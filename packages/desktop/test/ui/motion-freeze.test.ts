import assert from "node:assert/strict";
import { test } from "node:test";
import { freezeMotion } from "../../src/ui/motion/freeze.ts";

test("freezing a pane finishes its visual geometry flight without stopping content animations", () => {
	const pane = document.createElement("div");
	pane.className = "ly-dock-pane";
	const surface = document.createElement("div");
	surface.setAttribute("data-dock-motion", "");
	const chrome = document.createElement("div");
	chrome.className = "ly-dock-chrome";
	const heading = document.createElement("div");
	heading.setAttribute("data-dock-heading", "");
	chrome.append(heading);
	pane.append(chrome, surface);
	document.body.append(pane);
	let geometryFinished = 0;
	let contentFinished = 0;
	Object.defineProperty(pane, "getAnimations", { value: () => [] });
	Object.defineProperty(heading, "getAnimations", { value: () => [
		{ id: "ly-dock-geometry", finish: () => { geometryFinished++; } },
	] });
	Object.defineProperty(surface, "getAnimations", { value: () => [
		{ id: "ly-dock-geometry", finish: () => { geometryFinished++; } },
		{ id: "running-spinner", finish: () => { contentFinished++; } },
	] });
	const release = freezeMotion();
	const releaseNested = freezeMotion();
	try {
		assert.equal(geometryFinished, 2);
		assert.equal(contentFinished, 0);
		assert.equal(pane.hasAttribute("data-ly-frozen"), true);
		release();
		assert.equal(pane.hasAttribute("data-ly-frozen"), true);
		releaseNested();
		assert.equal(pane.hasAttribute("data-ly-frozen"), false);
	} finally {
		release(); releaseNested(); pane.remove();
	}
});
