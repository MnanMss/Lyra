import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { lyraHome } from "../session/store.ts";
import type { ToolContext } from "../types.ts";

export interface RecordedChange { id: string; path: string; before: string | null; after: string | null; source?: "tool" | "command"; timestamp: number }
function directory(sessionId: string): string { return join(lyraHome(), "changes", createHash("sha256").update(sessionId).digest("hex")); }
export async function recordFileChange(ctx: ToolContext, path: string, before: string | null, after: string | null, source: "tool" | "command" = "tool"): Promise<string | undefined> {
	// Bare tool hosts have no persistent session artifacts.
	if (!ctx.scratchDir) return undefined;
	const id = randomUUID();
	await mkdir(directory(ctx.sessionId), { recursive: true });
	await writeFile(join(directory(ctx.sessionId), `${id}.json`), JSON.stringify({ id, path, before, after, source, timestamp: Date.now() } satisfies RecordedChange), { flag: "wx", mode: 0o600 });
	return id;
}
export async function readFileChange(sessionId: string, id: string): Promise<RecordedChange> {
	if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("无效的变更记录");
	const value: unknown = JSON.parse(await readFile(join(directory(sessionId), `${id}.json`), "utf8"));
	if (!value || typeof value !== "object" || !("id" in value) || value.id !== id || !("path" in value) || typeof value.path !== "string" || !("before" in value) || (value.before !== null && typeof value.before !== "string") || !("after" in value) || (value.after !== null && typeof value.after !== "string") || !("timestamp" in value) || typeof value.timestamp !== "number") throw new Error("变更记录已损坏");
	return { id, path: value.path, before: value.before, after: value.after, source: "source" in value && value.source === "command" ? "command" : "tool", timestamp: value.timestamp };
}
export async function undoFileChanges(cwd: string, changes: RecordedChange[]): Promise<void> {
	if (!changes.length) throw new Error("没有可撤销的变更");
	const first = changes[0], last = changes[changes.length - 1];
	if (changes.some((change) => change.source === "command")) throw new Error("命令执行期间观测到的变更需要手动审阅，不能归因后自动撤销");
	if (!changes.every((change, index) => change.path === first.path && (!index || change.before === changes[index - 1].after))) throw new Error("文件在本轮操作之间存在其他修改，不能自动撤销");
	const root = await realpath(cwd), path = await realpath(first.path);
	const rel = relative(root, path);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || (await lstat(first.path)).isSymbolicLink()) throw new Error("只能撤销当前项目内的普通文件");
	if (await readFile(path, "utf8") !== last.after) throw new Error("文件已有后续修改，已保留；请在差异视图中手动处理");
	if (first.before === null) await unlink(path); else await writeFile(path, first.before, "utf8");
}
