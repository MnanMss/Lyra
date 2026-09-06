import type { UserContent } from "@lyra/core";
// Through the browser-safe door: the main barrel reaches the filesystem, and this runs in a page.
import { expandCommand, parseInvocation, parseSkillMention, resolveCommand, skillNameOf } from "@lyra/core/commands-view";
import { Camera, CircleAlert, Folder, GitBranch, MessageSquare, Plus, X } from "lucide-react";
import { openFromEvent } from "../image/index.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangeBar } from "../git/index.ts";
import { CommandMenu } from "./CommandMenu.tsx";
import { MentionMenu } from "./MentionMenu.tsx";
import { useMention } from "./useMention.ts";
import { findMentionRanges, type MentionCompletion } from "./mention-catalog.ts";
import type { ComposerDecorations } from "./CommandText.tsx";
import { useCommands } from "./useCommands.ts";
import { commandEntries, skillCommandName } from "./command-catalog.ts";
import { ComposerSend, ComposerShell } from "./ComposerShell.tsx";
import { SubAgentBar } from "../subagents/index.ts";
import { ForeignConfigNotice } from "./ForeignConfigNotice.tsx";
import { useDock } from "../dock/index.ts";
import { companionOf } from "../dock/index.ts";
import { ContextMeter } from "./ContextMeter.tsx";
import { EffortMenu, effortLabel } from "../models/index.ts";
import { ModelIcon } from "../models/index.ts";
import { RollingText, useRolled } from "../../ui/motion/RollingText.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { ModelMenu, formatWindow } from "../models/index.ts";
import { modelIdentity, modelTooltip } from "../../lib/model-grouping.ts";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { BranchMenu } from "../modals/index.ts";
import { PermissionPicker } from "../modals/index.ts";
import { ProjectPicker } from "../modals/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { findModel } from "../models/index.ts";
import { fileKind, isReadableAsText, KIND_LABEL, looksBinary, type FileKind } from "./attachments/file-kind.ts";
import { FileKindIcon } from "./attachments/FileKindIcon.tsx";
import { useApp } from "../../store/index.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import { bridge } from "../../services/index.ts";

const PERMISSION_LABEL: Record<string, string> = {
	ask: "请求批准",
	auto: "帮我批准",
	full: "完全访问",
};

interface Attachment {
	id: string;
	name: string;
	mimeType: string;
	/** What it is, for the icon and for whether its bytes may enter the prompt. */
	kind?: FileKind;
	data?: string;
	text?: string;
	isText: boolean;
}

