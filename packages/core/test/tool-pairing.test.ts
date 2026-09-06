/**
 * A turn that asked for two tools at once, on its way back to the provider.
 *
 * The shape this checks is not cosmetic. Relays that translate Responses into Chat Completions
 * make one assistant message per `function_call` item, and Chat Completions requires the message
 * after one carrying `tool_calls` to be the tool message answering it — so two calls in a row are
 * rejected outright:
 *
 *     an assistant message with 'tool_calls' must be followed by tool messages responding to
 *     each 'tool_call_id'. The following tool_call_ids did not have response messages: bash:0
 *
 * Verified against the relay this was reported on: calls and results interleaved are accepted,
 * the same conversation with both calls first is a 400 every time.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnthropicMessages } from "../src/ai/anthropic-messages-request.ts";
import { toResponsesInput } from "../src/ai/openai-responses-request.ts";
import { sanitizeChatCompletionsHistory, toChatCompletionsMessages } from "../src/ai/openai-chat-completions-request.ts";
import type { AssistantMessage, Message, ToolResultMessage } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "relay",
		model: "kimi-k3",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: 1,
	};
}

function call(id: string, name: string): Extract<AssistantMessage["content"][number], { type: "toolCall" }> {
	return { type: "toolCall", id, name, arguments: {}, argumentsText: "{}" };
}

function answer(id: string, text: string): ToolResultMessage {
	return { role: "toolResult", toolCallId: id, toolName: "x", content: [{ type: "text", text }], isError: false, timestamp: 2 };
}

const user: Message = { role: "user", content: [{ type: "text", text: "看看项目" }], timestamp: 0 };

/** Just the parts that decide whether the request is well formed. */
const shape = (input: unknown[]) =>
	input.map((item) => {
		const it = item as { type: string; call_id?: string };
		return it.call_id ? `${it.type}:${it.call_id}` : it.type;
	});

test("each call is followed by its own result", () => {
	const input = toResponsesInput([
		user,
		assistant([call("a", "bash"), call("b", "glob")]),
		answer("a", "listing"),
		answer("b", "no match"),
	]);

	assert.deepEqual(shape(input), [
		"message",
		"function_call:a",
		"function_call_output:a",
		"function_call:b",
		"function_call_output:b",
	]);
});

test("results recorded in completion order are paired back to their calls", () => {
	// What the log holds after the quicker tool finished first.
	const input = toResponsesInput([
		user,
		assistant([call("a", "bash"), call("b", "glob")]),
		answer("b", "no match"),
		answer("a", "listing"),
	]);

	assert.deepEqual(shape(input), [
		"message",
		"function_call:a",
		"function_call_output:a",
		"function_call:b",
		"function_call_output:b",
	]);
	// And the outputs still carry their own text rather than each other's.
	assert.equal((input[2] as { output: string }).output, "listing");
	assert.equal((input[4] as { output: string }).output, "no match");
});

test("a call with no result is left unanswered rather than given someone else's", () => {
	const input = toResponsesInput([user, assistant([call("a", "bash"), call("b", "glob")]), answer("b", "no match")]);

	assert.deepEqual(shape(input), ["message", "function_call:a", "function_call:b", "function_call_output:b"]);
});

test("a result whose call is not in the history keeps its place", () => {
	const input = toResponsesInput([user, assistant([call("a", "bash")]), answer("a", "listing"), answer("z", "orphan")]);

	assert.deepEqual(shape(input), [
		"message",
		"function_call:a",
		"function_call_output:a",
		"function_call_output:z",
	]);
});

test("a truncated history that starts with a result still sends it", () => {
	const input = toResponsesInput([answer("a", "listing"), user]);

	assert.deepEqual(shape(input), ["function_call_output:a", "message"]);
});

test("ids repeated across turns are answered within their own turn", () => {
	// Relays that name calls after the tool (`bash:0`) reuse the same id every turn.
	const input = toResponsesInput([
		user,
		assistant([call("bash:0", "bash")]),
		answer("bash:0", "first"),
		assistant([call("bash:0", "bash")]),
		answer("bash:0", "second"),
	]);

	assert.deepEqual(
		input.map((item) => (item as { output?: string }).output).filter(Boolean),
		["first", "second"],
	);
});

test("Anthropic gets its results in call order whatever order they finished in", () => {
	const messages: Message[] = [
		user,
		assistant([call("a", "bash"), call("b", "glob")]),
		answer("b", "no match"),
		answer("a", "listing"),
	];

	const out = toAnthropicMessages(messages);
	const results = out[out.length - 1];
	assert.equal(results.role, "user");
	assert.deepEqual(
		results.content.map((block) => (block as { tool_use_id: string }).tool_use_id),
		["a", "b"],
	);
});

test("an Anthropic result with no matching call is kept at the end of its run", () => {
	const out = toAnthropicMessages([
		user,
		assistant([call("a", "bash")]),
		answer("z", "orphan"),
		answer("a", "listing"),
	]);

	const results = out[out.length - 1];
	assert.deepEqual(
		results.content.map((block) => (block as { tool_use_id: string }).tool_use_id),
		["a", "z"],
	);
});

