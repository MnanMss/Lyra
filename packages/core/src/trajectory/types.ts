/**
 * One thing that happened, as the trajectory shows it.
 *
 * The session log is written for machines: append-only records keyed by sequence, some of which
 * carry three separate things at once (a reply with thinking, text and two tool calls is one
 * record). A trajectory is the same stream read for a person — one entry per thing that happened,
 * each labelled with where it came from.
 *
 * `seq` is the record it came from, so an entry can always be traced back, and several entries
 * sharing a `seq` is normal and meaningful: they arrived together.
 */

import type { ImageContent, Usage } from "../types/message.ts";

export type Source =
	/** The instructions the model was given. */
	| "system"
	/** What was injected around the messages for this turn: tools, skills. */
	| "context"
	| "user"
	/** The model's reasoning, when it exposes any. */
	| "thinking"
	| "assistant"
	| "tool-call"
	| "tool-result"
	/** A nested agent being dispatched, and what it reported back. */
	| "subagent"
	/** History being summarised to fit the window. */
	| "compaction"
	| "request"
	| "lifecycle"
	| "notice"
	| "approval";

export interface Entry {
	/** Stable across filtering, appends and lifecycle updates. */
	id?: string;
	/** The log record this came from. Not unique: one record can produce several entries. */
	seq: number;
	ts: number;
	source: Source;
	/** One line, for the list. */
	summary: string;
	/** Everything, for the detail pane. */
	detail: string;
	/** Ties a tool result back to its call, and a sub-agent's answer to its dispatch. */
	correlationId?: string;
	/**
	 * The shell command this entry is about, when it is about one.
	 *
	 * Carried separately from `detail` because a command is the thing you look for first when a
	 * step did something unexpected, and finding it inside a JSON string — escaped, on one line,
	 * among other arguments — is reading around the syntax rather than reading the command.
	 */
	command?: string;
	turn?: number;
	step?: number;
	parentId?: string;
	status?: "running" | "done" | "error" | "cancelled" | "skipped" | "interrupted";
	startedAt?: number;
	finishedAt?: number;
	durationMs?: number;
	ttftMs?: number;
	decodeMs?: number;
	usage?: Usage;
	provider?: string;
	model?: string;
	toolName?: string;
	input?: string;
	output?: string;
	/** Structured tool metadata, such as exit code and full-output artifact location. */
	metadata?: unknown;
	images?: ImageContent[];
	/** Sequence of the paired request, call, result or delegated dispatch. */
	linkedSeqs?: number[];
}

/** Replaces the list on reset; otherwise replaces matching keys and appends newly seen entries. */
export interface TrajectoryChanges {
	cursor: string;
	reset: boolean;
	upserts: Entry[];
	removals: string[];
}

/** Shown as filter chips, in the order a turn actually happens. */
export const SOURCE_ORDER: Source[] = [
	"system",
	"context",
	"user",
	"thinking",
	"assistant",
	"tool-call",
	"tool-result",
	"subagent",
	"compaction",
	"request",
	"lifecycle",
	"notice",
	"approval",
];

export const SOURCE_LABEL: Record<Source, string> = {
	system: "系统提示词",
	context: "上下文注入",
	user: "用户消息",
	thinking: "思维链",
	assistant: "模型回复",
	"tool-call": "工具调用",
	"tool-result": "工具结果",
	subagent: "子 Agent",
	compaction: "上下文压缩",
	request: "模型请求",
	lifecycle: "执行状态",
	notice: "诊断与重试",
	approval: "审批",
};

export const STATUS_LABEL: Record<NonNullable<Entry["status"]>, string> = {
	running: "进行中", done: "完成", error: "失败", cancelled: "已取消", skipped: "已跳过", interrupted: "未记录完成",
};

export function entryKey(entry: Entry): string {
	return entry.id ?? `${entry.seq}:${entry.source}:${entry.correlationId ?? ""}`;
}
