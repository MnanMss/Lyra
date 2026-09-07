import assert from "node:assert/strict";
import childProcess, { ChildProcess, type ExecFileOptions } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { LocalSandbox } from "../src/sandbox/local.ts";

function fixture(t: TestContext, failure?: Error) {
	const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
	const child = Object.assign(new ChildProcess(), { pid: 43210 });
	const commands: { file: string; args: readonly string[] }[] = [];
	const errors: Error[] = [];
	const spawn = t.mock.method(childProcess, "spawn", () => child);
	const exec = t.mock.method(childProcess, "execFile", (
		file: string, args: readonly string[], _options: ExecFileOptions,
		callback: (error: Error | null, stdout: string, stderr: string) => void,
	) => {
		commands.push({ file, args });
		// Windows console children reject taskkill's window-close request without /F.
		callback(failure ?? (args.includes("/F") ? null : new Error("This process can only be terminated forcefully (with /F option).")), "", "");
		return new ChildProcess();
	});
	syncBuiltinESMExports();
	Object.defineProperty(process, "platform", { ...platform, value: "win32" });
	t.after(() => {
		spawn.mock.restore(); exec.mock.restore(); syncBuiltinESMExports();
		Object.defineProperty(process, "platform", platform);
	});
	const sandbox = new LocalSandbox().run("node server.cjs", { cwd: process.cwd() });
	sandbox.onError(error => errors.push(error));
	return { child, sandbox, commands, errors };
}

test("ordinary Windows stop can terminate the owned console process tree", t => {
	const { sandbox, commands, errors } = fixture(t);
	sandbox.kill("SIGTERM");
	assert.deepEqual(errors, []);
	assert.deepEqual(commands, [{ file: "taskkill", args: ["/PID", "43210", "/T", "/F"] }]);
});

test("forced Windows stop still targets only the owned process tree", t => {
	const { sandbox, commands, errors } = fixture(t);
	sandbox.kill("SIGKILL");
	assert.deepEqual(errors, []);
	assert.deepEqual(commands, [{ file: "taskkill", args: ["/PID", "43210", "/T", "/F"] }]);
});

test("a finished Windows process cannot cause taskkill to target a reused PID", t => {
	const { child, sandbox, commands } = fixture(t);
	Object.defineProperty(child, "exitCode", { value: 0 });
	sandbox.kill("SIGTERM");
	sandbox.kill("SIGKILL");
	assert.deepEqual(commands, []);
});

test("a failed Windows termination remains observable while the process is alive", t => {
	const denied = new Error("Access is denied.");
	const { child, sandbox, errors } = fixture(t, denied);
	sandbox.kill("SIGTERM");
	assert.deepEqual(errors, [denied]);
	assert.equal(child.exitCode, null);
	assert.equal(child.signalCode, null);
});
