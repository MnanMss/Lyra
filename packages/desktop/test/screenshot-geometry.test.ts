/**
 * The rules a selection follows, checked without a screen.
 *
 * These are the parts of dragging a selection that are easy to get subtly wrong and tedious to
 * verify by hand: a handle that answers for the corner you are not on, a drag past the opposite
 * edge that produces a negative width, a toolbar that leaves the screen when the selection is at
 * the bottom of it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	clampRect,
	clampToolbar,
	handlePoint,
	hitHandle,
	insideRect,
	moveRect,
	rectFromPoints,
	resizeRect,
	toolbarPosition,
	HANDLES,
} from "../src/features/image/screenshot-geometry.ts";

const rect = { x: 100, y: 100, width: 200, height: 100 };
const screen = { width: 1000, height: 800 };

test("every handle sits on the selection's own edge", () => {
	for (const handle of HANDLES) {
		const at = handlePoint(rect, handle);
		const onVertical = at.x === rect.x || at.x === rect.x + rect.width || at.x === rect.x + rect.width / 2;
		const onHorizontal = at.y === rect.y || at.y === rect.y + rect.height || at.y === rect.y + rect.height / 2;
		assert.ok(onVertical && onHorizontal, `${handle} is at ${at.x},${at.y}`);
	}
});

test("a corner wins over the edge that shares it", () => {
	// The two overlap wherever a corner is, and the corner is what the pointer is aiming at.
	assert.equal(hitHandle(rect, { x: 100, y: 100 }, 8), "nw");
	assert.equal(hitHandle(rect, { x: 300, y: 200 }, 8), "se");
});

test("a point away from every handle is not a handle", () => {
	assert.equal(hitHandle(rect, { x: 200, y: 150 }, 8), null, "the middle is not a handle");
	assert.equal(hitHandle(rect, { x: 100, y: 140 }, 8), null, "part-way down an edge is not a handle");
});

test("the target is bigger than the mark", () => {
	// Six pixels off the corner still grabs it: eight pixels of square is not something a hand
	// lands on reliably, which is the same reason a scrollbar's target is wider than its thumb.
	assert.equal(hitHandle(rect, { x: 106, y: 106 }, 8), "nw");
	assert.equal(hitHandle(rect, { x: 120, y: 120 }, 8), null, "…but not from anywhere");
});

test("dragging a handle past the opposite edge flips rather than inverting", () => {
	// Left edge dragged to the right of the right edge. Width stays positive; the rectangle is
	// simply on the other side now, which is what every other resize in the world does.
	const flipped = resizeRect(rect, "w", { x: 400, y: 150 });
	assert.equal(flipped.x, 300);
	assert.equal(flipped.width, 100);
	assert.ok(flipped.width > 0, "a flipped selection must not have a negative width");
});

test("a corner handle moves both of its edges and neither of the others", () => {
	const resized = resizeRect(rect, "se", { x: 400, y: 500 });
	assert.deepEqual(resized, { x: 100, y: 100, width: 300, height: 400 });

	const north = resizeRect(rect, "n", { x: 999, y: 50 });
	assert.equal(north.y, 50, "the top edge moved");
	assert.equal(north.x, 100, "and the horizontal edges did not");
	assert.equal(north.width, 200);
});

test("moving keeps the selection whole at the edge instead of shrinking it", () => {
	const pushed = moveRect(rect, -500, -500, screen);
	assert.deepEqual(pushed, { x: 0, y: 0, width: 200, height: 100 }, "size survived the wall");

	const far = moveRect(rect, 5000, 5000, screen);
	assert.deepEqual(far, { x: 800, y: 700, width: 200, height: 100 });
});

test("a selection larger than the screen is not pushed to a negative offset", () => {
	const huge = { x: 10, y: 10, width: 2000, height: 2000 };
	const moved = moveRect(huge, -100, -100, screen);
	assert.equal(moved.x, 0);
	assert.equal(moved.y, 0);
});

test("clamping trims a resize that ran off the screen", () => {
	const trimmed = clampRect({ x: -50, y: -50, width: 200, height: 200 }, screen);
	assert.deepEqual(trimmed, { x: 0, y: 0, width: 150, height: 150 });
});

test("a rectangle from two corners is the same whichever order they arrive in", () => {
	const a = rectFromPoints({ x: 10, y: 20 }, { x: 60, y: 80 });
	const b = rectFromPoints({ x: 60, y: 80 }, { x: 10, y: 20 });
	assert.deepEqual(a, b);
	assert.deepEqual(a, { x: 10, y: 20, width: 50, height: 60 });
});

test("inside is inside, including the border", () => {
	assert.ok(insideRect(rect, { x: 200, y: 150 }));
	assert.ok(insideRect(rect, { x: 100, y: 100 }), "the corner counts");
	assert.ok(!insideRect(rect, { x: 99, y: 150 }));
});

// ---------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------

const toolbar = { width: 360, height: 40 };

test("the toolbar sits under the selection, aligned to its right edge", () => {
	/*
	 * Right, not left. The bar ends with cancel and confirm, and a drag almost always ends at the
	 * bottom-right corner — so aligning that end with the selection puts the two controls that
	 * finish the job under the hand that just let go. Left-aligned they are a bar's width away.
	 */
	// A selection with room for the bar under it; the narrow case is the test below.
	const roomy = { x: 200, y: 100, width: 500, height: 100 };
	const at = toolbarPosition(roomy, screen, toolbar);
	assert.equal(at.x + toolbar.width, roomy.x + roomy.width, "right-aligned with the selection");
	assert.equal(at.y, roomy.y + roomy.height + 12);
});

