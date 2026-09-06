import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let held: ServerResponse | undefined;
let requestArrived: (() => void) | undefined;
let holdNext = false;
let requests = 0;
function reply(res: ServerResponse, text: string, tool?: { name: string; input: Record<string, unknown> }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: `notice-${requests}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `tool-${requests}`, name: tool.name, input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
	emit("message_stop", {}); res.end();
}
before(async () => {
	server = createServer((req, res) => {
		req.resume(); req.on("end", () => {
			requests++;
			res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
			if (holdNext) { held = res; holdNext = false; requestArrived?.(); }
			else reply(res, "审批流程已结束。");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9613, seed: async (home) => {
		// Only provider responses and disk fixtures are synthetic; the renderer and IPC stay real.
		await seedInteractions(home, address.port);
		const file = join(home, "settings.json"); const settings = JSON.parse(await readFile(file, "utf8"));
		settings.permissionMode = "ask"; settings.projectMemory = false;
		await writeFile(file, JSON.stringify(settings));
	} });
});
afterEach(async (t) => {
	if (!t.passed) {
		await shot("notifications-failure");
		t.diagnostic(await app.evaluate<string>(`document.body.innerText.slice(-3000)`));
	}
});
after(async () => { await app?.stop(); await closeListeningServer(server); });
async function frames(count = 3) {
	await app.evaluate(`new Promise(resolve=>{let n=${count};const frame=()=>--n?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);})`);
}
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=600;const frame=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(frame);else reject(new Error(${JSON.stringify(expression)}));};frame();})`);
}
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`); await frames();
	await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	await frames();
}
async function chooseSession(id: string) {
	if (await app.evaluate<boolean>(`!!document.querySelector('button[aria-label^="显示侧边栏"]')`)) await click('button[aria-label^="显示侧边栏"]');
	await click(`[data-ly-row="${id}"] > button`);
	await until(`document.querySelector('.ly-transcript')?.textContent.includes(${JSON.stringify(id)})`);
}
async function collapseSidebar() {
	if (await app.evaluate<boolean>(`!!document.querySelector('button[aria-label^="隐藏侧边栏"]')`)) await click('button[aria-label^="隐藏侧边栏"]');
}
async function begin(prompt: string) {
	await chooseSession("qa-short");
	held = undefined; holdNext = true;
	const arrived = new Promise<void>((resolve) => { requestArrived = resolve; });
	await click('main textarea'); await app.send("Input.insertText", { text: prompt });
	await click('button[aria-label="发送"]');
	await arrived;
	await chooseSession("qa-long"); await collapseSidebar();
}
async function appearance(theme: "light" | "dark", width: number) {
	await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}});})()`);
	await until(`document.documentElement.classList.contains(${JSON.stringify(theme)})`); await frames(20);
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
}

