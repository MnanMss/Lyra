/**
 * Three things that are only true on screen: the usage page's placeholder and empty states, the
 * model menu's folding and starring, and whether the heatmap is centred in its card.
 *
 * The placeholder is sampled per painted frame rather than looked for once. It exists for the
 * length of a scan and no longer, so a single check at an arbitrary moment answers a question
 * about timing rather than about the feature.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

function reply(seq: number, at: number, tokens: number, provider: string, model: string): string {
	const message = {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-responses",
		provider,
		model,
		usage: {
			input: tokens,
			output: Math.round(tokens / 8),
			cacheRead: 0,
			cacheWrite: 0,
			total: tokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
		},
		stopReason: "stop",
		timestamp: at,
	};
	return `${JSON.stringify({ seq, ts: at, type: "message", message })}\n`;
}

function models(providerId: string, count: number, prefix: string) {
	return Array.from({ length: count }, (_, i) => ({
		id: `${providerId}/${prefix}-${i}`,
		providerId,
		modelId: `${prefix}-${i}`,
		name: `${prefix}-${i}`,
		contextWindow: 200000,
		maxOutputTokens: 8192,
		supportsThinking: true,
		supportsImages: i % 2 === 0,
		supportsTools: true,
	}));
}

/**
 * Enough logs that the first scan is a wait.
 *
 * The placeholder is deliberately suppressed under ~220ms (`useSlowLoad`), so a fixture small
 * enough to scan instantly would prove the opposite of what it looks like it proves.
 */
async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(root, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));

	/*
	 * Every log sits between 40 and 60 days ago.
	 *
	 * That makes 「最近 7 天」 a genuinely empty range — which is the state the tiles have to report
	 * as zeroes rather than as dashes — while 「全部」 still has a year of shape to draw.
	 */
	const day = 24 * 60 * 60 * 1000;
	for (let s = 0; s < 45; s++) {
		const projectId = `proj${s}`.padEnd(16, "0");
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const lines: string[] = [];
		for (let d = 60; d >= 40; d--) {
			const at = Date.now() - d * day;
			const provider = d % 2 === 0 ? "relay" : "house";
			for (let n = 0; n < 150; n++) {
				lines.push(reply(lines.length + 1, at, 5000 + ((d * 7919 + s * 104729 + n * 31) % 50_000), provider, "grok-4.6"));
			}
		}
		await writeFile(join(home, "sessions", projectId, `sess-${s}.jsonl`), lines.join(""));
	}

	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{ id: "relay", name: "Relay", baseUrl: "http://127.0.0.1:1/v1", api: "openai-responses", apiKey: "x", enabled: true, models: models("relay", 12, "gemini-3") },
				{ id: "house", name: "deerGpt", baseUrl: "http://127.0.0.1:1/v1", api: "openai-responses", apiKey: "y", enabled: true, models: models("house", 6, "claude") },
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: root, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "relay/gemini-3-0",
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4517, token: null },
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9498, seed });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
});

after(async () => {
	await app?.stop();
});

