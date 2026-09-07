import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollFade } from "../src/ui/scroll/fade.ts";

test("short scrollports retain an opaque reading area between both fades", () => {
	for (const height of [0, 20, 36, 46, 98, 180, 320, 800]) {
		const top = scrollFade(height, "top"), bottom = scrollFade(height, "bottom");
		assert.ok(top >= 0 && bottom >= 0);
		assert.ok(height - top - bottom >= height * 0.6);
	}
});

test("full-height lists preserve the established edge depths", () => {
	assert.equal(scrollFade(800, "top"), 36);
	assert.equal(scrollFade(800, "bottom"), 48);
});
