import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, useEffect, useState } from "react";
import { RetainedViews } from "../../src/ui/layout/RetainedViews.tsx";
import { mount, click } from "../helpers/mount.ts";

test("tab visits retain local state, suspend hidden effects, and evict the oldest page", async () => {
	const live = new Set<string>();
	function Page({ id }: { id: string }) {
		const [count, setCount] = useState(0);
		useEffect(() => { live.add(id); return () => { live.delete(id); }; }, [id]);
		return h("button", { id, onClick: () => setCount(count + 1) }, String(count));
	}
	const render = (id: string) => h(Page, { id });
	const view = await mount(h(RetainedViews, { active: "a", render, limit: 2 }));
	try {
		await click(view.find("#a"));
		await view.rerender(h(RetainedViews, { active: "b", render, limit: 2 }));
		assert.deepEqual([...live], ["b"]);
		await view.rerender(h(RetainedViews, { active: "a", render, limit: 2 }));
		assert.equal(view.find("#a").textContent, "1");
		assert.deepEqual([...live], ["a"]);
		await view.rerender(h(RetainedViews, { active: "c", render, limit: 2 }));
		assert.equal(view.host.querySelector("#b"), null);
		assert.deepEqual([...live], ["c"]);
	} finally { await view.unmount(); }
	assert.equal(live.size, 0);
});
