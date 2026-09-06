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
import { DEFAULT_SETTINGS, type SessionMeta, type Settings } from "@lyra/core";

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
		editMessage: async () => {},
		dispose: async () => {},
		prompt: async () => {
			throw new Error("not needed");
		},
		snapshot: async () => ({}),
		touch: () => {},
		sideChatState: async () => null,
		sideChatAsk: async () => {},
		sideChatEditAndResend: async () => {},
		sideChatAbort: async () => {},
		sideChatReset: async () => {},
		tasksList: async () => [],
		tasksCancel: async () => false,
		tasksDismiss: async () => false,
		tasksResume: async () => false,
		commandsList: async () => ({ commands: [], builtins: [], diagnostics: [], skills: [], agents: [] }),
		filesList: async () => [],
		filesRead: async () => null,
		scratchRoots: async () => [],
		generalScratch: async () => "/scratch/general",
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
		"files.list",
		"files.read",
	]) {
		assert.ok(allowed.has(method), `${method} 应该可用`);
	}
});

test("read-only project files cross the phone RPC without exposing write operations", async () => {
	const calls: unknown[] = [];
	const remote = deps({
		filesList: async (dir) => {
			calls.push(["list", dir]);
			return [{ name: "README.md", path: `${dir}/README.md`, isDirectory: false, size: 7 }];
		},
		filesRead: async (path) => {
			calls.push(["read", path]);
			return { text: "# Lyra\n", readOnly: true, truncated: false, bytes: 7, modifiedAt: 1 };
		},
	});

	assert.equal((await callRpc(remote, "files.list", ["/project"])).ok, true);
	const read = await callRpc(remote, "files.read", ["/project/README.md"]);
	assert.equal(read.ok, true);
	assert.deepEqual(read.value, { text: "# Lyra\n", readOnly: true, truncated: false, bytes: 7, modifiedAt: 1 });
	assert.deepEqual(calls, [["list", "/project"], ["read", "/project/README.md"]]);

	for (const method of ["files.write", "files.remove", "files.rename", "files.importInto"]) {
		assert.deepEqual(await callRpc(remote, method, []), { ok: false, error: "method-not-allowed" });
	}
});

test("approving a tool call is allowed, because that is the point of having a phone", () => {
	// A turn stops and waits for a decision; being able to make it from the other room is most of
	// why this feature exists. It grants only what the desktop was already about to ask for.
	assert.ok(allowedMethods().includes("agent.approve"));
});

test("approval decisions accept structured answers and persist only the consumed trusted subject", async () => {
	const resolved: unknown[] = [];
	let pending = [{ id: "r1", request: { subject: "approved command" } }];
	const saved: Settings[] = [];
	const session = {
		listPendingApprovals: () => pending,
		resolveApproval: (requestId: string, decision: unknown) => {
			resolved.push([requestId, decision]);
			pending = [];
			return true;
		},
	} as never;

	assert.deepEqual(await callRpc(deps({ live: () => session, saveSettings: async value => { saved.push(value); } }), "agent.approve", ["s1", "r1", "always"]), {
		ok: true,
		value: null,
	});
	assert.deepEqual(resolved, [["r1", "always"]]);
	assert.ok(saved[0].alwaysAllow.includes("approved command"));
	assert.equal((await callRpc(deps({ live: () => session }), "agent.approve", ["s1", "r2", { answer: "保留" }])).ok, true);

	for (const invalid of [{ allow: true }, { answer: "" }, { answer: 42 }, "yes", null]) {
		const result = await callRpc(deps({ live: () => session }), "agent.approve", ["s1", "r2", invalid]);
		assert.equal(result.ok, false);
		assert.match(String(result.error), /invalid-args.*decision/);
	}
	assert.deepEqual(resolved, [["r1", "always"], ["r2", { answer: "保留" }]], "invalid decisions must not reach the session");
	const missing = await callRpc(deps(), "agent.approve", ["missing", "r", { answer: "保留" }]);
	assert.equal(missing.ok, false, "a closed session must not acknowledge an answer");
});

test("thinking accepts a bounded string or null", async () => {
	const levels: unknown[] = [];
	const session = {
		meta: { projectId: "p1" },
		setThinking: async (thinking: unknown) => void levels.push(thinking),
	} as never;
	const withSession = deps({
		live: () => session,
		activate: async () => session,
	});

	assert.equal((await callRpc(withSession, "agent.setThinking", ["s1", "ultra"])).ok, true);
	assert.equal((await callRpc(withSession, "agent.setThinking", ["s1", null])).ok, true);
	assert.deepEqual(levels, ["ultra", null]);

	for (const invalid of [{ effort: "low" }, 3, "x".repeat(201)]) {
		const result = await callRpc(withSession, "agent.setThinking", ["s1", invalid]);
		assert.equal(result.ok, false);
		assert.match(String(result.error), /invalid-args.*thinking/);
	}
	assert.deepEqual(levels, ["ultra", null]);
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
		"sessions.trajectory": ["p1", "s1"],
		"sessions.trajectoryChanges": ["p1", "s1"],
		"sessions.fork": ["p1", "s1", 1],
		"sessions.remove": ["p1", "s1"],
		"sessions.capabilities": ["s1"],
		"sessions.setArchived": ["p1", "s1", true],
		"sessions.rename": ["p1", "s1", "标题"],
		"sessions.compact": ["s1"],
		"sessions.contextBreakdown": ["s1"],
		"agent.prompt": ["s1", "你好"],
		"agent.editMessage": ["s1", 0, "改过的"],
		"agent.abort": ["s1"],
		"agent.approve": ["s1", "r1", "once"],
		"agent.setModel": ["s1", "m1"],
		"agent.setThinking": ["s1", "low"],
		"settings.save": [{}],
		"subAgents.list": ["s1"],
		"subAgents.detail": ["s1", "a1"],
		"subAgents.steer": ["s1", "a1", "继续检查"],
		"subAgents.abort": ["s1", "a1"],
		"subAgents.dismiss": ["s1", "a1"],
		"subAgents.dismissFinished": ["s1"],
		"sideChat.state": ["s1"],
		"sideChat.ask": ["s1", "检查一下"],
		"sideChat.editAndResend": ["s1", 0, "换个问法"],
		"sideChat.abort": ["s1"],
		"sideChat.reset": ["s1"],
		"tasks.list": ["s1"],
		"tasks.cancel": ["s1", "t1"],
		"tasks.dismiss": ["s1", "t1"],
		"tasks.resume": ["s1", "t1"],
		"commands.list": ["/tmp/project"],
		"files.list": ["/tmp/project"],
		"files.read": ["/tmp/project/README.md"],
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
