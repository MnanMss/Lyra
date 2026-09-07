/**
 * The arithmetic behind the trend chart's pointer.
 *
 * Every one of these is a place where being slightly wrong is invisible in a screenshot and
 * obvious in use: a chart that answers with the wrong day, a reading that stops one column short
 * of the right edge, a bubble that hangs off the side of the window.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderTrend } from "../src/features/settings/usage-aggregate.ts";
import {
	CHART,
	chartTipPlacement,
	dayTitle,
	hoverIndexAt,
	metricLabel,
	PLOT_WIDTH,
	plotHeightFor,
	pointAtX,
	pointAtY,
	tipContentAt,
	trendColor,
	viewHeightFor,
} from "../src/features/settings/usage-chart-hover.ts";

/** The SVG drawn at its own size: one screen pixel per viewBox unit, at the window's origin. */
const UNSCALED = { left: 0, width: CHART.width };

function trend(id: string, values: number[]): ProviderTrend {
	return {
		id,
		tokens: 0,
		cost: 0,
		unpricedTokens: 0,
		share: 0,
		points: values.map((cost, index) => ({ day: `2026-09-${String(index + 1).padStart(2, "0")}`, cost, tokens: cost * 1000 })),
	};
}

describe("hoverIndexAt", () => {
	it("answers across the whole plot, not only where a mark is drawn", () => {
		assert.equal(hoverIndexAt(CHART.left, UNSCALED, 30), 0);
		assert.equal(hoverIndexAt(CHART.left + PLOT_WIDTH, UNSCALED, 30), 29);
		assert.equal(hoverIndexAt(CHART.left + PLOT_WIDTH / 2, UNSCALED, 31), 15, "the middle of an odd series is its middle day");
	});

	it("rounds to the nearest day, so every column owns the width around it", () => {
		const step = PLOT_WIDTH / 29;
		// Just inside the boundary between the fourth and fifth column, from either side.
		assert.equal(hoverIndexAt(CHART.left + step * 4 - step * 0.49, UNSCALED, 30), 4);
		assert.equal(hoverIndexAt(CHART.left + step * 4 + step * 0.49, UNSCALED, 30), 4);
		assert.equal(hoverIndexAt(CHART.left + step * 4 + step * 0.51, UNSCALED, 30), 5);
	});

	it("clamps the gutters rather than going blank there", () => {
		assert.equal(hoverIndexAt(0, UNSCALED, 30), 0, "the axis labels' gutter still reads as the first day");
		assert.equal(hoverIndexAt(CHART.width + 200, UNSCALED, 30), 29);
		assert.equal(hoverIndexAt(-500, UNSCALED, 30), 0);
	});

	it("undoes the scaling of a stretched chart and its offset in the window", () => {
		// The card is 1280 wide and starts 100px in: every viewBox unit is two screen pixels.
		const box = { left: 100, width: CHART.width * 2 };
		assert.equal(hoverIndexAt(100 + CHART.left * 2, box, 30), 0);
		assert.equal(hoverIndexAt(100 + (CHART.left + PLOT_WIDTH) * 2, box, 30), 29);
		assert.equal(hoverIndexAt(100 + (CHART.left + PLOT_WIDTH / 2) * 2, box, 31), 15);
	});

	it("has no answer without a series or without a layout", () => {
		assert.equal(hoverIndexAt(300, UNSCALED, 0), null);
		assert.equal(hoverIndexAt(300, { left: 0, width: 0 }, 30), null, "an unlaid-out chart must not report day zero");
		assert.equal(hoverIndexAt(300, UNSCALED, 1), 0, "a single day is the answer everywhere");
	});
});

describe("pointAtX / pointAtY", () => {
	it("spreads the days across the plot and draws a single one at the left edge", () => {
		assert.equal(pointAtX(0, 30), CHART.left);
		assert.equal(pointAtX(29, 30), CHART.left + PLOT_WIDTH);
		assert.equal(pointAtX(0, 1), CHART.left);
	});

	it("puts zero on the baseline and the maximum at the top", () => {
		assert.equal(pointAtY(0, 100), CHART.top + (CHART.height - CHART.top - CHART.bottom));
		assert.equal(pointAtY(100, 100), CHART.top);
		assert.equal(pointAtY(0, 0), CHART.top + (CHART.height - CHART.top - CHART.bottom), "an empty chart draws its flat line, not a NaN");
	});
});

describe("viewHeightFor", () => {
	it("scales the viewBox to the box it was given, so a unit is the same size in both directions", () => {
		// 730x242 is the card at 1440: the shape the chart used to be locked to.
		assert.equal(viewHeightFor({ width: 730, height: 242 }), 212);
		assert.equal(viewHeightFor({ width: 730, height: 330 }), 289, "a taller card gets a taller chart, not a band of empty");
		assert.equal(plotHeightFor(viewHeightFor({ width: 730, height: 330 })), 289 - CHART.top - CHART.bottom);
	});

	it("keeps a floor under the plot and falls back before it has been laid out", () => {
		assert.equal(viewHeightFor({ width: 0, height: 0 }), CHART.height);
		assert.equal(viewHeightFor({ width: 730, height: 20 }), CHART.top + CHART.bottom + 80, "a sliver of a box still leaves room to draw in");
	});
});

