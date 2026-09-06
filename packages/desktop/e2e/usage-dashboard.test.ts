/** Real Electron verification for the usage dashboard and offline model catalogue controls. */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { catalogModelFor } from "@lyra/core/model-catalog";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

interface ReplyFixture {
	provider: string;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total: number; source?: "provider" };
}

function reply(seq: number, at: number, fixture: ReplyFixture): string {
	const usage = {
		input: fixture.input,
		output: fixture.output,
		cacheRead: fixture.cacheRead,
		cacheWrite: fixture.cacheWrite,
		reasoning: fixture.reasoning,
		total: fixture.input + fixture.output + fixture.cacheRead + fixture.cacheWrite,
		cost: fixture.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const message = {
		role: "assistant",
		content: [{ type: "text", text: "usage fixture" }],
		api: "openai-responses",
		provider: fixture.provider,
		model: fixture.model,
		usage,
		stopReason: "stop",
		timestamp: at,
	};
	return `${JSON.stringify({ seq, ts: at, type: "message", message })}\n`;
}

function configuredModel(providerId: string, modelId: string, name: string) {
	return {
		id: `${providerId}/${modelId}`,
		providerId,
		modelId,
		name,
		contextWindow: 200_000,
		maxOutputTokens: 16_384,
		supportsThinking: true,
		supportsImages: true,
		supportsTools: true,
		pricing: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375, source: "manual" },
	};
}

function fixtureFor(index: number, tokens: number): ReplyFixture {
	const output = Math.round(tokens * 0.08);
	const cacheRead = Math.round(tokens * 0.68);
	const cacheWrite = Math.round(tokens * 0.06);
	const input = tokens - output - cacheRead - cacheWrite;
	switch (index % 5) {
		case 0:
			return { provider: "relay", model: "gemini-3-0", input, output, cacheRead, cacheWrite, reasoning: Math.round(output / 3) };
		case 1:
			return {
				provider: "house",
				model: "claude-0",
				input,
				output,
				cacheRead,
				cacheWrite,
				reasoning: Math.round(output / 4),
				cost: { input: 0.003, output: 0.004, cacheRead: 0.001, cacheWrite: 0.002, total: 0.01, source: "provider" },
			};
		case 2:
			return { provider: "openai", model: "gpt-5.2", input, output, cacheRead, cacheWrite, reasoning: Math.round(output / 2) };
		case 3:
			return { provider: "legacy", model: "retired-model", input, output, cacheRead, cacheWrite, reasoning: 0, cost: { total: 0.006 } };
		default:
			return { provider: "unknown", model: "unpriced-model", input, output, cacheRead, cacheWrite, reasoning: 0 };
	}
}

async function seed(home: string): Promise<void> {
	const root = join(home, "project");
	await mkdir(root, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
	const day = 24 * 60 * 60 * 1000;
	for (let session = 0; session < 40; session++) {
		const projectId = `usage${session}`.padEnd(16, "0");
		await mkdir(join(home, "sessions", projectId), { recursive: true });
		const lines: string[] = [];
		for (let daysAgo = 29; daysAgo >= 10; daysAgo--) {
			const at = Date.now() - daysAgo * day;
			for (let turn = 0; turn < 90; turn++) {
				const tokens = 4_000 + ((daysAgo * 7_919 + session * 104_729 + turn * 31) % 46_000);
				lines.push(reply(lines.length + 1, at, fixtureFor(daysAgo + session + turn, tokens)));
			}
		}
		await writeFile(join(home, "sessions", projectId, `session-${session}.jsonl`), lines.join(""));
	}
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		providers: [
			{ id: "relay", name: "Relay", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "x", enabled: true, models: [configuredModel("relay", "gemini-3-0", "Gemini 3")] },
			{ id: "house", name: "Claude Team", baseUrl: "https://relay.example/v1", api: "anthropic-messages", apiKey: "y", enabled: true, models: [configuredModel("house", "claude-0", "Claude") ] },
			{ id: "openai", name: "OpenAI 官方", baseUrl: "https://api.openai.com/v1", api: "openai-responses", apiKey: "z", enabled: true, models: [] },
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
	}));
}

before(async () => {
	app = await startApp({ port: 9502, seed });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
});

after(async () => {
	await app?.stop();
});

