import type { Message } from "@lyra/core";
import { isNudge } from "./grouping.ts";

/** Message indices preserve distinct targets for identical questions and attachment-only turns. */
export function questionsIn(messages: readonly Message[]) {
	return messages.flatMap((message, index) => {
		if (message.role !== "user" || message.synthetic || message.ruleMatch || isNudge(message)) return [];
		const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
		return [{ index, text: text || "图片消息" }];
	});
}
