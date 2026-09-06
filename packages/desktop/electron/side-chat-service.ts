/** Shared side-chat operations used by Electron IPC and the mobile sync transport. */

import { SideChat, restoredSideChatMessages, type AgentEvent, type UserContent } from "@lyra/core";
import { settings } from "./app-settings.ts";
import { broadcastSideChat, ensureLiveSession, sessions, sideChats } from "./session-hub.ts";
import { clearSideChat, loadSideChat, saveSideChat } from "./sidechat-store.ts";

const opening = new Map<string, Promise<SideChat | null>>();

function reportError(sessionId: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	broadcastSideChat(sessionId, { type: "notice", level: "error", message });
	broadcastSideChat(sessionId, { type: "agent_end", reason: "error", error: message });
}

async function ensureSideChat(sessionId: string): Promise<SideChat | null> {
	const existing = sideChats.get(sessionId);
	if (existing) {
		existing.updateSettings(settings());
		return existing;
	}
	const pending = opening.get(sessionId);
	if (pending) return pending;

	const operation = (async () => {
		const main = await ensureLiveSession(sessionId);
		if (!main) return null;
		const chat = new SideChat({
			main,
			settings: settings(),
			emit: async (event: AgentEvent) => {
				broadcastSideChat(sessionId, event);
				if (event.type !== "message_end" && event.type !== "rewound") return;
				try {
					await saveSideChat(sessionId, chat.state().messages);
				} catch (error) {
					console.error("[sidechat] Failed to persist transcript", error);
					broadcastSideChat(sessionId, {
						type: "notice",
						level: "error",
						message: "侧边聊天保存失败，请检查存储空间与目录权限。",
					});
				}
			},
		});
		chat.restore(await loadSideChat(sessionId));
		sideChats.set(sessionId, chat);
		return chat;
	})();
	opening.set(sessionId, operation);
	try {
		return await operation;
	} finally {
		if (opening.get(sessionId) === operation) opening.delete(sessionId);
	}
}

export async function sideChatState(sessionId: string) {
	const existing = sideChats.get(sessionId);
	if (existing) return existing.state();
	const messages = await loadSideChat(sessionId);
	const created = await opening.get(sessionId) ?? sideChats.get(sessionId);
	return created ? created.state() : { messages: restoredSideChatMessages(messages), running: false, revision: 0 };
}

export async function sideChatAsk(sessionId: string, content: UserContent[]): Promise<void> {
	const chat = await ensureSideChat(sessionId);
	if (!chat) throw new Error(`Session ${sessionId} is not open.`);
	void chat.ask(content).catch((error: unknown) => reportError(sessionId, error));
}

export async function sideChatEditAndResend(sessionId: string, index: number, content: UserContent[]): Promise<void> {
	const chat = await ensureSideChat(sessionId);
	if (!chat) throw new Error(`Session ${sessionId} is not open.`);
	void chat.editAndResend(index, content).catch((error: unknown) => reportError(sessionId, error));
}

export function sideChatAbort(sessionId: string): void {
	sideChats.get(sessionId)?.abort();
}

export async function sideChatReset(sessionId: string): Promise<void> {
	await opening.get(sessionId);
	sideChats.get(sessionId)?.reset();
	await clearSideChat(sessionId);
}

export function tasksList(sessionId: string) {
	return sessions.get(sessionId)?.taskQueue ?? [];
}

export async function tasksCancel(sessionId: string, taskId: string): Promise<boolean> {
	return (await sessions.get(sessionId)?.cancelTask(taskId)) ?? false;
}

export async function tasksDismiss(sessionId: string, taskId: string): Promise<boolean> {
	return (await sessions.get(sessionId)?.dismissTask(taskId)) ?? false;
}

export async function tasksResume(sessionId: string, taskId: string): Promise<boolean> {
	return (await sessions.get(sessionId)?.resumeTask(taskId)) ?? false;
}
