/**
 * Enforces protocol-level invariants on conversation history before sending to providers.
 *
 * All major LLM providers enforce strict tool pairing rules on the wire:
 * 1. OpenAI Responses:
 *    Every `function_call` must be accompanied by its `function_call_output`.
 *    An unanswered tool call causes HTTP 400 (`No tool output found for function call ...`).
 * 2. Anthropic Messages:
 *    Every `tool_use` block in an assistant message must have a matching `tool_result`
 *    in the immediately following user message. Missing results cause HTTP 400.
 * 3. OpenAI Chat Completions:
 *    An assistant message with `tool_calls` must be followed by `role: "tool"` messages
 *    responding to each `tool_call_id`. Missing results cause HTTP 400.
 *
 * If a session's history contains an assistant message with tool calls that were never
 * answered (e.g. aborted mid-turn, process crash before execution, or network disconnect),
 * sending it raw crashes the conversation irrevocably.
 *
 * This sanitizer synthesizes a clear error toolResult for any unanswered toolCall,
 * preserving turn atomicity and repairing protocol invariants without losing history.
 */

import type { AssistantMessage, Message, ToolResultMessage } from "../types.ts";

export function sanitizeToolPairing(messages: Message[]): Message[] {
	const out: Message[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		out.push(message);

		if (message.role !== "assistant") continue;

		const toolCalls = (message as AssistantMessage).content.filter((c) => c.type === "toolCall");
		if (toolCalls.length === 0) continue;

		// Collect the toolResults in the immediately following run
		const resultsRun: ToolResultMessage[] = [];
		let after = i + 1;
		for (; after < messages.length; after++) {
			const next = messages[after];
			if (next.role !== "toolResult") break;
			resultsRun.push(next);
		}

		// Check which tool calls have an answer in this run
		const answeredIds = new Set(resultsRun.map((r) => r.toolCallId));
		const missingCalls = toolCalls.filter((tc) => !answeredIds.has(tc.id));

		if (missingCalls.length > 0) {
			// Synthesize a placeholder toolResult so the wire protocol invariants remain unbroken
			for (const missing of missingCalls) {
				const syntheticResult: ToolResultMessage = {
					role: "toolResult",
					toolCallId: missing.id,
					toolName: missing.name,
					content: [{ type: "text", text: "[Turn was interrupted before tool execution could complete]" }],
					isError: true,
					timestamp: message.timestamp || Date.now(),
				};
				resultsRun.push(syntheticResult);
			}

			// Push the existing and synthetic results
			out.push(...resultsRun);
			i = after - 1;
		}
	}

	return out;
}
