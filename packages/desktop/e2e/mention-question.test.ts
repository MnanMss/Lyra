import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import type { SessionSnapshot } from "../electron/ipc-types.ts";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { questionModel, REFERENCE_TITLE, seedQuestions } from "./mention-question-fixture.ts";

let app: RunningApp;
const { server, requests } = questionModel();
const capsules = '.ly-composer button[aria-label^="移除会话引用："]';

before(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9638, seed: (home) => seedQuestions(home, address.port) });
	await app.evaluate("document.fonts.ready");
});
afterEach(async () => { if (app) await shot("mention-question-last-screen"); });
after(async () => {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (directory) { await mkdir(directory, { recursive: true }); await writeFile(join(directory, "request-tails.json"), JSON.stringify(requests.map((request) => request.messages.slice(-3)), null, 2)); }
	await app?.stop(); await closeListeningServer(server);
});

async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+15000;const tick=()=>{if(${expression})resolve();else if(performance.now()<deadline)requestAnimationFrame(tick);else reject(new Error(${JSON.stringify(expression)}));};tick();})`);
}
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}
async function input(text: string, selector = "main textarea") {
	await click(selector);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
	await app.send("Input.insertText", { text });
	await until(`document.querySelector(${JSON.stringify(selector)}).value === ${JSON.stringify(text)}`);
}
async function enter() {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}
async function session(id: string) {
	await click(`[data-ly-row="${id}"] > button`);
	await until(`document.querySelector('[data-ly-row="${id}"] > button')?.getAttribute('aria-current') === 'page'`);
}
async function snapshot(id: string) {
	const result = await app.evaluate<SessionSnapshot | null>(`(async()=>{const s=(await window.lyra.sessions.list()).find(s=>s.id===${JSON.stringify(id)});return window.lyra.sessions.transcript(s.projectId,s.id);})()`);
	assert.ok(result); return result;
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	await app.evaluate(`Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(data, "base64"));
}
async function appearance(theme: "dark" | "light", width: number) {
	await app.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
	await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${theme === "light" ? '"light"' : '"dark"'}}});})()`);
	await until(`innerWidth === ${width} && document.documentElement.style.colorScheme === ${theme === "light" ? '"light"' : '"dark"'} && !document.documentElement.hasAttribute('data-theme-switching')`);
}

test("same-title references survive draft switching and fit dark, light and narrow composers", async (t) => {
	await session("qa-long");
	for (let index = 0; index < 2; index++) {
		await input("@同名会话");
		await until(`document.querySelectorAll('.ly-mention-menu [role="option"][data-mention-kind="session"]').length === 2`);
		await click(`.ly-mention-menu [role="option"][data-index="${index}"]`);
		await until(`document.querySelectorAll(${JSON.stringify(capsules)}).length === ${index + 1}`);
		assert.equal(await app.evaluate("document.querySelector('main textarea').value"), "");
	}
	await input("保留这份引用草稿");
	await session("qa-short");
	await until(`document.querySelector('main textarea').value === '' && document.querySelectorAll(${JSON.stringify(capsules)}).length === 0`);
	await session("qa-long");
	await until(`document.querySelector('main textarea').value === '保留这份引用草稿' && document.querySelectorAll(${JSON.stringify(capsules)}).length === 2`);
	for (const theme of ["dark", "light"] satisfies Array<"dark" | "light">) {
		for (const width of [1280, 375]) {
			await appearance(theme, width);
			const bounds = await app.evaluate<{ width: number; shell: { left: number; right: number }; pills: Array<{ left: number; right: number; titleWidth: number; fullTitleWidth: number; overflow: string; icons: number[] }>; foreground: string; background: string }>(`(()=>{const shell=document.querySelector('main textarea').closest('.ly-composer'),r=shell.getBoundingClientRect(),pills=[...document.querySelectorAll(${JSON.stringify(capsules)})];return {width:innerWidth,shell:{left:r.left,right:r.right},pills:pills.map(p=>{const b=p.getBoundingClientRect(),s=p.querySelector('span');return {left:b.left,right:b.right,titleWidth:s.clientWidth,fullTitleWidth:s.scrollWidth,overflow:getComputedStyle(s).overflow,icons:[...p.querySelectorAll('svg')].map(icon=>icon.getBoundingClientRect().width)};}),foreground:getComputedStyle(pills[0]).color,background:getComputedStyle(pills[0]).backgroundColor};})()`);
			t.diagnostic(JSON.stringify({ theme, ...bounds }));
			assert.equal(bounds.pills.length, 2);
			assert.ok(bounds.shell.left >= 0 && bounds.shell.right <= width);
			for (const pill of bounds.pills) {
				assert.ok(pill.left >= bounds.shell.left && pill.right <= bounds.shell.right, JSON.stringify(bounds));
				assert.ok(pill.titleWidth > 0 && pill.fullTitleWidth > pill.titleWidth);
				assert.equal(pill.overflow, "hidden");
				assert.deepEqual(pill.icons, [12, 12], "long titles must not shrink the session or remove icon");
			}
			assert.notEqual(bounds.foreground, bounds.background);
			await shot(`reference-draft-${theme}-${width}`);
		}
	}
	await appearance("dark", 1280);
	await input("REFERENCE_SEND"); await enter();
	await until(`document.querySelectorAll('.ly-user-bubble [data-ly-tip="点击切换至该会话"]').length === 2 && !document.querySelector('button[aria-label="停止"]')`);
	const state = await snapshot("qa-long");
	const sent = state.messages.findLast((message) => message.role === "user");
	assert.ok(sent?.role === "user");
	assert.equal(sent.displayText, "REFERENCE_SEND");
	assert.deepEqual(sent.sessionRefs?.map((ref) => ref.id).sort(), ["qa-long", "qa-short"]);
	assert.deepEqual(sent.sessionRefs?.map((ref) => ref.title), [REFERENCE_TITLE, REFERENCE_TITLE]);
	assert.ok(requests.some((request) => { const raw = JSON.stringify(request); return raw.includes("session://qa-long") && raw.includes("session://qa-short"); }));
	assert.equal(await app.evaluate(`document.querySelectorAll(${JSON.stringify(capsules)}).length`), 0);
	await shot("reference-sent");
});

test("real ask_user returns choices and custom answers to their own pending sessions", async (t) => {
	await session("qa-long");
	const aBefore = (await snapshot("qa-long")).messages.filter((message) => message.role === "user").length;
	await input("ASK_OWNER"); await enter();
	await until(`document.querySelector('pre')?.textContent === '请选择本次实现方式' || [...document.querySelectorAll('pre')].some(e=>e.textContent==='请选择本次实现方式')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('input[aria-label="自定义回答"]').length`), 0);
	const aRequests = requests.length;
	await shot("question-options-dark");
	await session("qa-short");
	await until(`![...document.querySelectorAll('pre')].some(e=>e.textContent==='请选择本次实现方式')`);
	assert.equal(requests.length, aRequests, "switching sessions does not answer the pending tool");
	const bBefore = (await snapshot("qa-short")).messages.filter((message) => message.role === "user").length;
	await input("ASK_CUSTOM"); await enter();
	await until(`document.querySelector('input[aria-label="自定义回答"]')`);
	await appearance("light", 375);
	const question = await app.evaluate<{ left: number; right: number; width: number; inputs: number }>(`(()=>{const e=document.querySelector('input[aria-label="自定义回答"]').closest('.ly-glass'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,inputs:e.querySelectorAll('input').length};})()`);
	assert.ok(question.left >= 0 && question.right <= question.width); assert.equal(question.inputs, 1); t.diagnostic(JSON.stringify(question));
	await shot("question-custom-light-375");
	await appearance("dark", 1280); await session("qa-long");
	await until(`[...document.querySelectorAll('button')].some(e=>e.textContent==='更新实现')`);
	await app.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='更新实现').setAttribute('data-question-choice','')`);
	await click("[data-question-choice]");
	await session("qa-short");
	await until(`document.querySelector('input[aria-label="自定义回答"]')`);
	const custom = "先保留草稿，完成验证再更新。";
	await input(custom, 'input[aria-label="自定义回答"]');
	await click('input[aria-label="自定义回答"] + button');
	await until(`!document.querySelector('input[aria-label="自定义回答"]') && !document.querySelector('button[aria-label="停止"]')`);
	for (const [id, answer, count] of [["qa-long", "更新实现", aBefore], ["qa-short", custom, bBefore]] satisfies Array<[string, string, number]>) {
		const state = await snapshot(id);
		assert.equal(state.messages.filter((message) => message.role === "user").length, count + 1, "answering does not inject another user prompt");
		const result = state.messages.findLast((message) => message.role === "toolResult" && message.toolName === "ask_user");
		assert.ok(result?.role === "toolResult");
		assert.deepEqual(result.content, [{ type: "text", text: answer }]);
		assert.ok(requests.some((request) => { const tail = JSON.stringify(request.messages.slice(-3)); return tail.includes('"tool_result"') && tail.includes(answer); }));
	}
	await shot("question-answered");
});
