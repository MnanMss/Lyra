import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, createElement as h, useState, type ComponentProps } from "react";
import { entryKey, type Entry } from "@lyra/core/trajectory-view";
import { TraceTimeline } from "../../src/features/conversation/trajectory/TraceTimeline.tsx";
import { click, fire, mount, press } from "../helpers/mount.ts";

const entry: Entry = { id: "request", seq: 1, ts: 0, source: "request", summary: "模型请求", detail: "", startedAt: 0, finishedAt: 1000 };
const second: Entry = { ...entry, id: "tool", seq: 2, source: "tool-call", startedAt: 500 };
const third: Entry = { ...entry, id: "compact", seq: 3, source: "compaction", startedAt: 800 };

function replace(t: TestContext, target: object, key: PropertyKey, value: unknown) {
	const descriptor = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, { configurable: true, value });
	t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
}

async function timeline(t: TestContext, props: Partial<ComponentProps<typeof TraceTimeline>> = {}, paint: { dpr?: number; context?: object } = {}) {
	replace(t, globalThis, "devicePixelRatio", paint.dpr ?? 1);
	replace(t, window.HTMLCanvasElement.prototype, "clientWidth", 100);
	replace(t, window.HTMLCanvasElement.prototype, "getBoundingClientRect", () => new window.DOMRect(0, 0, 100, 48));
	replace(t, window.HTMLCanvasElement.prototype, "getContext", () => paint.context ?? null);
	replace(t, window.HTMLCanvasElement.prototype, "setPointerCapture", () => {});
	const ranges: unknown[] = [], selected: Entry[] = [];
	const view = await mount(h(TraceTimeline, { entries: [entry], range: null, selected: null, onRange: value => { ranges.push(value); }, onSelect: value => { selected.push(value); }, ...props }));
	t.after(() => view.unmount());
	const toggle = () => click(view.find('button[aria-label="时间概览"]'));
	return { view, toggle, ranges, selected };
}

function canvas() {
	const element = document.querySelector<HTMLCanvasElement>("[data-trace-timeline] canvas");
	assert.ok(element); return element;
}

const pointer = (type: string, x: number) => fire(canvas(), new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 8 }));

async function closed() {
	const deadline = Date.now() + 1000;
	while (document.querySelector("[data-trace-timeline]")) {
		assert.ok(Date.now() < deadline, "the popover must finish dismissal");
		await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
	}
}

test("tiny movement selects once, and reopening exposes a fresh canvas for committed and cancelled brushes", async t => {
	const { toggle, ranges, selected } = await timeline(t);
	await toggle(); const original = canvas();
	await pointer("pointerdown", 50); await pointer("pointermove", 51);
	assert.deepEqual(ranges, [], "a click must not install a near-zero range");
	await pointer("pointerup", 51);
	assert.deepEqual(ranges, []); assert.deepEqual(selected, [entry]);
	assert.equal(document.querySelector("[data-trace-timeline]"), null);
	await toggle(); assert.notEqual(canvas(), original);
	await pointer("pointerdown", 25); await pointer("pointermove", 50);
	assert.deepEqual(ranges, [], "drag feedback must stay local until release");
	await pointer("pointerup", 75);
	assert.deepEqual(ranges, [{ start: 250, end: 750 }]);
	await pointer("pointerdown", 20); await pointer("pointermove", 60);
	await pointer("pointercancel", 60); await pointer("pointerup", 60);
	assert.equal(ranges.length, 1, "cancelled touch gestures must not change the range");
});

test("Escape closes an in-progress brush without carrying pointer state into the next popup", async t => {
	const { toggle, ranges, selected } = await timeline(t);
	await toggle(); await pointer("pointerdown", 20); await pointer("pointermove", 60);
	await press(canvas(), "Escape"); await closed();
	assert.deepEqual(ranges, []);
	await toggle(); await pointer("pointermove", 80); await pointer("pointerup", 90);
	assert.deepEqual(ranges, [], "a released pointer from the closed popup is no longer a brush");
	assert.deepEqual(selected, []);
	assert.equal(document.querySelector("[data-trace-timeline] span")?.textContent, "拖选时间范围");
});

