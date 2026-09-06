import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ToolRun } from "../../store/index.ts";
import { DetailCard } from "../conversation/index.ts";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { RunDetail } from "./RunDetail.tsx";

const OVERSCAN = 8;

/** Only one record expands, so all other offsets stay a multiple of the measured row height. */
export function TaskRuns({ runs, scrollRef, query = "" }: { runs: ToolRun[]; query?: string; scrollRef: RefObject<HTMLDivElement | null> }) {
	const host = useRef<HTMLDivElement>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const [rowHeight, setRowHeight] = useState(36);
	const [openHeight, setOpenHeight] = useState(0);
	const [range, setRange] = useState({ start: 0, end: 40 });
	const firstId = useRef(runs[0]?.toolCallId);
	const openIndex = runs.findIndex(run => run.toolCallId === openId);
	const extra = openIndex < 0 ? 0 : Math.max(0, openHeight - rowHeight);

	useLayoutEffect(() => {
		const list = host.current;
		const viewport = scrollRef.current;
		if (!list || !viewport) return;
		const added = runs.findIndex(run => run.toolCallId === firstId.current);
		if (added > 0 && viewport.scrollTop > list.offsetTop) viewport.scrollTop += added * rowHeight;
		firstId.current = runs[0]?.toolCallId;
		const measure = () => {
			// A hidden dock pane keeps its window and measurements; zero is not a new row size.
			if (!viewport.clientHeight) return;
			const top = Math.max(0, viewport.scrollTop - list.offsetTop);
			const indexAt = (y: number) => {
				if (openIndex < 0 || y < openIndex * rowHeight) return Math.floor(y / rowHeight);
				if (y < (openIndex + 1) * rowHeight + extra) return openIndex;
				return Math.floor((y - extra) / rowHeight);
			};
			const start = Math.max(0, Math.min(runs.length - 1, indexAt(top) - OVERSCAN));
			const end = Math.min(runs.length, indexAt(top + viewport.clientHeight) + OVERSCAN + 1);
			setRange(prev => prev.start === start && prev.end === end ? prev : { start, end });
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		for (const child of viewport.children) observer.observe(child);
		viewport.addEventListener("scroll", measure, { passive: true });
		return () => { observer.disconnect(); viewport.removeEventListener("scroll", measure); };
	}, [scrollRef, rowHeight, extra, openIndex, runs]);

	const visible = Array.from({ length: Math.max(0, range.end - range.start) }, (_, index) => index + range.start)
		.filter(index => index < runs.length);
	// Keep an expanded record mounted even when it is outside the viewport, preserving detail
	// selection, nested scroll and sticky-header ownership while the rest of the list is windowed.
	if (openIndex >= 0 && !visible.includes(openIndex)) visible.push(openIndex);
	const focusedIndex = runs.findIndex(run => run.toolCallId === focusedId);
	if (focusedIndex >= 0 && !visible.includes(focusedIndex)) visible.push(focusedIndex);
	visible.sort((a, b) => a - b);
	const signature = visible.join(",");
	useLayoutEffect(() => {
		const list = host.current;
		if (!list) return;
		const measure = () => {
			const closed = list.querySelector<HTMLElement>('[data-task-record][data-open="false"]');
			const open = list.querySelector<HTMLElement>('[data-task-record][data-open="true"]');
			if (closed && closed.offsetHeight > 0) setRowHeight(closed.offsetHeight);
			if (open && open.offsetHeight > 0) setOpenHeight(open.offsetHeight);
		};
		measure();
		const observer = new ResizeObserver(measure);
		for (const row of list.children) observer.observe(row);
		return () => observer.disconnect();
	}, [signature, openId]);

	return <div ref={host} className="relative" data-task-records style={{ height: runs.length * rowHeight + extra }}>
		{visible.map(index => {
			const run = runs[index];
			const open = run.toolCallId === openId;
			return <div key={run.toolCallId} data-task-record={run.toolCallId} data-open={open}
				onFocusCapture={() => setFocusedId(run.toolCallId)}
				onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null); }}
				className={`absolute right-0 left-0 flow-root ${open ? "z-20" : ""}`}
				style={{ top: index * rowHeight + (index > openIndex && openIndex >= 0 ? extra : 0) }}>
				<DetailCard enter={false} open={open} onToggle={() => { setOpenId(open ? null : run.toolCallId); setOpenHeight(0); }}
					summary={<ScrollText text={run.summary} className="ly-fade-tail min-w-0 flex-1 text-detail" />}
					trailing={<>
						<span className={`h-[6px] w-[6px] shrink-0 rounded-full ${run.status === "running" ? "ly-pulse bg-info" : run.status === "error" ? "bg-danger" : "bg-ok/70"}`} />
						<Text size="caption" tone="faint" numeric className="shrink-0">{run.finishedAt ? formatSpan(run.finishedAt - run.startedAt) : "进行中"}</Text>
					</>}>
					<RunDetail run={run} query={query} />
				</DetailCard>
			</div>;
		})}
	</div>;
}

function formatSpan(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}
