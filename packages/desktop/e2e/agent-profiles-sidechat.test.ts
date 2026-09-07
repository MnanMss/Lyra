import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let port = 0;
const requests: { path: string; body: Record<string, unknown> }[] = [];
let savedProfiles: unknown;
let savedSide = "";
function anthropic(res: ServerResponse, text: string, tool?: { name: string; input: Record<string, unknown> }) {
	const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("message_start", { message: { id: "qa", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
	emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `call-${requests.length}`, name: tool.name, input: {} } : { type: "text", text: "" } });
	emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text } });
	emit("content_block_stop", { index: 0 });
	emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
	emit("message_stop", {}); res.end();
}
function responses(res: ServerResponse) {
	const item = { id: "answer", type: "message", role: "assistant", content: [{ type: "output_text", text: "SUBAGENT_DONE", annotations: [] }] };
	const emit = (type: string, data: object) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
	emit("response.created", { response: { id: "child", status: "in_progress" } });
	emit("response.output_item.added", { output_index: 0, item: { ...item, content: [] } });
	emit("response.output_text.delta", { output_index: 0, content_index: 0, delta: "SUBAGENT_DONE" });
	emit("response.output_item.done", { output_index: 0, item });
	emit("response.completed", { response: { id: "child", status: "completed", output: [item], usage: { input_tokens: 100, output_tokens: 20 } } }); res.end();
}
async function seed(home: string) {
	await seedInteractions(home, port);
	const path = join(home, "settings.json"); const settings = JSON.parse(await readFile(path, "utf8"));
	settings.providers[0].name = "主供应商";
	const model = { ...settings.providers[0].models[0], modelId: "gpt-5.6-sol", name: "同名模型", supportsThinking: true };
	settings.providers[0].models = [model];
	settings.providers.push({ ...settings.providers[0], id: "secondary", name: "第二供应商", api: "openai-responses", baseUrl: `http://127.0.0.1:${port}/secondary`, models: [{ ...model, providerId: "secondary", id: "secondary/model" }] });
	settings.thinking = "off";
	settings.projectMemory = false;
	if (savedProfiles) settings.subAgentProfiles = savedProfiles;
	await writeFile(path, JSON.stringify(settings));
	// Real session logs with controlled data, not a substituted renderer or screenshot mockup.
	const metas = JSON.parse(await readFile(join(home, "sessions", "index.json"), "utf8"));
	const meta = metas.find((entry: { id: string }) => entry.id === "qa-long");
	const log = join(home, "sessions", meta.projectId, "qa-long.jsonl");
	let raw = await readFile(log, "utf8");
	raw = raw.replace("qa-long 第 1 个问题：", "EARLY_MAIN_DECISION=使用索引作为基准。qa-long 第 1 个问题：");
	const longTool = { role: "toolResult", toolName: "read", toolCallId: "old-read", content: [{ type: "text", text: "long output ".repeat(6000) + "TOOL_TAIL_VALUE=末尾证据已保留" }], isError: false, timestamp: 3000 };
	raw += JSON.stringify({ type: "message", message: longTool, seq: 300, ts: 3000 }) + "\n";
	await writeFile(log, raw);
	await mkdir(join(home, "sidechats"), { recursive: true });
	const historical = { messages: [{ role: "user", synthetic: true, timestamp: 1, content: [{ type: "text", text: "Legacy hidden main snapshot" }] }, { role: "user", timestamp: 2, content: [{ type: "text", text: "以前的侧聊问题" }] }, { role: "assistant", timestamp: 3, api: "anthropic-messages", provider: "qa", model: "model", content: [{ type: "text", text: "以前的侧聊回答" }], usage: meta.usage, stopReason: "stop" }] };
	await writeFile(join(home, "sidechats", "qa-long.json"), savedSide || JSON.stringify(historical));
}
before(async () => {
	server = createServer((req, res) => {
		let raw = ""; req.on("data", (data) => { raw += data; });
		req.on("end", () => {
			const body = JSON.parse(raw); requests.push({ path: req.url ?? "", body });
			res.writeHead(200, { "content-type": "text/event-stream" });
			if (req.url?.startsWith("/secondary")) { responses(res); return; }
			const side = body.tools?.some((tool: { name: string }) => tool.name === "read_main_chat");
			const last = body.messages?.at(-1)?.content ?? [];
			const text = typeof last === "string" ? last : JSON.stringify(last);
			if (side) {
				if (text.includes('"tool_result"')) anthropic(res, text.includes("TOOL_TAIL_VALUE") ? "查到工具尾部：末尾证据已保留。" : text.includes("EARLY_MAIN_DECISION") ? "查到早期决策：使用索引作为基准。" : "查不到证据，测试应该失败。");
				else anthropic(res, "", { name: "read_main_chat", input: { query: text.includes("TOOL_TAIL_REQUEST") ? "TOOL_TAIL_VALUE" : "EARLY_MAIN_DECISION" } });
			} else if (body.tools?.some((tool: { name: string }) => tool.name === "task") && raw.includes("MAIN_DELEGATE") && !raw.includes("SUBAGENT_DONE")) anthropic(res, "", { name: "task", input: { description: "验证指定模型", prompt: "CHILD_MODEL_PROBE", subagent_type: "explore" } });
			else anthropic(res, "主任务完成，保留已验证的关键决策。");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string"); port = address.port;
	app = await startApp({ port: 9611, seed });
});

afterEach(async (t) => {
	if (!t.passed) {
		await shot("agent-side-failure");
		t.diagnostic(await app.evaluate<string>(`JSON.stringify({text:document.body.innerText.slice(-3000),fields:[...document.querySelectorAll('[data-dock-pane="chat"] textarea,[data-qa-target]')].map(e=>({value:e.value,text:e.textContent,rect:e.getBoundingClientRect().toJSON(),focused:e===document.activeElement})),scrolls:[...document.querySelectorAll('[data-dock-pane="chat"] .ly-scroll-view')].map(e=>({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight}))})`));
	}
});
after(async () => { await cleanupFixture(() => app?.stop(), () => closeListeningServer(server)); });
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=900;const tick=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(tick);else reject(new Error(${JSON.stringify(expression)}));};tick();})`);
}
async function frames(n = 15) { await app.evaluate(`new Promise(r=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):r();requestAnimationFrame(f);})`); }
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`); await frames(2);
	await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
	const at = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('Obscured: '+${JSON.stringify(selector)});return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) }); await frames(3);
}
async function label(text: string, scope = "button") {
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility()&&e.textContent.trim().startsWith(${JSON.stringify(text)}))`);
	await app.evaluate(`(()=>{document.querySelector('[data-qa-target]')?.removeAttribute('data-qa-target');[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&e.textContent.trim().startsWith(${JSON.stringify(text)})).setAttribute('data-qa-target','');})()`);
	await click("[data-qa-target]");
}
async function send(text: string, scope = '[data-dock-pane="chat"]') {
	const selector = `${scope} textarea`;
	await until(`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);
	await until(`!document.querySelector(${JSON.stringify(scope + ' [aria-label="停止"]')})`);
	await click(selector);
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}
async function openSide() {
	await click('button[aria-label="面板"]');
	await label("侧边聊天", '[role="menuitem"]');
	await until(`document.querySelector('[data-dock-pane="chat"] textarea')`);
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, name + ".png"), Buffer.from(result.data, "base64"));
}

