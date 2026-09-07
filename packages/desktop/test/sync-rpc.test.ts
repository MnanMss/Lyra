/**
 * What the phone is allowed to ask the desktop to do.
 *
 * This list is the security boundary. Whoever holds the pairing token can call anything on it, so
 * what is *absent* matters more than what is present: a shell, arbitrary file writes, the screen.
 * A test that only checked the allowed calls would pass just as happily on a list that allowed
 * everything, so most of what follows is about the omissions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedMethods, callRpc, RPC, type RpcDeps } from "../electron/sync-rpc.ts";
import { DEFAULT_SETTINGS, type SessionMeta } from "@lyra/core";

/** Deps that record what was asked of them, so a call can be traced without a real session. */
function deps(overrides: Partial<RpcDeps> = {}): RpcDeps {
	return {
		store: () => ({ listSessions: async () => [], load: async () => null }) as never,
		settings: () => DEFAULT_SETTINGS,
		saveSettings: async () => {},
		workspaceInfo: async (path) => ({ path }),
		live: () => undefined,
		activate: async () => null,
		create: async () => { throw new Error("not needed"); },
		abort: async () => {},
		dispose: async () => {},
		prompt: async () => {
			throw new Error("not needed");
		},
		snapshot: async () => ({}),
		touch: () => {},
		...overrides,
	};
}

test("a method not on the list does not exist for the phone", async () => {
	const result = await callRpc(deps(), "terminal.attach", ["x"]);
	assert.deepEqual(result, { ok: false, error: "method-not-allowed" });
});

test("the things that would hand over the machine are all absent", () => {
	/*
	 * Each of these is a way to reach past the app and into the computer: a shell, the filesystem,
	 * the display, the update channel. The pairing token is a phone-shaped secret — it lives in a
	 * device that gets lost — and none of this should ride on it.
	 */
	const allowed = new Set(allowedMethods());
	for (const method of [
		"terminal.attach",
		"terminal.write",
		"files.write",
		"files.read",
		"files.bytes",
		"screenshot.start",
		"system.openPath",
		"system.openExternal",
		"plugins.install",
		"updates.install",
		"forge.add",
		"git.commit",
		"sync.rotateToken",
	]) {
		assert.ok(!allowed.has(method), `${method} 不该在白名单里`);
	}
});

test("what a phone is actually for is on the list", () => {
	const allowed = new Set(allowedMethods());
	for (const method of [
		"settings.get",
		"sessions.list",
		"sessions.transcript",
		"agent.prompt",
		"agent.abort",
		"agent.approve",
	]) {
		assert.ok(allowed.has(method), `${method} 应该可用`);
	}
});

test("approving a tool call is allowed, because that is the point of having a phone", () => {
	// A turn stops and waits for a decision; being able to make it from the other room is most of
	// why this feature exists. It grants only what the desktop was already about to ask for.
	assert.ok(allowedMethods().includes("agent.approve"));
});

test("agent.approve with always persists the subject to alwaysAllow", async () => {
	let savedSettings: unknown;
	const approvals = [{ id: "req-1", request: { subject: "mcp__sqlcl-mcp__db_query" } }];
	const fakeSession = {
		listPendingApprovals: () => [...approvals],
		resolveApproval: (id: string, _decision: unknown) => {
			const idx = approvals.findIndex((a) => a.id === id);
			if (idx === -1) return false;
			approvals.splice(idx, 1);
			return true;
		},
	};
	const d = deps({
		live: (id) => (id === "s1" ? (fakeSession as never) : undefined),
		settings: () => ({ ...DEFAULT_SETTINGS, alwaysAllow: [] }),
		saveSettings: async (next) => { savedSettings = next; },
	});

	const result = await callRpc(d, "agent.approve", ["s1", "req-1", "always"]);
	assert.equal(result.ok, true);
	assert.deepEqual((savedSettings as { alwaysAllow: string[] })?.alwaysAllow, ["mcp__sqlcl-mcp__db_query"]);
	assert.equal(approvals.length, 0);
});

test("a handler that throws is an answer, not a dropped connection", async () => {
	const result = await callRpc(
		deps({
			store: () =>
				({
					listSessions: async () => {
						throw new Error("磁盘读不了");
					},
				}) as never,
		}),
		"sessions.list",
		[],
	);
	// The phone holds one long-lived connection; a failed call must not cost it that and the
	// resync that follows.
	assert.equal(result.ok, false);
	assert.match(String(result.error), /磁盘读不了/);
});

test("a successful call carries the value back, and null rather than undefined", async () => {
	const listed = await callRpc(deps(), "sessions.list", []);
	assert.deepEqual(listed, { ok: true, value: [] });

	// `undefined` does not survive JSON, and a caller reading `value` would see the key vanish.
	const nothing = await callRpc(deps({ live: () => undefined }), "agent.abort", ["s1"]);
	assert.deepEqual(nothing, { ok: true, value: null });
});

