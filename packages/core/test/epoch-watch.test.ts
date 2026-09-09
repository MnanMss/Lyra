/**
 * Tests for EpochWatch: 60-turn checkpoint health watchdog.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { EpochWatch } from "../src/agent/epoch-watch.ts";
import type { ToolResult } from "../src/types.ts";

function okResult(): ToolResult {
	return { content: [{ type: "text", text: "ok" }] };
}

function errorResult(): ToolResult {
	return { isError: true, content: [{ type: "text", text: "command failed" }] };
}

test("EpochWatch - healthy runs pass checkpoints without warning or stall", () => {
	const watch = new EpochWatch(60);

	for (let turn = 1; turn <= 60; turn++) {
		watch.observeTurn([{ name: "read" }], [okResult()]);
		if (watch.isCheckpoint(turn)) {
			const report = watch.evaluateCheckpoint(turn);
			assert.equal(report.healthy, true);
			assert.equal(report.stalled, false);
			assert.equal(report.warning, undefined);
		}
	}
});

test("EpochWatch - warns on first chronically failing epoch", () => {
	const watch = new EpochWatch(60);

	for (let turn = 1; turn <= 60; turn++) {
		watch.observeTurn([{ name: "bash" }], [errorResult()]);
	}

	assert.equal(watch.isCheckpoint(60), true);
	const report = watch.evaluateCheckpoint(60);
	assert.equal(report.healthy, false);
	assert.equal(report.stalled, false);
	assert.ok(report.warning?.includes("系统心跳检查点"));
});

test("EpochWatch - stalls on second consecutive failing epoch", () => {
	const watch = new EpochWatch(60);

	// Epoch 1: failures -> warns
	for (let turn = 1; turn <= 60; turn++) {
		watch.observeTurn([{ name: "bash" }], [errorResult()]);
	}
	const report1 = watch.evaluateCheckpoint(60);
	assert.equal(report1.stalled, false);
	assert.ok(report1.warning);

	// Epoch 2: still failing -> stalls
	for (let turn = 61; turn <= 120; turn++) {
		watch.observeTurn([{ name: "bash" }], [errorResult()]);
	}
	assert.equal(watch.isCheckpoint(120), true);
	const report2 = watch.evaluateCheckpoint(120);
	assert.equal(report2.healthy, false);
	assert.equal(report2.stalled, true);
});

test("EpochWatch - resets warning if second epoch recovers to healthy", () => {
	const watch = new EpochWatch(60);

	// Epoch 1: failures -> warns
	for (let turn = 1; turn <= 60; turn++) {
		watch.observeTurn([{ name: "bash" }], [errorResult()]);
	}
	const report1 = watch.evaluateCheckpoint(60);
	assert.equal(report1.healthy, false);

	// Epoch 2: recovers with good results
	for (let turn = 61; turn <= 120; turn++) {
		watch.observeTurn([{ name: "bash" }], [okResult()]);
	}
	const report2 = watch.evaluateCheckpoint(120);
	assert.equal(report2.healthy, true);
	assert.equal(report2.stalled, false);
});