test("keyboard previews stay local through pointer hover; Enter commits once and reset remains explicit", async t => {
	const selected: Entry[] = [], ranges: unknown[] = [];
	function Controlled() {
		const [range, setRange] = useState<{ start: number; end: number } | null>({ start: 250, end: 750 });
		const [key, setKey] = useState(entryKey(entry));
		return h(TraceTimeline, { entries: [entry, second, third], range, selected: key,
			onRange: next => { ranges.push(next); setRange(next); },
			onSelect: next => { selected.push(next); setKey(entryKey(next)); setRange(null); },
		});
	}
	const { view } = await timeline(t); await view.rerender(h(Controlled));
	await click(view.find('button[aria-label="时间概览"]'));
	assert.ok(document.activeElement === canvas(), "opening makes the documented arrow keys available immediately");
	const zoom = document.querySelector('button[aria-label="放大时间范围"]'); assert.ok(zoom); await click(zoom);
	await press(canvas(), "ArrowRight");
	assert.equal(canvas().getAttribute("aria-valuenow"), "1");
	const described = canvas().getAttribute("aria-valuetext");
	await pointer("pointermove", 20);
	assert.equal(canvas().getAttribute("aria-valuenow"), "1");
	assert.equal(canvas().getAttribute("aria-valuetext"), described, "hovering another lane must not replace the keyboard preview");
	await press(canvas(), "ArrowLeft"); assert.equal(canvas().getAttribute("aria-valuenow"), "0");
	await press(canvas(), "End"); assert.equal(canvas().getAttribute("aria-valuenow"), "2");
	await press(canvas(), "Home"); assert.equal(canvas().getAttribute("aria-valuenow"), "0");
	await press(canvas(), "End"); assert.equal(canvas().getAttribute("aria-valuenow"), "2");
	assert.deepEqual(selected, []); assert.deepEqual(ranges, []);
	assert.deepEqual([...document.querySelectorAll("[data-trace-timeline] > div:last-child span")].map(element => element.textContent), ["500ms", "1.0s"], "keyboard preview pans an offscreen point into view without changing the zoom span");
	await press(canvas(), "Enter", { repeat: true }); assert.deepEqual(selected, []);
	const beforeCommit = canvas(); await press(beforeCommit, "Enter"); await press(beforeCommit, "Enter");
	assert.deepEqual(selected, [third]); assert.deepEqual(ranges, []);
	assert.equal(document.querySelector("[data-trace-timeline]"), null);
	assert.ok(document.activeElement === view.find('button[aria-label="时间概览"]'));
	await click(view.find('button[aria-label="时间概览"]'));
	assert.equal(document.querySelector("[data-trace-timeline] span")?.textContent, "拖选时间范围", "committing a record clears the parent filter");
	assert.deepEqual([...document.querySelectorAll("[data-trace-timeline] > div:last-child span")].map(element => element.textContent), ["500ms", "1.0s"]);
	await press(canvas(), "ArrowLeft"); await press(canvas(), "Escape"); await closed();
	assert.deepEqual(selected, [third]); assert.deepEqual(ranges, []);
	await click(view.find('button[aria-label="时间概览"]'));
	assert.equal(canvas().getAttribute("aria-valuenow"), "2", "reopening discards an uncommitted keyboard preview");
	const reset = document.querySelector('button[aria-label="重置时间范围"]'); assert.ok(reset); await click(reset);
	assert.deepEqual(ranges, [null]);
	assert.deepEqual([...document.querySelectorAll("[data-trace-timeline] > div:last-child span")].map(element => element.textContent), ["0ms", "1.0s"]);
});

test("opening and reopening paint the current theme at device resolution and detach the old painter", async t => {
	const paints: string[] = [], scales: number[] = [];
	const context = { fillStyle: "", globalAlpha: 1,
		scale: (x: number) => { scales.push(x); },
		fillRect: () => { paints.push(context.fillStyle); }, strokeRect: () => {},
	};
	const observers = new Set<() => void>();
	const computed = getComputedStyle;
	// Custom-property inheritance also belongs to the browser, not this DOM shim.
	replace(t, globalThis, "getComputedStyle", (element: Element) => {
		const style = computed(element);
		if (element.tagName === "CANVAS") {
			const read = style.getPropertyValue.bind(style);
			Object.defineProperty(style, "getPropertyValue", { configurable: true, value: (property: string) => property.startsWith("--color-") ? document.documentElement.style.getPropertyValue(property) : read(property) });
		}
		return style;
	});
	// Happy DOM has no compositor; invoke the registered root theme observer explicitly.
	replace(t, globalThis, "MutationObserver", class {
		callback: () => void;
		constructor(callback: () => void) { this.callback = callback; }
		observe(target: Node) { if (target === document.documentElement) observers.add(this.callback); }
		disconnect() { observers.delete(this.callback); }
		takeRecords() { return []; }
	});
	const previous = document.documentElement.style.getPropertyValue("--color-info");
	t.after(() => { if (previous) document.documentElement.style.setProperty("--color-info", previous); else document.documentElement.style.removeProperty("--color-info"); });
	document.documentElement.style.setProperty("--color-info", "rgb(10, 20, 30)");
	const { toggle } = await timeline(t, {}, { dpr: 2, context });
	assert.equal(paints.length, 0);
	await toggle(); assert.equal(canvas().width, 200); assert.equal(canvas().height, 96);
	assert.equal(paints.at(-1), "rgb(10, 20, 30)"); assert.ok(scales.every(value => value === 2));
	document.documentElement.style.setProperty("--color-info", "rgb(40, 50, 60)");
	for (const paint of observers) paint();
	assert.equal(paints.at(-1), "rgb(40, 50, 60)");
	await toggle(); assert.equal(observers.size, 0, "closing detaches the old canvas theme observer");
	const closedCount = paints.length;
	document.documentElement.style.setProperty("--color-info", "rgb(70, 80, 90)");
	for (const paint of observers) paint();
	assert.equal(paints.length, closedCount);
	await toggle(); assert.equal(paints.at(-1), "rgb(70, 80, 90)"); assert.equal(observers.size, 1);
});
