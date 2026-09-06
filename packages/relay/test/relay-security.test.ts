import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const SERVER = new URL("../server.mjs", import.meta.url);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let nextPort = 48900 + (process.pid % 150) * 8;

async function relay(t: TestContext): Promise<number> {
	const port = nextPort++;
	const child: ChildProcess = spawn(process.execPath, [fileURLToPath(SERVER)], {
		env: { ...process.env, PORT: String(port) },
		stdio: "pipe",
	});
	t.after(() => { child.kill("SIGKILL"); });
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Relay did not start")), 10_000);
		child.once("error", (error) => { clearTimeout(timer); reject(error); });
		child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Relay exited (${code})`)); });
		child.stdout?.on("data", (chunk: Buffer) => {
			if (!chunk.toString().includes("listening")) return;
			clearTimeout(timer);
			resolve();
		});
	});
	return port;
}

async function desktop(t: TestContext, port: number, room: string, assetKey: string) {
	const socket = new WebSocket(`ws://127.0.0.1:${port}`);
	t.after(() => socket.terminate());
	const first = await new Promise<string>((resolve, reject) => {
		socket.once("error", reject);
		socket.once("open", () => socket.send(JSON.stringify({ type: "hello", role: "desktop", room, assetKey })));
		socket.once("message", (raw: Buffer) => resolve(raw.toString()));
	});
	return { socket, first };
}

test("an asset URL cannot be claimed from another room while its desktop is online", async (t) => {
	const port = await relay(t);
	const room = hash("owner-token");
	const assetKey = hash(`lyra-assets\0${room}`);
	const owner = await desktop(t, port, room, assetKey);
	assert.match(owner.first, /waiting/);
	const attacker = await desktop(t, port, hash("attacker-token"), assetKey);
	assert.match(attacker.first, /bad-hello/);

	const received = new Promise<Buffer>((resolve) => owner.socket.once("message", resolve));
	const response = fetch(`http://127.0.0.1:${port}/app/${assetKey}/`);
	const assetRequest: unknown = JSON.parse((await received).toString());
	assert.ok(assetRequest && typeof assetRequest === "object" && "id" in assetRequest);
	owner.socket.send(JSON.stringify({
		type: "asset_response", id: assetRequest.id, status: 200,
		contentType: "text/html", bodyBase64: Buffer.from("owner build").toString("base64"),
	}));
	assert.equal(await (await response).text(), "owner build");
});

test("an asset URL cannot be claimed before its desktop connects", async (t) => {
	const port = await relay(t);
	const assetKey = hash(`lyra-assets\0${hash("offline-owner-token")}`);
	const attacker = await desktop(t, port, hash("attacker-token"), assetKey);
	assert.match(attacker.first, /bad-hello/);
	assert.equal((await fetch(`http://127.0.0.1:${port}/app/${assetKey}/`)).status, 404);
});

async function status(port: number, path: string, host: string): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		const req = request({ hostname: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
			res.resume();
			res.once("end", () => resolve(res.statusCode));
		});
		req.once("error", reject);
		req.end();
	});
}

test("a malformed Host cannot terminate the HTTP relay", async (t) => {
	const port = await relay(t);
	assert.equal(await status(port, "/missing", "["), 404);
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test("a malformed request target is rejected without terminating the HTTP relay", async (t) => {
	const port = await relay(t);
	assert.equal(await status(port, "http://[", "localhost"), 400);
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});

test("an asset host cannot terminate the relay with an invalid response header", async (t) => {
	const port = await relay(t);
	const room = hash("header-host");
	const assetKey = hash(`lyra-assets\0${room}`);
	const owner = await desktop(t, port, room, assetKey);
	const received = new Promise<Buffer>((resolve) => owner.socket.once("message", resolve));
	const response = fetch(`http://127.0.0.1:${port}/app/${assetKey}/`);
	const assetRequest: unknown = JSON.parse((await received).toString());
	assert.ok(assetRequest && typeof assetRequest === "object" && "id" in assetRequest);
	owner.socket.send(JSON.stringify({
		type: "asset_response", id: assetRequest.id, status: 200,
		contentType: "text/plain\u0001", bodyBase64: Buffer.from("build").toString("base64"),
	}));
	assert.equal((await response).headers.get("content-type"), "application/octet-stream");
	assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
});