test("background completion stays compact in both themes and narrow windows, then opens its own conversation", async (t) => {
	const surfaces = new Map<string, string>();
	for (const theme of ["light", "dark"] as const) for (const width of [1200, 375]) {
		await appearance(theme, width);
		const result = `完成通知回归 ${theme} ${width}`;
		await begin(`触发后台完成 ${theme} ${width}`); assert.ok(held); reply(held, result);
		await until(`document.querySelector('[role="status"] button[aria-label="跳转到该会话"]')`); await frames(20);
		const metrics = await app.evaluate<{ cards: number; text: string; x: number; right: number; height: number; scroll: number; client: number; buttons: string[]; background: string; color: string; badge: { width: number; height: number; animation: string; color: string } }>(`(()=>{const action=document.querySelector('[role="status"] button[aria-label="跳转到该会话"]'),card=action.closest('[role="status"]'),r=card.getBoundingClientRect(),s=getComputedStyle(card),badge=document.querySelector('button[aria-label*="有任务已完成"] span.bg-ok'),b=badge.getBoundingClientRect();return {cards:document.querySelectorAll('[role="status"] button[aria-label="跳转到该会话"]').length,text:card.innerText,x:r.x,right:r.right,height:r.height,scroll:card.scrollWidth,client:card.clientWidth,buttons:[...card.querySelectorAll('button')].map(e=>e.getAttribute('aria-label')),background:s.backgroundColor,color:s.color,badge:{width:b.width,height:b.height,animation:getComputedStyle(badge).animationName,color:getComputedStyle(badge).backgroundColor}};})()`);
		assert.equal(metrics.cards, 1); assert.deepEqual(metrics.buttons, ["跳转到该会话", "关闭"]);
		assert.ok(metrics.x >= 0 && metrics.right <= width && metrics.height <= 56, JSON.stringify(metrics));
		assert.ok(metrics.scroll <= metrics.client, "the toast has no horizontal overflow");
		assert.deepEqual({ ...metrics.badge, color: "" }, { width: 6, height: 6, animation: "none", color: "" });
		assert.ok(metrics.text.length < 40); surfaces.set(theme, metrics.background);
		t.diagnostic(JSON.stringify({ theme, width, ...metrics })); await shot(`completion-${theme}-${width}`);
		await click('[role="status"] button[aria-label="跳转到该会话"]');
		await until(`document.querySelector('.ly-transcript')?.textContent.includes(${JSON.stringify(result)})`);
		await until(`!document.querySelector('[role="status"] button[aria-label="跳转到该会话"]')`);
		const painted = await app.evaluate<boolean[]>(`(async()=>{const out=[];for(let n=0;n<20;n++){await new Promise(requestAnimationFrame);out.push(document.querySelector('.ly-transcript')?.textContent.includes(${JSON.stringify(result)}));}return out;})()`);
		assert.ok(painted.every(Boolean), "the source result remains visible throughout navigation settling");
		assert.equal(await app.evaluate(`!!document.querySelector('button[aria-label*="有任务已完成"]')`), false);
	}
	assert.notEqual(surfaces.get("light"), surfaces.get("dark"), "the toast surface uses the active theme");
});

test("ordinary approvals and interactive questions expose one waiting badge and their own decision UI", async (t) => {
	const cases = [
		{ theme: "dark", width: 1200, name: "bash", input: { command: "rm -rf ./notification-e2e-unused", description: "通知验证：清理隔离测试目录" }, expected: "rm -rf ./notification-e2e-unused", cancel: "拒绝" },
		{ theme: "light", width: 375, name: "ask_user", input: { question: "请选择通知验证方案", options: ["保留方案 A", "保留方案 B"], allowCustomInput: true }, expected: "请选择通知验证方案", cancel: "取消" },
	] as const;
	for (const scenario of cases) {
		await appearance(scenario.theme, scenario.width); await begin(`审批通知回归 ${scenario.name}`);
		assert.ok(held); reply(held, "", { name: scenario.name, input: scenario.input });
		await until(`document.querySelector('button[aria-label*="有任务等待处理"]')`);
		const badge = await app.evaluate<{ animation: string; color: string }>(`(()=>{const b=document.querySelector('button[aria-label*="有任务等待处理"] span.bg-accent');return {animation:getComputedStyle(b).animationName,color:getComputedStyle(b).backgroundColor};})()`);
		assert.equal(badge.animation, "none");
		await chooseSession("qa-short"); await collapseSidebar();
		await until(`document.querySelector('main')?.textContent.includes(${JSON.stringify(scenario.expected)}) && [...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith(${JSON.stringify(scenario.cancel)}))`);
		const card = await app.evaluate<{ text: string; left: number; right: number; top: number; bottom: number; buttons: { left: number; right: number; top: number; bottom: number }[] }>(`(()=>{const cancel=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(scenario.cancel)}));const c=cancel.closest('.ly-glass'),r=c.getBoundingClientRect();return {text:c.innerText,left:r.left,right:r.right,top:r.top,bottom:r.bottom,buttons:[...c.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};})()`);
		assert.ok(card.left >= 0 && card.right <= scenario.width && card.top >= 0 && card.bottom <= 800, JSON.stringify(card));
		assert.ok(card.buttons.every((b) => b.left >= card.left && b.right <= card.right && b.top >= card.top && b.bottom <= card.bottom));
		if (scenario.name === "ask_user") assert.ok(card.text.includes("保留方案 A") && card.text.includes("保留方案 B"));
		t.diagnostic(JSON.stringify({ scenario: scenario.name, badge, card })); await shot(`approval-${scenario.name}-${scenario.theme}-${scenario.width}`);
		await app.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(scenario.cancel)})).setAttribute('data-qa-cancel','')`);
		await click('[data-qa-cancel]');
		await until(`!document.querySelector('button[aria-label="停止"]')`);
	}
});
