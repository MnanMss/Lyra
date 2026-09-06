import { useEffect, useId, useMemo, useState } from "react";
import type { SessionMeta } from "@lyra/core";
import type { SkillEntry } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import {
	findMentionRanges,
	parseMentionTrigger,
	rankMentions,
	type MentionCompletion,
	type MentionItem,
} from "./mention-catalog.ts";

export function useMention(
	text: string,
	cwd: string,
	field: React.RefObject<HTMLTextAreaElement | null>,
	setText: (text: string) => void,
	onPickAction?: (actionId: string, completion: MentionCompletion) => void,
) {
	const [active, setActive] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const [selection, setSelection] = useState({ text, start: text.length, end: text.length });
	const [focused, setFocused] = useState(false);
	const id = useId();

	const [skills, setSkills] = useState<SkillEntry[]>([]);
	const [sessions, setSessions] = useState<SessionMeta[]>([]);
	const [chosenSessions, setChosenSessions] = useState<Map<string, string>>(() => new Map());
	const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

	const nonce = useApp((state) => state.extensionsNonce);

	// Detect @ completion trigger
	const completion = parseMentionTrigger(
		text,
		selection.text === text ? selection.start : text.length,
		selection.text === text ? selection.end : text.length,
	);
	const mentionMode = completion !== null;

	// Load candidates (skills, sessions, workspace files)
	useEffect(() => {
		if (!mentionMode) return;
		let alive = true;

		// Fetch skills & plugins
		void bridge.commands.list(cwd).then((result) => {
			if (alive && result.skills) setSkills(result.skills);
		}).catch(() => {});

		// Fetch sessions
		void bridge.sessions.list().then((list) => {
			if (alive) setSessions(list);
		}).catch(() => {});

		// Fetch top-level / sub directory files from workspace
		if (cwd) {
			void bridge.files.list(cwd).then((entries) => {
				if (alive) {
					setWorkspaceFiles(entries.map((e) => e.isDirectory ? `${e.name}/` : e.name));
				}
			}).catch(() => {});
		}

		return () => {
			alive = false;
		};
	}, [cwd, nonce, mentionMode]);

	const term = completion?.term ?? null;

	const matches = useMemo(() => {
		if (term === null || dismissed || !focused) return [];
		return rankMentions(term, {
			files: workspaceFiles,
			sessions,
			skills,
			allowAction: true,
		});
	}, [term, dismissed, focused, workspaceFiles, sessions, skills]);

	useEffect(() => {
		setActive(0);
	}, [term, cwd]);

	const current = Math.min(active, Math.max(0, matches.length - 1));

	function select() {
		const el = field.current;
		if (el) setSelection({ text: el.value, start: el.selectionStart, end: el.selectionEnd });
	}

	function insertMentionText(tokenText: string) {
		const el = field.current;
		if (!completion || !el) return;
		el.focus();
		el.setSelectionRange(completion.start, completion.end);
		const trailingSpace = /\s/.test(text[completion.end] ?? "") ? "" : " ";
		document.execCommand("insertText", false, `${tokenText}${trailingSpace}`);
		setText(el.value);
		select();
		setDismissed(true);
	}

	function pick(item: MentionItem) {
		if (!completion) return;

		if (item.kind === "action") {
			onPickAction?.(item.id, completion);
			setDismissed(true);
			return;
		}

		let token = "";
		if (item.kind === "subagent" || item.kind === "plugin") {
			token = `@${item.title}`;
		} else if (item.kind === "session") {
			// Show human-readable title without exposing session UUID to user.
			// Wrap in quotes if title contains whitespace or punctuation that could break token boundaries.
			const formattedTitle = /[\s`"'()[\]{}]/.test(item.title) ? `@"${item.title}"` : `@${item.title}`;
			token = formattedTitle;
			if (item.data?.sessionId) {
				setChosenSessions((prev) => new Map(prev).set(item.title, item.data!.sessionId!));
			}
		} else if (item.kind === "file") {
			token = item.title.includes(" ") ? `@"${item.title}"` : `@${item.title}`;
		} else {
			token = `@${item.title}`;
		}

		insertMentionText(token);
	}

	// Decoration ranges for all mentions in the text
	const mentionDecorations = useMemo(() => {
		return findMentionRanges(text).map((r) => ({
			start: r.start,
			end: r.end,
		}));
	}, [text]);

	return {
		id,
		matches,
		term: term ?? "",
		active: current,
		setActive,
		pick,
		insertMentionText,
		mentionDecorations,
		completion,
		chosenSessions,
		sessions,
		change(next: string) {
			setText(next);
			setDismissed(false);
		},
		select,
		focus() {
			setFocused(true);
			select();
		},
		blur() {
			setFocused(false);
		},
		keyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
			if (!matches.length || event.nativeEvent.isComposing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
				return false;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setActive((current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
				return true;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const chosen = matches[current];
				if (chosen) pick(chosen);
				return true;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setDismissed(true);
				return true;
			}
			return false;
		},
	};
}