afterEach(async (context) => {
	if (context.passed) return;
	await shot("usage-dashboard-failure");
	context.diagnostic(await app.evaluate<string>("document.body.innerText.slice(-5000)"));
});

async function shot(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
}

const UI = `
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const label = (element) => element.innerText.replace(/\\s+/g, " ").trim();
	const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const byText = (selector, text) => [...document.querySelectorAll(selector)].find((element) => element.checkVisibility({ visibilityProperty: true }) && label(element) === text);
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
	const typeValue = (input, value) => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
		setter.call(input, value);
		input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
	};
	const openUsage = async () => {
		click(document.querySelector(".ly-sidebar-foot button"));
		await wait(500);
		const nav = byText("nav button", "使用统计");
		if (!nav) throw new Error("no 使用统计 nav item");
		return nav;
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

test("the dashboard paints a skeleton, then shows priced, cached and unpriced usage", async () => {
	const seen = await ui<{ frames: number; sawSkeleton: boolean; landed: boolean; text: string; paths: number; overflow: number; chartHeight: number; metricColumns: number }>(`
		click(await openUsage());
		let frames = 0;
		let sawSkeleton = false;
		let landed = false;
		await new Promise((resolve) => {
			const step = () => {
				frames += 1;
				if (document.querySelector('[aria-busy="true"]')) sawSkeleton = true;
				landed = Boolean(document.querySelector('[data-usage-dashboard="true"]'));
				if (landed || frames > 500) resolve(); else requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		});
		const chart = document.querySelector('[data-usage-chart="cost"]');
		const metrics = document.querySelector('[aria-label="用量指标"]');
		const metricRows = new Set([...metrics.children].map((element) => Math.round(element.getBoundingClientRect().top)));
		return {
			frames,
			sawSkeleton,
			landed,
			text: document.querySelector('[data-usage-dashboard="true"]')?.innerText || "",
			paths: chart?.querySelectorAll("polyline").length || 0,
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			chartHeight: Math.round(chart?.getBoundingClientRect().height || 0),
			metricColumns: Math.max(1, Math.ceil(metrics.children.length / metricRows.size)),
		};
	`);

	assert.ok(seen.landed, JSON.stringify(seen));
	assert.ok(seen.sawSkeleton, `no skeleton across ${seen.frames} painted frames`);
	assert.match(seen.text, /估算费用/);
	assert.match(seen.text, /缓存写入/);
	assert.match(seen.text, /推理/);
	assert.match(seen.text, /离线目录/);
	assert.match(seen.text, /未计价/);
	assert.ok(seen.paths >= 4, JSON.stringify(seen));
	assert.ok(seen.chartHeight >= 150, JSON.stringify(seen));
	assert.equal(seen.metricColumns, 5, JSON.stringify(seen));
	assert.ok(seen.overflow <= 0, JSON.stringify(seen));
	await shot("usage-dashboard-1440x900");
});

test("range, metric, breakdown and refresh controls update without blanking the page", async () => {
	const result = await ui<{ emptyText: string; tokenChart: boolean; dayRows: boolean; refreshed: boolean; remained: boolean }>(`
		const seven = byText("button", "7 天");
		click(seven);
		await wait(300);
		const emptyText = document.querySelector('[data-usage-dashboard="true"]')?.innerText || "";
		click(byText("button", "30 天"));
		await wait(300);
		click(byText("button", "Token"));
		await wait(100);
		const tokenChart = Boolean(document.querySelector('[data-usage-chart="tokens"]'));
		click(byText("button", "日期"));
		await wait(100);
		const dayRows = /2026\\/\\d+\\/\\d+/.test(document.querySelector('[data-usage-dashboard="true"]')?.innerText || "");
		const refresh = document.querySelector('button[aria-label="刷新用量统计"]');
		click(refresh);
		for (let index = 0; index < 100 && refresh.disabled; index++) await wait(20);
		return {
			emptyText,
			tokenChart,
			dayRows,
			refreshed: !refresh.disabled,
			remained: Boolean(document.querySelector('[data-usage-dashboard="true"]')),
		};
	`);

	assert.match(result.emptyText, /暂无价格/);
	assert.match(result.emptyText, /已处理 Token\s*0/);
	assert.match(result.emptyText, /这个区间没有趋势数据/);
	assert.doesNotMatch(result.emptyText, /—/);
	assert.ok(result.tokenChart, JSON.stringify(result));
	assert.ok(result.dayRows, JSON.stringify(result));
	assert.ok(result.refreshed, JSON.stringify(result));
	assert.ok(result.remained, JSON.stringify(result));
});

test("the dashboard reflows in a narrow desktop window without horizontal overflow", async () => {
	await app.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const geometry = await app.evaluate<{ overflow: number; dashboard: number; chart: number; metricColumns: number }>(`(() => {
		const dashboard = document.querySelector('[data-usage-dashboard="true"]');
		const chart = document.querySelector('[data-usage-chart="tokens"]');
		const metrics = document.querySelector('[aria-label="用量指标"]');
		const children = [...metrics.children];
		const tops = new Set(children.map((element) => Math.round(element.getBoundingClientRect().top)));
		return {
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			dashboard: Math.round(dashboard.getBoundingClientRect().width),
			chart: Math.round(chart.getBoundingClientRect().width),
			metricColumns: Math.max(1, Math.ceil(children.length / tops.size)),
		};
	})()`);
	assert.ok(geometry.overflow <= 0, JSON.stringify(geometry));
	assert.ok(geometry.dashboard > 300 && geometry.dashboard <= 760, JSON.stringify(geometry));
	assert.ok(geometry.chart > 280 && geometry.chart <= geometry.dashboard, JSON.stringify(geometry));
	assert.equal(geometry.metricColumns, 2, JSON.stringify(geometry));
	await shot("usage-dashboard-760x900");
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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


test("the model editor synchronises offline catalogue values and offers upstream references for relays", async () => {
	const expected = catalogModelFor({ id: "openai", baseUrl: "https://api.openai.com/v1" }, "gpt-5.2");
	assert.ok(expected);
	const values = await ui<{ context: string; output: string; input: string; outputPrice: string; cacheRead: string; cacheWrite: string; source: string; manualSource: string; relayMatched: boolean }>(`
		click(byText("nav button", "模型设置"));
		await wait(300);
		click(byText("button", "OpenAI 官方"));
		await wait(200);
		click(byText("button", "添加模型"));
		await wait(200);
		const field = (text) => [...document.querySelectorAll("label")].find((element) => label(element).startsWith(text));
		const modelInput = field("模型 ID").querySelector("input");
		typeValue(modelInput, "gpt-5.2");
		await wait(150);
		const matched = [...document.querySelectorAll("div")].some((element) => label(element).startsWith("离线模型目录已匹配"));
		if (!matched) throw new Error("catalogue did not match gpt-5.2");
		click(byText("button", "同步目录信息"));
		await wait(100);
		const read = (text) => field(text).querySelector("input").value;
		const result = {
			context: read("上下文窗口"),
			output: read("最大输出"),
			input: read("输入价格"),
			outputPrice: read("输出价格"),
			cacheRead: read("缓存命中价格"),
			cacheWrite: read("缓存写入价格"),
			source: [...document.querySelectorAll("p")].find((element) => label(element).includes("价格来自 models.dev"))?.innerText || "",
		};
		typeValue(field("输入价格").querySelector("input"), "9.9");
		await wait(100);
		const manualSource = [...document.querySelectorAll("p")].find((element) => label(element).includes("当前使用手动价格"))?.innerText || "";
		click(byText("button", "取消"));
		await wait(150);
		click(byText("button", "Relay"));
		await wait(150);
		click(byText("button", "添加模型"));
		await wait(150);
		const relayInput = field("模型 ID").querySelector("input");
		typeValue(relayInput, "gpt-5.2");
		await wait(100);
		return { ...result, manualSource, relayMatched: [...document.querySelectorAll("div")].some((element) => label(element).startsWith("离线模型目录已匹配")) };
	`);

	assert.equal(values.context, String(expected.model.contextWindow));
	assert.equal(values.output, String(expected.model.maxOutputTokens));
	assert.equal(values.input, String(expected.model.inputPrice));
	assert.equal(values.outputPrice, String(expected.model.outputPrice));
	assert.equal(values.cacheRead, expected.model.cacheReadPrice === undefined ? "" : String(expected.model.cacheReadPrice));
	assert.equal(values.cacheWrite, expected.model.cacheWritePrice === undefined ? "" : String(expected.model.cacheWritePrice));
	assert.match(values.source, /models\.dev/);
	assert.match(values.manualSource, /手动价格/);
	assert.equal(values.relayMatched, true);
});