test("provider and effort controls persist, align, and adapt to narrow settings", async (t) => {
	await click('[data-ly-row="qa-long"]');
	await click('button:has(svg.lucide-settings)'); await label("智能体", "nav button");
	await until(`document.querySelector('[data-agent-profile="explore"]')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('[aria-label="compact 思考等级"]').length`), 0);
	await click('[aria-label="compact 模型"]'); await click('[data-model="secondary/model"] [role="menuitem"]');
	await until(`document.querySelector('[aria-label="compact 模型"]').dataset.lyTip.includes('第二供应商')`);
	await click('[aria-label="explore 模型"]'); await click('[data-model="secondary/model"] [role="menuitem"]');
	await until(`document.querySelector('[aria-label="explore 模型"]').dataset.lyTip.includes('第二供应商')`);
	await click('[aria-label="explore 思考等级"]');
	await app.evaluate(`(()=>{const e=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.startsWith('极致'));if(!e)throw new Error('No ultra');e.setAttribute('data-effort-ultra','');})()`);
	await click('[data-effort-ultra]');
	await until(`document.querySelector('[aria-label="explore 思考等级"]').textContent.includes('极致')`);
	const saved = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8"));
	assert.deepEqual(saved.subAgentProfiles.explore, { modelId: "secondary/model", thinking: "ultra" });
	for (const width of [1280, 375]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false }); await frames(30);
		const boxes = await app.evaluate<{ x: number; right: number; y: number; height: number }[]>(`[...document.querySelectorAll('[data-agent-profile="explore"] fieldset > button')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,height:r.height};})`);
		t.diagnostic(JSON.stringify({ width, boxes })); assert.equal(boxes.length, 2);
		assert.ok(boxes.every((box) => box.x >= 0 && box.right <= width && box.height === 30));
		if (width === 1280) assert.equal(boxes[0].y, boxes[1].y);
		await shot(`agent-profiles-${width}`);
	}
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false }); await frames();
	await label("返回工作区", "nav button");
});

