import assert from "node:assert/strict";
import { test } from "node:test";
import { groupActivity } from "../src/features/sidebar/group-activity.ts";

test("group activity follows IDs and gives waiting precedence without losing running counts", () => {
	const result = groupActivity(["a", "b", "a", "c"], { a: "running", b: "waiting", c: "done", other: "failed" }, "c");
	assert.equal(result.activity, "waiting");
	assert.deepEqual(result.counts, { running: 1, waiting: 1, failed: 0, done: 0 });
});

test("finishing or removing the last running session clears the breathing state", () => {
	assert.equal(groupActivity(["a"], { a: "running" }, "a").activity, "running");
	assert.equal(groupActivity(["a"], { a: "done" }, "a").activity, null);
	assert.equal(groupActivity([], { a: "running" }, null).activity, null);
	assert.equal(groupActivity(["a"], { a: "failed" }, null).activity, "failed");
});
