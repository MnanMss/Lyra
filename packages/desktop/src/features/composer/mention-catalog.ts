import type { SessionMeta } from "@lyra/core";
import type { SkillEntry } from "../../../electron/ipc-types.ts";

export type MentionKind = "action" | "file" | "subagent" | "plugin" | "session";

export interface MentionItem {
	id: string;
	title: string;
	description?: string;
	kind: MentionKind;
	origin?: string;
	/** Extra data associated with the item, e.g. filePath, sessionId, subagent name */
	data?: {
		path?: string;
		sessionId?: string;
		subagentId?: string;
		pluginId?: string;
		skillId?: string;
	};
}

export interface MentionCompletion {
	term: string;
	start: number;
	end: number;
}

/**
 * Detect mention trigger `@term` at the current caret.
 * Requires `@` to be at start of text or preceded by whitespace.
 */
export function parseMentionTrigger(text: string, start: number, end: number): MentionCompletion | null {
	if (start !== end) return null;
	const match = /(?:^|\s)@([^\s]*)$/.exec(text.slice(0, start));
	if (!match) return null;
	const term = match[1];
	// Position of '@' is at (start - term.length - 1)
	const triggerStart = start - term.length - 1;
	return {
		term,
		start: triggerStart,
		end,
	};
}

/**
 * Find all mentions currently present in composer text.
 * Matches `@token` patterns that are bounded by whitespace or start/end of line.
 */
export function findMentionRanges(text: string): Array<{ start: number; end: number; text: string; inner: string }> {
	const ranges: Array<{ start: number; end: number; text: string; inner: string }> = [];
	// Support both @"quoted title" / @'quoted title' and @unquoted_token
	const regex = /(?:^|\s)(@(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|[^\s]+))/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const full = match[0];
		const token = match[1];
		const inner = match[2] !== undefined ? match[2].replace(/\\(["\\])/g, "$1") : match[3] ?? token.slice(1);
		const tokenStart = match.index + (full.length - token.length);
		ranges.push({
			start: tokenStart,
			end: tokenStart + token.length,
			text: token,
			inner,
		});
	}
	return ranges;
}

/** Quoting preserves spaces and quotes while keeping raw Windows paths readable. */
export function formatMention(path: string): string {
	return `@"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Rank and filter mention candidates based on search term */
export function rankMentions(
	term: string,
	options: {
		files?: string[];
		agents?: Array<{ id: string; name: string; description: string }>;
		sessions?: SessionMeta[];
		skills?: SkillEntry[];
		allowAction?: boolean;
	},
): MentionItem[] {
	const lower = term.toLowerCase().trim();
	const items: MentionItem[] = [];

	// Action entry: Pick file / folder
	if (options.allowAction && (!lower || "文件".includes(lower) || "文件夹".includes(lower) || "file".includes(lower) || "folder".includes(lower))) {
		items.push({
			id: "action:pick-file",
			title: "选择文件",
			kind: "action",
		});
		items.push({ id: "action:pick-directory", title: "选择文件夹", kind: "action" });
	}

	if (options.allowAction && (!lower || "compact".includes(lower) || "压缩上下文".includes(lower))) {
		items.push({ id: "action:compact", title: "compact", description: "压缩上下文", kind: "action" });
	}

	// Subagents
	for (const sub of options.agents ?? []) {
		if (!lower || sub.name.toLowerCase().includes(lower) || sub.description.toLowerCase().includes(lower)) {
			items.push({
				id: `subagent:${sub.id}`,
				title: sub.name,
				description: sub.description,
				kind: "subagent",
				data: { subagentId: sub.id },
				origin: "智能体",
			});
		}
	}

	// Plugins / Skills
	if (options.skills) {
		for (const skill of options.skills) {
			const fullName = skill.pluginId ? `${skill.pluginId}:${skill.name}` : skill.name;
			if (!lower || fullName.toLowerCase().includes(lower) || skill.description?.toLowerCase().includes(lower)) {
				items.push({
					id: `skill:${fullName}`,
					title: fullName,
					description: skill.description || "插件技能扩展",
					kind: "plugin",
					data: { skillId: skill.name, pluginId: skill.pluginId },
					origin: skill.pluginId ?? (skill.source === "workspace" ? "项目" : "内置"),
				});
			}
		}
	}

	// Sessions
	if (options.sessions) {
		for (const s of options.sessions) {
			const title = s.title || "未命名会话";
			if (!lower || title.toLowerCase().includes(lower) || s.id.toLowerCase().includes(lower)) {
				items.push({
					id: `session:${s.id}`,
					title,
					description: [s.projectName, s.updatedAt ? new Date(s.updatedAt).toLocaleDateString("zh-CN") : ""].filter(Boolean).join(" · "),
					kind: "session",
					data: { sessionId: s.id },
					origin: "历史会话",
				});
			}
		}
	}

	// Project files / directories
	if (options.files) {
		for (const path of options.files) {
			if (!lower || path.toLowerCase().includes(lower)) {
				items.push({
					id: `file:${path}`,
					title: path,
					description: "项目路径",
					kind: "file",
					data: { path },
					origin: "工作区",
				});
			}
		}
	}

	return items;
}
