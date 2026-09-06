import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStore } from "../src/session/store.ts";
import type { AssistantMessage, Message, ToolResultMessage } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";
import { sanitizeToolPairing } from "../src/ai/sanitize-history.ts";
import { toResponsesInput } from "../src/ai/openai-responses-request.ts";
import { toAnthropicMessages } from "../src/ai/anthropic-messages-request.ts";
import { toChatCompletionsMessages } from "../src/ai/openai-chat-completions-request.ts";

test("truncateFrom uses active messages rather than physical line numbers when ghost messages exist", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-trunc-ghost-"));
	try {
		const store = new SessionStore(root);
		let meta = await store.create("/tmp/test", "test-model");

		const appendMsg = async (role: "user" | "assistant", text: string) => {
			meta = await store.append(meta, {
				type: "message",
				message: {
					role,
					content: [{ type: "text", text }],
					timestamp: Date.now(),
					...(role === "assistant"
						? {
								stopReason: "end",
								usage: emptyUsage(),
							}
						: {}),
				} as Message,
			});
		};

		// 1. 写入最初几条消息
		await appendMsg("user", "msg 0");
		await appendMsg("assistant", "msg 1");
		await appendMsg("user", "msg 2 (to be truncated)");
		await appendMsg("assistant", "msg 3 (to be truncated)");

		// 2. 截断到 index 2，使物理日志保留 msg 2 和 msg 3，但逻辑上被切除
		await store.truncateFrom(meta.projectId, meta.id, 2);

		let loaded = await store.load(meta.projectId, meta.id);
		assert.equal(loaded?.messages.length, 2);
		assert.deepEqual(
			loaded?.messages.map((m) => (m.content[0] as { text: string }).text),
			["msg 0", "msg 1"],
		);

		// 3. 继续写入更多消息
		await appendMsg("user", "msg 2 new");
		await appendMsg("assistant", "msg 3 new");
		await appendMsg("user", "msg 4 new");
		await appendMsg("assistant", "msg 5 new");

		loaded = await store.load(meta.projectId, meta.id);
		assert.equal(loaded?.messages.length, 6);

		// 4. 再次截断当前活跃消息的 index 4 (即保留前 4 条: msg 0, 1, 2 new, 3 new)
		// 如果实现错误地物理扫描，由于物理日志前部有幽灵消息，cutoff 会漂移！
		const after = await store.truncateFrom(meta.projectId, meta.id, 4);
		assert.equal(after?.messages.length, 4);
		assert.deepEqual(
			after?.messages.map((m) => (m.content[0] as { text: string }).text),
			["msg 0", "msg 1", "msg 2 new", "msg 3 new"],
		);

		// 重新从磁盘 load 验证物理截断 afterSeq 是否正确生效
		const reloaded = await new SessionStore(root).load(meta.projectId, meta.id);
		assert.equal(reloaded?.messages.length, 4);
		assert.deepEqual(
			reloaded?.messages.map((m) => (m.content[0] as { text: string }).text),
			["msg 0", "msg 1", "msg 2 new", "msg 3 new"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("truncateFrom maintains turn atomicity for parallel tool calls", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-trunc-atom-"));
	try {
		const store = new SessionStore(root);
		let meta = await store.create("/tmp/test", "test-model");

		// User prompt
		meta = await store.append(meta, {
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "Run tools" }], timestamp: 1 },
		});

		// Assistant with 3 parallel tool calls
		meta = await store.append(meta, {
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "call_1", name: "read", arguments: {} },
					{ type: "toolCall", id: "call_2", name: "read", arguments: {} },
					{ type: "toolCall", id: "call_3", name: "read", arguments: {} },
				],
				stopReason: "toolUse",
				timestamp: 2,
				usage: emptyUsage(),
			} as AssistantMessage,
		});

		// 3 tool results
		for (let i = 1; i <= 3; i++) {
			meta = await store.append(meta, {
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: `call_${i}`,
					toolName: "read",
					content: [{ type: "text", text: `result ${i}` }],
					timestamp: 2 + i,
				} as ToolResultMessage,
			});
		}

		let loaded = await store.load(meta.projectId, meta.id);
		assert.equal(loaded?.messages.length, 5); // 0: user, 1: assistant, 2: res1, 3: res2, 4: res3

		// 尝试在 toolResult 2 的位置截断 (index 3)
		// 原子性要求：必须向前收缩，绝不能保留 assistant 却切掉后两个 toolResult！
		const truncated = await store.truncateFrom(meta.projectId, meta.id, 3);
		assert.ok(truncated);

		// 此时应退回到 assistant 之前（即只保留 index 0: user），不会留下孤立的 toolCall
		assert.equal(truncated.messages.length, 1);
		assert.equal(truncated.messages[0].role, "user");

		const reloaded = await store.load(meta.projectId, meta.id);
		assert.equal(reloaded?.messages.length, 1);
		assert.equal(reloaded?.messages[0].role, "user");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("sanitizeToolPairing repairs broken tool calls across all three wire formats", () => {
	const brokenHistory: Message[] = [
		{
			role: "user",
			content: [{ type: "text", text: "Run tools" }],
			timestamp: 1,
		},
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
				{ type: "toolCall", id: "call_2", name: "glob", arguments: { pattern: "*.ts" } },
			],
			stopReason: "toolUse",
			timestamp: 2,
			usage: emptyUsage(),
		} as AssistantMessage,
		// Only call_1 has an answer, call_2 is orphaned
		{
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "bash",
			content: [{ type: "text", text: "file.txt" }],
			timestamp: 3,
		} as ToolResultMessage,
		{
			role: "user",
			content: [{ type: "text", text: "Next user prompt" }],
			timestamp: 4,
		},
	];

	const sanitized = sanitizeToolPairing(brokenHistory);

	// 1. Check OpenAI Responses: every function_call must have matching function_call_output
	const responsesInput = toResponsesInput(sanitized);
	const fnCalls = responsesInput.filter((it: any) => it.type === "function_call");
	const fnOutputs = responsesInput.filter((it: any) => it.type === "function_call_output");
	assert.equal(fnCalls.length, 2);
	assert.equal(fnOutputs.length, 2);
	assert.deepEqual(
		fnCalls.map((c: any) => c.call_id),
		fnOutputs.map((o: any) => o.call_id),
	);

	// 2. Check Anthropic Messages: assistant tool_use must be answered in following user message
	const anthropicWire = toAnthropicMessages(sanitized);
	const assistantMsg = anthropicWire.find((m) => m.role === "assistant");
	const toolResultsMsg = anthropicWire.find((m, idx) => idx > 0 && anthropicWire[idx - 1] === assistantMsg);
	assert.ok(assistantMsg && toolResultsMsg);
	assert.equal(toolResultsMsg.role, "user");
	const toolUseIds = assistantMsg.content.filter((c) => c.type === "tool_use").map((c: any) => c.id);
	const toolResultIds = toolResultsMsg.content.filter((c) => c.type === "tool_result").map((c: any) => c.tool_use_id);
	assert.deepEqual(toolUseIds, ["call_1", "call_2"]);
	assert.deepEqual(toolResultIds, ["call_1", "call_2"]);

	// 3. Check OpenAI Chat Completions: assistant tool_calls followed by matching role: "tool"
	const chatWire = toChatCompletionsMessages("", sanitized) as any[];
	const ccAssistant = chatWire.find((m) => m.role === "assistant" && m.tool_calls);
	assert.ok(ccAssistant);
	const ccToolCalls = ccAssistant.tool_calls.map((tc: any) => tc.id);
	const ccTools = chatWire.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
	assert.deepEqual(ccToolCalls, ["call_1", "call_2"]);
	assert.deepEqual(ccTools, ["call_1", "call_2"]);
});
