import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";
import type { LyraApi } from "../../electron/ipc-types.ts";
import { PluginsView } from "../../src/features/plugins/PluginsView.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

test("a local skill scan cannot report an empty catalogue before it answers", async () => {
	let finish!: (scan: Awaited<ReturnType<LyraApi["plugins"]["list"]>>) => void;
	const scan = new Promise<Awaited<ReturnType<LyraApi["plugins"]["list"]>>>((resolve) => { finish = resolve; });
	Object.defineProperty(window, "lyra", { configurable: true, value: { plugins: { list: () => scan } } });
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, pluginRegistries: [], skillRegistries: [] }, workspace: null, pluginFocus: null });
	const view = await mount(h(PluginsView));
	try {
		await click(view.all<HTMLButtonElement>("header button").find((button) => button.textContent === "技能")!);
		assert.doesNotMatch(view.text(), /还没有技能|没有匹配的技能/);
		await act(async () => { finish({ plugins: [], mcpBundles: [], skills: [], skillDiagnostics: [], shadowedSkills: [], pluginDiagnostics: [] }); });
		assert.match(view.text(), /还没有技能/);
	} finally { await view.unmount(); }
});
