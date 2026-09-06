import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_LABEL, type Entry } from "@lyra/core/trajectory-view";

export interface TimeRange { start: number; end: number }

function laneFor(entry: Entry): number {
	return entry.source === "tool-call" ? 1 : entry.source === "compaction" || entry.source === "subagent" ? 2 : 0;
}

/** A canvas keeps thousands of spans out of the DOM; selections filter by real overlap. */
export function TraceTimeline({ entries, range, onRange, onSelect }: { entries: Entry[]; range: TimeRange | null; onRange: (range: TimeRange | null) => void; onSelect: (entry: Entry) => void }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const drag = useRef<{ x: number; time: number } | null>(null);
	const [view, setView] = useState<TimeRange | null>(null);
	const [hint, setHint] = useState("拖动筛选时间范围 · 滚轮缩放 · 右键重置");
	const points = useMemo(() => entries.filter(entry => entry.source === "request" || entry.source === "tool-call" || entry.source === "compaction" || entry.source === "subagent" || entry.source === "assistant" && !entry.linkedSeqs?.length), [entries]);
	const domain = useMemo(() => {
		let start = Infinity, end = -Infinity;
		for (const entry of points) { start = Math.min(start, entry.startedAt ?? entry.ts); end = Math.max(end, entry.finishedAt ?? entry.startedAt ?? entry.ts); }
		return points.length ? { start, end: Math.max(start + 1, end) } : { start: 0, end: 1 };
	}, [points]);
	const shown = view ?? domain;
	useEffect(() => {
		const el = canvas.current; if (!el) return;
		const paint = () => {
			const width = el.clientWidth; if (!width) return;
			const dpr = devicePixelRatio;
			const style = getComputedStyle(el);
			const color = (token: string) => style.getPropertyValue(`--color-${token}`).trim();
			el.width = Math.round(width * dpr); el.height = 56 * dpr;
			const ctx = el.getContext("2d"); if (!ctx) return;
			ctx.scale(dpr, dpr);
			const x = (time: number) => (time - shown.start) / (shown.end - shown.start) * width;
			for (const entry of points) {
				const left = x(entry.startedAt ?? entry.ts), right = x(entry.finishedAt ?? entry.startedAt ?? entry.ts);
				if (right < 0 || left > width) continue;
				const lane = laneFor(entry);
				ctx.fillStyle = entry.status === "error" ? color("danger") : lane === 1 ? color("ok") : lane === 2 ? color("violet") : color("info");
				ctx.globalAlpha = range && ((entry.finishedAt ?? entry.ts) < range.start || (entry.startedAt ?? entry.ts) > range.end) ? 0.2 : 0.8;
				ctx.fillRect(Math.max(0, left), lane * 16 + 5, Math.max(2, Math.min(width, right) - Math.max(0, left)), 10);
				if (entry.ttftMs !== undefined) { ctx.globalAlpha *= 0.45; ctx.fillStyle = color("ink"); ctx.fillRect(left, lane * 16 + 5, Math.max(1, x((entry.startedAt ?? entry.ts) + entry.ttftMs) - left), 10); }
			}
			if (range) { ctx.globalAlpha = 0.15; ctx.fillStyle = color("info"); ctx.fillRect(x(range.start), 0, x(range.end) - x(range.start), 56); }
		};
		paint(); const observer = new ResizeObserver(paint); observer.observe(el);
		return () => observer.disconnect();
	}, [points, shown, range]);
	const timeAt = (x: number, width: number) => shown.start + Math.max(0, Math.min(width, x)) / width * (shown.end - shown.start);
	const hitAt = (el: HTMLCanvasElement, clientX: number, clientY: number) => {
		const bounds = el.getBoundingClientRect();
		const lane = Math.floor((clientY - bounds.top) / 16);
		const time = timeAt(clientX - bounds.left, el.clientWidth);
		let hit: Entry | undefined, distance = Infinity;
		for (const entry of points) {
			if (laneFor(entry) !== lane) continue;
			const start = entry.startedAt ?? entry.ts, end = entry.finishedAt ?? start;
			const gap = Math.max(start - time, time - end, 0);
			if (gap < distance) { hit = entry; distance = gap; }
		}
		// Match the painted lane and interval, including the minimum-width marker for short spans.
		return distance <= (shown.end - shown.start) * 3 / el.clientWidth ? hit : undefined;
	};
	return <div className="mx-3 mt-1 shrink-0" data-trace-timeline>
		<div className="flex justify-between text-caption text-ink-faint"><span>时间概览 · {points.length}</span><button type="button" className="hover:text-ink" onClick={() => { setView(null); onRange(null); }}>{range || view ? "重置范围" : "模型 / 工具 / 压缩与委派"}</button></div>
		<canvas ref={canvas} className="block h-14 w-full touch-none" role="img" aria-label="执行时间概览，拖动筛选，滚轮缩放；也可通过下方记录列表选择" data-ly-tip={hint}
			onPointerDown={event => { if (event.button !== 0) return; const x = event.clientX - event.currentTarget.getBoundingClientRect().left; drag.current = { x, time: timeAt(x, event.currentTarget.clientWidth) }; event.currentTarget.setPointerCapture(event.pointerId); }}
			onPointerMove={event => {
				const el = event.currentTarget, x = event.clientX - el.getBoundingClientRect().left, time = timeAt(x, el.clientWidth);
				if (drag.current) { onRange({ start: Math.min(drag.current.time, time), end: Math.max(drag.current.time, time) }); return; }
				const near = hitAt(el, event.clientX, event.clientY);
				if (near) setHint(`#${near.seq} ${SOURCE_LABEL[near.source]} · ${near.summary}\n${new Date(near.startedAt ?? near.ts).toLocaleString()} · ${near.durationMs === undefined ? "未记录耗时" : `${near.durationMs} ms`}`);
				else setHint("拖动筛选时间范围 · 滚轮缩放 · 右键重置");
			}}
			onPointerUp={event => {
				const start = drag.current; drag.current = null; if (!start) return;
				const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
				if (Math.abs(x - start.x) < 3) { const near = hitAt(event.currentTarget, event.clientX, event.clientY); if (near) onSelect(near); }
			}}
			onPointerCancel={() => { drag.current = null; }}
			onContextMenu={event => { event.preventDefault(); setView(null); onRange(null); }}
			onWheel={event => { const x = event.clientX - event.currentTarget.getBoundingClientRect().left, width = event.currentTarget.clientWidth; const at = timeAt(x, width), span = Math.max(1, Math.min(domain.end - domain.start, (shown.end - shown.start) * (event.deltaY > 0 ? 1.3 : 0.75))); const start = Math.max(domain.start, Math.min(domain.end - span, at - span * x / width)); setView({ start, end: start + span }); }} />
	</div>;
}
