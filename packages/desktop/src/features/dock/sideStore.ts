/**
 * State for the side chat and the task queue.
 *
 * Kept apart from the main store because it is a different conversation with a different
 * lifetime: it restores from its own snapshots and never reaches the main session log.
 * Folding it into the main store would put two transcripts behind one set of message fields
 * and invite exactly the bug that makes a side-chat reply appear in the main thread.
 */

import type { AgentEvent, Message, QueuedTask, UserContent } from "@lyra/core";
import { create } from "zustand";
import { useDock } from "./store.ts";
import { reduceSideEvent, rebuildToolRuns, type SideConversation } from "./side-events.ts";
import type { ToolRun } from "../../store/tool-run.ts";

import { bridge } from "../../services/index.ts";

/**
 * What can occupy a pane. One of each at a time — two diffs of one worktree is not a thing.
 *
 * `chat` here is the *side* chat, a second conversation you can run beside the main one. The main
 * thread is `conversation`, which the dock adds to this set; the two names are close and the
 * things are not, which is worth the sentence. `files` is the tree and `file` is whichever one of
 * them is open — two panes, because they are two things you arrange separately.
 */
export type PanelKind =
	| "files"
	| "file"
	| "chat"
	/** Work the main agent delegated — see `components/subagents/`. */
	| "subagents"
	| "terminal"
	| "review"
	| "browser"
	| "tasks"
	| "trajectory";

/** Just enough of a preview for the panel to load it; the card owns the full record. */
interface BrowserPreview {
	id: string;
	sessionId: string;
	title: string;
	entry: string;
}

interface SideState {
	loading: boolean;
	error: string | null;
	/** The session this state belongs to, so a late event from the previous one is discarded. */
	sessionId: string | null;
	messages: Message[];
	toolRuns: Record<string, ToolRun>;
	running: boolean;
	/** Painted before the round trip, replaced by the stored copy when it arrives. */
	pending: Message | null;
	tasks: QueuedTask[];
	/** Text waiting to be put back into the composer, and a counter so repeats still register. */
	draftSeed: { text: string; nonce: number } | null;
	/** Client-side cache of in-memory side chats per session for seamless switching without flicker. */
	sessionCache: Record<string, SideConversation>;

	/**
	 * A command the user asked to run, waiting for the terminal to pick it up.
	 *
	 * Handed over rather than executed here: the pty belongs to the terminal pane, which may not
	 * exist yet when the button is pressed. The pane clears this once it has written it, so the
	 * same command is never run twice.
	 */
	pendingCommand: string | null;
	runInTerminal(command: string): void;
	commandTaken(): void;
	/**
	 * What the browser tab is showing.
	 *
	 * A preview handed over from the transcript, a URL typed into the address bar, or nothing.
	 * Held here rather than inside the panel so "open this in the side panel" can be a single
	 * call from a card that knows nothing about how the panel is built.
	 */
	browserTarget: { kind: "preview"; preview: BrowserPreview } | { kind: "url"; url: string } | null;
	openPreview(preview: BrowserPreview): void;
	openUrl(url: string): void;

	/** Point at a session and pull whatever conversation it already has. */
	attach(sessionId: string | null): Promise<void>;
	ask(content: UserContent[]): Promise<void>;
	abort(): Promise<void>;
	reset(): Promise<void>;
	/** Change a question already asked and answer from there. Everything after it is dropped. */
	editAndResend(index: number, content: UserContent[]): Promise<void>;
	cancelTask(taskId: string): Promise<void>;
	/** Take a finished row off the list. What it did, if anything, stays in the transcript. */
	dismissTask(taskId: string): Promise<void>;
	/** Put a stopped task back on the queue — interrupted by a pause, or failed. */
	resumeTask(taskId: string): Promise<void>;
	/** Hand text back to the composer — see the note on the implementation. */
	seedDraft(text: string): void;
	clearDraftSeed(): void;
	applyEvent(sessionId: string, event: AgentEvent & { sideRevision?: number }): void;
	setTasks(tasks: QueuedTask[]): void;
}

const reads = new Map<string, { events: (AgentEvent & { sideRevision?: number })[] }>();

const EMPTY: SideConversation = {
	error: null,
	messages: [],
	toolRuns: {},
	running: false,
	pending: null,
	tasks: [],
};

