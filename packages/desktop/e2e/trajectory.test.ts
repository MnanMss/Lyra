import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { seedTrajectory } from "./trajectory-fixture.ts";

let app: RunningApp;
let server: Server;
before(async () => {
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: "trace-qa", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "轨迹验证摘要：保留关键决策与未完成事项。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {}); res.end();
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9618, seed: async home => { await seedInteractions(home, address.port); await seedTrajectory(home); } });
});
after(async () => { await app?.stop(); await closeListeningServer(server); });
afterEach(async t => { if (!t.passed) { await shot("failure"); t.diagnostic(await app.evaluate(`document.body.innerText.slice(-7000)`)); } });

async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=300;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);
}
async function openPane(label: string) {
	await app.evaluate(`document.querySelector('button[aria-label="面板"]').click()`);
	await until(`document.querySelector('[role="menuitem"]')`);
	await until(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.includes(${JSON.stringify(label)}))`);
	await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	const data = await app.send<{data: string}>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(data.data, "base64"));
}

test("manual compression is traceable with its command, summary and lifecycle while the panel stays mounted", async (t) => {
	const at = await app.evaluate<{x: number; y: number}>(`(()=>{const r=document.querySelector('[data-ly-row="qa-long"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
	await until(`document.querySelector('main').textContent.includes('第 120 个回答')`);
	await openPane("轨迹");
	await until(`document.querySelector('[data-dock-pane="trajectory"]')?.textContent.includes('用户消息')`);
	await app.evaluate(`document.querySelector('main textarea').focus()`);
	await app.send("Input.insertText", { text: "/compact 保留关键决策" });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`document.querySelector('[data-command-status="done"]')`);
	const persisted = await app.evaluate<{source: string; summary: string; detail: string; command?: string}[]>(`(async()=>{const m=(await window.lyra.sessions.list()).find(m=>m.id==='qa-long');return window.lyra.sessions.trajectory(m.projectId,m.id);})()`);
	t.diagnostic(JSON.stringify(persisted.filter(e => e.source === "compaction")));
	await shot("trajectory-manual");
	assert.ok(persisted.some(e => e.command === "/compact 保留关键决策"), "the durable command lifecycle must be projected, not just the message counts");
	assert.ok(persisted.some(e => e.detail.includes("轨迹验证摘要")), "the stored summary must be inspectable");
	await until(`document.querySelector('[data-dock-pane="trajectory"]')?.textContent.includes('/compact')`);
	await app.evaluate(`[...document.querySelectorAll('[data-trace-entry]')].find(e=>e.textContent.includes('/compact')).click()`);
	await until(`document.querySelector('[data-trace-inspector]')?.textContent.includes('轨迹验证摘要')`);
	await shot("manual-detail");
});

async function clickRow(id: string) {
	const at = await app.evaluate<{x: number; y: number}>(`(()=>{const r=document.querySelector('[data-ly-row="${id}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
}
async function search(selector: string, text: string) {
	await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select();})()`);
	await app.send("Input.insertText", { text });
}

test("7500+ trajectory entries remain bounded; full output search and inspector selection do not shift rows", async (t) => {
	await clickRow("10000000-0000-4000-8000-000000000001");
	await until(`document.querySelector('[data-ly-row="10000000-0000-4000-8000-000000000001"][aria-current]') || document.querySelector('main').textContent.includes('执行并验证构建')`);
	await openPane("轨迹");
	await until(`document.querySelector('[data-trace-count]')?.textContent.includes('2500 次工具')`);
	const baseline = await app.evaluate(`(()=>{const s=document.querySelector('[data-dock-pane="trajectory"] .ly-scroll-view');return {rows:document.querySelectorAll('[data-trace-entry]').length,top:s.scrollTop,height:s.scrollHeight};})()`);
	assert.ok(baseline.rows < 55 && baseline.top > 200000, JSON.stringify(baseline));
	const sample = await app.evaluate(`new Promise(resolve=>{const s=document.querySelector('[data-dock-pane="trajectory"] .ly-scroll-view');const out=[];let i=0,prev=performance.now();const f=()=>{const now=performance.now();out.push({ms:now-prev,rows:document.querySelectorAll('[data-trace-entry]').length});prev=now;s.scrollTop=(s.scrollHeight-s.clientHeight)*(1-i/60);if(++i<60)requestAnimationFrame(f);else resolve(out);};requestAnimationFrame(f);})`);
	assert.ok(sample.every((frame: {rows: number}) => frame.rows < 55));
	t.diagnostic(JSON.stringify({ baseline, maxFrame: Math.max(...sample.map((frame: {ms: number}) => frame.ms)), maxRows: Math.max(...sample.map((frame: {rows: number}) => frame.rows)) }));
	await search('[data-trajectory] input', "TAIL_SENTINEL");
	await until(`document.querySelectorAll('[data-trace-entry]').length === 2`);
	await app.evaluate(`document.querySelector('[data-trace-entry]').click()`);
	await until(`document.querySelector('[data-trace-inspector]')?.textContent.includes('TAIL_SENTINEL')`);
	const stable = await app.evaluate(`new Promise(resolve=>{const out=[];let n=20;const f=()=>{out.push([...document.querySelectorAll('[data-trace-entry]')].map(e=>e.getBoundingClientRect().top));if(--n)requestAnimationFrame(f);else resolve(out);};requestAnimationFrame(f);})`);
	assert.ok(stable.every((frame: number[]) => JSON.stringify(frame) === JSON.stringify(stable[0])), "inspecting a record must not animate or shift its ledger row");
	await app.evaluate(`Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{document.documentElement.dataset.traceCopy=text;}})`);
	try {
		await app.evaluate(`document.querySelector('[aria-label="复制完整输出"]').click()`);
		const copied = await app.evaluate<string>(`document.documentElement.dataset.traceCopy`);
		assert.ok(copied.length > 12000 && copied.endsWith("TAIL_SENTINEL"));
	} finally { await app.evaluate(`delete navigator.clipboard.writeText;delete document.documentElement.dataset.traceCopy`); }
	await shot("long-trace-inspector");
});

test("task execution search includes omitted text, links to its trajectory and opens the complete raw output", async () => {
	await openPane("任务");
	await until(`document.querySelector('[data-task-records]')`);
	await search('[data-dock-pane="tasks"] input', "TAIL_SENTINEL");
	await until(`document.querySelectorAll('[data-task-record]').length === 1`);
	await app.evaluate(`document.querySelector('[data-task-record] button').click()`);
	await until(`document.querySelector('[data-dock-pane="tasks"]')?.textContent.includes('TAIL_SENTINEL')`);
	await app.evaluate(`document.querySelector('[data-dock-pane="tasks"] [aria-label="在轨迹中查看这次调用"]').click()`);
	await until(`document.querySelector('[data-trace-inspector]')?.textContent.includes('trace-run-2499')`);
	await app.evaluate(`document.querySelector('[data-trace-inspector] [aria-label="查看完整原始输出"]').click()`);
	const read = await app.evaluate(`(async()=>{const m=(await window.lyra.sessions.list()).find(m=>m.id==='10000000-0000-4000-8000-000000000001');const p=await window.lyra.sessions.exportTrajectory(m.projectId,m.id,'output',{correlationId:'trace-run-2499'});const r=await window.lyra.files.read(p);return {path:p,read:r?{bytes:r.bytes,truncated:r.truncated,tail:r.text.slice(-20)}:null};})()`);
	assert.ok(read.read, JSON.stringify(read));
	assert.ok(read.read.bytes > 200000 && read.read.truncated === false && read.read.tail.endsWith("RAW_FILE_TAIL"), JSON.stringify(read));
	await until(`document.querySelector('[data-dock-pane="file"] .cm-content')`);
	const paths = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-dock-pane="file"] [data-ly-tip]')].map(e=>e.getAttribute('data-ly-tip'))`);
	assert.ok(paths.some(path => path.includes("build.log")), JSON.stringify(paths));
	await shot("task-raw-output");
});

