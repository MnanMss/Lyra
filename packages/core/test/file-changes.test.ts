import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, test } from "node:test";
import { execFileSync } from "node:child_process";
import { recordFileChange, readFileChange, undoFileChanges } from "../src/tools/file-changes.ts";
import { beforeCommand, afterCommand } from "../src/tools/command-changes.ts";
import type { ToolContext } from "../src/types.ts";
let home: string, cwd: string, ctx: ToolContext;
let prior: string | undefined;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-change-test-")); cwd = join(home, "project"); await mkdir(cwd);
	prior = process.env.LYRA_HOME; process.env.LYRA_HOME = home;
	ctx = { cwd, sessionId: "test-session", state: new Map(), scratchDir: join(home, "scratch") };
});
afterEach(async () => { if (prior === undefined) delete process.env.LYRA_HOME; else process.env.LYRA_HOME = prior; await rm(home, { recursive: true, force: true }); });
test("chained edits undo only this turn, preserving the user's initial dirty content", async () => {
	const path = join(cwd, "main.ts"); const initial = "user work\n";
	const a = await recordFileChange(ctx, path, initial, "user work\nfirst\n"); assert.ok(a);
	const b = await recordFileChange(ctx, path, "user work\nfirst\n", "user work\nsecond\n"); assert.ok(b);
	await writeFile(path, "user work\nsecond\n");
	await undoFileChanges(cwd, await Promise.all([a,b].map((id) => readFileChange(ctx.sessionId, id))));
	assert.equal(await readFile(path, "utf8"), initial);
});
test("undo refuses later edits, discontinuous histories and records from another session", async () => {
	const path = join(cwd, "file.ts"), id = await recordFileChange(ctx, path, "before", "after"); assert.ok(id);
	const change = await readFileChange(ctx.sessionId, id); await writeFile(path, "new user work");
	await assert.rejects(undoFileChanges(cwd, [change]), /后续修改/);
	assert.equal(await readFile(path, "utf8"), "new user work");
	await assert.rejects(readFileChange("other-session", id));
	await assert.rejects(readFileChange(ctx.sessionId, "../../settings.json"), /无效/);
	await assert.rejects(undoFileChanges(cwd, [change, {...change, before: "unrelated"}]), /其他修改/);
});
test("new files are removed only while still equal to the recorded result", async () => {
	const path = join(cwd, "new.ts"), id = await recordFileChange(ctx, path, null, "created"); assert.ok(id);
	await writeFile(path, "created"); await undoFileChanges(cwd, [await readFileChange(ctx.sessionId, id)]);
	await assert.rejects(readFile(path), {code:"ENOENT"});
});
test("command snapshots compare against the working file, including staged additions", async () => {
	const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], {stdio:"pipe"});
	git("init"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
	await writeFile(join(cwd,"existing.ts"), "base\n"); git("add", "."); git("commit", "-m", "base");
	await writeFile(join(cwd,"existing.ts"), "user dirty\n");
	await writeFile(join(cwd,"staged.ts"), "one\ntwo\n"); git("add", "staged.ts");
	const snapshot = await beforeCommand(ctx);
	await writeFile(join(cwd,"staged.ts"), "one\nupdated\n");
	const ids = await afterCommand(ctx, snapshot); assert.equal(ids.length, 1);
	const change = await readFileChange(ctx.sessionId, ids[0]); assert.equal(change.before, "one\ntwo\n"); assert.equal(change.after, "one\nupdated\n");
	await assert.rejects(undoFileChanges(cwd, [change]), /命令/);
	assert.equal(await readFile(join(cwd,"existing.ts"), "utf8"), "user dirty\n");
});
