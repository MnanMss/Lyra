/**
 * That a side chat survives the app closing.
 *
 * It used to be memory only and the empty panel said so. That is a fair bargain for two questions
 * about what just happened, and a bad one once you have spent ten minutes in it and dispatched work
 * from it — closing the app took the thread with it, which is what was reported.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "@lyra/core";

let home = "";
before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-sidechat-"));
	process.env.LYRA_HOME = home;
});
after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true });
});

const said = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });

test("what was said comes back", async () => {
	const { loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	assert.deepEqual(await loadSideChat("s1"), [], "没聊过就是空的");

	await saveSideChat("s1", [said("一"), said("二")]);
	const back = await loadSideChat("s1");
	assert.equal(back.length, 2);
	assert.equal((back[0].content[0] as { text: string }).text, "一");
});

test("sessions do not read each other's panels", async () => {
	const { loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	await saveSideChat("s2", [said("属于 s2")]);
	assert.equal((await loadSideChat("s3")).length, 0);
});

test("clearing the panel clears it for next time too", async () => {
	const { clearSideChat, loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	await saveSideChat("s4", [said("回头要清掉")]);
	await clearSideChat("s4");
	assert.deepEqual(await loadSideChat("s4"), []);
});

/*
 * A half-written file is a crash, not a reason to refuse to open the panel.
 */
test("a corrupt file loses the conversation rather than the panel", async () => {
	const { loadSideChat } = await import("../electron/sidechat-store.ts");
	const { mkdir, writeFile } = await import("node:fs/promises");
	await mkdir(join(home, "sidechats"), { recursive: true });
	await writeFile(join(home, "sidechats", "s5.json"), '{"messages":[{"role":"user"', "utf8");
	assert.deepEqual(await loadSideChat("s5"), []);
});

test("an empty conversation leaves no file behind", async () => {
	const { loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	await saveSideChat("s6", [said("先说点什么")]);
	await saveSideChat("s6", []);
	assert.deepEqual(await loadSideChat("s6"), []);
});

test("queued snapshots are captured at invocation and reset wins over earlier writes", async () => {
	const { clearSideChat, loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	const messages = [said("saved at invocation")];
	const save = saveSideChat("snapshot", messages);
	messages.push(said("not yet committed"));
	await save;
	assert.deepEqual(await loadSideChat("snapshot"), [said("saved at invocation")]);
	const writes = Array.from({ length: 25 }, (_, index) => saveSideChat("ordered", [said(`version ${index}`)]));
	await Promise.all(writes);
	assert.deepEqual(await loadSideChat("ordered"), [said("version 24")]);
	await Promise.all([saveSideChat("ordered", [said("must disappear")]), clearSideChat("ordered")]);
	assert.deepEqual(await loadSideChat("ordered"), []);
});

test("disk snapshots reject paths instead of accepting a session id as a filename", async () => {
	const { loadSideChat, saveSideChat } = await import("../electron/sidechat-store.ts");
	for (const id of ["../settings", "..\\settings", "C:settings", "\0", ""]) {
		await assert.rejects(() => loadSideChat(id), /Invalid side-chat session id/);
		assert.throws(() => saveSideChat(id, [said("not a path")]), /Invalid side-chat session id/);
	}
});
