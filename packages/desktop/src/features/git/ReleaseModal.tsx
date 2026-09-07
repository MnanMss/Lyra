import { Input, Textarea } from "../../ui/inputs/NativeField.tsx";
import {
	Check,
	CheckCircle2,
	ChevronRight,
	Edit3,
	Eye,
	ExternalLink,
	Globe,
	Loader2,
	Play,
	RefreshCw,
	Tag,
	Info,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReleaseInfo, WorkflowRunStatus } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { Markdown } from "../conversation/index.ts";
import { releaseNotes } from "./release-notes.ts";
import { MenuBody, MenuItem } from "../../ui/overlay/Menu.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { bridge } from "../../services/index.ts";

interface ReleaseModalProps {
	cwd: string;
	onClose: () => void;
}

export function ReleaseModal({ cwd, onClose }: ReleaseModalProps) {
	const [info, setInfo] = useState<ReleaseInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedType, setSelectedType] = useState<"patch" | "minor" | "major" | "custom">("patch");
	const [customVersion, setCustomVersion] = useState("");
	const [notes, setNotes] = useState("");
	const notesRevision = useRef(0);
	const [generatingNotes, setGeneratingNotes] = useState(false);
	const [notesLang, setNotesLang] = useState<"zh" | "en">("zh");
	const [langMenuOpen, setLangMenuOpen] = useState(false);
	const langButtonRef = useRef<HTMLButtonElement | null>(null);
	const [previewMode, setPreviewMode] = useState(true);
	const notify = useApp((s) => s.notify);

	// Dry Run state
	const [dryRunId, setDryRunId] = useState<number | null>(null);
	const [dryRunStatus, setDryRunStatus] = useState<WorkflowRunStatus | null>(null);
	const [triggeringDryRun, setTriggeringDryRun] = useState(false);
	const [dryRunNotice, setDryRunNotice] = useState<string | null>(null);

	// Publishing state
	const [publishing, setPublishing] = useState(false);
	const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Read current release readiness information from repository.
	const handleRefresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await bridge.git.releaseInfo(cwd);
			if (!res) throw new Error("无法读取仓库的发布信息");
			{
				setInfo(res);
				setCustomVersion(res.suggestedVersion.patch);
				setNotes(releaseNotes(res.commitsSinceTag, "zh"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	// Fetch repository release status on mount
	useEffect(() => {
		void handleRefresh();
	}, [handleRefresh]);

	const currentTargetVersion =
		selectedType === "custom"
			? customVersion.trim()
			: (info?.suggestedVersion[selectedType] ?? customVersion);

	// Generate Release notes with categorized sections in Chinese or English
	const handleGenerateNotes = useCallback(
		async (lang: "zh" | "en" = notesLang, showToast = false) => {
			const revision = ++notesRevision.current;
			setGeneratingNotes(true);
			try {
				const freshInfo = await bridge.git.releaseInfo(cwd);
				if (!freshInfo) throw new Error("无法读取仓库的发布信息");
				setInfo(freshInfo);
				if (revision === notesRevision.current) setNotes(releaseNotes(freshInfo.commitsSinceTag, lang));
				if (showToast) notify(`已根据 ${freshInfo.commitsSinceTag.length} 条提交生成更新日志`, "info");
			} catch (err) {
				if (showToast) {
					notify(err instanceof Error ? err.message : "提取日志失败", "error");
				}
			} finally {
				setGeneratingNotes(false);
			}
		},
		[cwd, notesLang, notify],
	);

	// Poll dry run status if dryRunId is set
	useEffect(() => {
		if (!dryRunId) return;
		let alive = true;
		const interval = setInterval(async () => {
			const status = await bridge.git.workflowRunStatus(cwd, dryRunId);
			if (alive && status) {
				setDryRunStatus(status);
				if (status.status === "completed") {
					clearInterval(interval);
				}
			}
		}, 3000);

		return () => {
			alive = false;
			clearInterval(interval);
		};
	}, [cwd, dryRunId]);

	const handleTriggerDryRun = async () => {
		setError(null);
		setDryRunNotice(null);
		setTriggeringDryRun(true);
		try {
			const res = await bridge.git.triggerDryRun(cwd);
			if (!res.ok) {
				setError(res.error ?? "触发 GitHub Actions 试运行失败");
				return;
			}
			if (res.runId) {
				setDryRunId(res.runId);
				setDryRunNotice("已成功触发 GitHub Actions 跨平台打包试运行！正在实时监听进度…");
			} else {
				setDryRunNotice("已触发 GitHub Actions release-dryrun.yml，等待调度排队中…");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setTriggeringDryRun(false);
		}
	};

	const handlePublish = async () => {
		if (!currentTargetVersion) return;
		setError(null);
		setPublishing(true);

		// 1. Bump version files
		const bumpRes = await bridge.git.bumpVersion(cwd, currentTargetVersion);
		if (!bumpRes.ok) {
			setPublishing(false);
			setError(bumpRes.error ?? "更新 package.json 失败");
			return;
		}

		// 2. Publish git tag & push
		const pubRes = await bridge.git.publishReleaseTag(cwd, currentTargetVersion);
		setPublishing(false);
		if (!pubRes.ok) {
			setError(pubRes.error ?? "发布 Git Tag 失败");
			return;
		}

		setPublishSuccess(pubRes.tag ?? `v${currentTargetVersion}`);
	};

	return (
		<Overlay onClose={onClose} width={560}>{(dismiss) => <>
			<div className="ly-release-modal flex min-h-0 flex-col bg-float text-ink">
				{/* Clean Header */}
				<div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line-soft">
					<div className="flex items-center gap-2.5">
						<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink/5 text-ink">
							<Tag size={15} strokeWidth={2} />
						</div>
						<div>
							<h2 className="text-label font-semibold text-ink leading-none">发版中心</h2>
							<p className="text-caption text-ink-faint mt-0.5">选择版本并准备发布</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => dismiss()}
						aria-label="关闭发版中心" data-ly-tip="关闭"
						className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
					>
						<X size={15} />
					</button>
				</div>

				{/* Body Content */}
				<Scroller className="h-[min(520px,calc(85dvh-132px))] min-h-0" contentClassName="p-5 space-y-4">
					{loading && (
						<div className="flex items-center justify-center py-12">
							<Loader2 size={20} className="animate-spin text-ink-faint" />
						</div>
					)}

					{publishSuccess && (
						<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center space-y-2">
							<div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
								<CheckCircle2 size={18} />
								<span>版本 {publishSuccess} 已成功打 Tag 并推送到远程！</span>
							</div>
							<p className="text-detail text-ink-muted">
								GitHub Actions Release 正在自动多平台打包并发布产物。
							</p>
							<button
								type="button"
								onClick={() => dismiss()}
								className="mt-2 rounded-lg bg-ink px-4 py-1.5 text-detail font-medium text-shell hover:opacity-90 cursor-pointer"
							>
								完成
							</button>
						</div>
					)}

					{!loading && !publishSuccess && info && (
						<>
							{/* Current info & Target Version Picker */}
							<div className="rounded-xl bg-card p-3.5 space-y-3">
								<div className="flex items-center justify-between gap-2 flex-wrap text-detail text-ink-muted">
									<span>
										当前: <span className="font-mono text-ink font-medium">{info.currentVersion}</span>
									</span>
									<span>
										最新 Tag: <span className="font-mono text-ink font-medium">{info.latestTag ?? "无"}</span>
									</span>
									<span>
										待发提交: <span className="font-mono text-ink font-semibold">{info.commitsSinceTag.length}</span>
									</span>
								</div>

								<div>
									<div className="text-caption font-medium text-ink-muted mb-2">选择目标版本号</div>
									<div className="grid grid-cols-4 gap-2">
										{(["patch", "minor", "major"] as const).map((type) => (
											<button
												key={type}
												type="button"
												onClick={() => setSelectedType(type)}
												className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-detail transition-all cursor-pointer ${
													selectedType === type
														? "border-accent bg-accent/5 text-accent font-medium shadow-xs"
														: "border-line-soft bg-card-hover/40 hover:bg-card-hover text-ink"
												}`}
											>
												<span className="uppercase text-[9.5px] font-semibold tracking-wider opacity-60">
													{type}
												</span>
												<span className="font-mono mt-0.5 text-detail font-medium">{info.suggestedVersion[type]}</span>
											</button>
										))}
										<button
											type="button"
											onClick={() => setSelectedType("custom")}
											className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-detail transition-all cursor-pointer ${
												selectedType === "custom"
													? "border-accent bg-accent/5 text-accent font-medium shadow-xs"
													: "border-line-soft bg-card-hover/40 hover:bg-card-hover text-ink"
											}`}
										>
											<span className="uppercase text-[9.5px] font-semibold tracking-wider opacity-60">
												自定义
											</span>
											<span className="font-mono mt-0.5 text-detail font-medium">{customVersion || "x.y.z"}</span>
										</button>
									</div>

									<div className="mt-2 h-7">{selectedType === "custom" ? <Input aria-label="自定义版本" value={customVersion} onChange={(event) => setCustomVersion(event.target.value)} placeholder="x.y.z" className="h-7 w-full rounded-lg border border-line bg-input px-3 font-mono text-detail" /> : <p className="flex h-7 items-center text-caption text-ink-faint">{selectedType === "patch" ? "问题修复" : selectedType === "minor" ? "兼容的新功能" : "包含不兼容变更"}</p>}</div>
								</div>
							</div>

							{/* Release Notes */}
							<div className="group/notes space-y-1.5">
								<div className="flex items-center justify-between px-0.5">
									<span className="text-caption font-medium text-ink-muted">
										更新日志
									</span>
									<div data-open={langMenuOpen} className="ly-notes-actions flex items-center gap-1 opacity-0 transition-opacity group-hover/notes:opacity-100 group-focus-within/notes:opacity-100">
										{/* Language Dropdown */}
										<div className="relative">
											<button
												ref={langButtonRef}
												disabled={generatingNotes}
												type="button"
												onClick={() => setLangMenuOpen((v) => !v)}
												aria-label="更新日志语言" data-ly-tip={`语言：${notesLang === "zh" ? "中文" : "English"}`}
												className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
											>
												<Globe size={14} className="text-ink-muted" />
											</button>
											{langMenuOpen && (
												<Popover
													anchor={langButtonRef.current}
													onClose={() => setLangMenuOpen(false)}
													placement="bottom"
													align="end"
													width={120}
												>
													<MenuBody>
														<MenuItem
															selected={notesLang === "zh"}
															onClick={() => {
																setNotesLang("zh");
																setLangMenuOpen(false);
																void handleGenerateNotes("zh", true);
															}}
														>
															中文
														</MenuItem>
														<MenuItem
															selected={notesLang === "en"}
															onClick={() => {
																setNotesLang("en");
																setLangMenuOpen(false);
																void handleGenerateNotes("en", true);
															}}
														>
															English
														</MenuItem>
													</MenuBody>
												</Popover>
											)}
										</div>

										<button type="button" onClick={() => setPreviewMode(!previewMode)} aria-label={previewMode ? "编辑更新日志" : "预览更新日志"} data-ly-tip={previewMode ? "编辑" : "预览"} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink">
											{previewMode ? <Edit3 size={14} /> : <Eye size={14} />}
										</button>
										<button type="button" onClick={() => void handleGenerateNotes(notesLang, true)} disabled={generatingNotes} aria-label="重新生成更新日志" data-ly-tip="重新生成" className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50">
											<RefreshCw size={14} className={generatingNotes ? "ly-spin" : ""} />
										</button>
									</div>
								</div>

								{previewMode ? (
									<Scroller className="h-[180px] rounded-xl border border-line-soft bg-card" contentClassName="p-3.5 text-detail text-ink leading-relaxed">
										<Markdown text={notes || "*(无内容)*"} />
									</Scroller>
								) : (
									<Textarea
										value={notes}
										onChange={(e) => { notesRevision.current++; setNotes(e.target.value); }}
										aria-label="更新日志内容"
										className="block h-[180px] w-full rounded-xl border border-line-soft bg-card p-3.5 text-detail font-mono text-ink focus:border-primary focus:outline-none resize-none leading-relaxed"
										placeholder="在此编辑发版说明..."
									/>
								)}
							</div>

							{/* Pre-flight Checks / GitHub Actions Dry Run */}
							<div className="rounded-xl bg-card p-3.5 space-y-2.5">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<span className="text-detail font-medium text-ink">
											打包试运行
										</span>
									</div>
									<button
										type="button"
										onClick={handleTriggerDryRun}
										disabled={triggeringDryRun || dryRunStatus?.status === "in_progress"}
										className="flex h-6 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-micro font-medium text-ink hover:bg-card-hover transition-colors cursor-pointer disabled:opacity-50"
									>
										{triggeringDryRun ? (
											<Loader2 size={11} className="animate-spin text-ink-muted" />
										) : (
											<Play size={11} strokeWidth={2.2} className="text-accent" />
										)}
										<span>
											{triggeringDryRun
												? "触发中…"
												: dryRunStatus?.status === "in_progress"
													? "正在构建..."
													: "触发 Dry Run"}
										</span>
									</button>
								</div>

								{dryRunNotice && !dryRunStatus && (
									<div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-detail text-primary">
										<Loader2 size={13} className="animate-spin shrink-0" />
										<span>{dryRunNotice}</span>
									</div>
								)}

								{dryRunStatus && (
									<div className="rounded-lg bg-card-hover/50 p-2.5 text-detail space-y-2">
										<div className="flex items-center justify-between text-caption">
											<span className="text-ink-muted">
												状态:{" "}
												<span className="font-medium text-ink">
													{dryRunStatus.status === "completed"
														? dryRunStatus.conclusion === "success"
															? "全部平台构建成功 ✓"
															: "构建失败 ✗"
														: "正在构建各平台产物..."}
												</span>
											</span>
											{dryRunStatus.url && (
												<a
													href={dryRunStatus.url}
													target="_blank"
													rel="noreferrer"
													className="flex items-center gap-1 text-ink-muted hover:text-ink transition-colors"
												>
													<span>查看 Actions 日志</span>
													<ExternalLink size={10.5} />
												</a>
											)}
										</div>

										{dryRunStatus.jobs.length > 0 && (
											<div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-line-soft">
												{dryRunStatus.jobs.map((job) => (
													<div
														key={job.name}
														className="flex items-center gap-1.5 text-micro text-ink-muted truncate"
													>
														{job.status === "completed" ? (
															job.conclusion === "success" ? (
																<Check size={12} className="text-emerald-500 shrink-0" />
															) : (
																<XCircle size={12} className="text-rose-500 shrink-0" />
															)
														) : (
															<Loader2 size={12} className="animate-spin text-amber-500 shrink-0" />
														)}
														<span className="truncate">{job.name}</span>
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>


						</>
					)}
					{error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-caption text-danger">{error}</p>}
				</Scroller>

				{/* Footer Actions */}
				{!publishSuccess && (
					<div className="flex items-center justify-between border-t border-line-soft px-5 py-3 bg-card-hover/20">
						<div className="text-detail text-ink-muted">
							<button type="button" aria-label="发布操作说明" data-ly-tip="发布会更新版本文件、创建 Tag 并推送到远程。"><Info size={12} className="mr-1 inline-block" /></button>目标: <span className="font-mono font-semibold text-ink">v{currentTargetVersion}</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => dismiss()}
								className="rounded-lg px-3 py-1.5 text-detail text-ink-muted hover:bg-card-hover hover:text-ink transition-colors cursor-pointer"
							>
								取消
							</button>
							<button
								type="button"
								onClick={handlePublish}
								disabled={publishing || !currentTargetVersion}
								className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-1.5 text-detail font-medium text-shell hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
							>
								{publishing ? (
									<>
										<Loader2 size={13} className="animate-spin" />
										<span>发布中...</span>
									</>
								) : (
									<>
										<span>发布版本</span>
										<ChevronRight size={13} />
									</>
								)}
							</button>
						</div>
					</div>
				)}
			</div>
		</>}</Overlay>
	);
}