export const useSide = create<SideState>((set, get) => ({
	browserTarget: null,
	loading: false,
	sessionId: null,
	sessionCache: {},
	// Not in `EMPTY`: switching conversations should not throw away half-typed text, and the seed
	// is consumed by the composer within a tick of being set anyway.
	draftSeed: null,
	...EMPTY,

	openPreview: (preview) => set({ browserTarget: { kind: "preview", preview } }),
	openUrl: (url) => set({ browserTarget: { kind: "url", url } }),
	pendingCommand: null,
	runInTerminal: (command) => {
		set({ pendingCommand: command });
		// Make sure there is a terminal to pick it up. `open` focuses one that already exists
		// rather than adding a second, so a command run twice does not split the dock in two.
		useDock.getState().open("terminal");
	},
	commandTaken: () => set({ pendingCommand: null }),

	async attach(sessionId) {
		const previous = get();
		if (previous.sessionId === sessionId) return;
		if (previous.sessionId) set({ sessionCache: { ...previous.sessionCache, [previous.sessionId]: {
			messages: previous.messages, toolRuns: previous.toolRuns, running: previous.running,
			pending: previous.pending, tasks: previous.tasks, error: previous.error,
		} } });
		set({ sessionId, ...(sessionId ? get().sessionCache[sessionId] ?? EMPTY : EMPTY), loading: Boolean(sessionId) });
		if (!sessionId) return;
		const read = { events: [] as (AgentEvent & { sideRevision?: number })[] };
		reads.set(sessionId, read);
		try {
			const [snapshot, tasks] = await Promise.all([bridge.sideChat.state(sessionId), bridge.tasks.list(sessionId)]);
			if (reads.get(sessionId) !== read) return;
			let next: SideConversation = { ...EMPTY, messages: snapshot?.messages ?? [], running: snapshot?.running ?? false, tasks,
				toolRuns: snapshot ? rebuildToolRuns(snapshot.messages) : {} };
			// Replay only events newer than the snapshot, preserving both old history and live deltas.
			for (const event of read.events) {
				if (event.sideRevision === undefined || event.sideRevision > (snapshot?.revision ?? 0)) next = reduceSideEvent(next, event);
			}
			set((state) => ({ ...(state.sessionId === sessionId ? { ...next, loading: false } : {}), sessionCache: { ...state.sessionCache, [sessionId]: next } }));
		} catch (error) {
			if (get().sessionId === sessionId && reads.get(sessionId) === read) set({ loading: false, error: String(error) });
		} finally { if (reads.get(sessionId) === read) reads.delete(sessionId); }
	},

	async ask(content) {
		const sessionId = get().sessionId;
		if (!sessionId || get().running || get().loading) return;

		/*
		 * Paint it first.
		 *
		 * The first question of a session activates the main agent behind the scenes, which
		 * takes a second or more. Without this the composer would clear and nothing would take
		 * its place for that whole time.
		 */
		const pending: Message = { role: "user", content, timestamp: Date.now() };
		set({ messages: [...get().messages, pending], pending, running: true, error: null });
		try { await bridge.sideChat.ask(sessionId, content); }
		catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); get().applyEvent(sessionId, { type: "agent_end", reason: "error", error: String(error) }); }
	},

	/**
	 * Change a question already asked, and answer from there.
	 *
	 * Everything after it goes, because it was a reply to wording that no longer exists — the same
	 * rule the main conversation follows. Painted immediately for the same reason `ask` is: the
	 * round trip is long enough that a composer clearing to nothing reads as a lost message.
	 */
	async editAndResend(index, content) {
		const sessionId = get().sessionId;
		if (!sessionId || get().running || get().loading) return;
		const kept = get().messages.slice(0, index);
		const pending: Message = { role: "user", content, timestamp: Date.now() };
		set({ messages: [...kept, pending], pending, running: true, error: null });
		try { await bridge.sideChat.editAndResend(sessionId, index, content); }
		catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); get().applyEvent(sessionId, { type: "agent_end", reason: "error", error: String(error) }); }
	},

	async abort() {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		try { await bridge.sideChat.abort(sessionId); }
		catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); }
	},

	async reset() {
		const sessionId = get().sessionId;
		set({ ...EMPTY, loading: false, tasks: get().tasks });
		if (!sessionId) return;
		reads.delete(sessionId);
		try { await bridge.sideChat.reset(sessionId); }
		catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); }
	},

	async cancelTask(taskId) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		// Optimistic: the card should stop saying "queued" on the click, not on the round trip.
		set({
			tasks: get().tasks.map((t) => (t.id === taskId && t.status === "queued" ? { ...t, status: "cancelled" } : t)),
		});
		await bridge.tasks.cancel(sessionId, taskId);
	},

	async resumeTask(taskId) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		// Optimistic: the row should stop saying "interrupted" on the click.
		set({
			tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, status: "queued" as const, cancelledBy: undefined } : t)),
		});
		await bridge.tasks.resume(sessionId, taskId);
	},

	async dismissTask(taskId) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		// Optimistic, same as cancelling: the row goes on the click.
		set({ tasks: get().tasks.filter((t) => t.id !== taskId) });
		await bridge.tasks.dismiss(sessionId, taskId);
	},

	/**
	 * Put a task's text back where it was written, so it can be changed and sent again.
	 *
	 * Withdrawing a task should not throw away what it said — that is the whole reason to withdraw
	 * one rather than let it run. The composer holds its own text, so this is a seed it picks up
	 * rather than a value it is given; the counter is what makes withdrawing the same text twice
	 * register as two separate events.
	 */
	seedDraft(text) {
		set({ draftSeed: { text, nonce: get().draftSeed ? get().draftSeed!.nonce + 1 : 1 } });
	},

	clearDraftSeed: () => set({ draftSeed: null }),

	setTasks: (tasks) => set({ tasks }),

	applyEvent(sessionId, event) {
		// Background events update their cached conversation, never the visible one.
		const pendingRead = reads.get(sessionId);
		pendingRead?.events.push(event);
		const current = sessionId === get().sessionId ? get() : get().sessionCache[sessionId] ?? EMPTY;
		const next = reduceSideEvent(current, event);
		set((state) => ({ ...(sessionId === state.sessionId ? next : {}), sessionCache: { ...state.sessionCache, [sessionId]: next } }));
	},
}));
