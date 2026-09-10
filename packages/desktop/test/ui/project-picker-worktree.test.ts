import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createElement } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import type { LyraApi, RepoRef, WorkspaceInfo } from "../../electron/ipc-types.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { ProjectPicker } from "../../src/features/modals/ProjectPicker.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

function workspace(path: string): WorkspaceInfo {
	return { path, name: path, isGitRepo: true, branch: "main" };
}

let worktreeCalls: string[] = [];

beforeEach(() => {
	worktreeCalls = [];
	useApp.setState({
		settings: {
			...DEFAULT_SETTINGS,
			projects: [
				{ id: "/repo-a", path: "/repo-a", name: "Repo A", pinned: true, lastOpenedAt: 10 },
				{ id: "/repo-b", path: "/repo-b", name: "Repo B", pinned: false, lastOpenedAt: 5 },
			],
		},
		workspace: workspace("/repo-a"),
		scratchCwd: null,
		scratchRoots: [],
		selectionEpoch: 0,
		activeSessionId: null,
		meta: null,
		messages: [],
		sessions: [],
		sessionCache: {},
		toolRuns: {},
		running: false,
	});

	const trees: Record<string, RepoRef[]> = {
		"/repo-a": [
			{ path: "/repo-a", label: "Repo A", branch: "main", worktree: false },
			{ path: "/repo-a-wt1", label: "repo-a-wt1", branch: "feat/wt1", worktree: true },
		],
		"/repo-b": [
			{ path: "/repo-b", label: "Repo B", branch: "main", worktree: false },
		],
	};

	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			workspace: {
				info: async (path: string) => workspace(path),
			},
			git: {
				worktrees: async (path: string) => {
					worktreeCalls.push(path);
					return trees[path] ?? [];
				},
				createWorktree: async (_path: string, branch: string) => {
					return { ok: true, path: "/new-wt-path", branch };
				},
			},
			settings: {
				save: async (settings: Settings) => settings,
			},
			sessions: {
				create: async (cwd: string) => ({
					meta: { id: "s1", title: "s1", projectId: cwd, projectName: cwd, cwd, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 1, seq: 2, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } },
					messages: [],
					running: false,
					pendingApprovals: [],
				}),
				capabilities: async () => null,
			},
		} as unknown as LyraApi,
	});
});

test("ProjectPicker lists linked worktrees under their repository and allows switching", async () => {
	const anchor = document.createElement("button");
	const mounted = await mount(
		createElement(
			I18nProvider,
			{ locale: "zh-CN" } as any,
			createElement(
				LayoutProvider,
				null as any,
				createElement(ProjectPicker, {
					anchor,
					onClose: () => {},
				}),
			),
		),
	);
	// Wait for async worktrees effect to settle
	await new Promise((resolve) => setTimeout(resolve, 60));

	assert.ok(worktreeCalls.includes("/repo-a"));
	assert.ok(worktreeCalls.includes("/repo-b"));

	const text = document.body.textContent ?? "";
	assert.ok(text.includes("Repo A"), "main repo A should be rendered");
	assert.ok(text.includes("repo-a-wt1"), "linked worktree should be rendered");
	assert.ok(text.includes("feat/wt1"), "branch of linked worktree should be rendered");

	await mounted.unmount();
	anchor.remove();
});