test("a selection narrower than the toolbar keeps it on screen instead", () => {
	// Right-aligning a 360pt bar to a 200pt region would start it off the left edge of the display.
	const at = toolbarPosition(rect, screen, toolbar);
	assert.ok(at.x >= 0, `${at.x} is off the left edge`);
	assert.ok(at.x + toolbar.width <= screen.width, `${at.x + toolbar.width} is off the right edge`);
});

test("and flips above when there is no room below", () => {
	const low = { x: 100, y: 740, width: 200, height: 50 };
	const at = toolbarPosition(low, screen, toolbar);
	assert.ok(at.y < low.y, `expected it above ${low.y}, got ${at.y}`);
});

test("it never leaves the screen, even when neither side fits", () => {
	// A selection filling a short screen: below is off the bottom, above is off the top.
	const tall = { x: 100, y: 0, width: 200, height: 800 };
	const at = toolbarPosition(tall, screen, toolbar);
	assert.ok(at.y >= 0 && at.y + toolbar.height <= screen.height, `${at.y} is off screen`);
});

test("a selection at the right edge slides the toolbar back on screen", () => {
	const right = { x: 900, y: 100, width: 90, height: 90 };
	const at = toolbarPosition(right, screen, toolbar);
	assert.ok(at.x + toolbar.width <= screen.width, `toolbar runs to ${at.x + toolbar.width}, screen is ${screen.width}`);
});

test("a selection at the left edge is not pushed off the other way", () => {
	const at = toolbarPosition({ x: 0, y: 100, width: 100, height: 100 }, screen, toolbar);
	assert.ok(at.x >= 0);
});

test("the bar leaves room for the bubble it opens, rather than only for itself", () => {
	/*
	 * The reported symptom: a region reaching the bottom of the screen put the toolbar in the last
	 * strip that fitted, and the size-and-colour bubble — which opens *further* from the region —
	 * landed off the screen. All that showed of it was a row of pixels along the bottom edge.
	 */
	const bubble = { height: 34 };
	// A region whose bottom leaves room for the bar but not for the bar plus the bubble.
	const tight = { x: 100, y: 100, width: 400, height: screen.height - 100 - toolbar.height - 24 };

	const without = toolbarPosition(tight, screen, toolbar);
	assert.equal(without.side, "below", "前提：不考虑气泡时它会放在下方");

	const at = toolbarPosition(tight, screen, toolbar, bubble);
	assert.notEqual(at.side, "below", "下方放不下整摞时不应再选下方");
	// And wherever it went, the whole stack is on screen.
	const top = at.side === "below" ? at.y : at.y - bubble.height;
	const bottom = at.side === "below" ? at.y + toolbar.height + bubble.height : at.y + toolbar.height;
	assert.ok(top >= 0, `整摞顶部跑出了屏幕：${top}`);
	assert.ok(bottom <= screen.height, `整摞底部跑出了屏幕：${bottom}`);
});

test("with room on both sides the bubble does not change where the bar goes", () => {
	// The reservation must not push the bar around in the ordinary case.
	const roomy2 = { x: 100, y: 200, width: 400, height: 200 };
	assert.deepEqual(
		toolbarPosition(roomy2, screen, toolbar, { height: 34 }),
		toolbarPosition(roomy2, screen, toolbar),
	);
});

/*
 * A toolbar that has been dragged by hand, which stops following the selection.
 *
 * The automatic placement is right nearly always and wrong in the case it cannot see: the bar
 * covering the part of the picture that is about to be annotated, or a second window the user is
 * comparing against. Neither is on the screen the overlay can measure, so the answer is a handle
 * and a rule about where the result may end up.
 */
test("a dragged toolbar stays on screen, with room above it for its bubble", () => {
	const bubble = 48;
	const put = (x: number, y: number) => clampToolbar({ x, y }, toolbar, screen, bubble);

	// Somewhere ordinary: left exactly where it was put.
	assert.deepEqual(put(300, 400), { x: 300, y: 400 });

	// Dragged off the right and bottom edges: pulled back to the margin, keeping its whole width.
	const corner = put(screen.width + 500, screen.height + 500);
	assert.equal(corner.x, screen.width - toolbar.width - 12);
	assert.equal(corner.y, screen.height - toolbar.height - 12);

	// Dragged off the top: stopped where the bubble it opens still has somewhere to go. Without
	// this the size and colour of the tool in hand are unreachable — the bubble opens upward.
	assert.equal(put(300, -200).y, bubble);
	assert.equal(put(-200, 300).x, 12);
});

test("a viewport too short for the toolbar keeps its top edge rather than its bottom", () => {
	/*
	 * Off the bottom is recoverable: the bar is still under the pointer that dragged it there, and
	 * the grip is at its left end. Off the top is not — there is nothing above the screen to drag
	 * it back from. So where the two bounds conflict, the low one wins.
	 */
	const tiny = { width: 200, height: 40 };
	const at = clampToolbar({ x: 0, y: 0 }, toolbar, tiny, 48);
	assert.ok(at.y >= 12, `顶部被推出了屏幕：${at.y}`);
	assert.ok(at.x >= 12, `左边被推出了屏幕：${at.x}`);
});