test("a dispatched subagent actually calls the selected provider with ultra reasoning", async (t) => {
	await send("MAIN_DELEGATE 派一个子智能体验证模型", '[data-dock-pane="conversation"]');
	await until(`document.body.innerText.includes('主任务完成')`);
	const child = requests.find((request) => request.path.startsWith("/secondary"));
	t.diagnostic(JSON.stringify(requests.map((request) => ({ path: request.path, model: request.body.model, reasoning: request.body.reasoning })))); assert.ok(child);
	assert.equal(child.body.model, "gpt-5.6-sol"); assert.deepEqual(child.body.reasoning, { effort: "ultra", summary: "auto" });
});

test("sidechat restores old answers, queries early history and full tool tails, then survives switching", async () => {
	await openSide();
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('以前的侧聊回答')`);
	assert.equal(await app.evaluate(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('Legacy hidden')`), false);
	await send("EARLY_REQUEST 主聊天最早的决策是什么？");
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('查到早期决策')`);
	await send("TOOL_TAIL_REQUEST 帮我查看工具输出的末尾。");
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('查到工具尾部')`);
	await click('[data-ly-row="qa-short"]'); await frames();
	assert.equal(await app.evaluate(`document.querySelector('[data-dock-pane="chat"]')?.innerText.includes('查到工具尾部') ?? false`), false);
	await click('[data-ly-row="qa-long"]');
	await until(`document.querySelector('[data-dock-pane="chat"]')?.innerText.includes('查到工具尾部')`);
	await shot("sidechat-main-history");
	savedSide = await readFile(join(app.home, "sidechats", "qa-long.json"), "utf8");
	assert.match(savedSide, /查到工具尾部/); assert.doesNotMatch(savedSide, /Legacy hidden/);
	savedProfiles = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")).subAgentProfiles;
});

