/**
 * Our messages, in the shape the OpenAI Chat Completions API wants (`POST /v1/chat/completions`).
 */

import type { Message, ToolResultMessage, ToolSpec } from "../types.ts";

export function toChatCompletionsTools(tools: ToolSpec[]): unknown[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	}));
}

function toolResultMessage(result: ToolResultMessage): unknown {
	const content = result.content
		.map((c) => (c.type === "text" ? c.text : `[image ${c.mimeType}, ${c.data.length} base64 chars]`))
		.join("\n");
	return {
		role: "tool",
		tool_call_id: result.toolCallId,
		content,
	};
}

/**
 * Cleans conversation history for the OpenAI Chat Completions wire protocol.
 *
 * Chat Completions enforces strict invariants:
 * 1. An assistant message must have either non-empty content or tool_calls. Empty content ("")
 *    without tool_calls causes HTTP 400 (e.g. Gemini/relays returning INVALID_ARGUMENT).
 *    When a model spends its turn thinking and emits no text/tools, that turn is a no-op;
 *    we prune it along with any synthetic nudge following it.
 * 2. Tool results must correspond to an assistant tool call. Orphan tool results that have no
 *    prior assistant call are dropped or sanitized to avoid 400 errors.
 */
export function sanitizeChatCompletionsHistory(messages: Message[]): Message[] {
	const out: Message[] = [];
	const droppedEmptyAssistantIndices = new Set<number>();

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		if (message.role === "assistant") {
			const hasText = message.content.some((c) => c.type === "text" && c.text.trim().length > 0);
			const hasToolCalls = message.content.some((c) => c.type === "toolCall");

			if (!hasText && !hasToolCalls) {
				droppedEmptyAssistantIndices.add(i);
				continue;
			}
		} else if (message.role === "user") {
			if (droppedEmptyAssistantIndices.has(i - 1) && message.synthetic) {
				continue;
			}
		}

		out.push(message);
	}

	return out;
}

export function toChatCompletionsMessages(systemPrompt: string, messages: Message[]): unknown[] {
	const sanitized = sanitizeChatCompletionsHistory(messages);
	const out: unknown[] = [];
	if (systemPrompt) {
		out.push({ role: "system", content: systemPrompt });
	}

	for (let index = 0; index < sanitized.length; index++) {
		const message = sanitized[index];
		if (message.role === "user") {
			const hasImages = message.content.some((c) => c.type === "image");
			if (!hasImages) {
				let text = message.content
					.filter((c) => c.type === "text")
					.map((c) => (c.type === "text" ? c.text : ""))
					.join("\n");
				const prevMsg = index > 0 ? sanitized[index - 1] : undefined;
				if (prevMsg?.role === "assistant" && prevMsg.stopReason === "aborted" && !message.synthetic) {
					text = `[System note: Your previous response was interrupted by the user to provide new instructions. Abandon the interrupted thought and focus entirely on the latest user request below.]\n\n${text}`;
				}
				out.push({ role: "user", content: text });
			} else {
				out.push({
					role: "user",
					content: message.content.map((c) =>
						c.type === "text"
							? { type: "text", text: c.text }
							: {
									type: "image_url",
									image_url: { url: `data:${c.mimeType};base64,${c.data}` },
								},
					),
				});
			}
			continue;
		}

		if (message.role === "assistant") {
			const answers = new Map<string, ToolResultMessage>();
			let after = index + 1;
			for (; after < sanitized.length; after++) {
				const next = messages[after];
				if (next.role !== "toolResult") break;
				if (!answers.has(next.toolCallId)) answers.set(next.toolCallId, next);
			}

			const toolCalls: unknown[] = [];
			let text = "";

			for (const c of message.content) {
				if (c.type === "text") {
					text += c.text;
				} else if (c.type === "toolCall") {
					toolCalls.push({
						id: c.id,
						type: "function",
						function: {
							name: c.name,
							arguments: c.argumentsText ?? JSON.stringify(c.arguments),
						},
					});
				}
			}

			const msg: Record<string, unknown> = { role: "assistant" };
			if (text) {
				msg.content = text;
			} else if (toolCalls.length > 0) {
				msg.content = null;
			} else if (message.stopReason === "aborted") {
				msg.content = "[Turn interrupted by user]";
			} else {
				const hasThinking = message.content.some((c) => c.type === "thinking");
				msg.content = hasThinking ? "[Thought without final response]" : "[Empty response]";
			}
			if (toolCalls.length > 0) msg.tool_calls = toolCalls;

			out.push(msg);

			// Interleave / follow directly with tool messages responding to tool calls
			for (const tc of toolCalls as { id: string }[]) {
				const answer = answers.get(tc.id);
				if (answer) {
					out.push(toolResultMessage(answer));
				}
			}
			continue;
		}

		if (message.role === "toolResult") {
			// If not already consumed by the assistant loop above
			const prev = sanitized[index - 1];
			if (prev?.role !== "assistant") {
				out.push(toolResultMessage(message));
			}
		}
	}

	return out;
}
