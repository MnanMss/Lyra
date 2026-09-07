import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { click, mount } from "../helpers/mount.ts";

test("named local Markdown artifacts open through the file reader and preserve their labels", async () => {
	const paths: string[] = [];
	const previous = Object.getOwnPropertyDescriptor(window, "lyra");
	Object.defineProperty(window, "lyra", { configurable: true, value: { files: { read: async (path: string) => { paths.push(path); return null; } } } });
	const view = await mount(h(Markdown, { text: "[实现说明](/project/docs/result.md:12)", baseDir: "/project" }));
	try {
		assert.equal(view.find("a").textContent, "实现说明");
		assert.ok(view.find("a svg"));
		await click(view.find("a"));
		assert.deepEqual(paths, ["/project/docs/result.md"]);
	} finally {
		await view.unmount();
		if (previous) Object.defineProperty(window, "lyra", previous); else Reflect.deleteProperty(window, "lyra");
	}
});

test("unsafe schemes and malformed encoded paths never become clickable file links", async () => {
	const view = await mount(h(Markdown, { text: "[unsafe](javascript:alert) [broken](/project/%E0%A4.md)", baseDir: "/project" }));
	try { assert.equal(view.host.querySelector("a"), null); assert.match(view.text(), /unsafe.*broken/); }
	finally { await view.unmount(); }
});