describe("chartTipPlacement", () => {
	const tip = { width: 200, height: 120 };
	const viewport = { width: 1440, height: 900 };

	it("sits beside the crosshair, to its right, centred on the pointer", () => {
		const at = chartTipPlacement({ x: 700, y: 400 }, tip, viewport);
		assert.equal(at.left, 714, "14px clear of the line, so the bubble never covers it");
		assert.equal(at.top, 340);
	});

	it("flips to the left when the right would run past the window", () => {
		const at = chartTipPlacement({ x: 1400, y: 400 }, tip, viewport);
		assert.equal(at.left, 1400 - 14 - tip.width, "the most recent day is the one people point at, and it is at the edge");
		assert.ok(at.left + tip.width <= viewport.width - 8);
	});

	it("keeps both edges on screen when neither side fits", () => {
		const narrow = { width: 320, height: 900 };
		const right = chartTipPlacement({ x: 300, y: 400 }, tip, narrow);
		assert.ok(right.left >= 8 && right.left + tip.width <= narrow.width - 8, JSON.stringify(right));
		const left = chartTipPlacement({ x: 20, y: 400 }, tip, narrow);
		assert.ok(left.left >= 8 && left.left + tip.width <= narrow.width - 8, JSON.stringify(left));
	});

	it("follows the pointer only as far as the plot, rather than riding up over the legend and the controls", () => {
		const plot = { top: 300, bottom: 560 };
		assert.equal(chartTipPlacement({ x: 700, y: 430 }, tip, viewport, plot).top, 370, "in the middle it is simply centred on the pointer");
		assert.equal(chartTipPlacement({ x: 700, y: 310 }, tip, viewport, plot).top, 300, "near the top it stops at the chart's own top edge");
		assert.equal(chartTipPlacement({ x: 700, y: 550 }, tip, viewport, plot).top, 560 - tip.height, "and at the bottom, at its bottom edge");
	});

	it("is let out of a plot shorter than the bubble, which could not fit either way", () => {
		assert.equal(chartTipPlacement({ x: 700, y: 340 }, tip, viewport, { top: 300, bottom: 380 }).top, 280);
	});

	it("never lets the bubble hang off the top or the bottom", () => {
		assert.equal(chartTipPlacement({ x: 700, y: 10 }, tip, viewport).top, 8);
		assert.equal(chartTipPlacement({ x: 700, y: 895 }, tip, viewport).top, viewport.height - tip.height - 8);
	});

	it("shows the top of a bubble taller than the window rather than centring it", () => {
		const tall = { width: 200, height: 1000 };
		assert.equal(chartTipPlacement({ x: 700, y: 400 }, tall, viewport).top, 8);
	});
});

describe("tipContentAt", () => {
	const trends = [trend("relay", [1.5, 0, 12.345]), trend("fast", [0, 0.001, 3])];
	const labelOf = (id: string) => (id === "relay" ? "Relay" : "蹬得飞快");

	it("states every provider for the day, in the legend's order, keeping the idle ones", () => {
		const content = tipContentAt(trends, 1, "cost", labelOf);
		assert.ok(content);
		assert.equal(content.day, "2026-09-02");
		assert.equal(content.title, "2026/9/2 周三");
		assert.deepEqual(content.rows.map((row) => row.label), ["Relay", "蹬得飞快"]);
		assert.deepEqual(content.rows.map((row) => row.text), ["$0", "$0.0010"], "a provider that spent nothing that day still has a row");
		assert.deepEqual(content.rows.map((row) => row.color), [trendColor(0), trendColor(1)], "the dots match the legend");
	});

	it("totals the day when there is more than one provider to total", () => {
		assert.equal(tipContentAt(trends, 2, "cost", labelOf)?.total, "$15.35");
		assert.equal(tipContentAt([trends[0]], 2, "cost", labelOf)?.total, null, "one provider's total is the row above it");
	});

	it("reads tokens as exact counts", () => {
		const content = tipContentAt(trends, 2, "tokens", labelOf);
		assert.deepEqual(content?.rows.map((row) => row.text), ["12,345", "3,000"]);
		assert.equal(content?.total, "15,345");
	});

	it("has nothing to say about a day outside the range or a chart with no series", () => {
		assert.equal(tipContentAt(trends, 9, "cost", labelOf), null);
		assert.equal(tipContentAt([], 0, "cost", labelOf), null);
	});
});

describe("metricLabel", () => {
	it("keeps fractions of a cent visible and rounds real money to cents", () => {
		assert.equal(metricLabel(0, "cost"), "$0");
		assert.equal(metricLabel(0.0012, "cost"), "$0.0012");
		assert.equal(metricLabel(12.345, "cost"), "$12.35");
		assert.equal(metricLabel(1234.5, "cost"), "$1,234.50");
	});

	it("groups tokens rather than abbreviating them", () => {
		assert.equal(metricLabel(2_500_000_000, "tokens"), "2,500,000,000");
		assert.equal(metricLabel(0, "tokens"), "0");
	});
});

describe("dayTitle", () => {
	it("spells out what the axis only has room to abbreviate", () => {
		assert.equal(dayTitle("2026-09-05"), "2026/9/5 周六");
		assert.equal(dayTitle("2026-01-01"), "2026/1/1 周四");
	});

	it("passes through anything that is not a date", () => {
		assert.equal(dayTitle("nonsense"), "nonsense");
	});
});
