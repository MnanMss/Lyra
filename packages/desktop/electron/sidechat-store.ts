/** Atomic, ordered side-chat snapshots, separate from the main transcript. */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome, type Message } from "@lyra/core";

const writes = new Map<string, Promise<void>>();

function enqueue(path: string, write: () => Promise<void>): Promise<void> {
	const previous = writes.get(path) ?? Promise.resolve();
	const next = previous.catch(() => {}).then(write);
	writes.set(path, next);
	void next.finally(() => { if (writes.get(path) === next) writes.delete(path); }).catch(() => {});
	return next;
}

function dir(): string {
	return join(lyraHome(), "sidechats");
}

function fileFor(sessionId: string): string {
	// Snapshot reads are reachable over IPC before a live session is resolved.
	if (!sessionId || /[\\/\0:]/.test(sessionId)) throw new Error("Invalid side-chat session id");
	return join(dir(), `${sessionId}.json`);
}

/** What was said in this session's side chat last time, or an empty list. */
export async function loadSideChat(sessionId: string): Promise<Message[]> {
	const path = fileFor(sessionId);
	await writes.get(path);
	const raw = await readFile(path, "utf8").catch(() => null);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as { messages?: Message[] };
		return Array.isArray(parsed.messages) ? parsed.messages : [];
	} catch {
		// A truncated write from a crash. Losing this conversation is better than refusing to open
		// the panel because of it.
		return [];
	}
}

/**
 * Write it out.
 *
 * Write-then-rename, so a crash midway leaves the previous version rather than half of this one.
 */
export function saveSideChat(sessionId: string, messages: Message[]): Promise<void> {
	const path = fileFor(sessionId);
	// Serialize now, before the next message can mutate this array or any content blocks.
	const snapshot = messages.length > 0 ? JSON.stringify({ messages }) : null;
	return enqueue(path, async () => {
		if (snapshot === null) { await rm(path, { force: true }); return; }
		await mkdir(dir(), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, snapshot, "utf8");
		await rename(tmp, path);
	});
}

/** Reset joins the same queue so an earlier save cannot resurrect the conversation. */
export function clearSideChat(sessionId: string): Promise<void> {
	return saveSideChat(sessionId, []);
}
