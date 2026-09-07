import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolRun } from "../../src/store/tool-run.ts";
import { filterRuns } from "../../src/features/task/filter-runs.ts";

test("execution search covers late output, metadata, IDs and refreshed streaming results", () => {
	const run: ToolRun = { toolCallId: "specific-call", toolName: "bash", summary: "build", args: { command: "pnpm build" }, startedAt: 1, status: "running" };
	const complete: ToolRun = { ...run, status: "error", result: { content: [{ type: "text", text: "a".repeat(15000) + "OUTSIDE_PREVIEW" }], details: { exitCode: 17 } } };
	assert.equal(filterRuns([run], "OUTSIDE_PREVIEW").length, 0);
	assert.equal(filterRuns([complete], "outside_preview", "error").length, 1);
	assert.equal(filterRuns([complete], "exitCode").length, 1);
	assert.equal(filterRuns([complete], "SPECIFIC-call").length, 1);
	assert.equal(filterRuns([complete], "pnpm build", "done").length, 0);
});