test("非字符串的参数被拒，而不是折成空串传下去", async () => {
	/*
	 * 这条测试以前断言的是相反的事：一个对象会被 `s()` 折成 `""` 然后传给会话层。那是当时的
	 * 实现，也是一个坏行为——请求没有被拒绝，只是变成了「查找 id 为空的会话」，失败发生在
	 * 离调用者很远的地方。现在它在分发层就被挡住。
	 */
	let asked: unknown = "untouched";
	const result = await callRpc(
		deps({
			live: (id) => {
				asked = id;
				return undefined;
			},
		}),
		"agent.abort",
		[{ evil: true }],
	);

	assert.equal(result.ok, false, "对象不是一个 sessionId");
	assert.match(String(result.error), /invalid-args/);
	assert.equal(asked, "untouched", "handler 根本不该被调用");
});

test("参数缺失同样被拒", async () => {
	// 空数组是「body 里没有参数」的诚实读法，而 agent.abort 需要一个 sessionId。
	const result = await callRpc(deps(), "agent.abort", []);
	assert.equal(result.ok, false);
	assert.match(String(result.error), /invalid-args.*sessionId/);
});

test("参数合法时照常执行", async () => {
	// 上面两条都在验拒绝，这条验没有把正常调用一起挡掉。
	const result = await callRpc(deps({ live: () => undefined }), "agent.abort", ["s1"]);
	assert.deepEqual(result, { ok: true, value: null });
});

test("每个 handler 都能经 callRpc 到达", async () => {
	/*
	 * 表里有而够不到的方法，是这个文件自己的覆盖漏洞。
	 *
	 * 现在参数要合法才到得了 handler，所以按方法给合适的实参——「够得到」的判据从「不是
	 * method-not-allowed」变成「不是 invalid-args」，这也更准确：前者只证明它在表里。
	 */
	const sample: Record<string, unknown[]> = {
		"workspace.info": ["/tmp/p"],
		"sessions.create": ["/tmp/p"],
		"sessions.open": ["p1", "s1"],
		"sessions.transcript": ["p1", "s1"],
		"sessions.remove": ["p1", "s1"],
		"sessions.capabilities": ["s1"],
		"sessions.setArchived": ["p1", "s1", true],
		"sessions.rename": ["p1", "s1", "标题"],
		"agent.prompt": ["s1", "你好"],
		"agent.editMessage": ["s1", 0, "改过的"],
		"agent.abort": ["s1"],
		"agent.approve": ["s1", "r1", { allow: true }],
		"agent.setModel": ["s1", "m1"],
		"agent.setThinking": ["s1", { effort: "low" }],
		"settings.save": [{}],
		"subAgents.list": ["s1"],
		"rules.preview": [{ isCorrection: true, name: "no-any", body: "不用 any。" }],
		"rules.keep": ["s1", "project", "no-any", "---\n---\n不用 any。\n"],
		"rules.decline": ["s1"],
	};

	for (const method of Object.keys(RPC)) {
		const result = await callRpc(deps(), method, sample[method] ?? []);
		assert.notEqual(result.error, "method-not-allowed", `${method} 应当可达`);
		assert.doesNotMatch(
			String(result.error ?? ""),
			/invalid-args/,
			`${method} 的实参被自己的规格拒了——要么规格写错，要么这里的样例该更新`,
		);
	}
});

test("phone submissions preserve the opening message and resume it through the shared hub", async () => {
	const meta: SessionMeta = { id: "unique", projectId: "project", projectName: "project", cwd: "/project", title: "你好", createdAt: 1, updatedAt: 1, modelId: "", messageCount: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
	const opening = { content: [{ type: "text", text: "你好" }], synthetic: false };
	const calls: unknown[] = [];
	const hub = deps({
		create: async (...args) => { calls.push(args); return { meta, messages: [], running: true, pendingApprovals: [] }; },
		prompt: async (...args) => { calls.push(args); return meta; },
		activate: async () => { throw new Error("creation must not activate MCP"); },
	});
	assert.equal((await callRpc(hub, "sessions.create", ["/project", "qa/model", opening])).ok, true);
	assert.deepEqual(calls[0], ["/project", "qa/model", opening]);
	assert.deepEqual(await callRpc(hub, "agent.prompt", ["unique", opening.content, { resumePending: true }]), { ok: true, value: meta });
	assert.deepEqual(calls[1], ["unique", opening.content, { resumePending: true }]);
	assert.equal((await callRpc(hub, "agent.prompt", ["unique", "legacy text"])).ok, true);
	assert.deepEqual(calls[2], ["unique", [{ type: "text", text: "legacy text" }], {}]);
	for (const invalid of [{ content: [] }, { content: [{ type: "text", text: 9 }] }, { ...opening, synthetic: "yes" }]) {
		assert.equal((await callRpc(hub, "sessions.create", ["/project", "qa/model", invalid])).ok, false);
	}
	assert.equal(calls.length, 3, "malformed content must not reach storage");
});
