/**
 * The overlay scrollbar, reporting its own drag.
 *
 * The thumb is drawn beside the viewport rather than inside it, and it moves the surface by
 * assigning `scrollTop`. So a drag produces no wheel, no touch and no key — only a scroll event,
 * which is indistinguishable from the browser clamping a transcript that just got shorter.
 *
 * That matters because of the rule in `follow.ts`: an anonymous position change may restore
 * following and may never end it. Without `onUserScroll` the one gesture that has no event of its
 * own would be the one gesture a follower cannot hear, and pulling the thumb up during a streaming
 * turn would be undone by the next token. These tests are that contract.
 *
 * happy-dom performs no layout, so the geometry is supplied on the prototype: `Scroller` decides
 * whether to draw a thumb at all from `scrollHeight` against `clientHeight`, and with the real
 * zeroes it would never draw one.
 */

import assert from "node:assert/strict";
import { act, createElement as h } from "react";
import { test } from "node:test";
import { createRef } from "react";
import { Scroller } from "../../src/ui/scroll/Scroller.tsx";
import type { Direction } from "../../src/ui/scroll/follow.ts";
import { mount } from "../helpers/mount.ts";

const geometry = { content: 2400, view: 400 };
let scrollTop = 0;

Object.defineProperties(HTMLElement.prototype, {
	clientHeight: { configurable: true, get: () => geometry.view },
	scrollHeight: { configurable: true, get: () => geometry.content },
	scrollTop: {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = Math.max(0, Math.min(value, geometry.content - geometry.view));
		},
	},
});

/**
 * The thumb's height and the travel available to it, as `Scroller` computes them.
 *
 * Restated here rather than imported because the drag arithmetic is what is under test: a test that
 * derived its expectations from the same expression could not tell a correct implementation from a
 * consistently wrong one.
 */
const THUMB = Math.max(28, (geometry.view / geometry.content) * geometry.view);
const TRAVEL = geometry.view - THUMB;

async function openScroller() {
	scrollTop = 0;
	const directions: Direction[] = [];
	const ref = createRef<HTMLDivElement>();
	const view = await mount(
		h(Scroller, {
			scrollRef: ref,
			onUserScroll: (direction: Direction) => directions.push(direction),
			children: h("div", null, "transcript"),
		}),
	);
	return { view, directions, thumb: view.find(".ly-thumb") };
}

/** Press the thumb, then move the mouse to `clientY` and let the queued frame run. */
async function drag(thumb: Element, from: number, to: number) {
	await act(async () => {
		thumb.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientY: from }));
	});
	await act(async () => {
		window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientY: to }));
		// The move is coalesced into one animation frame; the harness runs those on a 16ms timer.
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
}

test("a thumb is drawn only when there is something to scroll", async () => {
	const { view, thumb } = await openScroller();
	assert.ok(thumb, "the content is six times the viewport, so the bar is real");
	await view.unmount();
});

test("pressing the thumb is reported before it has moved at all", async () => {
	/*
	 * The press is a claim on the surface, and it is what calls off a ride back down: without it,
	 * grabbing the thumb mid-glide would leave the animation running under the reader's hand.
	 * Reported as `unknown` because a press has no direction — where it ends decides.
	 */
	const { view, directions, thumb } = await openScroller();
	await act(async () => {
		thumb.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientY: 100 }));
	});
	assert.deepEqual(directions, ["unknown"]);
	await view.unmount();
});

test("dragging the thumb downwards reports downwards", async () => {
	const { view, directions, thumb } = await openScroller();
	await drag(thumb, 100, 200);

	assert.ok(scrollTop > 0, `the surface moved (scrollTop=${scrollTop})`);
	assert.deepEqual(directions, ["unknown", "down"]);
	await view.unmount();
});

test("dragging the thumb upwards reports upwards — the gesture with no event of its own", async () => {
	const { view, directions, thumb } = await openScroller();
	// Start from halfway down, so there is somewhere above to drag to.
	scrollTop = 1000;
	await drag(thumb, 200, 100);

	assert.ok(scrollTop < 1000, `the surface moved up (scrollTop=${scrollTop})`);
	assert.deepEqual(directions, ["unknown", "up"]);
	await view.unmount();
});

test("the drag position tracks the pointer, not the distance it travelled", async () => {
	// A thumb dragged a third of its travel puts the surface a third of the way down its content.
	const { view, thumb } = await openScroller();
	await drag(thumb, 0, Math.round(TRAVEL / 3));
	const expected = Math.round((geometry.content - geometry.view) / 3);
	assert.ok(
		Math.abs(scrollTop - expected) <= 2,
		`expected roughly ${expected} for a third of ${Math.round(TRAVEL)}px of travel, got ${scrollTop}`,
	);
	await view.unmount();
});

test("a thumb held against the end reports nothing at all", async () => {
	/*
	 * The browser clamps, so a drag that has run out of travel moves nothing — and reporting a
	 * direction for it would let a thumb pinned to the bottom of the bar stop the transcript
	 * following, which is the opposite of what holding it there means.
	 */
	const { view, directions, thumb } = await openScroller();
	scrollTop = geometry.content - geometry.view;
	await drag(thumb, 100, 400);
	assert.deepEqual(directions, ["unknown"], "the press, and then nothing");
	await view.unmount();
});

test("a Scroller with no follower attached drags without complaint", async () => {
	// Most scrollers in the window pass no `onUserScroll`; the call site has to stay optional.
	scrollTop = 0;
	const view = await mount(h(Scroller, { children: h("div", null, "list") }));
	const thumb = view.find(".ly-thumb");
	await drag(thumb, 100, 200);
	assert.ok(scrollTop > 0, "it still scrolls");
	await view.unmount();
});