const UI = `
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const label = (el) => el.innerText.replace(/\\s+/g, " ").trim();
	const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const menu = () => document.querySelector('[aria-label="选择模型"]');
	const openModelMenu = async () => {
		if (menu()) return menu();
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		if (!chip) throw new Error("no model chip");
		click(chip);
		await wait(500);
		if (!menu()) throw new Error("model menu did not open");
		return menu();
	};
	/** Model rows only — the switches in the footer are menu items too. */
	const rows = () => [...menu().querySelectorAll("[data-model]")].map((r) => label(r));
	const openUsage = async () => {
		const gear = document.querySelector(".ly-sidebar-foot button");
		click(gear);
		await wait(600);
		const nav = [...document.querySelectorAll("button")].find((b) => label(b) === "使用统计");
		if (!nav) throw new Error("no 使用统计 nav item");
		return nav;
	};
	const heatmap = () => {
		const scroller = [...document.querySelectorAll("div")].find((d) => d.className.includes("justify-content:safe_center"));
		if (!scroller) throw new Error("heatmap scroller not found");
		return scroller;
	};
	const heatmapBox = () => {
		const scroller = heatmap(), outer = scroller.getBoundingClientRect(), inner = scroller.firstElementChild.getBoundingClientRect();
		return { left: inner.left - outer.left, right: outer.right - inner.right, card: outer.width,
			grid: inner.width, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
			scrollLeft: scroller.scrollLeft, justify: getComputedStyle(scroller).justifyContent };
	};
	const tiles = () =>
		[...document.querySelectorAll("div")]
			.filter((d) => d.checkVisibility({ visibilityProperty: true }) && d.className.includes("rounded-[12px]") && d.className.includes("border-line"))
			.map((d) => label(d));
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

test("the usage page draws its own outline while the logs are being read", async () => {
	const seen = await ui<{ frames: number; sawSkeleton: boolean; sawDash: boolean; landed: boolean }>(`
		const nav = await openUsage();
		click(nav);

		/*
		 * Sampled per painted frame. A poll on a timer misses a placeholder that came and went
		 * between two ticks, and reports the feature as missing when what was missing was the tick.
		 */
		let frames = 0;
		let sawSkeleton = false;
		let sawDash = false;
		let landed = false;
		await new Promise((done) => {
			const step = () => {
				frames += 1;
				if (document.querySelector('[aria-busy="true"]')) sawSkeleton = true;
				// The old page put an em dash in every tile until the numbers arrived.
				if (tiles().some((t) => t.includes("—"))) sawDash = true;
				if (tiles().some((t) => t.startsWith("tokens 用量") && /\\d/.test(t))) landed = true;
				if (landed || frames > 400) done(undefined);
				else requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		});
		return { frames, sawSkeleton, sawDash, landed };
	`);

	assert.ok(seen.landed, "the page finished loading within the sampling window");
	assert.ok(seen.sawSkeleton, `a placeholder was drawn during the ${seen.frames}-frame wait`);
	assert.equal(seen.sawDash, false, "and never a tile reading 「—」");
});

test("an empty range reports zeroes and says there is no model, rather than dashes", async () => {
	const empty = await ui<{ tiles: string[]; charts: string[] }>(`
		// 「最近 7 天」 over logs that stop 40 days ago is a real empty range.
		const seven = [...document.querySelectorAll("button")].find((b) => label(b) === "最近 7 天");
		if (!seven) throw new Error("no range control");
		click(seven);
		await wait(600);
		return {
			tiles: tiles(),
			charts: [...document.querySelectorAll("p")].map(label).filter((t) => t.includes("没有") || t.includes("还没")),
		};
	`);

	const joined = empty.tiles.join(" | ");
	assert.match(joined, /tokens 用量 0/, `a measured nothing is a zero: ${joined}`);
	assert.match(joined, /活跃天数 0/);
	assert.match(joined, /最常用模型 暂无模型/, "the one tile whose value is a name says so in words");
	assert.doesNotMatch(joined, /—/, "no em dashes anywhere on the page");
	assert.ok(empty.charts.length >= 1, `the charts say why they are blank: ${empty.charts.join(" / ")}`);
});

interface HeatmapBox {
	left: number;
	right: number;
	card: number;
	grid: number;
	scrollWidth: number;
	clientWidth: number;
	scrollLeft: number;
	justify: string;
}

test("the heatmap centres when it fits and keeps both ends reachable when narrow", async (t) => {
	const viewport = await app.evaluate<{ width: number; height: number }>("({ width: innerWidth, height: innerHeight })");
	try {
		// A requested native window size can be clamped to the CI display; set the layout viewport.
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		const wide = await ui<HeatmapBox>(`
			const all = [...document.querySelectorAll("button")].find((b) => label(b) === "全部");
			click(all);
			await new Promise(requestAnimationFrame);
			heatmap().scrollIntoView({ block: "center" });
			return heatmapBox();
		`);
		assert.match(wide.justify, /safe center/);
		assert.ok(wide.card > wide.grid, `the wide card fits the grid: ${JSON.stringify(wide)}`);
		assert.ok(Math.abs(wide.left - wide.right) <= 2, `equal margins: ${JSON.stringify(wide)}`);
		assert.ok(wide.left > 0);
		await shot("heatmap-wide");

		await app.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: false });
		const recent = await ui<HeatmapBox>(`
			heatmap().scrollLeft = 0;
			heatmap().scrollIntoView({ block: "center" });
			await new Promise(requestAnimationFrame);
			return heatmapBox();
		`);
		assert.ok(recent.scrollWidth > recent.clientWidth, `the narrow card scrolls: ${JSON.stringify(recent)}`);
		assert.ok(Math.abs(recent.right) <= 1 && recent.left < 0, `the recent end starts visible: ${JSON.stringify(recent)}`);
		await shot("heatmap-narrow-recent");

		const oldest = await ui<HeatmapBox>(`
			heatmap().scrollLeft = -heatmap().scrollWidth;
			await new Promise(requestAnimationFrame);
			return heatmapBox();
		`);
		assert.ok(oldest.scrollLeft < 0 && Math.abs(oldest.left) <= 1, `the oldest end remains reachable: ${JSON.stringify(oldest)}`);
		await shot("heatmap-narrow-oldest");
		t.diagnostic(JSON.stringify({ wide, recent, oldest }));
	} finally {
		await app.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
	}
});

async function shot(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(image.data, "base64"));
}

test("the model menu folds a provider away and remembers it", async () => {
	const folded = await ui<{ before: number; after: number; count: string; reopened: number }>(`
		await openModelMenu();
		const before = rows().length;

		const head = [...menu().querySelectorAll("button[aria-expanded]")].find((b) => label(b).startsWith("Relay"));
		if (!head) throw new Error("no foldable Relay heading");
		click(head);
		await wait(300);
		const after = rows().length;
		const count = label(head);

		// Close and reopen: the fold is a preference, not a mode.
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await wait(300);
		await openModelMenu();
		return { before, after, count, reopened: rows().length };
	`);

	assert.equal(folded.before, 18, "twelve models under Relay and six under deerGpt");
	assert.equal(folded.after, 6, "folding Relay leaves only the other provider's rows");
	assert.match(folded.count, /Relay 12/, "a folded group still says how many it holds");
	assert.equal(folded.reopened, 6, "and it is still folded the next time the menu is opened");
});

test("starring a model pins it to the top, and the star survives a reopen", async () => {
	const starred = await ui<{ first: string; stored: string[]; afterUnstar: string[] }>(`
		await openModelMenu();
		// Unfold Relay again, so this test is about stars rather than about the previous one.
		const head = [...menu().querySelectorAll("button[aria-expanded]")].find((b) => label(b).startsWith("Relay"));
		if (head && head.getAttribute("aria-expanded") === "false") { click(head); await wait(300); }

		const star = [...menu().querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "") === "收藏 claude-3");
		if (!star) throw new Error("no star button for claude-3");
		click(star);
		await wait(500);

		const settings = await window.lyra.settings.get();
		const first = rows()[0] || "";

		// Unstarring puts it back where it came from.
		const lit = [...menu().querySelectorAll('button[aria-pressed="true"]')][0];
		click(lit);
		await wait(500);
		const after = await window.lyra.settings.get();
		return { first, stored: settings.favoriteModelIds || [], afterUnstar: after.favoriteModelIds || [] };
	`);

	assert.deepEqual(starred.stored, ["house/claude-3"], "the star is written to settings, so it travels");
	assert.match(starred.first, /claude-3/, "and the shortlist is drawn first");
	assert.deepEqual(starred.afterUnstar, [], "unstarring removes it again");
});

test("the menu has a ceiling and scrolls inside it", async () => {
	const box = await ui<{ height: number; scrollable: boolean; searchVisible: boolean; footerVisible: boolean }>(`
		await openModelMenu();
		const surface = menu();
		const rect = surface.getBoundingClientRect();
		const scroller = [...surface.querySelectorAll("*")].find((el) => el.scrollHeight > el.clientHeight + 4);
		const search = surface.querySelector("input");
		const footerRow = [...surface.querySelectorAll('[role=menuitem]')].find((r) => label(r).startsWith("管理供应商与模型"));
		return {
			height: Math.round(rect.height),
			scrollable: Boolean(scroller),
			// Both stay on screen while the list scrolls: they are in the header and footer slots.
			searchVisible: Boolean(search) && search.getBoundingClientRect().height > 0,
			footerVisible: Boolean(footerRow) && footerRow.getBoundingClientRect().height > 0,
		};
	`);

	assert.ok(box.height <= 420, `the menu is bounded, not window-tall: ${box.height}px`);
	assert.ok(box.scrollable, "and the list inside it scrolls");
	assert.ok(box.searchVisible, "the search field stays put");
	assert.ok(box.footerVisible, "so do the switches under the list");
});
