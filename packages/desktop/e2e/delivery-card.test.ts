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

/**
 * 一份两个方向都装不下的改动。
 *
 * 一行的时候，预览连滚动条都没有，而滚动条正是浮层内衬出问题的地方：菜单要给竖条让开 20px，
 * 一整块 diff 让开之后，右边就空出一条不是代码的底色。写够高也写够宽，那 20px 才量得到。
 */
function written(index: number): string {
	const lines = [`export const value${index} = ${index};`];
	for (let i = 0; i < 40; i++) lines.push(`export const field_${index}_${i} = ${JSON.stringify("横向溢出用的长行".repeat(i === 3 ? 14 : 1))};`);
	return lines.join("\n") + "\n";
}
before(async () => {
	// Only the provider is scripted. File writes, records, IPC and rendering use the real app.
	server = createServer((req, res) => {
		req.resume(); req.on("end", () => {
			const index = turns++;
			const tool = index < 5 ? { name: "write", input: { path: `delivery-${index}.ts`, content: written(index) } } : null;
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
		const metrics = await app.evaluate<{ preview: DOMRect; row: DOMRect; card: DOMRect; overflow: number; cards: number; inset: { left: number; right: number; bottom: number }; reach: Record<string, string> }>(`(()=>{const e=document.querySelector('[aria-label="文件变更预览"]'),p=e.getBoundingClientRect(),d=e.querySelector('.ly-diff-scroll').getBoundingClientRect();
			const reach={};for(const tip of ['撤销这次文件改动','审核全部文件改动']){const b=document.querySelector('[data-turn-delivery] button[data-ly-tip="'+tip+'"]'),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);reach[tip]=b.contains(hit)?'可点':'被盖住：'+(hit&&hit.closest('[aria-label]')?hit.closest('[aria-label]').getAttribute('aria-label'):String(hit&&hit.className))}
			return {preview:p.toJSON(),row:document.querySelector('[data-delivery-file]').getBoundingClientRect().toJSON(),card:document.querySelector('[data-turn-delivery]').getBoundingClientRect().toJSON(),overflow:Math.max(0,p.right-innerWidth),cards:document.querySelectorAll('[data-turn-delivery]').length,
			 inset:{left:d.left-p.left,right:p.right-d.right,bottom:p.bottom-Math.min(d.bottom,p.bottom)},reach}})()`);
		t.diagnostic(JSON.stringify({ theme, ...metrics })); assert.equal(metrics.overflow, 0); assert.ok(metrics.preview.x >= 0 && metrics.preview.y >= 0); assert.equal(metrics.cards, 1);
		/*
		 * 预览是从这张卡片里拉出来的，所以它就是这张卡片的宽度和这张卡片的左边缘。
		 *
		 * 上面那条「没有超出窗口」拦不住这件事：宽度写死 720 的时候，预览在一个普通宽度的窗口里
		 * 比它下面的卡片宽出两百多像素、左右都挂在外面，而窗口还宽得很，overflow 一直是 0。要量
		 * 的是它和卡片的关系，不是它和屏幕的关系。
		 *
		 * 量卡片而不是量行，是因为它挂在卡片上：挂在行上的时候，鼠标在行间挪一格，整个面板就跟着
		 * 跳一格、重画一次，看上去和「预览没了」没有区别。
		 */
		assert.ok(Math.abs(metrics.preview.width - metrics.card.width) <= 1, `预览要和卡片同宽：${JSON.stringify({ preview: metrics.preview.width, card: metrics.card.width })}`);
		assert.ok(Math.abs(metrics.preview.x - metrics.card.x) <= 1, `预览的左边缘要对着卡片：${JSON.stringify({ preview: metrics.preview.x, card: metrics.card.x })}`);
		/*
		 * 代码铺满它所在的卡片。
		 *
		 * 这块面板自带底色，而浮层的滚动体原本是按菜单来的：上下 6px 外边距、右侧 4px，出了滚动条
		 * 再让开 20px。菜单项没有底色，看不出来；一整块 diff 摆进去，右边就空出 25px 玻璃色、顶上
		 * 空出 6px，代码像是嵌在一张比它大的卡片里。
		 */
		assert.ok(metrics.inset.left <= 2 && metrics.inset.right <= 2, `代码要铺满浮层，左右只留描边：${JSON.stringify(metrics.inset)}`);
		/*
		 * 预览不压在它自己的卡片上。
		 *
		 * 它开在行的正上方时，正好落在这张卡片自己的「撤销」和「审核」上——预览一出来，这一轮唯一
		 * 的两个动作就点不到了，而预览是鼠标经过就出来的。
		 */
		assert.deepEqual(metrics.reach, { 撤销这次文件改动: "可点", 审核全部文件改动: "可点" }, `预览不该盖住卡片自己的按钮：${JSON.stringify(metrics.reach)}`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: metrics.preview.x + 40, y: metrics.preview.y + 35 });
		await frames();
		assert.ok(await app.evaluate(`document.querySelector('[aria-label="文件变更预览"]')?.checkVisibility()`), "the diff remains readable when moving into its popup");
		await screenshot(`delivery-${theme}`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 }); await frames();
	}

	/*
	 * 经过不算数，停下来才算。
	 *
	 * 卡片自己的两个按钮就在这些行的上方，去够它们必然要横穿这些行——预览要是碰到就开，那趟路上
	 * 它一直是开着的。下界而不是区间：机器慢只会等得更久，那不是这条要拦的东西。
	 */
	const rows = await app.evaluate<{ x: number; y: number }[]>(`[...document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)')].slice(0,2).map(e=>{const r=e.getBoundingClientRect();return {x:r.x+50,y:r.y+r.height/2}})`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rows[0] });
	const started = Date.now();
	await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('delivery-0')`);
	const waited = Date.now() - started;
	t.diagnostic(`悬停到出现：${waited}ms`);
	assert.ok(waited >= 200, `预览要等鼠标停稳才出现，实际只等了 ${waited}ms`);

	/*
	 * 站定之后，在行间挪动只换内容。
	 *
	 * 这些行是紧挨着的，预览开在它上方 8px，所以从最后一个文件往上抬一点点就落进了上一行——挂在
	 * 行上的时候，那一下会让整块面板跳一行的高度并重画。从外面看，那就是预览没了。
	 */
	const place = `(()=>{const r=document.querySelector('[aria-label="文件变更预览"]').getBoundingClientRect();return Math.round(r.x)+','+Math.round(r.y)+','+Math.round(r.width)+','+Math.round(r.height)})()`;
	// 量在入场之后：`ly-pop-in` 是一段 scale，量在中途拿到的是 0.95 倍的它，和位置无关。
	await frames();
	const settled = await app.evaluate<string>(place);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rows[1] });
	await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('delivery-1')`);
	assert.equal(await app.evaluate<string>(place), settled, "在文件行之间挪动只换内容，不挪位置");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 }); await frames();
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
