import assert from "node:assert/strict";
import childProcess, { ChildProcess, type SpawnOptions } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { stopProcessGroup } from "../e2e/app.ts";

function fixture(t: TestContext) {
	const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
	const child = Object.assign(new ChildProcess(), { pid: 43210, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
	const killer = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() });
	const unref = t.mock.method(child, "unref", () => {});
	const spawn = t.mock.method(childProcess, "spawn", (command: string, args: readonly string[], options: SpawnOptions) => {
		assert.equal(command, "taskkill");
		assert.deepEqual(args, ["/PID", String(child.pid), "/T", "/F"]);
		assert.equal(options.timeout, 5_000);
		return killer;
	});
	syncBuiltinESMExports();
	Object.defineProperty(process, "platform", { ...platform, value: "win32" });
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => {
		spawn.mock.restore(); syncBuiltinESMExports();
		Object.defineProperty(process, "platform", platform);
		for (const stream of [child.stdin, child.stdout, child.stderr, killer.stdout, killer.stderr]) stream.destroy();
	});
	return { child, killer, unref };
}

// Let the current promise queue drain without advancing the mocked exit deadline.
const drained = () => new Promise<void>(resolve => setImmediate(resolve));

test("Windows teardown waits for a target exit notification that arrives after taskkill closes", async t => {
	const { child, killer, unref } = fixture(t);
	let settled = false;
	const outcome = stopProcessGroup(child).then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
	killer.stderr.write("A process in the tree had already exited.");
	killer.emit("close", 128, null);
	await drained();
	assert.equal(settled, false, "taskkill's close event must not classify the target before its exit notification arrives");
	assert.equal(child.stdin.destroyed, false);
	// Node's native exit callback updates this readonly field before emitting the event.
	Object.defineProperty(child, "exitCode", { value: 1 });
	child.emit("exit", 1, null);
	assert.equal(await outcome, null);
	assert.ok([child.stdin, child.stdout, child.stderr].every(stream => stream.destroyed));
	assert.equal(unref.mock.callCount(), 1);
});

test("Windows teardown still reports taskkill output when the target never exits within the existing deadline", async t => {
	const { child, killer, unref } = fixture(t);
	let settled = false;
	const outcome = stopProcessGroup(child).then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
	killer.stdout.write("Failed PID 43210. "); killer.stderr.write("Access is denied.");
	killer.emit("close", 1, null);
	await drained();
	t.mock.timers.tick(999); await drained();
	assert.equal(settled, false);
	t.mock.timers.tick(1);
	const error = await outcome;
	assert.ok(error instanceof Error);
	assert.match(error.message, /taskkill failed for test process 43210 \(exit 1, signal null\): Failed PID 43210\. Access is denied\./);
	assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
	assert.ok([child.stdin, child.stdout, child.stderr].every(stream => stream.destroyed));
	assert.equal(unref.mock.callCount(), 1);
});

test("a taskkill spawn error stays visible and releases every runner pipe", async t => {
	const { child, killer, unref } = fixture(t);
	const failure = new Error("taskkill spawn failed");
	const result = assert.rejects(stopProcessGroup(child), error => error === failure);
	killer.emit("error", failure);
	await result;
	assert.ok([child.stdin, child.stdout, child.stderr].every(stream => stream.destroyed));
	assert.equal(unref.mock.callCount(), 1);
});
