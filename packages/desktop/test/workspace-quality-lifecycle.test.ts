import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { RunningApp } from "../e2e/app.ts";
import { stopWorkspaceFixture } from "../e2e/workspace-quality-lifecycle.ts";

test("workspace teardown closes the real model listener when Electron shutdown rejects", async (t) => {
	const server = createServer((_req, res) => res.end("fixture"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => { server.closeAllConnections(); server.close(); });
	const shutdownFailure = new Error("taskkill failed for isolated fixture process");
	const app: RunningApp = {
		home: "unused",
		evaluate: async () => { throw new Error("CDP already closed"); },
		send: async () => { throw new Error("CDP already closed"); },
		stop: async () => { throw shutdownFailure; },
	};
	const diagnostics: string[] = [];
	await assert.rejects(stopWorkspaceFixture(app, server, (message) => diagnostics.push(message)), shutdownFailure);
	assert.equal(server.listening, false, "a failed app shutdown must not leave the HTTP listener holding the test process open");
	assert.ok(diagnostics.some((message) => message.includes("service lookup failed")));
	assert.ok(diagnostics.some((message) => message.includes("app cleanup failed: Error: taskkill failed")));
	assert.ok(diagnostics.some((message) => message.includes("model listener active=false")));
});

test("workspace teardown closes the model listener after a failed app startup", async (t) => {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	await stopWorkspaceFixture(undefined, server, () => {});
	assert.equal(server.listening, false);
});
