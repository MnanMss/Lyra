import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { AgentEvent, SessionMeta } from "@lyra/core";
import type { Entry } from "@lyra/core/trajectory-view";
import { useApp } from "../../src/store/index.ts";
import { useTrajectory } from "../../src/features/conversation/trajectory/useTrajectory.ts";
import { click, mount } from "../helpers/mount.ts";

function Probe() {
	const state = useTrajectory();
	return h("div", null, h("span", null, `${state.loading}:${state.error}:${state.all.map(entry => entry.detail).join(",")}`), h("button", { onClick: state.refresh }, "refresh"));
}

test("durable events during a read are drained once; old-session responses cannot replace the new session and errors are visible", async () => {
	const requests: { id: string; resolve: (entries: Entry[]) => void; reject: (error: Error) => void }[] = [];
	const listeners = new Set<(payload: { sessionId: string; event: AgentEvent }) => void>();
	const meta: SessionMeta = { id: "trace-refresh-a", projectId: "p", projectName: "QA", cwd: "/tmp", title: "A", createdAt: 1, updatedAt: 1, messageCount: 1, seq: 1, modelId: "qa", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		sessions: { trajectory: (_project: string, id: string) => new Promise<Entry[]>((resolve, reject) => requests.push({ id, resolve, reject })) },
		agent: { onEvent: (listener: (payload: { sessionId: string; event: AgentEvent }) => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
	} });
	useApp.setState({ meta });
	const view = await mount(h(Probe));
	const entry = (detail: string): Entry => ({ seq: 1, ts: 1, source: "compaction", detail, summary: detail });
	try {
		assert.equal(requests.length, 1);
		await act(async () => { for (let i = 0; i < 10; i++) for (const listener of listeners) listener({ sessionId: meta.id, event: { type: "compacted", before: 20, after: 8 } }); });
		assert.equal(requests.length, 1, "only one read may be in flight");
		await act(async () => requests[0].resolve([entry("A")]));
		assert.equal(requests.length, 2, "a committed change during the read must be fetched");
		await act(async () => useApp.setState({ meta: { ...meta, id: "trace-refresh-b" } }));
		assert.equal(requests.length, 3);
		assert.ok(!view.text().includes(":A"));
		await act(async () => requests[1].resolve([entry("stale A")]));
		assert.ok(!view.text().includes("stale A"));
		await act(async () => requests[2].reject(new Error("disk failure")));
		assert.match(view.text(), /disk failure/);
		await click(view.find("button"));
		await act(async () => requests[3].resolve([entry("B")]));
		assert.match(view.text(), /false::B/);
	} finally {
		await view.unmount();
		assert.equal(listeners.size, 0);
		if (previous) Object.defineProperty(window, "lyra", previous); else Reflect.deleteProperty(window, "lyra");
	}
});
