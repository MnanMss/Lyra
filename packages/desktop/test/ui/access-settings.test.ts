/**
 * Tests for the AccessSettings component under test:ui.
 *
 * Verifies that the alwaysAllow list renders items correctly,
 * shows the empty hint when empty, and allows revoking an entry.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";
import { AccessSettings } from "../../src/features/settings/AccessSettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

test("AccessSettings renders empty hint when alwaysAllow is empty", async () => {
	useApp.setState({
		settings: { ...DEFAULT_SETTINGS, alwaysAllow: [] },
	});

	const view = await mount(h(AccessSettings));
	assert.match(view.text(), /暂无「始终允许」记录/);
	await view.unmount();
});

test("AccessSettings renders allowed subjects and revoking removes the subject", async () => {
	let saved: Settings | undefined;
	useApp.setState({
		settings: {
			...DEFAULT_SETTINGS,
			alwaysAllow: ["mcp__sqlcl-mcp__db_query", "Bash(git status)"],
		},
		saveSettings: async (next) => {
			saved = next;
			useApp.setState({ settings: next });
		},
	});

	const view = await mount(h(AccessSettings));
	assert.match(view.text(), /mcp__sqlcl-mcp__db_query/);
	assert.match(view.text(), /Bash\(git status\)/);

	// Find the delete button for the first allowed item
	const deleteButtons = view.all<HTMLButtonElement>("button[aria-label*='不再自动允许']");
	const { act } = await import("react");
	await act(async () => {
		deleteButtons[0]?.click();
	});
	// Click delete on mcp__sqlcl-mcp__db_query
	deleteButtons[0]?.click();

	assert.deepEqual(saved?.alwaysAllow, ["Bash(git status)"]);
	await view.unmount();
});
