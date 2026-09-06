import { execFile } from "node:child_process";
import { request } from "node:http";
import { promisify } from "node:util";
import { backgroundJobs } from "@lyra/core";
import type { ServiceEndpoint, SessionServices } from "../shared/session-services.ts";
import { descendants, localHost, parseLsof, parseProcesses, parseSs, parseWindowsListeners, serviceUrl, type ProcessEntry } from "./service-listeners.ts";
import { sessions } from "./session-hub.ts";

const exec = promisify(execFile);
async function command(file: string, args: string[]): Promise<string> {
	return (await exec(file, args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })).stdout;
}
async function listeners(): Promise<{ processes: ProcessEntry[]; listeners: ServiceEndpoint[] }> {
	if (process.platform === "win32") {
		const script = "$ErrorActionPreference='Stop'; $p=@(Get-CimInstance Win32_Process | ForEach-Object { @{pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId} }); $l=@(Get-NetTCPConnection -State Listen | ForEach-Object { @{pid=[int]$_.OwningProcess; address=$_.LocalAddress; port=[int]$_.LocalPort} }); @{processes=$p; listeners=$l} | ConvertTo-Json -Depth 4 -Compress";
		const value: unknown = JSON.parse(await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]));
		return parseWindowsListeners(value);
	}
	const [processes, sockets] = await Promise.all([
		command("ps", ["-axo", "pid=,ppid="]),
		process.platform === "darwin" ? command("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]) : command("ss", ["-H", "-ltnp"]),
	]);
	return { processes: parseProcesses(processes), listeners: process.platform === "darwin" ? parseLsof(sockets) : parseSs(sockets) };
}
async function httpUrl(endpoint: ServiceEndpoint): Promise<string | undefined> {
	const host = localHost(endpoint.address);
	const url = `http://${host.includes(":") ? `[${host}]` : host}:${endpoint.port}/`;
	return new Promise((resolve) => {
		const req = request(url, { method: "HEAD" }, (response) => { response.resume(); resolve(url); });
		const timer = setTimeout(() => req.destroy(), 700);
		req.once("close", () => { clearTimeout(timer); resolve(undefined); });
		req.once("error", () => resolve(undefined)); req.end();
	});
}
// One OS query at a time, shared across panels in a refresh cycle.
let pending: Promise<SessionServices> | undefined;
let pendingSession: string | undefined;
export async function listSessionServices(sessionId: string): Promise<SessionServices> {
	if (pending && pendingSession === sessionId) return pending;
	const task = collect(sessionId); pending = task; pendingSession = sessionId;
	try { return await task; } finally { if (pending === task) { pending = undefined; pendingSession = undefined; } }
}
async function collect(sessionId: string): Promise<SessionServices> {
	const session = sessions.get(sessionId);
	if (!session) return { jobs: [] };
	const jobs = backgroundJobs(session.can.state).list().slice(-30);
	const response: SessionServices = { jobs: jobs.map(({ output: _output, ...job }) => ({ ...job, endpoints: [] })) };
	if (!jobs.some((job) => job.pid && job.finishedAt === undefined)) return response;
	try {
		const snapshot = await listeners();
		for (const job of response.jobs) {
			if (!job.pid || job.finishedAt !== undefined) continue;
			const owned = descendants(job.pid, snapshot.processes);
			const output = jobs.find((entry) => entry.id === job.id)?.output ?? "";
			job.endpoints = await Promise.all(snapshot.listeners.filter((entry) => owned.has(entry.pid)).slice(0, 16).map(async (entry) => ({ ...entry, url: serviceUrl(entry, output) ?? await httpUrl(entry) })));
		}
	} catch (error) { response.discoveryError = error instanceof Error ? error.message : String(error); }
	return response;
}
export function stopSessionService(sessionId: string, id: string, force: boolean): boolean {
	const session = sessions.get(sessionId);
	if (!session) return false;
	return backgroundJobs(session.can.state).stop(id, force);
}
