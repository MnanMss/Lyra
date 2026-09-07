import { ChevronDown, FileDiff, Files, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeliveryFile, TurnDelivery } from "../../../electron/turn-delivery.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { relativeTo } from "../../lib/paths.ts";
import { useApp } from "../../store/index.ts";
import { Button } from "../../ui/primitives/Button.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DiffView } from "../git/index.ts";
import { latestDeliveryTimestamp } from "./delivery-state.ts";

const PREVIEW_FILES = 3;

export function TurnDeliveryCard({ timestamp }: { timestamp: number }) {
	const sessionId = useApp((state) => state.activeSessionId);
	const latest = useApp((state) => latestDeliveryTimestamp(state.messages, state.running));
	if (!sessionId || latest !== timestamp || onPhone()) return null;
	return <Delivery key={sessionId + ":" + timestamp} sessionId={sessionId} timestamp={timestamp} />;
}

function Counts({ added, removed }: { added: number; removed: number }) {
	return <span className="flex shrink-0 items-center gap-1.5 tabular-nums"><span className="text-ok">+{added}</span><span className="text-danger">−{removed}</span></span>;
}

function FileName({ path }: { path: string }) {
	const split = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
	return <span className="min-w-0 flex-1 truncate"><span className="text-ink-muted">{path.slice(0, split)}</span><span className="text-ink">{path.slice(split)}</span></span>;
}

