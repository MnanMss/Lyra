/**
 * Pointing at the daily trend chart.
 *
 * The behaviour under test is the one the card's subtitle has always promised — "悬停查看当日数据"
 * — and did not do: the only hover targets were the data points themselves, so the answer arrived
 * only if the pointer landed on a line. These check that the whole plot answers, that the answer is
 * the whole day rather than one provider, and that it is rendered outside the card, which is
 * `overflow-hidden` and would otherwise cut it off.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import type { ProviderTrend } from "../../src/features/settings/usage-aggregate.ts";
import { CHART } from "../../src/features/settings/usage-chart-hover.ts";
import { UsageTrendChart } from "../../src/features/settings/usage-charts.tsx";
import { fire, mount, type Mounted } from "../helpers/mount.ts";

const NAMES: Record<string, string> = { relay: "Relay", fast: "蹬得飞快" };

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

const DAYS = 30;
const relay = trend("relay", Array.from({ length: DAYS }, (_, index) => (index === 15 ? 53.58 : index * 0.5)));
const fast = trend("fast", Array.from({ length: DAYS }, (_, index) => (index === 15 ? 0 : 0.01)));

/**
 * A laid-out chart.
 *
 * happy-dom performs no layout, so every rectangle is zero — and a zero-width chart correctly
 * reports that there is no day under the pointer. The size is stated here instead: the SVG drawn at
 * its own scale, at the window's origin, which keeps the expected coordinates readable.
 */
function laidOut(view: Mounted): void {
	const svg = view.find("svg");
	svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: CHART.width, bottom: CHART.height, width: CHART.width, height: CHART.height, x: 0, y: 0, toJSON: () => ({}) });
}

function point(view: Mounted, clientX: number, clientY = 100, type = "pointermove"): Promise<void> {
	return fire(view.find("[data-usage-chart]"), new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));
}

function tip(): HTMLElement | null {
	return document.body.querySelector<HTMLElement>("[data-chart-tip]");
}

async function chart(metric: "cost" | "tokens" = "cost", trends = [relay, fast]): Promise<Mounted> {
	const view = await mount(h(UsageTrendChart, { trends, metric, labelOf: (id: string) => NAMES[id] ?? id }));
	laidOut(view);
	return view;
}

test("pointing anywhere in the plot reads the nearest day for every provider at once", async () => {
	const view = await chart();
	try {
		assert.ok(!tip(), "nothing is shown before the pointer arrives");
		// Well above the lines, in empty space: still a day, because the whole plot is live.
		await point(view, CHART.left + (CHART.width - CHART.left - CHART.right) / 2, 20);

		const bubble = tip();
		assert.ok(bubble, "hovering the plot must show a reading");
		const text = (bubble.textContent ?? "").replace(/\s+/g, " ").trim();
		assert.match(text, /2026\/9\/16 周三/, "the full date, not the axis's abbreviation");
		assert.match(text, /Relay/);
		assert.match(text, /\$53\.58/);
		assert.match(text, /蹬得飞快/, "an idle provider keeps its row rather than vanishing");
		assert.match(text, /合计/);
		assert.ok(!view.host.querySelector("[data-chart-tip]"), "the bubble is portalled out of the overflow-hidden card");
		assert.ok(bubble.parentElement === document.body, "portalled to the body, where no ancestor can clip it");
	} finally {
		await view.unmount();
	}
});

test("the crosshair lands on the day being read and follows the pointer to the next one", async () => {
	const view = await chart();
	try {
		await point(view, CHART.left);
		const cursor = () => view.find("[data-chart-cursor] line");
		assert.equal(cursor().getAttribute("x1"), String(CHART.left), "the first day sits on the axis");
		assert.match((tip()?.textContent ?? "").replace(/\s+/g, " "), /2026\/9\/1/);

		await point(view, CHART.width - CHART.right);
		assert.equal(cursor().getAttribute("x1"), String(CHART.width - CHART.right), "the last day sits on the right edge");
		assert.match((tip()?.textContent ?? "").replace(/\s+/g, " "), /2026\/9\/30/);
		assert.equal(view.all("[data-chart-cursor]").length, 1, "one crosshair, not one per pointer move");
	} finally {
		await view.unmount();
	}
});

test("only the providers with a value that day get a dot on the crosshair", async () => {
	const view = await chart();
	try {
		await point(view, CHART.width - CHART.right);
		assert.equal(view.all("[data-chart-cursor] circle").length, 2, "both spent something on the last day");
		// Day 16 is the spike: relay only, fast at zero, which would otherwise stack a dot on the baseline.
		await point(view, CHART.left + ((CHART.width - CHART.left - CHART.right) / 29) * 15);
		assert.equal(view.all("[data-chart-cursor] circle").length, 1);
	} finally {
		await view.unmount();
	}
});

test("the reading leaves with the pointer", async () => {
	const view = await chart();
	try {
		await point(view, 300);
		assert.ok(tip());
		await point(view, 300, 100, "pointerout");
		assert.ok(!tip(), "a bubble left behind would describe a chart nobody is looking at");
		assert.ok(!view.host.querySelector("[data-chart-cursor]"));
	} finally {
		await view.unmount();
	}
});

test("a scroll drops the reading, which is fixed to the window and would otherwise drift", async () => {
	const view = await chart();
	try {
		await point(view, 300);
		assert.ok(tip());
		// A scroller's own event, which does not bubble — the chart listens for it on the way down.
		await fire(view.find("[data-usage-chart]"), new Event("scroll"));
		assert.ok(!tip(), "a fixed bubble would go on pointing at a day that scrolled away");
	} finally {
		await view.unmount();
	}
});

test("switching the metric restates the same day in tokens", async () => {
	const view = await chart();
	try {
		await point(view, CHART.width - CHART.right);
		assert.match((tip()?.textContent ?? "").replace(/\s+/g, " "), /\$14\.50/);
		await view.rerender(h(UsageTrendChart, { trends: [relay, fast], metric: "tokens", labelOf: (id: string) => NAMES[id] ?? id }));
		const text = (tip()?.textContent ?? "").replace(/\s+/g, " ");
		assert.match(text, /14,500/, "the same day, counted rather than priced");
		assert.doesNotMatch(text, /\$/);
	} finally {
		await view.unmount();
	}
});

test("shortening the range drops a reading of a day that no longer exists", async () => {
	const view = await chart();
	try {
		await point(view, CHART.width - CHART.right);
		assert.ok(tip(), "day 30 is being read");
		await view.rerender(h(UsageTrendChart, { trends: [trend("relay", [1, 2, 3])], metric: "cost", labelOf: (id: string) => NAMES[id] ?? id }));
		assert.ok(!tip(), "day 30 is gone; nothing must be drawn off the end of the new series");
		assert.ok(!view.host.querySelector("[data-chart-cursor]"));
	} finally {
		await view.unmount();
	}
});

test("an unlaid-out chart says nothing rather than guessing at day zero", async () => {
	const view = await mount(h(UsageTrendChart, { trends: [relay, fast], metric: "cost", labelOf: (id: string) => NAMES[id] ?? id }));
	try {
		await point(view, 300);
		assert.ok(!tip(), "a zero-width chart has no day under the pointer to report");
	} finally {
		await view.unmount();
	}
});
