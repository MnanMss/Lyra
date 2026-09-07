/**
 * A question nobody is there to answer.
 *
 * The gate exists so that a person decides the things a rule should not. When there is no person,
 * waiting forever is not deference — it is a run that never finishes. Refusing is the only safe
 * direction: it grants nothing, and the agent generally finds another way.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalGate } from "../src/runtime/approvals.ts";
import type { ApprovalRequest } from "../src/types.ts";

const request: ApprovalRequest = {
	kind: "bash",
	title: "Remove a directory outside the project",
	detail: "rm -rf /Users/me/elsewhere",
	subject: "rm -rf /Users/me/elsewhere",
};

function gate(options: Partial<Parameters<typeof ApprovalGate.prototype.request>> = {}, timeoutMs = 40) {
	const asked: string[] = [];
	const instance = new ApprovalGate({
		mode: () => "auto",
		cwd: () => "/Users/me/project",
		ask: async (pending) => {
			asked.push(pending.id);
		},
		remember: () => {},
		unattendedTimeoutMs: timeoutMs,
	});
	return { instance, asked };
}

test("an unanswered question becomes a refusal rather than a wait", async () => {
	const { instance, asked } = gate();
	const decision = await instance.request({ ...request });
	assert.equal(decision, "reject");
	assert.equal(asked.length, 1, "it did ask first");
	assert.deepEqual(instance.list(), [], "and stopped waiting for an answer");
});

test("an answer given in time still wins", async () => {
	const { instance } = gate(undefined, 5_000);
	const pending = instance.request({ ...request });
	// The person is there.
	await new Promise((r) => setTimeout(r, 10));
	const [entry] = instance.list();
	assert.ok(entry, "the question is waiting");
	instance.resolve(entry.id, "once");
	assert.equal(await pending, "once");
});

test("an always answer adds the subject to allowList and notifies remember", async () => {
	const remembered: string[] = [];
	const instance = new ApprovalGate({
		mode: () => "ask",
		cwd: () => "/Users/me/project",
		ask: async () => {},
		remember: (subject) => {
			remembered.push(subject);
		},
		unattendedTimeoutMs: 5_000,
	});

	const pending = instance.request({ ...request, subject: "mcp__sqlcl-mcp__db_query" });
	await new Promise((r) => setTimeout(r, 10));
	const [entry] = instance.list();
	assert.ok(entry, "the question is waiting");

	// Resolving with always resolves the in-flight request to once and remembers the subject
	const ok = instance.resolve(entry.id, "always");
	assert.equal(ok, true);
	assert.equal(await pending, "once");
	assert.deepEqual(remembered, ["mcp__sqlcl-mcp__db_query"]);

	// Subsequent requests with the same subject pass immediately without asking
	const second = await instance.request({ ...request, subject: "mcp__sqlcl-mcp__db_query" });
	assert.equal(second, "once");
	assert.deepEqual(instance.list(), []);
});
