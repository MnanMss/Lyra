import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, SessionStore, AgentSession, type AgentEvent } from "@lyra/core";
import { createStoredSession } from "../electron/create-session.ts";
import { initialPrompt, promptContent, promptOptions } from "../electron/prompt-input.ts";

test("opening submissions have durable distinct identities before any runtime is initialized", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-create-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const content = promptContent([{ type: "text", text: "同一个问题\n  两个会话" }]);
		const settings = { ...DEFAULT_SETTINGS, worktrees: { ...DEFAULT_SETTINGS.worktrees, autoCreateOnNewSession: true } };
		const [first, second] = await Promise.all([createStoredSession(store, settings, root, "", { content }), createStoredSession(store, settings, root, "", { content })]);
		assert.notEqual(first.meta.id, second.meta.id);
		assert.equal(first.meta.title, "同一个问题 两个会话");
		assert.equal(first.meta.workspaceSetup, "worktree");
		assert.equal((await store.load(first.meta.projectId, first.meta.id))?.messages.length, 1);
		await store.append(first.meta, { type: "title", title: "只改第一个" });
		await store.setArchived(first.meta.projectId, first.meta.id, true);
		assert.equal((await store.load(second.meta.projectId, second.meta.id))?.meta.title, second.meta.title);
		assert.equal((await store.load(second.meta.projectId, second.meta.id))?.meta.archived, undefined);
		await store.delete(first.meta.projectId, first.meta.id);
		assert.equal((await store.listSessions()).length, 1);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("a persisted opening message is consumed once and abort can cancel its startup", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-pending-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const saved = await createStoredSession(store, DEFAULT_SETTINGS, root, "", { content: [{ type: "text", text: "opening" }] });
		const events: AgentEvent[] = [];
		const session = new AgentSession({ cwd: root, store, settings: { ...DEFAULT_SETTINGS, providers: [] }, meta: saved.meta, emit: (event) => { events.push(event); } });
		session.restore(saved.messages);
		const first = session.resumePendingPrompt();
		assert.equal(session.running, true, "the disk-write interval is already busy");
		assert.equal(session.resumePendingPrompt(), first);
		session.abort();
		await first;
		assert.equal(session.running, false);
		assert.equal(events.some((event) => event.type === "notice"), false, "no provider was reached after cancellation");
		assert.equal((await store.load(saved.meta.projectId, saved.meta.id))?.messages.length, 1);
		assert.equal((await store.load(saved.meta.projectId, saved.meta.id))?.meta.pendingPrompt, undefined);
		await session.dispose();
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("prompt boundary rejects malformed payloads and keeps supported image/text content", () => {
	assert.throws(() => initialPrompt({ content: [{ type: "text", text: 4 }] }));
	assert.throws(() => initialPrompt({ content: [], synthetic: "yes" }));
	assert.throws(() => promptOptions({ resumePending: "true" }));
	assert.throws(() => promptOptions({ deliver: "unknown" }));
	assert.deepEqual(initialPrompt({ content: [{ type: "image", data: "eA==", mimeType: "image/png" }] }), { content: [{ type: "image", data: "eA==", mimeType: "image/png" }] });
});

test("presentation metadata is validated on both prompt entry points", () => {
	for (const invalid of [{ displayText: 12 }, { skillRef: { name: "s", path: {} } }, { skillRef: { name: "s", pluginId: [] } }, { sessionRefs: [null] }, { sessionRefs: [{ id: 4, title: "t" }] }]) {
		assert.throws(() => initialPrompt({ content: "hello", ...invalid }));
		assert.throws(() => promptOptions(invalid));
	}
	const metadata = { displayText: "", skillRef: { name: "s", path: "/skills/s.md", pluginId: "p" }, sessionRefs: [{ id: "a", title: "同名" }, { id: "b", title: "同名" }] };
	assert.deepEqual(promptOptions(metadata), metadata);
	assert.deepEqual(initialPrompt({ content: "hello", ...metadata }), { content: [{ type: "text", text: "hello" }], ...metadata });
});

test("a reference-only opening uses its label and persists both same-title targets", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-reference-prompt-"));
	try {
		const store = new SessionStore(join(root, "sessions"));
		const initial = initialPrompt({ content: "reference instructions", displayText: "", sessionRefs: [{ id: "a", title: "同名" }, { id: "b", title: "同名" }] });
		const saved = await createStoredSession(store, DEFAULT_SETTINGS, root, "", initial);
		assert.equal(saved.meta.title, "同名");
		const message = (await store.load(saved.meta.projectId, saved.meta.id))?.messages[0];
		assert.ok(message?.role === "user");
		assert.deepEqual(message.sessionRefs, initial?.sessionRefs);
		assert.equal(message.displayText, "");
	} finally { await rm(root, { recursive: true, force: true }); }
});
