import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AssistantMessage, Message } from "@lyra/core";
import type { SideChatSnapshot } from "../../electron/ipc-types.ts";
import { useSide } from "../../src/features/dock/sideStore.ts";

const user = (text: string, timestamp = 1): Message => ({ role: "user", content: [{ type: "text", text }], timestamp });
const answer: AssistantMessage = { role: "assistant", api: "openai-responses", provider: "qa", model: "qa", content: [{ type: "text", text: "Live answer" }], timestamp: 2, stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { resolve, promise };
}
function api(state: (id: string) => Promise<SideChatSnapshot | null>, ask = async () => {}) {
	Object.defineProperty(window, "lyra", { configurable: true, value: { sideChat: { state, ask, reset: async () => {}, abort: async () => {} }, tasks: { list: async () => [] } } });
}
afterEach(async () => { await useSide.getState().attach(null); useSide.setState({ sessionCache: {} }); });

test("late attach snapshot merges new stream events without deleting older questions or duplicating included events", async () => {
	const pending = deferred<SideChatSnapshot>(); api(() => pending.promise);
	const attaching = useSide.getState().attach("a");
	useSide.getState().applyEvent("a", { type: "message_start", message: user("Old question"), sideRevision: 1 });
	useSide.getState().applyEvent("a", { type: "message_start", message: { ...answer, stopReason: "pending" }, sideRevision: 2 });
	useSide.getState().applyEvent("a", { type: "message_end", message: answer, sideRevision: 3 });
	useSide.getState().applyEvent("a", { type: "agent_end", reason: "done", sideRevision: 4 });
	pending.resolve({ modelId: null, revision: 1, messages: [user("Old question")], running: true }); await attaching;
	assert.deepEqual(useSide.getState().messages, [user("Old question"), answer]);
	assert.equal(useSide.getState().running, false); assert.equal(useSide.getState().loading, false);
	assert.equal("sessionCache" in useSide.getState().sessionCache.a, false);
});

test("background answers update only their session and are immediately visible on returning", async () => {
	api(async (id) => ({ modelId: null, messages: [user(id)], running: false, revision: 0 }));
	await useSide.getState().attach("a"); await useSide.getState().attach("b");
	useSide.getState().applyEvent("a", { type: "message_start", message: answer, sideRevision: 1 });
	useSide.getState().applyEvent("a", { type: "message_end", message: answer, sideRevision: 2 });
	assert.deepEqual(useSide.getState().messages, [user("b")]);
	assert.deepEqual(useSide.getState().sessionCache.a.messages, [user("a"), answer]);
	const response = deferred<SideChatSnapshot>(); api(() => response.promise);
	const returning = useSide.getState().attach("a");
	assert.deepEqual(useSide.getState().messages, [user("a"), answer]);
	response.resolve({ modelId: null, messages: [user("a"), answer], running: false, revision: 2 }); await returning;
});

test("A to B to A cannot be overwritten by the first A read", async () => {
	const first = deferred<SideChatSnapshot>(); const last = deferred<SideChatSnapshot>(); let reads = 0;
	api((id) => id === "b" ? Promise.resolve({ modelId: null, messages: [], running: false }) : ++reads === 1 ? first.promise : last.promise);
	const oldA = useSide.getState().attach("a"); await useSide.getState().attach("b");
	const newA = useSide.getState().attach("a");
	last.resolve({ modelId: null, messages: [user("Current A")], running: false }); await newA;
	first.resolve({ modelId: null, messages: [user("Stale A")], running: true }); await oldA;
	assert.deepEqual(useSide.getState().messages, [user("Current A")]); assert.equal(useSide.getState().running, false);
});

test("failed submission shows an error and releases the composer instead of leaving a pending run", async () => {
	api(async () => ({ modelId: null, messages: [], running: false }), async () => { throw new Error("IPC unavailable"); });
	await useSide.getState().attach("a");
	await useSide.getState().ask([{ type: "text", text: "Question" }]);
	assert.equal(useSide.getState().running, false); assert.equal(useSide.getState().pending, null);
	assert.match(useSide.getState().error ?? "", /IPC unavailable/);
});

test("rewind drops discarded answers and tool cards before the replacement arrives", async () => {
	api(async () => ({ modelId: null, messages: [user("Original"), answer], running: false })); await useSide.getState().attach("a");
	useSide.getState().applyEvent("a", { type: "rewound", messageCount: 0 });
	useSide.getState().applyEvent("a", { type: "message_start", message: user("Replacement", 3) });
	assert.deepEqual(useSide.getState().messages, [user("Replacement", 3)]); assert.deepEqual(useSide.getState().toolRuns, {});
});

test("late snapshots cannot replace a newer model selection, including background session caches", async () => {
	const pending = deferred<SideChatSnapshot>(); api(() => pending.promise);
	const attach = useSide.getState().attach("model-a");
	useSide.getState().applyEvent("model-a", { type: "side_model", modelId: "chosen", sideRevision: 2 });
	pending.resolve({ messages: [], running: false, modelId: "old", revision: 1 }); await attach;
	assert.equal(useSide.getState().modelId, "chosen");
	api(async () => ({ messages: [], running: false, modelId: null, revision: 0 })); await useSide.getState().attach("model-b");
	useSide.getState().applyEvent("model-a", { type: "side_model", modelId: "background", sideRevision: 3 });
	assert.equal(useSide.getState().modelId, null); assert.equal(useSide.getState().sessionCache["model-a"].modelId, "background");
});