function Delivery({ sessionId, timestamp }: { sessionId: string; timestamp: number }) {
	const workspace = useApp((state) => state.workspace?.path);
	const [data, setData] = useState<TurnDelivery | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [review, setReview] = useState<string | true | null>(null);
	const [undoing, setUndoing] = useState(false);
	const [hover, setHover] = useState<{ anchor: HTMLElement; file: DeliveryFile } | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const live = useRef(true);
	const undoLock = useRef(false);
	const confirm = useConfirmer();
	useEffect(() => {
		live.current = true;
		void bridge.delivery.get(sessionId, timestamp).then((value) => { if (live.current) setData(value); }).catch((error: unknown) => { if (live.current) useApp.getState().notify(String(error), "error"); });
		return () => { live.current = false; clearTimeout(hoverTimer.current); };
	}, [sessionId, timestamp]);
	const closeHover = () => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(null), 120); };
	const undo = async (path?: string) => {
		if (undoLock.current) return;
		undoLock.current = true; setUndoing(true);
		try {
			await bridge.delivery.undo(sessionId, timestamp, path);
			const value = await bridge.delivery.get(sessionId, timestamp);
			if (live.current) setData(value);
			useApp.getState().notify("已撤销改动", "info");
		} catch (error) { useApp.getState().notify(String(error), "error"); }
		finally { undoLock.current = false; if (live.current) setUndoing(false); }
	};
	const askUndo = (file?: DeliveryFile) => {
		setHover(null);
		confirm.ask({ title: file ? "撤销这个文件的改动？" : "撤销这次文件改动？", detail: "仅撤销已记录的改动；后续修改会保留。", confirmLabel: "撤销改动", onConfirm: () => undo(file?.path) });
	};
	// Reports, warnings and commands cannot manufacture an empty file-change card.
	if (!data?.files.length) return null;
	const added = data.files.reduce((sum, file) => sum + file.added, 0);
	const removed = data.files.reduce((sum, file) => sum + file.removed, 0);
	const remaining = data.files.length - PREVIEW_FILES;
	const relative = (path: string) => workspace ? relativeTo(workspace, path) : path;
	const row = (file: DeliveryFile) => <button key={file.path} type="button" data-delivery-file={file.path}
		className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-label transition-colors hover:bg-card-hover focus-visible:bg-card-hover"
		onMouseEnter={(event) => { clearTimeout(hoverTimer.current); setHover({ anchor: event.currentTarget, file }); }} onMouseLeave={closeHover}
		onFocus={(event) => setHover({ anchor: event.currentTarget, file })} onBlur={closeHover}
		onClick={() => { setHover(null); setReview(file.path); }}>
		<FileName path={relative(file.path)} /><Counts added={file.added} removed={file.removed} />
	</button>;
	return <>
		<section data-turn-delivery aria-label="文件变更" className="mt-3 rounded-xl border border-line bg-card/30 text-label">
			<div className="flex min-h-16 flex-wrap items-center gap-3 px-3 py-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-hover text-ink-muted"><FileDiff size={21} strokeWidth={1.7} /></span>
				<div className="min-w-0 flex-1"><p className="font-medium text-ink">已编辑 {data.files.length} 个文件</p><Counts added={added} removed={removed} /></div>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					<Button size="sm" variant="subtle" icon={<Undo2 size={14} />} disabled={!data.files.every((file) => file.canUndo)} loading={undoing} label="撤销这次文件改动" onClick={() => askUndo()}>撤销</Button>
					<Button size="sm" icon={<Files size={14} />} label="审核全部文件改动" onClick={() => { setHover(null); setReview(true); }}>审核</Button>
				</div>
			</div>
			<div className="px-1 pb-1">
				{data.files.slice(0, PREVIEW_FILES).map(row)}
				{remaining > 0 && <>
					<div id={"delivery-" + timestamp + "-more"} className="ly-reveal" data-open={expanded} aria-hidden={!expanded} inert={!expanded}><div>{data.files.slice(PREVIEW_FILES).map(row)}</div></div>
					<button type="button" aria-expanded={expanded} aria-controls={"delivery-" + timestamp + "-more"} onClick={() => { setHover(null); setExpanded(!expanded); }} className="flex h-9 items-center gap-2 rounded-md px-3 text-ink-muted hover:bg-card-hover hover:text-ink">
						{expanded ? "收起文件" : "再显示 " + remaining + " 个文件"}<ChevronDown size={14} className="transition-transform duration-[var(--ly-t-quick)]" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
					</button>
				</>}
			</div>
		</section>
		{/*
		 * As wide as the row it came out of, which is as wide as the card.
		 *
		 * It was 720 — a number from nowhere, and on an ordinary window some 250px wider than the
		 * card underneath it. The preview hung off both sides of the thing that produced it and read
		 * as a surface from some other layout that happened to land there. The card has no width of
		 * its own to copy: it is as wide as the column, and the column follows the window.
		 *
		 * Measured off the anchor at open time, on the same terms as the position — a popover is
		 * placed by the layout it opened into, and width is part of that placement, not a separate
		 * thing to keep chasing afterwards.
		 */}
		{hover && <Popover anchor={hover.anchor} onClose={() => setHover(null)} role="group" label="文件变更预览" placement="top" align="start" width={hover.anchor.offsetWidth} maxHeight={420} bodyClassName="p-0"
			header={<div className="flex min-w-0 items-center gap-3 px-3 py-2 text-label" onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={closeHover}><FileName path={relative(hover.file.path)} /><Counts added={hover.file.added} removed={hover.file.removed} /></div>}>
			<div onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={closeHover}><DiffView path={hover.file.path} hunks={hover.file.hunks} maxLines={Infinity} /></div>
		</Popover>}
		{review && <Overlay onClose={() => setReview(null)} width={850}>
			<Scroller className="max-h-[75vh]" contentClassName="p-4"><h2 data-dialog-title className="mb-3 text-body text-ink">文件变更</h2>
				{data.files.filter((file) => review === true || review === file.path).map((file) => <div key={file.path} className="mb-4">
					<div className="mb-2 flex items-center gap-3 text-label"><FileName path={relative(file.path)} /><Counts added={file.added} removed={file.removed} /><IconButton size="sm" icon={<Undo2 size={14} />} label={file.canUndo ? "撤销此文件的改动" : "无法自动撤销，请核对后续修改"} explainDisabled disabled={!file.canUndo || undoing} onClick={() => askUndo(file)} /></div>
					<DiffView path={file.path} hunks={file.hunks} maxLines={Infinity} />
				</div>)}
			</Scroller>
		</Overlay>}
		{confirm.element}
	</>;
}
