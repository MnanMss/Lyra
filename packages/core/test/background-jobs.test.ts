import assert from "node:assert/strict";
import { test } from "node:test";
import { BackgroundJobs, backgroundJobs, type BackgroundJob } from "../src/tools/background-jobs.ts";
import type { SandboxProcess } from "../src/kernel/services.ts";
import { useSandbox } from "../src/sandbox/index.ts";
import { bashTool } from "../src/tools/bash.ts";
import { SessionCapabilities } from "../src/runtime/session-capabilities.ts";
test("a session can stop only its own process handle, and a terminated job cannot target a reused PID", () => {
	const a=new BackgroundJobs(),b=new BackgroundJobs(),signals:string[]=[];
	const info:BackgroundJob={id:"owned",command:"dev",startedAt:1,exitCode:null,output:"",pid:123,status:"running"};
	const process:SandboxProcess={onOutput(){},onExit(){},onError(){},kill(signal){signals.push(signal??"");}};
	a.add(info,process);
	assert.equal(b.stop("owned",true),false);assert.equal(a.stop("123",true),false);assert.equal(signals.length,0);
	assert.equal(a.stop("owned"),true);assert.deepEqual(signals,["SIGTERM"]);
	info.finishedAt=2;info.status="exited";assert.equal(a.stop("owned",true),false);assert.equal(signals.length,1);
});

test("one unkillable background process cannot leak the other processes and session resources", async () => {
	const capabilities = new SessionCapabilities();
	const jobs = backgroundJobs(capabilities.state);
	const closed: string[] = [];
	const denied = new Error("EPERM: process belongs to a different user");
	for (const id of ["denied", "owned"]) {
		jobs.add({ id, command: "server", startedAt: 1, exitCode: null, output: "", status: "running" }, {
			onOutput() {}, onError() {}, onExit() {},
			kill() { closed.push(id); if (id === "denied") throw denied; },
		});
	}
	capabilities.mcp.closeAll = async () => { closed.push("mcp"); };
	capabilities.extensions.dispose = async () => { closed.push("extensions"); };
	let failure: unknown;
	await assert.rejects(capabilities.dispose(), error => { failure = error; return true; });
	assert.deepEqual(closed, ["denied", "owned", "mcp", "extensions"]);
	assert.ok(failure instanceof AggregateError);
	assert.deepEqual(failure.errors, [denied]);
	assert.equal(jobs.get("denied")?.status, "failed");
	assert.match(jobs.get("denied")?.error ?? "", /EPERM/);
});
test("a signalled command keeps its missing exit code instead of reporting exit 0", async () => {
	useSandbox({ run: () => ({ onOutput() {}, onError() {}, kill() {}, onExit(listener) { queueMicrotask(() => listener(null)); } }) });
	try {
		const result = await bashTool.execute({ command: "node verify.cjs" }, { cwd: process.cwd(), sessionId: "signal-test", state: new Map() });
		assert.ok("isError" in result && result.isError);
		assert.ok(result.details && typeof result.details === "object" && "exitCode" in result.details);
		assert.equal(result.details.exitCode, null);
		assert.match(result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join(""), /terminated without an exit code/);
	} finally { useSandbox(null); }
});
