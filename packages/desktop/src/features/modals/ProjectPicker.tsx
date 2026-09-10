import { Check, Folder, GitBranchPlus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RepoRef } from "../../../electron/git.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { MENU_MAX_HEIGHT, MenuBody, MenuItem, MenuSearch, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { startProjectSession } from "../sidebar/index.ts";

/**
 * Project switcher, anchored to whatever opened it.
 *
 * It used to be a centred dialog reached from the app title, which made changing project feel
 * like a mode switch for the whole window. Hanging it off the composer's project chip keeps
 * the control next to the thing it scopes — the turn you are about to send.
 */
export function ProjectPicker({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const workspace = useApp((s) => s.workspace);
	const openWorkspace = useApp((s) => s.openWorkspace);
	const pickWorkspace = useApp((s) => s.pickWorkspace);
	const clearWorkspace = useApp((s) => s.clearWorkspace);
	// Switching projects changes what is behind the drawer, so the drawer has to go with it.
	const { dismissNav } = useLayout();
	const [query, setQuery] = useState("");
	const [trees, setTrees] = useState<Record<string, RepoRef[]>>({});
	const [creatingFor, setCreatingFor] = useState<string | null>(null);
	const [draftBranch, setDraftBranch] = useState("");
	const [busy, setBusy] = useState(false);
	const notify = useApp((s) => s.notify);
	useEffect(() => {
		let live = true;
		const projectsList = settings?.projects ?? [];
		void Promise.all(
			projectsList.map(async (p) => {
				try {
					const list = await bridge.git.worktrees(p.path);
					return [p.path, list.filter((t) => t.worktree)] as const;
				} catch {
					return [p.path, []] as const;
				}
			}),
		).then((entries) => {
			if (!live) return;
			setTrees(Object.fromEntries(entries));
		});
		return () => {
			live = false;
		};
	}, [settings?.projects]);
	const projects = (settings?.projects ?? [])
		.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.path.includes(query))
		.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

	const choose = (action: () => void) => {
		action();
		onClose();
		dismissNav();
	};

	const makeWorktree = async (repoPath: string) => {
		const branch = draftBranch.trim();
		if (!branch || busy) return;
		setBusy(true);
		try {
			const result = await bridge.git.createWorktree(repoPath, branch);
			if (!result.ok) {
				notify(result.error ?? t("projectMenu.worktreeFailed"), "error");
				return;
			}
			notify(t("projectMenu.worktreeMade", { path: result.path ?? "" }));
			onClose();
			dismissNav();
			if (result.path) {
				void startProjectSession(result.path);
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			placement="top"
			align="start"
			width="wide"
			maxHeight={MENU_MAX_HEIGHT}
			label={t("project.switch")}
			header={<MenuSearch value={query} onChange={setQuery} placeholder={t("project.search")} />}
			// The two ways out of the list stay put while it scrolls: neither is about a project
			// you are looking at, and both are what you reach for when none of them is the one.
			footer={
				<MenuBody>
					{workspace?.isGitRepo && (
						<MenuItem
							icon={<GitBranchPlus size={13} strokeWidth={1.9} />}
							onClick={() => {
								setDraftBranch("");
								setCreatingFor(creatingFor === workspace.path ? null : workspace.path);
							}}
						>
							{t("projectMenu.newWorktree")}
						</MenuItem>
					)}
					<MenuItem icon={<Plus size={13} strokeWidth={1.9} />} onClick={() => choose(() => void pickWorkspace())}>
						{t("project.new")}
					</MenuItem>
					<MenuItem icon={<X size={13} strokeWidth={1.9} />} onClick={() => choose(clearWorkspace)}>
						{t("project.without")}
					</MenuItem>
				</MenuBody>
			}
		>
			<MenuBody>
				{creatingFor && (
					<form
						className="border-b border-line-soft p-2.5"
						onSubmit={(e) => {
							e.preventDefault();
							void makeWorktree(creatingFor);
						}}
					>
						<label className="block pb-1.5 text-detail text-ink-faint">
							{t("projectMenu.branchName")}
						</label>
						<div className="flex items-center gap-1.5">
							<Input
								autoFocus
								value={draftBranch}
								onChange={(e) => setDraftBranch(e.target.value)}
								placeholder="feature/…"
								className="h-7 w-full rounded-md border border-line bg-input px-2 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint"
							/>
							<button
								type="submit"
								disabled={busy || !draftBranch.trim()}
								className="h-7 shrink-0 rounded-md bg-ink px-2.5 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-45"
							>
								{busy ? "…" : t("common.create")}
							</button>
						</div>
					</form>
				)}
				{projects.map((project) => {
					const projectTrees = trees[project.path] ?? [];
					const isCurrent = workspace?.path === project.path;
					return (
						<div key={project.path}>
							<div className="group/project flex items-center justify-between pr-1">
								<div className="min-w-0 flex-1">
									<MenuItem
										icon={<Folder size={13} strokeWidth={1.8} />}
										title={project.path}
										selected={isCurrent}
										trailing={
											isCurrent ? (
												<Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" />
											) : undefined
										}
										onClick={() => choose(() => void openWorkspace(project.path))}
									>
										{project.name}
									</MenuItem>
								</div>
								<button
									type="button"
									data-ly-tip={t("projectMenu.newWorktree")}
									aria-label={`${t("projectMenu.newWorktree")}: ${project.name}`}
									onClick={(e) => {
										e.stopPropagation();
										setDraftBranch("");
										setCreatingFor(creatingFor === project.path ? null : project.path);
									}}
									className="opacity-0 transition-opacity hover:opacity-100 group-hover/project:opacity-100 focus:opacity-100 rounded p-1 text-ink-faint hover:bg-card-hover hover:text-ink"
								>
									<GitBranchPlus size={13} strokeWidth={1.8} />
								</button>
							</div>
							{projectTrees.map((tree) => {
								const isTreeCurrent = workspace?.path === tree.path;
								return (
									<MenuItem
										key={tree.path}
										icon={<GitBranchPlus size={13} strokeWidth={1.8} className="ml-2 text-ink-faint" />}
										title={tree.path}
										detail={tree.branch ?? t("sync.detached")}
										selected={isTreeCurrent}
										trailing={
											isTreeCurrent ? (
												<Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" />
											) : undefined
										}
										onClick={() => choose(() => void openWorkspace(tree.path))}
									>
										<span className="pl-1 font-mono text-detail text-ink-muted">{tree.label}</span>
									</MenuItem>
								);
							})}
						</div>
					);
				})}
				{projects.length === 0 && <p className="px-2.5 py-5 text-center text-detail text-ink-faint">{t("project.none")}</p>}
			</MenuBody>
		</Popover>
	);
}
