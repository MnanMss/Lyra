import { onPhone } from "../../../services/index.ts";
import { ChevronRight } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { entryKey, SOURCE_LABEL, STATUS_LABEL, type Entry } from "@lyra/core/trajectory-view";
import { SourceIcon } from "./SourceIcon.tsx";
import { Scroller } from "../../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../../ui/scroll/ScrollText.tsx";

const OVERSCAN = 8;
type Row = { id: string; entry: Entry } | { id: string; turn: number; count: number };

export const TraceList = memo(function TraceList({ entries, selected, onSelect, resetKey, collapsed, onCollapse, target }: {
	entries: Entry[]; selected: string | null; onSelect: (entry: Entry) => void; resetKey: string;
	collapsed: Set<number>; onCollapse: (turn: number) => void; target: string | null;
}) {
	const height = onPhone() ? 44 : 36;
	const viewport = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const previous = useRef("");
	const consumedTarget = useRef<string | null>(null);
	const [range, setRange] = useState({ start: 0, end: 40 });
	const [focused, setFocused] = useState<string | null>(null);
	const rows = useMemo(() => {
		const result: Row[] = []; let last: number | undefined = -1;
		const counts = new Map<number, number>();
		for (const entry of entries) if (entry.turn !== undefined) counts.set(entry.turn, (counts.get(entry.turn) ?? 0) + 1);
		for (const entry of entries) {
			if (entry.turn !== undefined && entry.turn !== last) result.push({ id: `turn:${entry.turn}:${entryKey(entry)}`, turn: entry.turn, count: counts.get(entry.turn) ?? 0 });
			last = entry.turn;
			if (entry.turn === undefined || !collapsed.has(entry.turn)) result.push({ id: entryKey(entry), entry });
		}
		return result;
	}, [entries, collapsed]);
	useLayoutEffect(() => {
		const el = viewport.current; if (!el) return;
		if (previous.current !== resetKey) { previous.current = resetKey; follow.current = true; }
		if (follow.current) el.scrollTop = el.scrollHeight;
		const measure = () => {
			if (!el.clientHeight) return;
			setRange({ start: Math.max(0, Math.floor(el.scrollTop / height) - OVERSCAN), end: Math.min(rows.length, Math.ceil((el.scrollTop + el.clientHeight) / height) + OVERSCAN) });
		};
		measure(); const observer = new ResizeObserver(measure); observer.observe(el);
		el.addEventListener("scroll", measure, { passive: true });
		return () => { observer.disconnect(); el.removeEventListener("scroll", measure); };
	}, [rows, resetKey, height]);
	useLayoutEffect(() => {
		if (!target) { consumedTarget.current = null; return; }
		if (consumedTarget.current === target) return; const index = rows.findIndex(row => row.id === target), el = viewport.current;
		if (index >= 0 && el) { consumedTarget.current = target; follow.current = false; el.scrollTop = Math.max(0, index * height - el.clientHeight / 2); }
	}, [target, rows, height]);
	const indices = Array.from({ length: Math.max(0, range.end - range.start) }, (_, i) => range.start + i).filter(index => index < rows.length);
	const focusedIndex = rows.findIndex(row => row.id === focused);
	if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
	return <Scroller scrollRef={viewport} className="min-h-0 flex-1" contentClassName="pl-2 pr-3" onScroll={el => { follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 4; }}>
		<div data-trace-list role="list" aria-label="轨迹记录" className="relative" style={{ height: rows.length * height }}>
			{indices.map(index => {
				const row = rows[index];
				return <div key={row.id} role="listitem" aria-posinset={index + 1} aria-setsize={rows.length} className="absolute inset-x-0" style={{ top: index * height, height: height }}>
					{"entry" in row ? <button type="button" data-trace-entry={row.id} aria-pressed={selected === row.id} onClick={() => onSelect(row.entry)} onFocus={() => setFocused(row.id)} onBlur={() => setFocused(null)}
						className={`ly-scroll flex h-full w-full items-center gap-2 rounded-md px-1.5 text-left text-caption ${selected === row.id ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover/50"}`} style={{ paddingLeft: row.entry.parentId ? 18 : undefined }}>
						<span className={`flex shrink-0 items-center ${row.entry.status === "running" ? "ly-pulse text-info" : row.entry.status === "error" ? "text-danger" : "text-ink-faint"}`} data-ly-tip={row.entry.status ? STATUS_LABEL[row.entry.status] : SOURCE_LABEL[row.entry.source]}><SourceIcon source={row.entry.source} /></span>
						<ScrollText text={row.entry.summary} className="min-w-0 flex-1" />
						<span className="shrink-0 text-ink-faint tabular-nums" data-ly-tip={`步骤 ${row.entry.step ?? "—"} · ${row.entry.durationMs === undefined ? "未记录耗时" : `${row.entry.durationMs} ms`}`}>#{row.entry.seq}</span>
					</button> : <button type="button" aria-expanded={!collapsed.has(row.turn)} onClick={() => onCollapse(row.turn)} className="flex h-full w-full items-center gap-1.5 px-1.5 text-left text-caption text-ink-faint"><ChevronRight size={12} style={{ transform: collapsed.has(row.turn) ? undefined : "rotate(90deg)" }} /><span>第 {row.turn} 轮</span><span className="ml-auto tabular-nums">{row.count}</span></button>}
				</div>;
			})}
		</div>
	</Scroller>;
});