test("@ agents are selectable and @compact executes real compaction with the configured model", async (t) => {
	const composer = '[data-dock-pane="conversation"] textarea';
	for (const name of ["fast", "deep"]) {
		await click(composer); await app.send("Input.insertText", { text: "@" + name });
		await until(`document.querySelector('[data-mention-kind="subagent"][aria-label^="${name}，"]')?.checkVisibility()`);
		await app.evaluate(`document.querySelector(${JSON.stringify(composer)}).select()`);
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", windowsVirtualKeyCode: 8 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", windowsVirtualKeyCode: 8 });
	}
	const start = requests.length;
	await click(composer); await app.send("Input.insertText", { text: "@compact" });
	await click('[data-mention-kind="action"][aria-label^="compact，"]');
	await app.send("Input.insertText", { text: "保留 EARLY_MAIN_DECISION" });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until(`document.querySelector('[data-command-status="done"]')?.innerText.includes('保留 EARLY_MAIN_DECISION')`);
	const compact = requests.slice(start).find(request => request.path.startsWith("/secondary"));
	assert.ok(compact); assert.match(JSON.stringify(compact.body), /保留 EARLY_MAIN_DECISION/);
	t.diagnostic(JSON.stringify({ command: "@compact", provider: compact.path }));
	const previous = await app.evaluate<number>(`document.querySelector('[data-dock-pane="chat"]').innerText.split('查到早期决策').length`);
	await send("EARLY_REQUEST 压缩后再次核对原始决策");
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.split('查到早期决策').length > ${previous}`);
	savedSide = await readFile(join(app.home, "sidechats", "qa-long.json"), "utf8");
	assert.match(savedSide, /压缩后再次核对原始决策/);
});

test("a fresh Electron process restores persisted answers and can edit the first visible question", async (t) => {
	await app.stop();
	// The harness removes its profile on exit. Replay the exact saved side file in a new isolated profile.
	app = await startApp({ port: 9611, seed });
	await click('[data-ly-row="qa-long"]'); await openSide();
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('查到工具尾部')`);
	const point = await app.evaluate<{x: number; y: number}>(`(()=>{const r=document.querySelector('[data-dock-pane="chat"] .ly-scroll-view').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: -2400 }); await frames(30);
	await click('[data-dock-pane="chat"] button[aria-label="编辑并重新提问"]');
	await until(`document.querySelector('[data-dock-pane="chat"] textarea')?.value.includes('以前的侧聊问题')`);
	await app.evaluate(`document.querySelector('[data-dock-pane="chat"] textarea').select()`);
	await app.send("Input.insertText", { text: "EARLY_REQUEST 编辑后查询早期决策" });
	t.diagnostic(await app.evaluate<string>(`JSON.stringify([...document.querySelectorAll('[data-dock-pane="chat"] textarea')].map(e=>({value:e.value,rect:e.getBoundingClientRect().toJSON(),focused:e===document.activeElement})))`));
	await label("重新提问");
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('查到早期决策')`);
	const state = await app.evaluate<{ messages: unknown[] }>(`window.lyra.sideChat.state('qa-long')`);
	assert.doesNotMatch(JSON.stringify(state.messages), /以前的侧聊问题|以前的侧聊回答|TOOL_TAIL_REQUEST/);
	assert.match(JSON.stringify(state.messages), /编辑后查询早期决策/);
	assert.deepEqual(await app.evaluate(`window.lyra.settings.get().then(s=>s.subAgentProfiles)`), savedProfiles);
	await shot("sidechat-restored-edit");
});

test("sidechat model selection and its default use their actual providers and survive restarting", async (t) => {
	await click('[aria-label="侧边聊天模型"]'); await click('[data-model="secondary/model"] [role="menuitem"]');
	await until(`document.querySelector('[aria-label="侧边聊天模型"]').dataset.lyTip?.includes('第二供应商')`);
	const start = requests.length;
	await send("SIDE_MODEL_PROBE 使用侧聊独立模型");
	await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('SUBAGENT_DONE')`);
	const actual = requests.slice(start).find(request => JSON.stringify(request.body).includes("SIDE_MODEL_PROBE"));
	assert.ok(actual); assert.ok(actual.path.startsWith("/secondary"));
	assert.equal(await app.evaluate(`window.lyra.sideChat.state('qa-long').then(s=>s.modelId)`), "secondary/model");
	await click('button:has(svg.lucide-settings)'); await label("智能体", "nav button");
	await click('[aria-label="侧边聊天默认模型"]'); await click('[data-model="secondary/model"] [role="menuitem"]');
	await until(`document.querySelector('[aria-label="侧边聊天默认模型"]').dataset.lyTip?.includes('第二供应商')`);
	const stored = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")); assert.equal(stored.sideChatModelId, "secondary/model");
	await label("返回工作区", "nav button");
	await click('[aria-label="新的侧边聊天"]');
	await until(`!document.querySelector('[data-dock-pane="chat"]').innerText.includes('SIDE_MODEL_PROBE')`);
	assert.deepEqual(await app.evaluate(`window.lyra.sideChat.state('qa-long').then(s=>({modelId:s.modelId,messages:s.messages}))`), { modelId: "secondary/model", messages: [] });
	await send("SIDE_AFTER_RESET"); await until(`document.querySelector('[data-dock-pane="chat"]').innerText.includes('SUBAGENT_DONE')`);
	savedSide = await readFile(join(app.home, "sidechats", "qa-long.json"), "utf8");
	await app.stop(); app = await startApp({ port: 9611, seed });
	await click('[data-ly-row="qa-long"]'); await openSide();
	await until(`document.querySelector('[aria-label="侧边聊天模型"]').dataset.lyTip?.includes('第二供应商')`);
	assert.match(await app.evaluate<string>(`document.querySelector('[data-dock-pane="chat"]').innerText`), /SIDE_AFTER_RESET/);
	t.diagnostic(JSON.stringify({ provider: actual.path, persistedModel: "secondary/model" }));
	await shot("sidechat-independent-model");
});