test("Chat Completions: prunes pure-thinking assistant without tools and drops subsequent synthetic nudge", () => {
	const pureThinkingAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "Just thinking and no answer..." }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 10,
	};
	const syntheticNudge: Message = {
		role: "user",
		content: [{ type: "text", text: "（自动继续）上一条回复是空的。请直接开始执行：说明你要做什么，并调用工具去做。" }],
		timestamp: 11,
		synthetic: true,
	};
	const nextUser: Message = {
		role: "user",
		content: [{ type: "text", text: "真正的用户新消息" }],
		timestamp: 12,
	};

	const sanitized = sanitizeChatCompletionsHistory([user, pureThinkingAssistant, syntheticNudge, nextUser]);
	assert.equal(sanitized.length, 2);
	assert.deepEqual(sanitized, [user, nextUser]);

	const wire = toChatCompletionsMessages("", [user, pureThinkingAssistant, syntheticNudge, nextUser]);
	assert.equal(wire.length, 2);
	assert.equal((wire[0] as { role: string }).role, "user");
	assert.equal((wire[1] as { role: string }).role, "user");
});

test("Chat Completions: preserves assistant with tool calls even if text is empty", () => {
	const toolCallAssistant: AssistantMessage = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Thinking before call..." },
			call("call-1", "bash"),
		],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: 20,
	};
	const wire = toChatCompletionsMessages("", [user, toolCallAssistant, answer("call-1", "ok")]);
	assert.equal(wire.length, 3);
	assert.equal((wire[1] as { role: string }).role, "assistant");
	assert.ok((wire[1] as { tool_calls: unknown[] }).tool_calls.length > 0);
	assert.equal((wire[2] as { role: string }).role, "tool");
});

test("Chat Completions: fallback protects against standalone unpruned empty assistant", () => {
	const standaloneEmptyAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "pondering..." }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 30,
	};

	// Directly testing the serializer loop fallback net
	const wire = toChatCompletionsMessages("", [standaloneEmptyAssistant]);
	assert.equal(wire.length, 0); // because it is pruned by sanitizeChatCompletionsHistory

	// If an assistant has whitespace-only text that bypassed basic checks, it gets a non-empty fallback content
	const whitespaceAssistant: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "   " }],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 31,
	};
	const wireWhitespace = toChatCompletionsMessages("", [whitespaceAssistant]);
	// whitespace-only is also pruned by sanitizeChatCompletionsHistory
	assert.equal(wireWhitespace.length, 0);
});

test("Chat Completions: parallel tool results are never duplicated", () => {
	const toolCallAssistant: AssistantMessage = {
		role: "assistant",
		content: [call("call-1", "bash"), call("call-2", "read"), call("call-3", "glob")],
		api: "openai-chat-completions",
		provider: "relay",
		model: "test",
		usage: emptyUsage(),
		stopReason: "toolUse",
		timestamp: 20,
	};
	const wire = toChatCompletionsMessages("", [
		user,
		toolCallAssistant,
		answer("call-1", "res1"),
		answer("call-2", "res2"),
		answer("call-3", "res3"),
		user,
	]) as any[];

	// 应该依次为: user, assistant(with 3 calls), tool(1), tool(2), tool(3), user
	assert.equal(wire.length, 6);
	assert.equal(wire[0].role, "user");
	assert.equal(wire[1].role, "assistant");
	assert.equal(wire[1].tool_calls.length, 3);

	const toolResults = wire.filter((m) => m.role === "tool");
	assert.equal(toolResults.length, 3);
	assert.deepEqual(
		toolResults.map((m) => m.tool_call_id),
		["call-1", "call-2", "call-3"],
	);
	assert.equal(wire[5].role, "user");
});

test("Chat Completions: orphan tool result with no prior assistant message still outputs once", () => {
	const wire = toChatCompletionsMessages("", [answer("orphan-1", "orphan result"), user]) as any[];
	assert.equal(wire.length, 2);
	assert.equal(wire[0].role, "tool");
	assert.equal(wire[0].tool_call_id, "orphan-1");
	assert.equal(wire[1].role, "user");
});

test("Chat Completions: usage keeps input and cacheRead disjoint and captures reasoning tokens", async () => {
	const { openaiChatCompletionsProvider } = await import("../src/ai/openai-chat-completions.ts");
	const sseData = [
		`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
		`data: ${JSON.stringify({
			choices: [{ delta: {} }],
			usage: {
				prompt_tokens: 1000,
				completion_tokens: 50,
				prompt_tokens_details: { cached_tokens: 800 },
				completion_tokens_details: { reasoning_tokens: 30 },
			},
		})}\n\n`,
		"data: [DONE]\n\n",
	].join("");

	const mockFetch = async () => new Response(sseData, { status: 200, headers: { "content-type": "text/event-stream" } });
	const providerConfig = {
		id: "test",
		name: "test",
		baseUrl: "https://example.invalid",
		api: "openai-chat-completions" as const,
		apiKey: "test",
		enabled: true,
		models: [],
	};
	const modelConfig = {
		modelId: "test-model",
		contextWindow: 128000,
		maxOutputTokens: 4096,
		pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
	};

	const stream = openaiChatCompletionsProvider.stream(
		providerConfig,
		modelConfig,
		{ systemPrompt: "", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }], tools: [] },
		{ fetch: mockFetch as any },
	);

	let finalMessage: AssistantMessage | null = null;
	for await (const event of stream) {
		if (event.type === "done") {
			finalMessage = event.message;
		}
	}

	assert.ok(finalMessage);
	// prompt_tokens (1000) = cacheRead (800) + input (200)
	assert.equal(finalMessage.usage.cacheRead, 800);
	assert.equal(finalMessage.usage.input, 200);
	assert.equal(finalMessage.usage.output, 50);
	assert.equal(finalMessage.usage.reasoning, 30);
	assert.equal(finalMessage.usage.total, 1050); // 200 + 50 + 800
});
