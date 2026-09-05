import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { questionsIn } from "../../src/features/conversation/question-navigation.ts";
import { useTranscriptWindow } from "../../src/features/conversation/view-state.ts";
import { mount, click } from "../helpers/mount.ts";

test("identical questions have separate targets; synthetic prompts have none", () => {
	assert.deepEqual(questionsIn([
		{ role: "user", content: [{ type: "text", text: "same" }], timestamp: 1 },
		{ role: "user", content: [{ type: "text", text: "same" }], timestamp: 2 },
		{ role: "user", synthetic: true, content: [{ type: "text", text: "continue" }], timestamp: 3 },
		{ role: "user", content: [{ type: "image", data: "", mimeType: "image/png" }], timestamp: 4 },
	]), [{ index: 0, text: "same" }, { index: 1, text: "same" }, { index: 3, text: "图片消息" }]);
});

test("jumping through 10,000 runs mounts one window and preserves each session's range", async () => {
	function Window({ id }: { id: string }) {
		const range = useTranscriptWindow(id, 60, 10_000);
		return h("div", null,
			h("output", null, `${range.start}:${range.end}`),
			h("button", { id: "old", onClick: () => range.reveal(10) }, "old"),
			h("button", { id: "latest", onClick: range.latest }, "latest"));
	}
	const view = await mount(h(Window, { id: "nav-a" }));
	try {
		await click(view.find("#old"));
		assert.equal(view.find("output").textContent, "5:65");
		await view.rerender(h(Window, { id: "nav-b" }));
		assert.equal(view.find("output").textContent, "9940:10000");
		await view.rerender(h(Window, { id: "nav-a" }));
		assert.equal(view.find("output").textContent, "5:65");
		await click(view.find("#latest"));
		assert.equal(view.find("output").textContent, "9940:10000");
	} finally { await view.unmount(); }
});
