import { readFileChange, undoFileChanges, type Message, type SessionStorage } from "@lyra/core";
import { sessions } from "./session-hub.ts";

export type { DeliveryFile, TurnDelivery } from "./delivery-record.ts";
import { collectDelivery, type TurnDelivery } from "./delivery-record.ts";
export function deliveryMessages(messages: Message[], timestamp: number): Message[] {
	const end = messages.findIndex((message) => message.role === "assistant" && message.timestamp === timestamp);
	if (end < 0) throw new Error("找不到对应的回答");
	let start = end - 1;
	while (start >= 0) {
		const message = messages[start];
		if (message.role === "assistant" && message.stopReason !== "toolUse" && message.stopReason !== "pending") break;
		start--;
	}
	return messages.slice(start + 1, end + 1);
}
export async function sessionDelivery(store: SessionStorage, sessionId: string, timestamp: number): Promise<TurnDelivery> {
	const live = sessions.get(sessionId);
	const meta = live?.meta ?? (await store.listSessions()).find((entry) => entry.id === sessionId);
	if (!meta) throw new Error("会话不存在");
	const messages = live?.messages ?? (await store.load(meta.projectId, sessionId))?.messages;
	if (!messages) throw new Error("会话记录不存在");
	return collectDelivery(sessionId, meta.cwd, deliveryMessages(messages, timestamp), timestamp);
}
export async function undoDeliveryFile(store: SessionStorage, sessionId: string, timestamp: number, path: string): Promise<void> {
	const delivery = await sessionDelivery(store, sessionId, timestamp);
	const file = delivery.files.find((entry) => entry.path === path);
	if (!file || !file.canUndo) throw new Error("文件没有可安全撤销的本轮改动");
	const meta = (await store.listSessions()).find((entry) => entry.id === sessionId);
	if (!meta || [...sessions.values()].some((session) => session.cwd === meta.cwd && session.running)) throw new Error("项目仍有任务运行，请结束后再撤销");
	await undoFileChanges(meta.cwd, await Promise.all(file.changeIds.map((id) => readFileChange(sessionId, id))));
}
