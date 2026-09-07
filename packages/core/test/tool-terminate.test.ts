import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgent } from "../src/agent/loop.ts";
import { makeYieldTool } from "../src/runtime/yield-tool.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig, Tool } from "../src/types.ts";
import { emptyUsage } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
};

const PROVIDER: ProviderConfig = {
	id: "fake",
	name: "Fake",
	baseUrl: "http://localhost",
	api: "openai-responses",
	apiKey: "x",
	enabled: true,
	models: [MODEL],
};

test("a tool with terminate: true ends the agent loop immediately after executing", async () => {
	let streamCalls = 0;
	const terminatingTool = {
		name: "finish_work",
		description: "finishes the run immediately",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: async () => ({ content: [{ type: "text", text: "done" }], terminate: true }),
	} as unknown as Tool;

	const result = await runAgent(
		{
			sessionId: "test-terminate",
			cwd: "/tmp",
			provider: PROVIDER,
			model: MODEL,
			systemPrompt: "",
			tools: [terminatingTool],
			messages: [{ role: "user", content: [{ type: "text", text: "do work" }], timestamp: Date.now() }],
			streamFn: async () => {
				streamCalls++;
				return {
					role: "assistant",
					content: [{ type: "toolCall", id: `call-${streamCalls}`, name: "finish_work", arguments: {} }],
					api: "openai-responses",
					provider: "fake",
					model: "model",
					usage: emptyUsage(),
					stopReason: "toolUse",
					timestamp: Date.now(),
				} as AssistantMessage;
			},
		},
		() => {},
	);

	assert.equal(result.reason, "done");
	assert.equal(streamCalls, 1, "model should only be called once; terminating tool prevents further turns");
});

test("yield tool terminates loop on valid submission and prevents subsequent turns", async () => {
	let streamCalls = 0;
	const yieldTool = makeYieldTool({
		type: "object",
		required: ["summary"],
		properties: { summary: { type: "string" } },
	});

	const result = await runAgent(
		{
			sessionId: "test-yield-terminate",
			cwd: "/tmp",
			provider: PROVIDER,
			model: MODEL,
			systemPrompt: "",
			tools: [yieldTool],
			messages: [{ role: "user", content: [{ type: "text", text: "review" }], timestamp: Date.now() }],
			streamFn: async () => {
				streamCalls++;
				return {
					role: "assistant",
					content: [{ type: "toolCall", id: `call-${streamCalls}`, name: "yield", arguments: { summary: "ok" } }],
					api: "openai-responses",
					provider: "fake",
					model: "model",
					usage: emptyUsage(),
					stopReason: "toolUse",
					timestamp: Date.now(),
				} as AssistantMessage;
			},
		},
		() => {},
	);

	assert.equal(result.reason, "done");
	assert.equal(streamCalls, 1, "loop should finish immediately after successful yield");
});
