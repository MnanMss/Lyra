import assert from "node:assert/strict";
import { test } from "node:test";
import { BackgroundJobs, type BackgroundJob } from "../src/tools/background-jobs.ts";
import type { SandboxProcess } from "../src/kernel/services.ts";
import { useSandbox } from "../src/sandbox/index.ts";
import { bashTool } from "../src/tools/bash.ts";
test("a session can stop only its own process handle, and a terminated job cannot target a reused PID", () => {
	const a=new BackgroundJobs(),b=new BackgroundJobs(),signals:string[]=[];
	const info:BackgroundJob={id:"owned",command:"dev",startedAt:1,exitCode:null,output:"",pid:123,status:"running"};
	const process:SandboxProcess={onOutput(){},onExit(){},onError(){},kill(signal){signals.push(signal??"");}};
	a.add(info,process);
	assert.equal(b.stop("owned",true),false);assert.equal(a.stop("123",true),false);assert.equal(signals.length,0);
	assert.equal(a.stop("owned"),true);assert.deepEqual(signals,["SIGTERM"]);
	info.finishedAt=2;info.status="exited";assert.equal(a.stop("owned",true),false);assert.equal(signals.length,1);
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
