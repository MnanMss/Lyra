/** Real Electron regression checks with isolated settings and synthetic session usage logs. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
const shots = "/tmp/lyra-model-defaults-e2e";
const legacy = (modelId: string): ModelConfig => ({
	id: `relay/${modelId}`, providerId: "relay", modelId, name: modelId,
	contextWindow: 200000, maxOutputTokens: 16384, supportsThinking: true, supportsImages: true, supportsTools: true,
});

before(async () => {
	app = await startApp({ port: 9648, seed: async (home) => {
		await mkdir(join(home, "project"), { recursive: true });
		await mkdir(join(home, "sessions", "fixture"), { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 1100, x: 0, y: 0 }));
		const settings: Settings = {
			...DEFAULT_SETTINGS, uiLocale: "zh-CN", disabledPlugins: ["*"],
			appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light", reduceMotion: "on" },
			providers: [{ id: "relay", name: "Relay", baseUrl: "https://relay.example/v1", api: "openai-responses", apiKey: "", enabled: true,
				models: [legacy("gemini-3.7-flash-high"), legacy("deepseek-v4-flash:0731"), legacy("gemini-pro-agent")] }],
			defaultModelId: "relay/gemini-3.7-flash-high",
			projects: [{ id: "project", name: "目录验证", path: join(home, "project"), pinned: true, lastOpenedAt: 1 }],
		};
		await writeFile(join(home, "settings.json"), JSON.stringify(settings));
		const timestamp = Date.now();
		const message = { role: "assistant", timestamp, provider: "relay", model: "gpt-5.2-high", api: "openai-responses", content: [{ type: "text", text: "Synthetic usage fixture" }], stopReason: "stop",
			usage: { input: 1000000, output: 0, cacheRead: 1000000, cacheWrite: 0, total: 2000000, cost: { total: 0 } } };
		await writeFile(join(home, "sessions", "fixture", "history.jsonl"), `${JSON.stringify({ seq: 1, ts: timestamp, type: "message", message })}\n`);
	} });
});
after(async () => { await app?.stop(); });
afterEach(async (t) => {
	if (!t.passed && app) {
		await shot("failure");
		t.diagnostic(await app.evaluate<string>("document.body.innerText.slice(-5000)"));
	}
});

async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+15000;const step=()=>{if(${expression})resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error(${JSON.stringify(expression)}));};step();})`);
}

async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	// Portal placement is measured after mount; hit-test only once the painted rectangle settles.
	await app.evaluate(`new Promise((resolve,reject)=>{let previous='',stable=0;const end=Date.now()+5000;const step=()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return reject(new Error('Target disappeared'));const r=e.getBoundingClientRect(),current=[r.x,r.y,r.width,r.height].join(',');stable=current===previous?stable+1:0;previous=current;if(stable>=3)resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error('Target kept moving'));};requestAnimationFrame(step);})`);
	await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}

async function label(text: string, scope = "button") {
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)})`);
	await app.evaluate(`(()=>{document.querySelector('[data-model-qa]')?.removeAttribute('data-model-qa');[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)}).setAttribute('data-model-qa','');})()`);
	await click("[data-model-qa]");
}

async function input(selector: string, value: string) {
	await click(selector);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2, windowsVirtualKeyCode: 65 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
	await app.send("Input.insertText", { text: value });
}

async function shot(name: string) {
	await mkdir(shots, { recursive: true });
	const capture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(shots, `${name}.png`), Buffer.from(capture.data, "base64"));
}

async function editor(modelId: string) {
	await label("模型设置", "nav button");
	await until(`document.querySelector('[aria-label="编辑模型"]')`);
	await app.evaluate(`(()=>{document.querySelector('[data-edit-qa]')?.removeAttribute('data-edit-qa');const row=[...document.querySelectorAll('[class~="group/row"]')].find(e=>e.textContent.includes(${JSON.stringify(modelId)}));row.querySelector('[aria-label="编辑模型"]').setAttribute('data-edit-qa','');})()`);
	await click("[data-edit-qa]");
	await until(`document.querySelector('[data-ly-modal] input')?.value===${JSON.stringify(modelId)}`);
}

const readFields = `(()=>{const modal=document.querySelector('[data-ly-modal]');const read=t=>[...modal.querySelectorAll('label')].find(e=>e.textContent.startsWith(t)).querySelector('input').value;return {id:read('模型 ID'),context:read('上下文窗口'),output:read('最大输出'),input:read('输入价格'),priceOut:read('输出价格'),cache:read('缓存命中价格'),toggles:[...modal.querySelectorAll('[role="switch"]')].map(e=>e.getAttribute('aria-checked')),text:modal.innerText};})()`;

test("all five built-in agents can be configured before any session is created", async (t) => {
	await click(".ly-sidebar-foot button");
	await label("子智能体", "nav button");
	await until(`document.querySelectorAll('[data-agent-profile]').length===5`);
	const visible = await app.evaluate<{ names: string[]; controls: number; overflow: number }>(`({names:[...document.querySelectorAll('[data-agent-profile]')].map(e=>e.getAttribute('data-agent-profile')),controls:document.querySelectorAll('[data-agent-profile] fieldset').length,overflow:document.documentElement.scrollWidth-window.innerWidth})`);
	assert.deepEqual(visible.names, ["general", "explore", "review", "verify", "plan"]);
	assert.equal(visible.controls, 5); assert.equal(visible.overflow, 0);
	await click('[aria-label="explore 模型"]');
	await until(`document.querySelector('[data-model="relay/gemini-3.7-flash-high"] button')`);
	await click('[data-model="relay/gemini-3.7-flash-high"] button');
	await until(`document.querySelector('[aria-label="explore 模型"]').textContent.includes('gemini-3.7-flash-high')`);
	const saved = await app.evaluate<Settings>("window.lyra.settings.get()");
	assert.equal(saved.subAgentProfiles?.explore.modelId, "relay/gemini-3.7-flash-high");
	await label("返回工作区");
	await label("新对话");
	await click(".ly-sidebar-foot button");
	await label("子智能体", "nav button");
	await until(`document.querySelectorAll('[data-agent-profile]').length===5`);
	await until(`document.querySelector('[aria-label="explore 模型"]').textContent.includes('gemini-3.7-flash-high')`);
	t.diagnostic(JSON.stringify(visible)); await shot("builtin-agents");
});

test("old relay imports show real prices, limits and text-only model capabilities", async (t) => {
	await editor("gemini-3.7-flash-high");
	const values = await app.evaluate<{ id: string; context: string; output: string; input: string; priceOut: string; cache: string; text: string }>(readFields);
	assert.equal(values.id, "gemini-3.7-flash-high"); assert.equal(values.context, "1048576"); assert.equal(values.output, "65536");
	assert.equal(values.input, "0.75"); assert.equal(values.priceOut, "3.75"); assert.equal(values.cache, "0.075");
	assert.match(values.text, /参考估算/); t.diagnostic(JSON.stringify(values)); await shot("relay-model-prices");
	await label("取消"); await until(`!document.querySelector('[data-ly-modal]')`);
	await editor("deepseek-v4-flash:0731");
	await until(`document.querySelector('[data-ly-modal]')?.innerText.includes('deepseek-v4-flash')`);
	const images = await app.evaluate<string>(`[...document.querySelectorAll('[data-ly-modal] label')].find(e=>e.textContent.startsWith('支持图片输入')).querySelector('[role="switch"]').getAttribute('aria-checked')`);
	assert.equal(images, "false");
	await app.evaluate(`document.querySelector('[data-ly-modal] [role="switch"]').scrollIntoView({block:'center',behavior:'instant'})`);
	await shot("text-only-capabilities");
	await label("取消"); await until(`!document.querySelector('[data-ly-modal]')`);
});

test("an unknown alias has no fake prices and can be bound without rewriting the request id", async () => {
	await editor("gemini-pro-agent");
	const initial = await app.evaluate<{ input: string; text: string }>(readFields);
	assert.equal(initial.input, ""); assert.match(initial.text, /尚未识别上游模型/);
	await input('[aria-label="搜索模型目录"]', "google gemini-2.5-pro");
	await until(`document.querySelector('[aria-label="模型目录搜索结果"] button')`);
	await app.evaluate(`(()=>{const e=[...document.querySelectorAll('[aria-label="模型目录搜索结果"] button')].find(e=>e.querySelector('span').textContent==='gemini-2.5-pro'&&e.textContent.includes('Google'));e.setAttribute('data-bind-qa','');})()`);
	await click("[data-bind-qa]");
	await until(`document.querySelector('[data-ly-modal]')?.innerText.includes('google')||document.querySelector('[data-ly-modal]')?.innerText.includes('Google')`);
	const fields = await app.evaluate<{ id: string; input: string }>(readFields);
	assert.equal(fields.id, "gemini-pro-agent"); assert.equal(fields.input, "1.25");
	await label("保存"); await until(`!document.querySelector('[data-ly-modal]')`);
	const saved = await app.evaluate<Settings>("window.lyra.settings.get()");
	const bound = saved.providers[0].models.find((model) => model.modelId === "gemini-pro-agent");
	assert.deepEqual(bound?.catalogRef, { providerId: "google", modelId: "gemini-2.5-pro" });
	assert.equal(bound?.pricing?.input, 1.25);
});

test("historical relay usage produces a nonzero bill and catalogue coverage", async (t) => {
	await label("使用统计", "nav button");
	await until(`document.querySelector('[data-usage-dashboard="true"]')`);
	const visible = await app.evaluate<string>(`document.querySelector('[data-usage-dashboard="true"]').innerText`);
	assert.match(visible, /\$1\.93/); assert.match(visible, /离线目录\s*100\.0%/);
	assert.doesNotMatch(visible, /暂无价格/);
	t.diagnostic(visible); await shot("relay-history-cost");
});
