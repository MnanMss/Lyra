/**
 * Saying something, and everything that follows from it.
 *
 * Sending, editing, retrying, interrupting. The composer's copy of a message is painted before
 * anything is stored — a conversation that swallows what you typed for two seconds while a session
 * is created reads as broken — and the stored copy replaces it when the runtime confirms it.
 */

import type { ApprovalDecision, Message, ThinkingLevel, UserContent } from "@lyra/core";
import { prune, without } from "./derive.ts";
import { loadCarried, relight, saveCarried } from "./turn-meter.ts";
import type { AppState } from "./index.ts";
import { bridge } from "../services/index.ts";

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function turnSlice(set: Set, get: Get) {
	const creating = new Map<number, ReturnType<typeof bridge.sessions.create>>();
	return {
	async send(content: UserContent[], options: { synthetic?: boolean; carryOn?: boolean; deliver?: "steer" | "followUp" } = {}) {
		const { workspace, settings, scratchCwd, selectionEpoch: epoch } = get();
		let sessionId = get().activeSessionId;
		const cwd = workspace?.path ?? scratchCwd;
		if (!sessionId && !cwd) { await get().pickWorkspace(); return; }
		// A second submission in the same draft shares its identity, never its title as a key.
		const inFlight = !sessionId ? creating.get(epoch) : undefined;
		if (inFlight) {
			try { sessionId = (await inFlight).meta.id; }
			catch { return; }
		}
		const ownsSelection = () => get().selectionEpoch === epoch;
		const pending: Message = { role: "user", content, timestamp: Date.now(), ...(options.synthetic ? { synthetic: true } : {}) };
		const carriedMeter = sessionId ? (get().carried[sessionId] ?? loadCarried(sessionId)) : null;
		const meter = relight(options.carryOn && sessionId ? carriedMeter : null, Date.now());
		if (sessionId) saveCarried(sessionId, null);
		if (ownsSelection()) set({
			messages: [...get().messages, pending], pendingUserMessage: { sessionId: sessionId ?? null, message: pending },
			running: true, stopped: null, turnStartedAt: meter.startedAt, turnTokens: meter.tokens,
		});
		if (sessionId) set({
			turns: { ...get().turns, [sessionId]: meter }, carried: without(get().carried, sessionId),
			activity: { ...get().activity, [sessionId]: "running" },
			sessions: get().sessions.map((session) => session.id === sessionId ? { ...session, updatedAt: Date.now() } : session),
		});
		let resumePending = false;
		if (!sessionId && cwd) {
			const creation = bridge.sessions.create(cwd, settings?.defaultModelId ?? "", { content, synthetic: options.synthetic });
			creating.set(epoch, creation);
			try {
				const snapshot = await creation;
				sessionId = snapshot.meta.id;
				resumePending = true;
				const listed = snapshot.meta;
				const messages = snapshot.messages;
				set({
					sessions: [listed, ...get().sessions.filter((session) => session.id !== listed.id)],
					activity: { ...get().activity, [sessionId]: "running" },
					turns: { ...get().turns, [sessionId]: meter },
					sessionCache: prune({ ...get().sessionCache, [sessionId]: {
						meta: listed, messages, toolRuns: {},
						state: { running: true, approvals: [], todos: [], compactions: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null },
					} }, sessionId),
					...(ownsSelection() ? {
						activeSessionId: sessionId, meta: listed, messages, toolRuns: {}, approvals: [],
						loadingSession: false, pendingUserMessage: null,
					} : {}),
				});
			} catch (cause) {
				if (ownsSelection()) set({ running: false, stopped: "error", turnStartedAt: null, pendingUserMessage: null });
				get().notify(`新建会话失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
				return;
			} finally { creating.delete(epoch); }
		}
		if (!sessionId) return;
		const id = sessionId;
		try {
			const meta = await bridge.agent.prompt(id, content, { ...options, resumePending });
			const cached = get().sessionCache[id];
			set({
				sessions: get().sessions.map((listed) => listed.id === id ? meta : listed),
				...(cached ? { sessionCache: { ...get().sessionCache, [id]: { ...cached, meta } } } : {}),
				...(get().activeSessionId === id ? { meta } : {}),
			});
			if (get().activeSessionId === id && get().workspace && get().workspace?.path !== meta.cwd) {
				const workspace = await bridge.workspace.info(meta.cwd);
				if (get().activeSessionId === id) set({ workspace });
			}
			const capabilities = await bridge.sessions.capabilities(id);
			if (get().activeSessionId === id) set({ capabilities });
		} catch (cause) {
			const cached = get().sessionCache[id];
			set({ activity: { ...get().activity, [id]: "failed" }, turns: without(get().turns, id),
				...(cached?.state ? { sessionCache: { ...get().sessionCache, [id]: { ...cached, state: { ...cached.state, running: false, stopped: "error", pendingUserMessage: null } } } } : {}),
			});
			if (get().activeSessionId === id) set({ running: false, stopped: "error", pendingUserMessage: null, turnStartedAt: null });
			get().notify(`发送失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
		}
	},

  /**
   * Run the turn again, from the message that started it.
   *
   * Failures are usually transport-level — a dropped socket, a relay hiccup — and the right
   * response is to send exactly the same thing again. Implemented on top of `editMessage`
   * because re-asking a question *is* replacing it with itself: everything after has to go,
   * for the same reason it does when the wording changes.
   */
  async retryFrom(index: number) {
    const messages = get().messages;
    for (let i = Math.min(index, messages.length - 1); i >= 0; i--) {
      const message = messages[i];
      if (message.role === "user" && !message.synthetic) {
        await get().editMessage(i, message.content);
        return;
      }
    }
  },

  async editMessage(index: number, content: UserContent[]) {
    const sessionId = get().activeSessionId;
    if (!sessionId || get().running) return;

    /*
     * Optimistic, and destructive on purpose.
     *
     * The reply being replaced is on screen right now; leaving it there while the new turn
     * spins up would show an answer to a question that has already been withdrawn. Cutting
     * first makes the screen agree with what is about to be sent.
     */
    const pending: Message = {
      role: "user",
      content,
      timestamp: Date.now(),
    };
    set({
      messages: [...get().messages.slice(0, index), pending],
      pendingUserMessage: { sessionId, message: pending },
      toolRuns: {},
      approvals: [],
      running: true,
      turnStartedAt: Date.now(),
      turnTokens: 0,
      /*
       * From zero, and the carried meter goes with the reply it belonged to.
       *
       * 重试 is the opposite of 继续: it throws away what the turn did and asks again, paying for it
       * a second time. Carrying the paused turn's minutes and tokens into that would report the
       * discarded work as part of the work that replaced it.
       */
      turns: { ...get().turns, [sessionId]: { startedAt: Date.now(), tokens: 0 } },
      carried: without(get().carried, sessionId),
      // The cached copy is now wrong; it will be rebuilt from the events that follow.
      sessionCache: without(get().sessionCache, sessionId),
    });
    saveCarried(sessionId, null);

    await bridge.agent.editMessage(sessionId, index, content);
  },

  async abort() {
    const sessionId = get().activeSessionId;
    if (sessionId) await bridge.agent.abort(sessionId);
  },

  async respondToApproval(id: string, decision: ApprovalDecision) {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    set({ approvals: get().approvals.filter((a) => a.id !== id) });
    await bridge.agent.approve(sessionId, id, decision);
  },

  /**
   * Choose the model this conversation runs on, at any point in it.
   *
   * This used to refuse once a conversation had started, because stored messages carry
   * provider-specific handles — the `signature` on a thinking block, the encrypted reasoning
   * payload replayed on the next turn — and handing one provider's handle to another is rejected
   * outright rather than ignored. That is a real hazard, but refusing the switch was the wrong
   * answer to it: the handles are droppable, and what they buy is continuity of the model's own
   * chain of thought, not the conversation itself.
   *
   * So the switch goes through and `stripStaleHandles` clears the handles written before it. What
   * is lost is the earlier reasoning context, which the warning below says plainly — the visible
   * transcript, and everything the new model reads, is unchanged.
   */
  async setModel(modelId: string, options: { asDefault?: boolean } = {}) {
    const { activeSessionId, settings, meta } = get();
    if (activeSessionId) {
      /*
       * Paint this conversation's choice before the write crosses IPC.
       *
       * Writing it after `await` let the old conversation's meta arrive after `newSession` had
       * cleared it, making a blank conversation display the model that belonged to the one left
       * behind. A failed write is rolled back only while that same conversation and choice are
       * still on screen, so neither path can overwrite a conversation opened in the meantime.
       */
      if (meta) set({ meta: { ...meta, modelId } });
      try {
        await bridge.agent.setModel(activeSessionId, modelId);
      } catch (cause) {
        const current = get();
        if (
          meta &&
          current.activeSessionId === activeSessionId &&
          current.meta?.id === meta.id &&
          current.meta.modelId === modelId
        ) {
          set({ meta });
        }
        throw cause;
      }
    }
    /*
     * The app default is a separate decision, and used to be made for you.
     *
     * Every pick wrote `defaultModelId`, so trying a cheaper model on one question silently
     * re-aimed every conversation started afterwards. A conversation with no session yet is the
     * exception: there is nothing else for the choice to land on, and it is about to become the
     * model the new session is created with.
     */
    if (settings && (options.asDefault || !activeSessionId))
      await get().saveSettings({ ...settings, defaultModelId: modelId });

  },

  /**
   * The reasoning level for the conversation on screen.
   *
   * With no session yet there is nothing to write it to, so it lands on the app default — which
   * is also what that conversation will be created with, so the control means the same thing in
   * both cases. `meta` is updated straight away rather than waiting for the round trip: this is
   * read by the composer's label, and a control that lags a frame behind the press reads as one
   * that did not take.
   */
  async setThinking(thinking: ThinkingLevel) {
    const { activeSessionId, meta, settings } = get();
    if (activeSessionId) {
      if (meta) set({ meta: { ...meta, thinking } });
      await bridge.agent.setThinking(activeSessionId, thinking);
      return;
    }
    if (settings) await get().saveSettings({ ...settings, thinking });
  },

  async refreshSync() {
    set({ sync: await bridge.sync.status() });
  },
  };
}

