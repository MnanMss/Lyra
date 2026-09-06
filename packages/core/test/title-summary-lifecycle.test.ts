import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { AgentEvent } from "../src/agent/events.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import { AgentSession, type AgentSessionOptions } from "../src/runtime/session.ts";
import { summarizeTitle } from "../src/runtime/title-summary.ts";
import { SessionStore, type SessionMeta, type SessionRecordInput } from "../src/session/store.ts";
import { emptyUsage, type AssistantMessage, type ModelConfig, type ProviderConfig } from "../src/types.ts";

const model: ModelConfig = { id: "test/model", providerId: "test", modelId: "model", name: "Test", contextWindow: 128000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true };
const provider: ProviderConfig = { id: "test", name: "Test", api: "openai-responses", apiKey: "test", baseUrl: "http://localhost", enabled: true, models: [model] };
const settings = { ...DEFAULT_SETTINGS, providers: [provider], defaultModelId: model.id };
const prompt = "Please review the authentication code and fix the regression.";
function reply(text: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text }], api: provider.api, provider: provider.id, model: model.modelId, stopReason: "stop", usage: emptyUsage(), timestamp: 1 };
}
async function fixture(t: TestContext, options: Partial<Pick<AgentSessionOptions, "settings" | "titleSummaryStream" | "emit">> = {}) {
	const root = await mkdtemp(join(tmpdir(), "ly-title-life-"));
	const store = new SessionStore(join(root, "sessions"));
	const session = new AgentSession({ cwd: root, store, meta: await store.create(root, model.id), settings, streamFn: async () => reply("Done"), emit: () => {}, ...options });
	t.after(async () => { await session.dispose(); await rm(root, { recursive: true, force: true }); });
	return { root, store, session };
}

test("title fallback preserves ordinary user prose and uses structured display text", async (t) => {
	const { session } = await fixture(t, { settings: { ...settings, autoSummarizeTitle: false } });
	const text = "使用已有技能优化页面。先检查菜单的滚动问题。";
	await session.prompt([{ type: "text", text }]);
	assert.equal(session.meta.title, text);
	const second = await fixture(t, { settings: { ...settings, autoSummarizeTitle: false } });
	await second.session.prompt([{ type: "text", text: "Injected context only" }], { displayText: "[上下文引用提示] 是用户正在讨论的标签" });
	assert.equal(second.session.meta.title, "[上下文引用提示] 是用户正在讨论的标签");
});

for (const action of ["dispose", "abort", "disable", "edit"] as const) {
	test(`${action} cancels the pending title request`, async (t) => {
		const result = Promise.withResolvers<AssistantMessage>();
		let signal: AbortSignal | undefined;
		let calls = 0;
		const { session } = await fixture(t, { titleSummaryStream: async function* (_provider, _model, _context, options) {
			calls++;
			if (calls > 1) { const message = reply("New title"); yield { type: "done", message }; return message; }
			signal = options?.signal;
			const message = await result.promise;
			yield { type: "done", message };
			return message;
		} });
		await session.prompt([{ type: "text", text: prompt }]);
		let pending: Promise<void> | undefined;
		if (action === "dispose") pending = session.dispose();
		else if (action === "abort") session.abort();
		else if (action === "disable") session.updateSettings({ ...settings, autoSummarizeTitle: false });
		else pending = session.editAndResend(0, [{ type: "text", text: "New question" }]);
		const cancelled = signal?.aborted;
		result.resolve(reply("Stale title"));
		await pending;
		assert.equal(cancelled, true);
	});
}

test("rename waits for an already-started automatic title write", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ly-title-write-"));
	const autoStarted = Promise.withResolvers<void>();
	const allowAuto = Promise.withResolvers<void>();
	let manualStarted = false;
	class PausedStore extends SessionStore {
		override async append(meta: SessionMeta, record: SessionRecordInput) {
			if (record.type === "title" && record.title === "Automatic") { autoStarted.resolve(); await allowAuto.promise; }
			if (record.type === "title" && record.title === "Manual") manualStarted = true;
			return super.append(meta, record);
		}
	}
	const store = new PausedStore(join(root, "sessions"));
	const session = new AgentSession({ cwd: root, store, meta: await store.create(root, model.id), settings, emit: () => {}, streamFn: async () => reply("Done"), titleSummaryStream: async function* () {
		const message = reply("Automatic"); yield { type: "done", message }; return message;
	} });
	t.after(async () => { allowAuto.resolve(); await session.dispose(); await rm(root, { recursive: true, force: true }); });
	const running = session.prompt([{ type: "text", text: prompt }]);
	await autoStarted.promise;
	const renaming = session.rename("Manual");
	const overlapped = manualStarted;
	allowAuto.resolve();
	await Promise.all([running, renaming]);
	assert.equal(overlapped, false);
	assert.equal(session.meta.title, "Manual");
	const loaded = await store.load(session.meta.projectId, session.meta.id);
	assert.equal(loaded?.meta.title, "Manual");
	assert.equal(loaded?.meta.titleSetByUser, true);
});

test("title usage is counted and survives reopening without adding conversation messages", async (t) => {
	const titled = Promise.withResolvers<void>();
	const usage = { ...emptyUsage(), input: 100, output: 10, reasoning: 0, total: 110, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
	const { store, session } = await fixture(t, { emit: (event: AgentEvent) => { if (event.type === "title" && event.title === "Automatic") titled.resolve(); }, titleSummaryStream: async function* () {
		const message = { ...reply("Automatic"), usage }; yield { type: "done", message }; return message;
	} });
	await session.prompt([{ type: "text", text: prompt }]);
	await titled.promise;
	assert.deepEqual(session.meta.usage, usage);
	const loaded = await store.load(session.meta.projectId, session.meta.id);
	assert.deepEqual(loaded?.meta.usage, usage);
	assert.equal(loaded?.messages.length, 2);
	await session.log.truncateFrom(0);
	assert.deepEqual((await store.load(session.meta.projectId, session.meta.id))?.meta.usage, usage, "rewriting the prompt does not erase a title request that was already billed");
});

test("image-only opening retains a useful title", async (t) => {
	const { session } = await fixture(t);
	await session.prompt([{ type: "image", mimeType: "image/png", data: "AA==" }]);
	assert.equal(session.meta.title, "图片消息");
});

test("title requests bound long prompts without splitting Unicode characters", async () => {
	let sent = "";
	await summarizeTitle({ text: "😀".repeat(100000), provider, model, stream: async function* (_provider, _model, context) {
		sent = JSON.stringify(context.messages);
		const message = reply("Emoji task"); yield { type: "done", message }; return message;
	} });
	assert.ok(sent.length < 10000, `title request has ${sent.length} characters`);
	assert.doesNotMatch(sent, /\\ud[89ab][0-9a-f]{2}/i);
});
