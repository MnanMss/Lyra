import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { closeListeningServer } from "../e2e/app.ts";
import { cleanupFixture } from "../e2e/fixture-cleanup.ts";

test("fixture cleanup closes a real HTTP listener when Electron shutdown rejects", async (t) => {
	const server = createServer((_request, response) => response.end("fixture"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => { server.closeAllConnections(); server.close(); });
	const shutdownFailure = new Error("taskkill failed for isolated fixture process");
	await assert.rejects(cleanupFixture(
		async () => { throw shutdownFailure; },
		() => closeListeningServer(server),
	), (error: unknown) => error === shutdownFailure);
	assert.equal(server.listening, false, "the model listener must not keep a failed after hook alive");
});

test("fixture cleanup preserves every failure and still releases later resources", async () => {
	const shutdownFailure = new Error("Electron shutdown failed");
	const closeFailure = new Error("another fixture resource failed to close");
	const completed: string[] = [];
	await assert.rejects(cleanupFixture(
		async () => { completed.push("app"); throw shutdownFailure; },
		() => { completed.push("model"); throw closeFailure; },
		() => { completed.push("relay"); },
	), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [shutdownFailure, closeFailure]);
		return true;
	});
	assert.deepEqual(completed, ["app", "model", "relay"]);
});

test("fixture cleanup accepts resources that were not acquired during startup", async (t) => {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const fixture: { app?: { stop(): Promise<void> } } = {};
	await cleanupFixture(
		() => fixture.app?.stop(),
		() => closeListeningServer(server),
	);
	assert.equal(server.listening, false);
});
