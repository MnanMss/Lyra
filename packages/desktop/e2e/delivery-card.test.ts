import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let turns = 0;
before(async () => {
	// Only the provider is scripted. File writes, records, IPC and rendering use the real app.
	server = createServer((req, res) => {
		req.resume(); req.on("end", () => {
			const index = turns++;
			const tool = index < 5 ? { name: "write", input: { path: `delivery-${index}.ts`, content: `export const value${index} = ${index};\n` } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: index === 5 ? `已完成。\n\n[实现说明](${join(app.home, "project", "README.md")})` : "这一轮没有修改文件。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {}); res.end();
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9643, seed: async home => {
		await seedInteractions(home, address.port);
		await mkdir(join(home, "private"));
		await writeFile(join(home, "private", "outside.txt"), "PRIVATE_FIXTURE");
		await symlink(join(home, "private"), join(home, "project", "outside"), "junction");
		const path = join(home, "settings.json"), settings = JSON.parse(await readFile(path, "utf8"));
		await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
	} });
});
after(async () => { try { await app?.stop(); } finally { await closeListeningServer(server); } });
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+15000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(expression)}+'; '+document.body.innerText.slice(-1000)))}tick()})`);
}
async function frames(n = 20) { await app.evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`); }
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`); await frames();
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('Obscured '+${JSON.stringify(selector)});return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}
async function send(text: string) {
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}
afterEach(async t => { if (!t.passed) await screenshot("delivery-failure"); });
async function screenshot(name: string) {
	const dir = process.env.LYRA_E2E_ARTIFACTS; if (!dir) return;
	await mkdir(dir, { recursive: true });
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, name + ".png"), Buffer.from(shot.data, "base64"));
}

test("real file changes produce one temporary card with internal expansion and stable themed diff previews", async t => {
	await click('[data-ly-row="qa-short"]');
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery]').length`), 0);
	await send("修改五个文件用于验证变更卡片");
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 5 个文件')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery]').length`), 1);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length`), 3);
	assert.ok(await app.evaluate(`[...document.querySelectorAll('[data-dock-pane="conversation"] a')].some(e=>e.textContent.includes('实现说明'))`));
	await click('[data-dock-pane="conversation"] a[href$="README.md"]');
	await until(`document.querySelector('[data-dock-pane="file"]')?.innerText.includes('QA fixture')`);
	await click('[data-turn-delivery] [aria-expanded="false"]'); await frames();
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length`), 5);
	await click('[data-turn-delivery] [aria-expanded="true"]'); await frames();
	for (const theme of ["light", "dark"]) {
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}});})()`);
		await until(`document.documentElement.style.colorScheme===${JSON.stringify(theme)}&&!document.documentElement.hasAttribute('data-theme-switching')`);
		await app.evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'center',behavior:'instant'})`); await frames();
		const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-delivery-file]').getBoundingClientRect();return {x:r.x+50,y:r.y+r.height/2}})()`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
		await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('export const')`); await frames();
		const metrics = await app.evaluate<{ preview: DOMRect; row: DOMRect; card: DOMRect; overflow: number; cards: number }>(`(()=>{const e=document.querySelector('[aria-label="文件变更预览"]');return {preview:e.getBoundingClientRect().toJSON(),row:document.querySelector('[data-delivery-file]').getBoundingClientRect().toJSON(),card:document.querySelector('[data-turn-delivery]').getBoundingClientRect().toJSON(),overflow:Math.max(0,e.getBoundingClientRect().right-innerWidth),cards:document.querySelectorAll('[data-turn-delivery]').length}})()`);
		t.diagnostic(JSON.stringify({ theme, ...metrics })); assert.equal(metrics.overflow, 0); assert.ok(metrics.preview.x >= 0 && metrics.preview.y >= 0); assert.equal(metrics.cards, 1);
		/*
		 * 预览是从这一行里拉出来的，所以它就是这一行的宽度和这一行的左边缘。
		 *
		 * 上面那条「没有超出窗口」拦不住这件事：宽度写死 720 的时候，预览在一个普通宽度的窗口里
		 * 比它下面的卡片宽出两百多像素、左右都挂在外面，而窗口还宽得很，overflow 一直是 0。要量
		 * 的是它和卡片的关系，不是它和屏幕的关系。
		 */
		assert.ok(Math.abs(metrics.preview.width - metrics.row.width) <= 1, `预览要和文件行同宽：${JSON.stringify({ preview: metrics.preview.width, row: metrics.row.width })}`);
		assert.ok(Math.abs(metrics.preview.x - metrics.row.x) <= 1, `预览的左边缘要对着这一行：${JSON.stringify({ preview: metrics.preview.x, row: metrics.row.x })}`);
		assert.ok(metrics.preview.width <= metrics.card.width, `预览不该宽过卡片：${JSON.stringify({ preview: metrics.preview.width, card: metrics.card.width })}`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: metrics.preview.x + 40, y: metrics.preview.y + 35 });
		await frames();
		assert.ok(await app.evaluate(`document.querySelector('[aria-label="文件变更预览"]')?.checkVisibility()`), "the diff remains readable when moving into its popup");
		await screenshot(`delivery-${theme}`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 }); await frames();
	}
});

test("local material readers and writes reject links outside an opened project", async () => {
	const path = join(app.home, "project", "outside", "outside.txt");
	const result = await app.evaluate(`(async()=>({read:await window.lyra.files.read(${JSON.stringify(path)}),bytes:await window.lyra.files.bytes(${JSON.stringify(path)}),document:await window.lyra.files.document(${JSON.stringify(path)}),write:await window.lyra.files.write(${JSON.stringify(path)},'overwritten')}))()`);
	assert.deepEqual(result, { read: null, bytes: null, document: null, write: { ok: false, error: "该路径不在已打开的项目内" } });
	assert.equal(await readFile(join(app.home, "private", "outside.txt"), "utf8"), "PRIVATE_FIXTURE");
});

test("undo uses the stored changes, and the next answer cannot retain the previous turn's card", async () => {
	await click('[data-turn-delivery] button[data-ly-tip="撤销这次文件改动"]');
	await until(`document.querySelector('[role="dialog"]')`);
	await app.evaluate(`(()=>{const button=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent.includes('撤销改动'));if(!button)throw Error('Missing confirm');button.click()})()`);
	await until(`document.querySelector('[data-turn-delivery] button[data-ly-tip="撤销这次文件改动"]')?.disabled`);
	for (let i = 0; i < 5; i++) await assert.rejects(readFile(join(app.home, "project", `delivery-${i}.ts`)), { code: "ENOENT" });
	await send("只回答，不改文件");
	await until(`document.body.innerText.includes('这一轮没有修改文件')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery]').length`), 0);
});