export function Composer() {
	const workspace = useApp((s) => s.workspace);
	const scratchCwd = useApp((s) => s.scratchCwd);
	const settings = useApp((s) => s.settings);
	const meta = useApp((s) => s.meta);
	const messages = useApp((s) => s.messages);
	const running = useApp((s) => s.running);
	const activeSessionId = useApp((s) => s.activeSessionId);
	// "底部面板" in Settings → 常规. Saved but read by nothing until now.
	const showBottomPanel = useApp((s) => s.settings?.editor.showBottomPanel) ?? true;
	const switchingBranch = useApp((s) => s.switchingBranch);
	const send = useApp((s) => s.send);
	const abort = useApp((s) => s.abort);
	const { compact } = useLayout();

	const draftKey = activeSessionId
		? activeSessionId
		: workspace
			? `new:project:${workspace.path}`
			: `new:scratch:${scratchCwd ?? "general"}`;

	const savedDraft = useApp((s) => s.drafts[draftKey]);
	const setDraft = useApp((s) => s.setDraft);

	const [text, setText] = useState(() => savedDraft?.text ?? "");
	const [attachments, setAttachments] = useState<Attachment[]>(() => (savedDraft?.attachments as Attachment[]) ?? []);

	// Keep a ref of current text and attachments so we can sync them to store on unmount or key change.
	const textRef = useRef(text);
	textRef.current = text;
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const draftKeyRef = useRef(draftKey);

	/*
	 * Sync local input state whenever the target session/blank draft key switches.
	 */
	useEffect(() => {
		const prevKey = draftKeyRef.current;
		if (prevKey !== draftKey) {
			// Save draft for the key we are leaving.
			setDraft(prevKey, { text: textRef.current, attachments: attachmentsRef.current });
			draftKeyRef.current = draftKey;

			// Restore draft for the key we just moved to.
			const nextDraft = useApp.getState().drafts[draftKey];
			setText(nextDraft?.text ?? "");
			setAttachments((nextDraft?.attachments as Attachment[]) ?? []);
		}
	}, [draftKey, setDraft]);

	/*
	 * Persist changes to current draft in the store so switching away (or remounting) preserves it.
	 */
	useEffect(() => {
		setDraft(draftKey, { text, attachments });
	}, [text, attachments, draftKey, setDraft]);

	/*
	 * Text left here by something outside the composer — opening a review, so far.
	 *
	 * Taken and cleared, so it lands once and is then the user's to edit or discard. Appended
	 * rather than replacing anything already typed: whatever is in the field was typed by hand and
	 * losing it would be worse than an awkward join.
	 */
	const draft = useApp((s) => s.composerDraft);
	const field = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (!draft.text) return;
		setText((current) =>
			draft.replace || !current.trim() ? draft.text : `${current.trimEnd()}\n\n${draft.text}`,
		);
		useApp.getState().setComposerDraft("");
		/*
		 * And put the caret in it.
		 *
		 * What arrives this way is a starting point rather than a finished message — a suggestion
		 * card, a review to describe — so the next thing anybody does is edit it. Landing the text
		 * without the focus makes that a click they have to find first. At the end, not selected:
		 * this is a draft to add to, not one to type over.
		 */
		const el = field.current;
		if (el) {
			el.focus();
			el.setSelectionRange(el.value.length, el.value.length);
		}
	}, [draft]);


	const commandCwd = workspace?.path ?? scratchCwd ?? "";
	const slash = useCommands(text, commandCwd, field, setText);
	const mentionRef = useRef<{ insertMentionText: (text: string) => void } | null>(null);
	const pickFileForMention = useCallback(async (_actionId: string, _completion: MentionCompletion) => {
		try {
			const paths = await bridge.files.pick({ directory: false, multiple: false });
			if (!paths || paths.length === 0) return;
			const chosen = paths[0];
			let rel = chosen;
			if (workspace?.path && chosen.startsWith(workspace.path)) {
				rel = chosen.slice(workspace.path.length).replace(/^[/\\\\]+/, "");
			} else {
				// If outside workspace or absolute path, show base filename to avoid full system path leaks in display
				const lastPart = chosen.split(/[/\\\\]/).pop();
				if (lastPart) rel = lastPart;
			}
			const formatted = rel.includes(" ") ? `@"${rel}"` : `@${rel}`;
			mentionRef.current?.insertMentionText(formatted);
		} catch (err) {
			useApp.getState().notify(`选择文件失败：${err instanceof Error ? err.message : String(err)}`, "error");
		}
	}, [workspace?.path]);

	const mention = useMention(text, commandCwd, field, setText, pickFileForMention);
	mentionRef.current = mention;

	const mergedDecoration = useMemo((): ComposerDecorations => {
		return {
			command: slash.decoration,
			mentions: mention.mentionDecorations,
		};
	}, [slash.decoration, mention.mentionDecorations]);
	const submitting = useRef(new Map<string, symbol>());

	const modelMenu = usePopover();
	const effortMenu = usePopover();
	const permissionMenu = usePopover();
	const projectMenu = usePopover();
	const branchMenu = usePopover();
	const fileRef = useRef<HTMLInputElement>(null);

	/** No project behind this conversation, and that was the choice — not a step left undone. */
	const chatting = !workspace && Boolean(scratchCwd);
	const modelId = meta?.modelId ?? settings?.defaultModelId ?? null;
	// The whole record, not just its name: the mark beside it is chosen from the id the provider
	// knows the model by, which is not the same string as the label somebody typed for it.
	const model = findModel(settings, modelId);
	/*
	 * Which house this model is from, and whether the strip has to say so.
	 *
	 * With one provider the name is the whole answer and the extra word is noise. With two relays
	 * offering the same `grok-4.6`, the name is not an answer at all — so the provider is folded
	 * into the label exactly when it is what tells them apart. Either way the tooltip has room for
	 * all of it.
	 */
	const identity = modelIdentity(settings, modelId);
	const modelName = identity?.ambiguous ? `${identity.provider.name} · ${identity.model.name}` : (model?.name ?? null);
	// The mark rolls with the name it belongs to, on the same terms — never on the first paint.
	const modelRolls = useRolled(modelId ?? "");
	const permissionMode = settings?.permissionMode ?? "auto";

	async function submit() {
		if (submitting.current.has(draftKey)) return;
		const submission = Symbol();
		submitting.current.set(draftKey, submission);
		const release = () => { if (submitting.current.get(draftKey) === submission) submitting.current.delete(draftKey); };
		try { await submitOnce(release); }
		catch (cause) { useApp.getState().notify(`命令或消息发送失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"); }
		finally { release(); }
	}

	async function submitOnce(release: () => void) {
		const trimmed = text.trim();
		if (!trimmed && attachments.length === 0) return;

		/*
		 * A command becomes the prompt it stands for, here, before anything is sent.
		 *
		 * Expanded rather than sent as `/name` with the expansion hidden: what is in the transcript
		 * is then exactly what the model was given, which is the difference between a conversation
		 * you can audit and one where a step happened off-screen. It also costs nothing to explain
		 * afterwards — the instructions are right there.
		 *
		 * Re-read on dispatch so paste-and-send and edits made outside Lyra use the current definition.
		 * An unknown name is not an error: it goes out as typed, because `/` is also how people
		 * write paths and a composer that rejected them would be wrong far more often than right.
		 */
		let outgoing = trimmed;
		let userDisplayText: string | undefined;
		let triggeredSkill: { name: string; path?: string; pluginId?: string } | undefined;
		const referencedSessions: Array<{ id: string; title: string }> = [];
		/* 命令可以声明会话正忙时怎么送——见 `SlashCommand.deliver`。 */
		let deliver: "steer" | "followUp" | undefined;
		/*
		 * 行首的 `/x`，或者嵌在句中的 `/skill:x`（07 §4）。后者只在草稿不以别的命令开头时算数：
		 * `/commit 用了 /skill:x 的产物` 是一次 `/commit`，里面那个是它的参数。
		 */
		const invocation = parseInvocation(trimmed) ?? parseSkillMention(trimmed);

		/*
		 * A built-in acts on the session and sends nothing.
		 *
		 * Cleared first, because these are not instant — `/compact` is a model call — and a field
		 * that still held `/compact` while it ran would invite a second press.
		 */
		const builtin = invocation ? commandEntries([], []).find((entry) => entry.name === invocation.name) : undefined;
		if (builtin) {
			if (attachments.length) { useApp.getState().notify("这条内置命令不接收附件，请先移除附件或单独发送消息。", "warn"); return; }
			if (builtin.action === "compact" && !activeSessionId) { useApp.getState().notify("当前还没有可压缩的会话。", "warn"); return; }
			if (builtin.action !== "compact" && invocation?.rest) { useApp.getState().notify("这条命令不接收参数，输入内容已保留。", "warn"); return; }
			setText("");
			setDraft(draftKey, null);
			// The guard covers draft resolution; runtime execution must not block subsequent messages.
			release();
			if (builtin.action === "compact" && activeSessionId) {
				const result = await bridge.sessions.compact(activeSessionId, invocation?.rest);
				if (!result.ok && result.reason) useApp.getState().notify(result.reason, "warn");
			} else if (builtin.action === "clear") await useApp.getState().newSession();
			else if (builtin.action === "manage-commands") {
				useApp.getState().setSettingsSection("commands");
				useApp.getState().setView("settings");
			}
			return;
		}

		if (invocation) {
			// Resolve against disk at dispatch, including paste-and-send and edits made in another app.
			const fresh = await bridge.commands.list(commandCwd);
			// A disk scan must not dispatch an obsolete draft or erase edits made while it was pending.
			if (draftKeyRef.current !== draftKey || textRef.current !== text || attachmentsRef.current !== attachments) return;

			/*
			 * 精确命中优先，否则唯一的末段匹配——`/commit` 找到 `git:commit`。
			 *
			 * 菜单那边早就这么匹配了（`rankCommands` 的 rank 2），而这里一直是精确匹配：
			 * 列表里看得见、回车却找不到。
			 */
			const command = resolveCommand(fresh.commands, invocation.name);
			if (command) {
				outgoing = expandCommand(command, invocation.rest);
				/*
				 * 命令自己说了怎么送，就按它说的送。
				 *
				 * `followUp` 是这里唯一真正改变行为的一个：会话正忙时不插话，排到这一轮后面。
				 * 空闲时三种都一样，都是开一个新回合。
				 */
				if (command.deliver === "followUp" || command.deliver === "steer") deliver = command.deliver;
			}
			else {
				/*
				 * A skill, asked for by name.
				 *
				 * Expanded into an instruction rather than into the skill's own body: the body can
				 * run to several thousand words and belongs in a tool result, which is where the
				 * `skill` tool puts it. What goes in the transcript is the ask — short, and exactly
				 * what the model is being told.
				 *
				 * Works for skills the model cannot see on its own, and that is the point of them:
				 * `disableModelInvocation` means "do not choose this yourself", not "never run
				 * this" — the tool looks skills up by name and has never filtered on that flag.
				 */
				// `/pdf` and `/skill:pdf` name the same skill; both qualified and bare names match
				const targetSkillName = skillNameOf(invocation).toLowerCase();
				const skill = fresh.skills?.find((entry) => {
					const qualified = skillCommandName(entry).toLowerCase();
					const bare = entry.name.toLowerCase();
					return qualified === targetSkillName || bare === targetSkillName;
				});
				if (skill) {
					triggeredSkill = {
						name: skill.name,
						path: skill.path,
						pluginId: skill.pluginId,
					};
					const restText = invocation.rest.trim();
					userDisplayText = restText;
					outgoing = [
						`使用 \`${skill.name}\` 技能${skill.pluginId ? `（来自插件 ${skill.pluginId}）` : ""}。`,
						restText,
					]
						.filter(Boolean)
						.join("\n\n");
				}
			}
		}
		// Detect mentions matching sessions (by title or chosenSessions mapping)
		const sessionPrompts: string[] = [];
		const mentionRanges = findMentionRanges(outgoing);
		for (const mr of mentionRanges) {
			const token = mr.inner;
			// Match session by direct id (backward compatibility), chosen map, or title
			const targetSessionId =
				mention.chosenSessions.get(token) ??
				(token.startsWith("session:") ? token.slice(8) : undefined) ??
				mention.sessions.find((s) => s.title === token || s.id === token)?.id;

			if (targetSessionId) {
				const matchedSession = mention.sessions.find((s) => s.id === targetSessionId);
				const label = matchedSession?.title || token;
				referencedSessions.push({ id: targetSessionId, title: label });
				sessionPrompts.push(`- 引用了历史会话「${label}」：请使用 \`read\` 工具读取 \`session://${targetSessionId}\` 获取该会话的详细历史与上下文。`);
			}
		}
		if (sessionPrompts.length > 0) {
			// If displayText is not yet set by skill invocation, default to the clean outgoing before appending system hints
			if (userDisplayText === undefined) {
				userDisplayText = outgoing;
			}
			outgoing = `${outgoing}\n\n[上下文引用提示]\n${sessionPrompts.join("\n")}`;
		}
		if (attachments.length > 0) {
			const textFiles = attachments.filter((a) => a.isText && a.text);
			if (textFiles.length > 0) {
				const attachedTexts = textFiles.map((f) => `### 附件文件: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``);
				outgoing = outgoing ? `${outgoing}\n\n${attachedTexts.join("\n\n")}` : attachedTexts.join("\n\n");
			}
		}

		const images = attachments
			.filter((a) => !a.isText && a.data)
			.map((a): UserContent => ({ type: "image", data: a.data!, mimeType: a.mimeType }));

		const content: UserContent[] = [
			...images,
			...(outgoing ? [{ type: "text" as const, text: outgoing }] : []),
		];
		setText("");
		setAttachments([]);
		setDraft(draftKey, null);
		release();
		await send(content, {
			...(deliver ? { deliver } : {}),
			...(userDisplayText !== undefined ? { displayText: userDisplayText } : {}),
			...(triggeredSkill ? { skillRef: triggeredSkill } : {}),
			...(referencedSessions.length > 0 ? { sessionRefs: referencedSessions } : {}),
		});
	}

	/**
	 * Take files on, without pretending every one of them is text.
	 *
	 * This used to be two branches: images were read as bytes, and *everything else* went through
	 * `file.text()`. A `.doc` is a compound binary document, so decoding it as UTF-8 produced a few
	 * thousand replacement characters — which were then pasted into the message and sent. The person
	 * saw their contract rendered as noise, and the model received the same noise.
	 *
	 * Three outcomes now, and which one applies is decided before anything is read:
	 *
	 *   - an image, carried as image content the model can actually look at;
	 *   - a kind that is known not to be text — a document, a video, an archive — attached by name
	 *     and type only, with nothing pasted into the prompt;
	 *   - anything else read as text, and *then* checked: the extension is a first guess, and a file
	 *     can be named anything.
	 */
	async function addFiles(files: FileList | null) {
		if (!files) return;
		const next: Attachment[] = [];
		const refused: string[] = [];

		for (const file of Array.from(files).slice(0, 8)) {
			const id = `${file.name}-${Date.now()}-${Math.random()}`;
			const kind = fileKind(file.name, file.type);

			if (kind === "image") {
				const buffer = await file.arrayBuffer();
				next.push({ id, name: file.name, mimeType: file.type, data: bytesToBase64(new Uint8Array(buffer)), isText: false, kind });
				continue;
			}

			if (!isReadableAsText(kind)) {
				// Known not to be text: attached, but its bytes stay out of the prompt.
				next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind });
				refused.push(`${file.name}（${KIND_LABEL[kind]}）`);
				continue;
			}

			try {
				const buffer = new Uint8Array(await file.arrayBuffer());
				if (looksBinary(buffer)) {
					// Named like text, and is not. Same treatment as the known kinds above.
					next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind: "binary" });
					refused.push(`${file.name}（二进制文件）`);
					continue;
				}
				next.push({
					id,
					name: file.name,
					mimeType: file.type || "text/plain",
					text: new TextDecoder().decode(buffer),
					isText: true,
					kind,
				});
			} catch {
				useApp.getState().notify(`无法读取文件 ${file.name} 的内容`, "warn");
			}
		}

		/*
		 * Said once, and said plainly.
		 *
		 * The file is still attached — the name and type reach the model, which is often all the
		 * question needs. What must not happen silently is the contents being dropped: someone who
		 * expects the agent to have read their document should find out here rather than from an
		 * answer that quietly ignored it.
		 */
		if (refused.length > 0) {
			useApp
				.getState()
				.notify(`${refused.join("、")} 的内容无法作为文本读取，只附上了文件名`, "warn");
		}
		if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
	}

	const takeScreenshot = useCallback(async () => {
		await bridge.screenshot.start(settings?.screenshot);
	}, [settings?.screenshot]);

	return (
		/*
		 * `ly-composer-dock`: the strip along the bottom of the conversation, named so the phone can
		 * find it. It is the one thing that has to move when a keyboard slides over the window —
		 * the transcript above it stays put and keeps its scroll position. See `--ly-keyboard`.
		 */
		<div className={`ly-composer-dock shrink-0 pt-2 pb-5 ${compact ? "px-4" : "px-8"}`}>
			<div className="mx-auto w-full max-w-[var(--ly-content)]">
				{/*
				 * That work has been delegated, above everything else the composer says.
				 *
				 * A sub-agent's context is deliberately kept out of this transcript, which is what
				 * makes it invisible — for two minutes nothing on screen told a run reading forty
				 * files apart from one that was stuck. The bar is that line, and it opens the pane.
				 */}
				{/* Once per project: what other tools' configuration this repository carries, already in use. */}
				<ForeignConfigNotice />
				<SubAgentBar onOpen={() => useDock.getState().open("subagents", companionOf("subagents"))} />
				{/*
				 * Where the turn will run, and what it has already changed.
				 *
				 * The chips shrink and ellipsise rather than being dropped when space runs short,
				 * because "which project, which branch" is exactly what you need before send.
				 *
				 * One row, because these are the same question asked at two moments: the project
				 * and branch are what you check before pressing send, the change counts are what
				 * you check after. Splitting them into two strips would cost a row of height to
				 * separate things you read together.
				 */}
				{showBottomPanel && (
				<div className="flex items-center gap-0.5 overflow-hidden pb-1">
					<Chip
						/*
						 * Chat, not 「无项目」.
						 *
						 * The old label named the state by what it lacks — a mode called "no project",
						 * which reads as something missing rather than as something chosen. What it
						 * actually is: a conversation with no checkout behind it. Reviewing a repository
						 * that is not on this machine, asking something that is not about code. That is a
						 * chat, and naming it after itself is the difference between a state and a gap.
						 *
						 * 「选择项目」 stays for the case where nothing has been chosen yet, which really is
						 * an unfinished step. The picker sits behind all three.
						 */
						icon={chatting ? <MessageSquare size={13} strokeWidth={1.8} /> : <Folder size={13} strokeWidth={1.8} />}
						label={workspace?.name ?? (chatting ? "Chat" : "选择项目")}
						onClick={projectMenu.toggle}
						active={projectMenu.open}
					/>
					{workspace?.branch && (
						/*
						 * The name stays put while a switch runs; the mark says it is running.
						 *
						 * Which is the whole point — see `BranchMenu`. Showing the target name early
						 * reads well right up until git refuses, and then the chip has claimed
						 * something that did not happen. A pulsing branch mark is honest about both
						 * outcomes and still answers the click immediately.
						 */
						<Chip
							icon={<GitBranch size={13} strokeWidth={1.8} className={switchingBranch ? "ly-pulse" : undefined} />}
							label={workspace.branch}
							busy={Boolean(switchingBranch)}
							onClick={branchMenu.toggle}
							active={branchMenu.open}
						/>
					)}
					<div className="min-w-2 flex-1" />
					<ChangeBar />
				</div>
				)}

				<div className="relative">
				<CommandMenu id={slash.id} commands={slash.matches} term={slash.term} active={slash.active} onPick={slash.pick} onHover={slash.setActive} />
				<MentionMenu id={mention.id} items={mention.matches} term={mention.term} active={mention.active} onPick={mention.pick} onHover={mention.setActive} />
				<ComposerShell
					fieldRef={field}
					value={text}
					onChange={(next) => {
						slash.change(next);
						mention.change(next);
					}}
					decoration={mergedDecoration}
					onSelect={() => {
						slash.select();
						mention.select();
					}}
					onFocus={() => {
						slash.focus();
						mention.focus();
					}}
					onBlur={() => {
						slash.blur();
						mention.blur();
					}}
					commandMenu={
						mention.matches.length > 0
							? { id: mention.id, active: mention.active, open: true }
							: { id: slash.id, active: slash.active, open: slash.matches.length > 0 }
					}
					onSubmit={() => void submit()}
					onKeyDown={(event) => {
						if (mention.keyDown(event)) return;
						slash.keyDown(event, () => void submit());
					}}
					placeholder="随心输入，或输入 / 命令，@ 提及文件、会话与技能"
					onFiles={(files) => void addFiles(files)}
					attachments={
						attachments.length > 0 ? (
							<div className="flex flex-wrap gap-2 px-4 pt-3.5">
								{attachments.map((attachment) => (
									<div key={attachment.id} className="relative">
										{/*
										 * Three shapes, not two.
										 *
										 * The old split was "text or image", and the image branch drew an `<img>` from
										 * `attachment.data` — which a Word document, a video or an archive does not have.
										 * Attaching one produced a broken image where the file should have been.
										 */}
										{attachment.isText ? (
											<div className="flex h-[68px] w-[110px] flex-col justify-between rounded-lg border border-line bg-card p-2.5 text-left shadow-xs">
												<div className="flex items-center gap-1.5 text-ink-muted">
													<FileKindIcon kind={attachment.kind ?? "text"} size={15} />
													<span className="truncate text-xs font-medium text-ink">{attachment.name}</span>
												</div>
												<span className="text-[10px] text-ink-faint">文本 / 代码附件</span>
											</div>
										) : !attachment.data ? (
											/* Attached by name and type: its bytes are not something a prompt can carry.
											   See `addFiles`. */
											<div
												className="flex h-[68px] w-[110px] flex-col justify-between rounded-lg border border-line bg-card p-2.5 text-left shadow-xs"
												data-ly-tip={`${attachment.name}\n${KIND_LABEL[attachment.kind ?? "binary"]} · 只附带文件名`}
											>
												<div className="flex items-center gap-1.5 text-ink-muted">
													<FileKindIcon kind={attachment.kind ?? "binary"} size={15} />
													<span className="truncate text-xs font-medium text-ink">{attachment.name}</span>
												</div>
												<span className="text-[10px] text-ink-faint">
													{KIND_LABEL[attachment.kind ?? "binary"]} · 仅文件名
												</span>
											</div>
										) : (
											<button
												type="button"
												aria-label={`预览 ${attachment.name}`}
												onClick={(event) =>
													openFromEvent(
														event,
														attachments
															.filter((a) => !a.isText && a.data)
															.map((a) => ({
																src: `data:${a.mimeType};base64,${a.data}`,
																alt: a.name,
																onReplace: (dataUrl: string) =>
																	setAttachments((prev) =>
																		prev.map((item) =>
																			item.id === a.id ? { ...item, ...fromDataUrl(dataUrl, item) } : item,
																		),
																	),
															})),
														// Indexed among the ones that are actually previewable, or the viewer opens the wrong picture.
														attachments.filter((a) => !a.isText && a.data).findIndex((a) => a.id === attachment.id),
													)
												}
												className="block overflow-hidden rounded-lg border border-line transition-opacity duration-[var(--ly-t-quick)] hover:opacity-85"
											>
												<img
													src={`data:${attachment.mimeType};base64,${attachment.data}`}
													alt={attachment.name}
													className="h-[68px] w-[92px] object-cover"
												/>
											</button>
										)}
										<button
											type="button"
											onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
											className="absolute -top-1.5 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line bg-float text-ink-muted transition-colors hover:text-ink"
										>
											<X size={11} strokeWidth={2.2} />
										</button>
									</div>
								))}
							</div>
						) : undefined
					}
					left={
						<>
							<button
								type="button"
								data-ly-tip="添加附件文件或图片"
								aria-label="添加附件文件或图片"
								onClick={() => fileRef.current?.click()}
								className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
							>
								<Plus size={16} strokeWidth={1.9} />
							</button>
							{bridge.platform === "darwin" && settings?.screenshot?.showInComposer && (
								<button
									type="button"
									data-ly-tip={`屏幕截图 ${settings?.screenshot?.shortcut ? `(${settings.screenshot.shortcut.replace("CommandOrControl", "⌘").replace("Shift", "⇧").replace("Alt", "⌥").replace(/\+/g, "")})` : ""}`}
									aria-label="屏幕截图"
									onClick={() => void takeScreenshot()}
									className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
								>
									<Camera size={15} strokeWidth={1.9} />
								</button>
							)}
							<input
								ref={fileRef}
								type="file"
								multiple
								hidden
								onChange={(e) => {
									void addFiles(e.target.files);
									e.target.value = "";
								}}
							/>

							<button
								type="button"
								/* The app's own tooltip, so the icon-only form still says what it is. */
								data-ly-tip={PERMISSION_LABEL[permissionMode]}
								data-ly-tip-side="top"
								aria-label={PERMISSION_LABEL[permissionMode]}
								onClick={permissionMenu.toggle}
								aria-haspopup="menu"
								aria-expanded={permissionMenu.open}
								className={`ly-composer-control flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-label transition-colors duration-[var(--ly-t-quick)] ${
									permissionMode === "full"
										? // Red, not the accent: this is the one mode that hands over the machine.
											`text-danger ${permissionMenu.open ? "bg-danger/10" : "hover:bg-danger/10"}`
										: permissionMenu.open
											? "bg-card-hover text-ink"
											: "text-ink-muted hover:bg-card-hover hover:text-ink"
								}`}
							>
								<CircleAlert size={13.5} strokeWidth={1.9} className="shrink-0" />
								{/*
								 * The label is the first thing to go when space runs out.
								 *
								 * Full access used to keep its words at every width, on the grounds
								 * that it must never be quietly on. But a label that refuses to
								 * yield just pushes the rest of the row out; the mark carries that
								 * meaning on its own now that it is red, and the tooltip says the
								 * word for anyone unsure.
								 *
								 * Measured against the field rather than the window: with a sidebar
								 * It was `@max-[420px]:hidden` — a width standing in for 「does this fit」,
								 * which it cannot: what fits depends on how long the model's name is, and
								 * those run from `gpt-5` to `claude-opus-4-6-thinking`. The words went at
								 * 419px with clear air still in the row, and having gone they freed width
								 * that nothing then claimed.
								 *
								 * And it goes before the meter rather than after it. This is a mode you set
								 * once and leave set; the meter and the name are about the turn being composed
								 * right now — see the ranking in `composer/fit.ts`.
								 */}
								<span data-ly-fit-drop="1" className="shrink-0 whitespace-nowrap">
									<RollingText>{PERMISSION_LABEL[permissionMode]}</RollingText>
								</span>
							</button>
						</>
					}
					right={
						<>
							{/*
							 * Beside the model it is measured against — the window is a property of that model.
							 *
							 * The last thing the row gives up, and it used to be the first — at a fixed
							 * `@max-[480px]`, which on a real window dropped it while the two halves of the
							 * row still had 54px of clear air between them. It costs about 24px, so it now
							 * goes only when those 24px are the ones missing, and only after 「完全访问」 has
							 * already given up its words for a larger saving.
							 */}
							<div data-ly-fit-drop="2" className="flex shrink-0 items-center">
								<ContextMeter messages={messages} settings={settings} modelId={modelId} sessionId={activeSessionId} />
							</div>

							<button
								type="button"
								onClick={modelMenu.toggle}
								data-ly-tip={modelTooltip(identity, formatWindow)}
								aria-haspopup="menu"
								aria-expanded={modelMenu.open}
								className={`ly-composer-control flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-label transition-colors ${
									modelMenu.open ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"
								}`}
							>
								{/* Keyed on the model, so picking a different house turns the mark over with
								    the label beside it rather than swapping under it. */}
								<ModelIcon
									key={modelId}
									model={model?.modelId}
									name={modelName}
									className={modelRolls ? "ly-roll" : ""}
								/>
								{/*
								 * The one thing in the row that yields, so it is also what says the row is out of
								 * room: everything else is `shrink-0`, and this truncating is exactly the moment
								 * there was not enough width to go round. `fit.ts` reads this element — the class is the handle — which is why a short
								 * name keeps its meter at any width.
								 */}
								<RollingText className="ly-fit-probe min-w-0 truncate">{modelName ?? "选择模型"}</RollingText>
							</button>
							<button
								type="button"
								onClick={effortMenu.toggle}
								aria-haspopup="menu"
								aria-expanded={effortMenu.open}
								data-ly-tip={`推理强度：${effortLabel(sessionThinking(meta, settings), model)}`}
								className={`ly-composer-control mr-1.5 flex h-7 shrink-0 items-center rounded-md px-2 text-label transition-colors ${
									effortMenu.open ? "bg-card-hover text-ink" : "text-ink-faint hover:bg-card-hover hover:text-ink"
								}`}
							>
								<RollingText>{effortLabel(sessionThinking(meta, settings), model)}</RollingText>
							</button>

							<ComposerSend
								running={running}
								disabled={!text.trim() && attachments.length === 0}
								onSend={() => void submit()}
								onStop={() => void abort()}
							/>
						</>
					}
				/>
				</div>
			</div>

			{permissionMenu.open && <PermissionPicker anchor={permissionMenu.anchor} onClose={permissionMenu.close} />}
			{projectMenu.open && <ProjectPicker anchor={projectMenu.anchor} onClose={projectMenu.close} />}
			{branchMenu.open && <BranchMenu anchor={branchMenu.anchor} onClose={branchMenu.close} />}
			{modelMenu.open && <ModelMenu anchor={modelMenu.anchor} onClose={modelMenu.close} />}
			{effortMenu.open && <EffortMenu anchor={effortMenu.anchor} onClose={effortMenu.close} />}
		</div>
	);
}

function Chip({
	icon,
	label,
	onClick,
	active,
	busy,
}: {
	icon: React.ReactNode;
	label: string;
	onClick: (event: React.MouseEvent<HTMLElement>) => void;
	active?: boolean;
	/** Something is being changed about what this names; the label is held until it lands. */
	busy?: boolean;
}) {
	const rolls = useRolled(label);

	return (
		<button
			type="button"
			data-ly-tip={busy ? "正在切换分支…" : label}
			aria-haspopup="menu"
			aria-expanded={active}
			aria-busy={busy || undefined}
			onClick={onClick}
			/* Dimmed while it is being changed, so the name reads as "still this, for now". */
			className={`ly-scroll flex h-[26px] min-w-0 items-center gap-1.5 rounded-md px-2 text-label transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] ${
				busy ? "opacity-60" : ""
			} ${active ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"}`}
		>
			<span className="shrink-0 text-ink-faint">{icon}</span>
			{/* Keyed on the label so switching project or branch rolls the new one in. `ScrollText`
			    cannot take `RollingText` as a child — it measures the string to decide whether the
			    chip scrolls on hover — so the remount happens around it instead, on the same terms. */}
			<ScrollText key={label} text={label} className={`min-w-0 ${rolls ? "ly-roll" : ""}`} />
		</button>
	);
}

/** btoa cannot take a raw byte array; chunk it so large images do not blow the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Split an annotated `data:` URL back into the shape an attachment is stored in.
 *
 * The annotator always hands back PNG, whatever went in — flattening a JPEG with marks on it and
 * calling it a JPEG would re-compress the original a second time.
 */
function fromDataUrl(dataUrl: string, previous: { mimeType: string }): { data: string; mimeType: string } {
	const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
	if (!match) return { data: "", mimeType: previous.mimeType };
	return { mimeType: match[1], data: match[2] };
}
