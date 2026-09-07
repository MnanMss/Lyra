import { spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, closeListeningServer, stopProcessGroup, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { startMobile } from "./mobile-app.ts";

const PORT = 4598;
const RELAY_PORT = 4599;
let relay: ChildProcess;
const TOKEN = "mobile-sync-isolated-test-token";
let desktop: RunningApp;
let phone: Awaited<ReturnType<typeof startMobile>>;
let reply: ServerResponse | undefined;
let turn = 0;
const model = createServer((request, response) => {
	request.resume();
	request.on("end", () => {
		reply = response;
		response.writeHead(200, { "content-type": "text/event-stream" });
		sse({ type: "message_start", message: { id: `mock-${++turn}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
		sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
		sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `同步回复第${turn}轮，正在生成` } });
	});
});
function sse(event: { type: string; [key: string]: unknown }) { reply?.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }
function finish() {
	sse({ type: "content_block_stop", index: 0 });
	sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } });
	sse({ type: "message_stop" }); reply?.end(); reply = undefined;
}

type Page = Pick<RunningApp, "evaluate" | "send">;
async function until(page: Page, expression: string, label = expression) {
	const started = performance.now();
	while (performance.now() - started < 12_000) {
		if (await page.evaluate<boolean>(expression)) return performance.now() - started;
		await new Promise((resolve) => setTimeout(resolve, 80));
	}
	throw new Error(`${label}: ${await page.evaluate("document.body.innerText.slice(-2000)")}`);
}
async function click(page: Page, selector: string, last = false) {
	const point = await page.evaluate<{ x: number; y: number }>(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.checkVisibility({visibilityProperty:true})).at(${last ? -1 : 0});if(!el)throw new Error(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
	await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

async function shot(page: Page, name: string) {
	const { data } = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await mkdir("output/mobile-sync", { recursive: true });
	await writeFile(`output/mobile-sync/${name}.png`, Buffer.from(data, "base64"));
}
async function size(width: number, height: number) {
	await phone.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
	await phone.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	await phone.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
}

before(async () => {
	relay = spawn(process.execPath, [join(import.meta.dirname, "../../relay/server.mjs")], { env: { ...process.env, PORT: String(RELAY_PORT) }, detached: true, stdio: "ignore" });
	for (let i = 0; i < 100; i++) {
		if (await fetch(`http://127.0.0.1:${RELAY_PORT}/health`).then(r => r.ok).catch(() => false)) break;
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address(); assert.ok(address && typeof address !== "string");
	desktop = await startApp({ port: 9704, seed: async (home) => {
		await seedInteractions(home, address.port);
		const file = join(home, "settings.json");
		const settings = JSON.parse(await readFile(file, "utf8"));
		settings.sync = { enabled: true, port: PORT, token: TOKEN, relayUrl: `ws://127.0.0.1:${RELAY_PORT}` };
		settings.providers[0].models.push({ ...settings.providers[0].models[0], id: "qa/other", modelId: "other", name: "QA Other" });
		settings.uiLocale = "zh-CN";
		settings.appearance = { theme: "dark" };
		await writeFile(file, JSON.stringify(settings));
	} });
	phone = await startMobile(desktop.home, { host: "127.0.0.1", port: PORT, token: TOKEN, platform: "darwin" }, 9705);
	await until(phone, "!!document.querySelector('.ly-shell')", "mobile shell");
});
after(async () => {
	await cleanupFixture(
		() => finish(),
		() => phone?.stop(),
		() => desktop?.stop(),
		() => closeListeningServer(model),
		() => stopProcessGroup(relay),
	);
});

test("mobile renderer preserves desktop tokens and fits phone, landscape and tablet viewports", async (t) => {
	for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [844, 390], [768, 1024], [1024, 768]]) {
		await size(width, height);
		const geometry = await phone.evaluate<{ width: number; overflow: number; controls: { label: string; w: number; h: number; right: number; bottom: number }[] }>(`({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,controls:[...document.querySelectorAll('[data-ly-toolbar-button],.ly-composer-control')].filter(e=>e.checkVisibility({visibilityProperty:true})).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),w:r.width,h:r.height,right:r.right,bottom:r.bottom}})})`);
		t.diagnostic(`${width}x${height}: ${JSON.stringify(geometry)}`);
		assert.equal(geometry.width, width); assert.equal(geometry.overflow, 0);
		assert.ok(geometry.controls.length > 0);
		for (const control of geometry.controls) { assert.ok(control.w >= 44 && control.h >= 44, JSON.stringify(control)); assert.ok(control.right <= width + 1 && control.bottom <= height + 1, JSON.stringify(control)); }
		await shot(phone, `mobile-${width}x${height}`);
	}
	await size(390, 844);
	const tokens = "['--color-shell','--color-ink','--color-accent'].map(t=>getComputedStyle(document.documentElement).getPropertyValue(t).trim())";
	assert.deepEqual(await phone.evaluate(tokens), await desktop.evaluate(tokens));
	assert.equal(await phone.evaluate("[...document.querySelectorAll('button')].some(e=>e.checkVisibility({visibilityProperty:true})&&/截图/.test(e.getAttribute('aria-label')||''))"), false);
});

test("cold-session rename, model, archive, restore and deletion reach the other screen", async (t) => {
	await size(1024, 768);
	const source = await desktop.evaluate<{ projectId: string; id: string }>("window.lyra.sessions.list().then(s=>s.find(s=>s.id==='qa-short'))");
	const args = `${JSON.stringify(source.projectId)},'qa-short'`;
	await phone.evaluate(`window.lyra.sessions.rename(${args},'手机改名同步')`);
	t.diagnostic(`phone → desktop rename ${await until(desktop, "document.body.innerText.includes('手机改名同步')")}ms`);
	await desktop.evaluate(`window.lyra.sessions.rename(${args},'电脑改名同步')`);
	await until(phone, "document.body.innerText.includes('电脑改名同步')");
	await click(phone, '[data-ly-row="qa-short"] > button');
	await until(phone, "!!document.querySelector('main textarea')");
	await desktop.evaluate("window.lyra.agent.setModel('qa-short','qa/other')");
	await until(phone, "[...document.querySelectorAll('.ly-composer-control')].some(e=>e.textContent.includes('QA Other'))");
	await desktop.evaluate("window.lyra.agent.setThinking('qa-short','high')");
	await phone.evaluate(`window.lyra.sessions.setArchived(${args},true)`);
	await until(desktop, "!document.querySelector('[data-ly-row=\"qa-short\"]')");
	await desktop.evaluate(`window.lyra.sessions.setArchived(${args},false)`);
	await until(phone, "!!document.querySelector('[data-ly-row=\"qa-short\"]')");
	await click(phone, '[data-ly-row="qa-short"] > button');
	await desktop.evaluate(`window.lyra.sessions.remove(${args})`);
	await until(phone, "!document.querySelector('[data-ly-row=\"qa-short\"]') && !document.querySelector('main')?.innerText.includes('qa-short 第')");
});

test("two real screens stream both ways and recover missed content without dropping a draft", async (t) => {
	await size(1024, 768);
	await click(desktop, '[data-ly-row="qa-long"] > button');
	await click(phone, '[data-ly-row="qa-long"] > button');
	await until(phone, "document.querySelector('main')?.innerText.includes('第 120 个问题')");
	const send = async (page: Page, text: string) => {
		await click(page, "main textarea");
		await page.send("Input.insertText", { text });
		await click(page, 'button[aria-label="发送"]');
	};
	await send(phone, "来自手机的实时消息");
	t.diagnostic(`phone → desktop prompt ${await until(desktop, "document.querySelector('main')?.innerText.includes('来自手机的实时消息')")}ms`);
	await until(phone, "document.querySelector('main')?.innerText.includes('同步回复第1轮')");
	await until(desktop, "document.querySelector('main')?.innerText.includes('同步回复第1轮')");
	finish();
	await until(phone, "!document.querySelector('button[aria-label=\"停止\"]')");
	await send(desktop, "来自电脑的实时消息");
	await until(phone, "document.querySelector('main')?.innerText.includes('同步回复第2轮')");
	await click(phone, "main textarea"); await phone.send("Input.insertText", { text: "断线也要保留的草稿" });
	await desktop.evaluate("window.lyra.sync.stop()");
	await until(phone, "window.lyra.sync.connectionStatus()==='reconnecting'", "socket actually disconnected");
	await click(phone, 'button[aria-label="发送"]');
	await until(phone, "document.body.innerText.includes('发送失败')");
	assert.equal(await phone.evaluate("document.querySelector('main textarea').value"), "断线也要保留的草稿");
	sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，断线期间桌面继续完成" } }); finish();
	await until(desktop, "document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')");
	assert.equal(await phone.evaluate("document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')"), false);
	await desktop.evaluate("window.lyra.sync.start()");
	await phone.evaluate("window.__lyraProbe()");
	t.diagnostic(`recovery ${await until(phone, "document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')")}ms`);
	assert.equal(await phone.evaluate("document.querySelector('main textarea').value"), "断线也要保留的草稿");
	await shot(phone, "reconnected-transcript");
	await until(phone, "!document.querySelector('button[aria-label=\"停止\"]')");
	await desktop.evaluate("window.lyra.sync.stop()");
	await until(phone, "window.lyra.sync.connectionStatus()==='reconnecting'");
	await click(phone, 'main button[aria-label="编辑并重新发送"]', true);
	await until(phone, "document.querySelectorAll('main textarea').length===2");
	await click(phone, 'main [data-question-index] textarea');
	await phone.send("Input.insertText", { text: "离线编辑" });
	await phone.evaluate("[...document.querySelectorAll('main [data-question-index] button')].find(e=>e.textContent==='发送')?.click()");
	await until(phone, "document.body.innerText.includes('编辑重发失败')");
	assert.equal(await phone.evaluate("document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')"), true);
	await desktop.evaluate("window.lyra.sync.start()");
	await phone.evaluate("window.__lyraProbe()");
	await until(phone, "window.lyra.sync.connectionStatus()==='connected'");
});

test("mobile trajectory keeps real touch targets and omits desktop file exports", async (t) => {
	await size(390, 844);
	// Dismiss the errors intentionally produced by the preceding offline test.
	await phone.evaluate(`document.querySelectorAll('[role="alert"] button[aria-label="关闭"]').forEach(e=>e.click())`);
	await until(phone, `!document.querySelector('[role="alert"] button[aria-label="关闭"]')`);
	await click(phone, 'button[aria-label="面板"]');
	t.diagnostic(await phone.evaluate("document.body.innerText.slice(-800)"));
	await phone.evaluate("(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='轨迹');if(!e)throw new Error('trajectory action missing');e.click();})()");
	await until(phone, "!!document.querySelector('[data-trace-entry]')");
	for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
		await size(width, height);
		const rows = await phone.evaluate<{ top: number; height: number; bottom: number }[]>("[...document.querySelectorAll('[data-trace-list] [role=listitem]')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,height:r.height,bottom:r.bottom}})");
		assert.ok(rows.length > 0, 'the mobile ledger must contain visible records');
		for (let i = 0; i < rows.length; i++) { assert.equal(rows[i].height, 44); if (i) assert.ok(rows[i].top >= rows[i - 1].bottom); }
		assert.equal(await phone.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
		assert.equal(await phone.evaluate("document.querySelectorAll('[data-trajectory] button[aria-label*=导出],[data-trajectory] button[aria-label*=完整记录]').length"), 0);
		await shot(phone, `trajectory-${width}x${height}`);
		await click(phone, 'button[aria-label="时间概览"]');
		await until(phone, "!!document.querySelector('[data-trace-timeline] canvas')");
		await phone.evaluate("Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})))");
		const timeline = await phone.evaluate<{ controls: { height: number; width: number; bottom: number }[]; canvasTop: number }>("(()=>{const p=document.querySelector('[data-trace-timeline]');return {controls:[...p.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {height:r.height,width:r.width,bottom:r.bottom}}),canvasTop:p.querySelector('canvas').getBoundingClientRect().top}})()");
		assert.ok(timeline.controls.length > 0 && timeline.controls.every(r=>r.height>=44 && r.width>=44 && r.bottom<=timeline.canvasTop), JSON.stringify(timeline));
		await shot(phone, `trajectory-timeline-${width}x${height}`);
		await phone.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
		await phone.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
		await until(phone, "!document.querySelector('[data-trace-timeline]')");
	}
});

test("relay serves the real mobile renderer and synchronizes settings and forked conversations", async (t) => {
	await phone.stop();
	phone = await startMobile(desktop.home, { host: "127.0.0.1", port: RELAY_PORT, token: TOKEN, relay: true, platform: "darwin" }, 9705);
	await until(phone, "!!document.querySelector('.ly-shell')");
	await size(1024, 768);
	await click(phone, '[data-ly-row="qa-long"] > button');
	await until(phone, "document.querySelector('main')?.innerText.includes('断线期间桌面继续完成')");
	await desktop.evaluate("window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:'light'}}))");
	t.diagnostic(`relay theme ${await until(phone, "document.documentElement.classList.contains('light')")}ms`);
	await phone.evaluate("window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,appearance:{...s.appearance,theme:'dark'}}))");
	await until(desktop, "document.documentElement.classList.contains('dark')");
	const fork = await phone.evaluate<{ meta: { id: string; title: string } }>("window.lyra.sessions.list().then(s=>{const m=s.find(s=>s.id==='qa-long');return window.lyra.sessions.fork(m.projectId,m.id,2)})");
	await until(desktop, `!!document.querySelector('[data-ly-row="${fork.meta.id}"]')`);
	await until(phone, `!!document.querySelector('[data-ly-row="${fork.meta.id}"]')`);
	const scratch = await phone.evaluate<string>("window.lyra.git.generalScratch()");
	assert.ok(scratch.endsWith("general"));
	await phone.evaluate("window.__lyraProbe()");
	await shot(phone, "relay-desktop-parity");
});
