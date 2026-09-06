import { useEffect, useRef, useState } from "react";
import { Disclosure } from "../../../ui/layout/Disclosure.tsx";
import { SourceIcon } from "./SourceIcon.tsx";
import { available } from "../../../services/index.ts";
import { ArrowUpRight, FileText, GitBranch, ScrollText as OutputIcon, X } from "lucide-react";
import { openViewer } from "../../image/index.ts";
import { SOURCE_LABEL, STATUS_LABEL, entryKey, type Entry } from "@lyra/core/trajectory-view";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../../ui/scroll/ScrollText.tsx";
import { Popover, type Anchor } from "../../../ui/overlay/Popover.tsx";
import { TraceText } from "../detail/TraceText.tsx";

export function TraceInspector({ anchor, entry, all, query, onSelect, onClose, onExport, onOutput, onFork }: {
	anchor: Anchor;
	entry: Entry; all: Entry[]; query: string; onSelect: (entry: Entry) => void; onClose: () => void; onExport: () => void; onOutput: () => void; onFork: () => void;
}) {
	const [details, setDetails] = useState(false);
	const header = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = header.current;
		if (!element) return;
		const previous = document.activeElement;
		const opener = previous instanceof HTMLElement && previous !== document.body ? previous : null;
		const popup = element.closest("[data-ly-popover]");
		element.focus({ preventScroll: true });
		return () => {
			// Restore after React's DOM commit, which can otherwise return focus to the body.
			// A sibling popover or an outside click may already own the user's new focus.
			if (document.activeElement !== document.body && !popup?.contains(document.activeElement)) return;
			const fallback = anchor instanceof HTMLElement ? anchor.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
			const target = opener?.isConnected ? opener : fallback;
			if (target?.isConnected) target.focus({ preventScroll: true });
		};
	}, [anchor]);
	const pairs = all.filter(candidate => candidate !== entry && (entry.linkedSeqs?.includes(candidate.seq) || entry.source === "subagent" && candidate.parentId === entry.correlationId));
	const facts: [string, string | number | undefined][] = [
		["状态", entry.status && STATUS_LABEL[entry.status]], ["供应商", entry.provider], ["模型", entry.model],
		["调用 ID", entry.correlationId], ["父 Agent", entry.parentId],
		["开始", entry.startedAt === undefined ? undefined : new Date(entry.startedAt).toLocaleString()],
		["结束", entry.finishedAt === undefined ? undefined : new Date(entry.finishedAt).toLocaleString()],
		["耗时", entry.durationMs === undefined ? undefined : `${entry.durationMs.toLocaleString()} ms`],
		["首 Token", entry.ttftMs === undefined ? undefined : `${entry.ttftMs.toLocaleString()} ms`],
		["生成", entry.decodeMs === undefined ? undefined : `${entry.decodeMs.toLocaleString()} ms`],
		["生成速度", entry.decodeMs && entry.usage ? `${(entry.usage.output / entry.decodeMs * 1000).toFixed(1)} token/s` : undefined],
	];
	return <Popover anchor={anchor} onClose={onClose} role="dialog" label="记录详情" width={480} maxHeight={480} className="ly-trace-inspector" header={
		<div ref={header} tabIndex={-1} role="group" aria-label="记录详情" data-trace-inspector-header className="flex h-9 shrink-0 items-center gap-1.5 px-2 text-caption text-ink-muted outline-none">
			<SourceIcon source={entry.source} /><ScrollText text={`#${entry.seq} · ${SOURCE_LABEL[entry.source]} · ${entry.summary}`} className="min-w-0 flex-1" />
			{available("sessions", "exportTrajectory") && <IconButton label="在文件中查看完整记录" size="sm" icon={<FileText size={12} />} onClick={onExport} />}
			{available("sessions", "exportTrajectory") && entry.metadata && typeof entry.metadata === "object" && "outputPath" in entry.metadata && typeof entry.metadata.outputPath === "string" ? <IconButton label="查看完整原始输出" size="sm" icon={<OutputIcon size={12} />} onClick={onOutput} /> : null}
			<IconButton label="从这里分叉" size="sm" icon={<GitBranch size={12} />} onClick={onFork} />
			<IconButton label="关闭记录详情" size="sm" icon={<X size={12} />} onClick={onClose} />
		</div>
		}><div className="pb-3 pr-2">

			{entry.input && <TraceText title="输入" text={entry.input} kind={entry.toolName ? "json" : "text"} query={query} />}
			{entry.command && entry.command !== entry.input && <TraceText title="命令" text={entry.command} kind="shell" query={query} />}
			{entry.detail && entry.detail !== entry.input && entry.detail !== entry.output && <TraceText title="详情" text={entry.detail} query={query} />}
			{entry.output && <TraceText title="输出" text={entry.output} query={query} />}
			<div className="px-3 py-1"><Disclosure compact title="记录信息" open={details} onToggle={() => setDetails(value => !value)}>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-caption">
				{facts.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label} className="contents"><dt className="text-ink-faint">{label}</dt><dd className="min-w-0 break-words text-ink-muted tabular-nums">{value}</dd></div>)}
			</dl>
			{entry.usage && <TraceText title="Token 用量" kind="json" text={JSON.stringify(entry.usage, null, 2)} />}
			{entry.metadata !== undefined && <TraceText title="结构化详情" kind="json" text={JSON.stringify(entry.metadata, null, 2)} query={query} />}
			</Disclosure></div>
			{entry.images?.map((part, index) => <button type="button" key={index} className="mx-3 my-2 block" onClick={event => openViewer((entry.images ?? []).map(image => ({ src: `data:${image.mimeType};base64,${image.data}` })), index, event.currentTarget.getBoundingClientRect(), event.currentTarget)}><img alt={`记录 #${entry.seq} 图片 ${index + 1}`} className="max-h-52 max-w-full rounded-lg object-contain" src={`data:${part.mimeType};base64,${part.data}`} /></button>)}
			{pairs.length > 0 && <div className="px-3 py-2"><p className="mb-1 text-caption text-ink-faint">关联记录 · {pairs.length}</p>{pairs.slice(0, 20).map(pair => <button type="button" key={entryKey(pair)} className="ly-item ly-scroll flex h-7 w-full min-w-0 gap-2 rounded px-1 text-left text-caption text-ink-muted" onClick={() => onSelect(pair)}><SourceIcon source={pair.source} size={12} /><span className="shrink-0 tabular-nums">#{pair.seq}</span><ScrollText text={`${SOURCE_LABEL[pair.source]} · ${pair.summary}`} className="min-w-0 flex-1" /><ArrowUpRight size={12} className="shrink-0" /></button>)}{pairs.length > 20 && <p className="text-caption text-ink-faint">搜索父 Agent ID 可查询全部关联记录。</p>}</div>}
		</div></Popover>;
}
