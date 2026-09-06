import { ChevronRight, FileText, Files, Globe, ExternalLink, Undo2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeliveryFile, TurnDelivery } from "../../../electron/turn-delivery.ts";
import type { SessionServices } from "../../../shared/session-services.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { relativeTo } from "../../lib/paths.ts";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DiffView } from "../git/index.ts";
import { companionOf, useDock } from "../dock/index.ts";
import { commandBrowser } from "../browser/index.ts";

const deliveries = new Map<string, TurnDelivery>();
export function TurnDeliveryCard({ timestamp }: { timestamp: number }) {
	const sessionId = useApp((state) => state.activeSessionId);
	const workspace = useApp((state) => state.workspace?.path);
	const key = `${sessionId}:${timestamp}`;
	const [record, setRecord] = useState<{ key: string; data: TurnDelivery } | null>(null);
	const [services, setServices] = useState<{ key: string; data: SessionServices } | null>(null);
	const [error, setError] = useState("");
	const [expanded, setExpanded] = useState(true);
	const [review, setReview] = useState(false);
	const [hover, setHover] = useState<{ anchor: HTMLElement; file: DeliveryFile } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const confirm = useConfirmer();
	useEffect(() => {
		if (!sessionId || onPhone()) return;
		let live = true;
		const cached = deliveries.get(key);
		if (cached) setRecord({ key, data: cached });
		else void bridge.delivery.get(sessionId, timestamp).then((data) => { deliveries.set(key, data); if (deliveries.size > 100) deliveries.delete(deliveries.keys().next().value!); if (live) setRecord({ key, data }); }).catch((error: unknown) => { if (live) setError(String(error)); });
		return () => { live = false; clearTimeout(timer.current); };
	}, [sessionId, timestamp, key]);
	const data = record?.key === key ? record.data : deliveries.get(key);
	useEffect(() => {
		if (!sessionId || !data?.serviceJobIds.length || onPhone()) return;
		let live = true, refreshTimer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				if (document.hidden) { refreshTimer = setTimeout(() => void refresh(), 2000); return; }
				const value = await bridge.services.list(sessionId);
				if (!live) return;
				value.jobs = value.jobs.filter((job) => data.serviceJobIds.includes(job.id));
				setServices({ key, data: value });
				if (value.jobs.some((job) => job.finishedAt === undefined)) refreshTimer = setTimeout(() => void refresh(), 2000);
			} catch (error) { if (live) setError(String(error)); }
		};
		void refresh();
		return () => { live = false; clearTimeout(refreshTimer); };
	}, [sessionId, key, data]);
	const endpoints = services?.key === key ? services.data.jobs.filter((job) => job.finishedAt === undefined).flatMap((job) => job.endpoints.filter((entry) => entry.url)) : [];
	const openFile = (path: string) => { void useOpenFile.getState().open({ path, name: path.split(/[\\/]/).pop() || path, isDirectory: false, size: 0 }); useDock.getState().open("file", companionOf("file")); };
	const undo = async (file: DeliveryFile) => {
		if (!sessionId) return;
		try {
			await bridge.delivery.undo(sessionId, timestamp, file.path);
			const next = await bridge.delivery.get(sessionId, timestamp); deliveries.set(key, next); setRecord({ key, data: next });
			useApp.getState().notify("已撤销这个文件的本轮改动", "info");
		} catch (error) { useApp.getState().notify(String(error), "error"); }
	};
	if (!data?.reportPath && !endpoints.length && !error) return null;
	const added = data?.files.reduce((sum, file) => sum + file.added, 0) ?? 0, removed = data?.files.reduce((sum, file) => sum + file.removed, 0) ?? 0;
	return <div data-turn-delivery className="mt-3 text-detail">
		{data?.reportPath && <>
			<div className="flex h-7 items-center gap-1.5 text-ink-muted">
				<button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left"><ChevronRight size={13} className="transition-transform" style={{ transform: expanded ? "rotate(90deg)" : undefined }} /><span>{data.files.length ? `${data.files.length} 个文件` : "本轮验证"}</span>{data.files.length > 0 && <><span className="text-ok tabular-nums">+{added}</span><span className="text-danger tabular-nums">−{removed}</span></>}</button>
				{data.warnings.length > 0 && <span data-ly-tip={data.warnings.join("\n")}><TriangleAlert size={13} className="text-ink-faint" /></span>}
				<IconButton size="sm" label="查看实现与验证记录" icon={<FileText size={14} />} onClick={() => { if (data.reportPath) openFile(data.reportPath); }} />
				<IconButton size="sm" label="审阅本轮所有变更" disabled={!data.files.length} icon={<Files size={14} />} onClick={() => setReview(true)} />
			</div>
			<div className="ly-reveal" data-open={expanded} aria-hidden={!expanded} inert={!expanded}><div><div className="pl-4">
				{data.files.map((file) => <div key={file.path} data-delivery-file className="group/change flex h-7 items-center gap-1.5" onMouseEnter={(event) => { clearTimeout(timer.current); setHover({ anchor: event.currentTarget, file }); }} onMouseLeave={() => { timer.current = setTimeout(() => setHover(null), 120); }}>
					<button type="button" onClick={() => { setHover(null); setReview(true); }} onFocus={(event) => setHover({ anchor: event.currentTarget, file })} onBlur={() => setHover(null)} className="ly-scroll flex min-w-0 flex-1 items-center gap-2 text-left text-ink-muted" data-ly-tip={file.path}><FileText size={12} className="shrink-0" /><ScrollText text={workspace ? relativeTo(workspace, file.path) : file.path} className="min-w-0 flex-1 text-caption" /><span className="shrink-0 text-ok tabular-nums">+{file.added}</span><span className="shrink-0 text-danger tabular-nums">−{file.removed}</span></button>
					<IconButton size="sm" className="opacity-0 group-hover/change:opacity-100 group-focus-within/change:opacity-100" label={file.canUndo ? "撤销此文件的本轮改动" : "文件已有后续修改或由命令修改，请手动审阅"} explainDisabled disabled={!file.canUndo} icon={<Undo2 size={13} />} onClick={() => { setHover(null); confirm.ask({ title: "撤销这个文件的本轮改动？", detail: file.path, confirmLabel: "撤销改动", onConfirm: () => void undo(file) }); }} />
				</div>)}
			</div></div></div>
		</>}
		{endpoints.map((endpoint) => <div key={`${endpoint.pid}:${endpoint.port}:${endpoint.address}`} className="flex items-center gap-1.5 text-caption text-ink-faint"><Globe size={12} /><ScrollText text={endpoint.url ?? ""} className="min-w-0 flex-1 font-mono" /><IconButton size="sm" label="内置浏览器打开服务" icon={<Globe size={12} />} onClick={() => { if (endpoint.url) void commandBrowser({ type: "open", url: endpoint.url, sessionId, newTab: true }); }} /><IconButton size="sm" label="系统浏览器打开服务" icon={<ExternalLink size={12} />} onClick={() => { if (endpoint.url) void bridge.system.openExternal(endpoint.url); }} /></div>)}
		{error && <p role="status" className="text-caption text-danger">交付记录：{error}</p>}
		{hover && <Popover anchor={hover.anchor} onClose={() => setHover(null)} role="group" label="文件变更预览" placement="top" width={560} maxHeight={280} bodyClassName="p-0"><div onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => setHover(null)}><DiffView path={hover.file.path} hunks={hover.file.hunks} maxLines={60} /></div></Popover>}
		{review && data && <Overlay onClose={() => setReview(false)} width={850}><Scroller className="max-h-[75vh]" contentClassName="p-4"><h2 data-dialog-title className="mb-3 text-body text-ink">本轮文件变更</h2>{data.files.map((file) => <div key={file.path} className="mb-4"><ScrollText text={file.path} className="mb-2 text-detail text-ink-muted" /><DiffView path={file.path} hunks={file.hunks} maxLines={Infinity} /></div>)}</Scroller></Overlay>}
		{confirm.element}
	</div>;
}
