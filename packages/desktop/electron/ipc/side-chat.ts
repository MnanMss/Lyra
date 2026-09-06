/**
 * The side chat, and the task queue it dispatches into.
 *
 * A second conversation about the same session: it can read the transcript and hand work to the
 * agent, but its own replies never join that transcript. Keeping the two apart is most of what
 * this file is for — hence its own channel prefix and its own emit path.
 */

import { ipcMain } from "electron";
import type { AgentEvent, AgentSession, Settings, UserContent } from "@lyra/core";
import { clearSideChat, loadSideChat, saveSideChat } from "../sidechat-store.ts";
import { SideChat, restoredSideChatMessages } from "@lyra/core";

export interface SideChatIpcDeps {
	sideChats: Map<string, SideChat>;
	sessions: Map<string, AgentSession>;
	settings(): Settings;
	ensureSession(sessionId: string): Promise<AgentSession | null>;
	broadcastSideChat(sessionId: string, event: AgentEvent): void;
}

export function registerSideChatIpc({ sideChats, sessions, settings, ensureSession, broadcastSideChat }: SideChatIpcDeps): void {
	const opening = new Map<string, Promise<SideChat | null>>();
	function reportError(sessionId: string, error: unknown): void {
		broadcastSideChat(sessionId, { type: "notice", level: "error", message: error instanceof Error ? error.message : String(error) });
		broadcastSideChat(sessionId, { type: "agent_end", reason: "error", error: String(error) });
	}
	async function ensureSideChat(sessionId: string): Promise<SideChat | null> {
		const existing = sideChats.get(sessionId);
		if (existing) { existing.updateSettings(settings()); return existing; }
		const pending = opening.get(sessionId);
		if (pending) return pending;
		const operation = (async () => {
			const main = await ensureSession(sessionId);
			if (!main) return null;
			const chat = new SideChat({ main, settings: settings(), emit: async (event) => {
				broadcastSideChat(sessionId, event);
				if (event.type === "message_end" || event.type === "rewound") {
					try { await saveSideChat(sessionId, chat.state().messages); }
					catch (error) {
						console.error("[sidechat] Failed to persist transcript", error);
						broadcastSideChat(sessionId, { type: "notice", level: "error", message: "侧边聊天保存失败，请检查存储空间与目录权限。" });
					}
				}
			} });
			chat.restore(await loadSideChat(sessionId));
			sideChats.set(sessionId, chat);
			return chat;
		})();
		opening.set(sessionId, operation);
		try { return await operation; }
		finally { if (opening.get(sessionId) === operation) opening.delete(sessionId); }
	}

	ipcMain.handle("sidechat:state", async (_event, sessionId: string) => {
		const existing = sideChats.get(sessionId);
		if (existing) return existing.state();
		// State is read on every navigation, even with the pane closed. Do not pin a live agent.
		const messages = await loadSideChat(sessionId);
		const created = await opening.get(sessionId) ?? sideChats.get(sessionId);
		return created ? created.state() : { messages: restoredSideChatMessages(messages), running: false, revision: 0 };
	});

	ipcMain.handle("sidechat:ask", async (_event, sessionId: string, content: UserContent[]) => {
		const chat = await ensureSideChat(sessionId);
		if (!chat) throw new Error(`Session ${sessionId} is not open.`);
		// Not awaited, same as `agent:prompt` — the reply streams back over IPC.
		void chat.ask(content).catch((error: unknown) => reportError(sessionId, error));
	});

	/*
	 * Editing a question already asked, and answering from there.
	 *
	 * Not awaited, the same as `ask`: the answer streams back over IPC and the round trip would
	 * otherwise hold the renderer for as long as the model takes.
	 */
	ipcMain.handle("sidechat:editAndResend", async (_event, sessionId: string, index: number, content: UserContent[]) => {
		const chat = await ensureSideChat(sessionId);
		if (!chat) throw new Error(`Session ${sessionId} is not open.`);
		void chat.editAndResend(index, content).catch((error: unknown) => reportError(sessionId, error));
	});

	ipcMain.handle("sidechat:abort", async (_event, sessionId: string) => {
		sideChats.get(sessionId)?.abort();
	});

	ipcMain.handle("sidechat:reset", async (_event, sessionId: string) => {
		await opening.get(sessionId);
		sideChats.get(sessionId)?.reset();
		// Clearing the panel means clearing it, including next time the app starts.
		await clearSideChat(sessionId);
	});

	ipcMain.handle("tasks:list", async (_event, sessionId: string) => sessions.get(sessionId)?.taskQueue ?? []);

	ipcMain.handle("tasks:cancel", async (_event, sessionId: string, taskId: string) => {
		const session = sessions.get(sessionId);
		return session ? session.cancelTask(taskId) : false;
	});

	/*
	 * Clearing a row off the list, which is not the same as cancelling the work.
	 *
	 * The list is a receipt for what the side chat handed over; the work itself, if it ran, is in
	 * the transcript and stays there. Only finished tasks can go — see `TaskQueue.dismiss`.
	 */
	ipcMain.handle("tasks:dismiss", async (_event, sessionId: string, taskId: string) => {
		const session = sessions.get(sessionId);
		return session ? session.dismissTask(taskId) : false;
	});

	/*
	 * Picking a stopped task back up, which is the way out of the dead end this used to be.
	 *
	 * Pausing the main session cancels whatever it was running, dispatched tasks included, and that
	 * was terminal: the row said the task had been interrupted and nothing — continuing the main
	 * conversation, asking the side chat again — could bring it back. Now the same task goes back on
	 * the queue and drains when the session is free.
	 */
	ipcMain.handle("tasks:resume", async (_event, sessionId: string, taskId: string) => {
		const session = sessions.get(sessionId);
		return session ? session.resumeTask(taskId) : false;
	});
}