test("session switching never renders the previous trace selection or filter contents", async () => {
	await clickRow("qa-short");
	await until(`document.querySelector('main').textContent.includes('第 5 个回答')`);
	await openPane("轨迹");
	await until(`document.querySelector('[data-trajectory]') && !document.querySelector('[data-trace-count]').textContent.includes('2500 次工具')`);
	assert.equal(await app.evaluate(`document.querySelector('[data-trajectory]').textContent.includes('trace-run-2499')`), false);
	assert.equal(await app.evaluate(`document.querySelector('[data-trajectory] input').value`), "");
	await clickRow("qa-long");
	await until(`document.querySelector('[data-trajectory]').textContent.includes('/compact')`);
	assert.equal(await app.evaluate(`document.querySelector('[data-trajectory]').textContent.includes('trace-run-2499')`), false);
});

test("time-range selection, turn folding and model timing are queryable through the real controls", async () => {
	await clickRow("10000000-0000-4000-8000-000000000001");
	await until(`document.querySelector('[data-trace-count]')?.textContent.includes('7503/7503')`);
	const box = await app.evaluate<{x: number; y: number; width: number}>(`(()=>{const r=document.querySelector('[data-trace-timeline] canvas').getBoundingClientRect();return {x:r.x,y:r.y+r.height/2,width:r.width};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + box.width * 0.25, y: box.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.width * 0.75, y: box.y, button: "left", buttons: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.width * 0.75, y: box.y, button: "left", clickCount: 1 });
	await until(`!document.querySelector('[data-trace-count]').textContent.startsWith('7503/')`);
	const filtered = await app.evaluate<string>(`document.querySelector('[data-trace-count]').textContent`);
	const count = Number(filtered.split("/")[0]); assert.ok(count > 3000 && count < 4500, filtered);
	await app.evaluate(`document.querySelector('[data-trace-timeline] button').click()`);
	await until(`document.querySelector('[data-trace-count]').textContent.startsWith('7503/')`);
	await app.evaluate(`document.querySelector('[aria-label="收起所有轮次"]').click()`);
	await until(`document.querySelectorAll('[data-trace-entry]').length < 5`);
	await app.evaluate(`document.querySelector('[aria-label="展开所有轮次"]').click()`);
	await until(`document.querySelectorAll('[data-trace-entry]').length > 5`);
	await app.evaluate(`[...document.querySelectorAll('[data-trajectory] button')].find(e=>e.textContent.startsWith('模型请求')).click()`);
	await until(`document.querySelector('[data-trace-count]').textContent.startsWith('2500/')`);
	await app.evaluate(`document.querySelector('[data-trace-entry]').click()`);
	await until(`document.querySelector('[data-trace-inspector]')?.textContent.includes('首 Token')`);
	const details = await app.evaluate<string>(`document.querySelector('[data-trace-inspector]').textContent`);
	assert.ok(details.includes("120 ms") && details.includes("80 ms") && details.includes("Token 用量"), details);
	const toolLane = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-trace-timeline] canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+26};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: toolLane.x, y: toolLane.y - 16, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: toolLane.x, y: toolLane.y - 16, button: "left", clickCount: 1 });
	await until(`document.querySelector('[data-trace-inspector] > div')?.textContent.includes('模型请求')`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...toolLane, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...toolLane, button: "left", clickCount: 1 });
	await until(`document.querySelector('[data-trace-inspector] > div')?.textContent.includes('工具调用')`);
});
