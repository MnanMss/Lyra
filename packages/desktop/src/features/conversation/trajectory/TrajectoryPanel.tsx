import { History, Download, FileText, RefreshCw, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { countBySource, entryKey, filterTrajectory, STATUS_LABEL, type Entry, type Source, type TrajectoryFilter } from "@lyra/core/trajectory-view";
import { PanelEmpty } from "../../../ui/layout/PanelEmpty.tsx";
import { SearchField } from "../../../ui/inputs/SearchField.tsx";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { useApp } from "../../../store/index.ts";
import { useOpenFile } from "../../../store/openFile.ts";
import { useDock, companionOf } from "../../dock/index.ts";
import { SourceFilter } from "./SourceFilter.tsx";
import { useTrajectory } from "./useTrajectory.ts";
import { TraceList } from "./TraceList.tsx";
import { TraceInspector } from "./TraceInspector.tsx";
import { TraceTimeline, type TimeRange } from "./TraceTimeline.tsx";
import { useTraceFocus } from "./navigation.ts";
import { available, bridge } from "../../../services/index.ts";

export function TrajectoryPanel() {
	const meta = useApp(state => state.meta);
	return meta ? <SessionTrajectory key={meta.id} /> : <PanelEmpty icon={History} title="轨迹">打开一个对话，这里会显示它的完整记录。</PanelEmpty>;
}

function SessionTrajectory() {
	const meta = useApp(state => state.meta);
	const { all, loading, error, refresh } = useTrajectory();
	const [sources, setSources] = useState<Source[]>([]);
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const [status, setStatus] = useState<TrajectoryFilter["status"]>();
	const [time, setTime] = useState<TimeRange | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [target, setTarget] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(new Set<number>());
	const focus = useTraceFocus();
	const appliedFocus = useRef(-1);
	const sessionId = meta?.id;
	const counts = useMemo(() => countBySource(all), [all]);
	const entries = useMemo(() => filterTrajectory(all, { sources, query: deferredQuery, status, time: time ?? undefined }), [all, sources, deferredQuery, status, time]);
	const picked = all.find(entry => entryKey(entry) === selected);
	const totals = useMemo(() => {
		const requests = new Set(all.filter(entry => entry.source === "request").flatMap(entry => entry.linkedSeqs ?? []));
		return all.reduce((total, entry) => {
			if (entry.usage && (entry.source === "request" || !requests.has(entry.seq))) { total.tokens += entry.usage.total; total.cost += entry.usage.cost.total; }
			if (entry.source === "tool-call") total.tools++;
			return total;
		}, { tokens: 0, cost: 0, tools: 0 });
	}, [all]);
	const navigate = (entry: Entry) => {
		setSources([]); setQuery(""); setStatus(undefined); setTime(null); setCollapsed(new Set());
		setSelected(entryKey(entry)); setTarget(entryKey(entry));
	};
	useEffect(() => {
		if (!sessionId || focus.sessionId !== sessionId || !focus.correlationId || appliedFocus.current === focus.nonce) return;
		const entry = all.find(entry => entry.correlationId === focus.correlationId && entry.source === "tool-call");
		if (entry) { appliedFocus.current = focus.nonce; setSources([]); setQuery(""); setStatus(undefined); setTime(null); setCollapsed(new Set()); setSelected(entryKey(entry)); setTarget(entryKey(entry)); }
	}, [focus.nonce, focus.sessionId, focus.correlationId, sessionId, all]);
	const exportFile = async (format: "md" | "json" | "output", entry?: Entry) => {
		if (!meta) return;
		try {
			const path = await bridge.sessions.exportTrajectory(meta.projectId, meta.id, format, entry ? { id: entryKey(entry) } : undefined);
			await useOpenFile.getState().open({ path, name: path.split(/[\\/]/).pop() || path, isDirectory: false, size: 0 });
			useDock.getState().open("file", companionOf("file"));
		} catch (error) { useApp.getState().notify(String(error), "error"); }
	};
	const fork = async () => {
		if (!meta || !picked) return;
		try { const result = await bridge.sessions.fork(meta.projectId, meta.id, picked.seq); if (result) await useApp.getState().openSession(result.meta); else throw new Error("分叉失败"); }
		catch (error) { useApp.getState().notify(String(error), "error"); }
	};
	return <div className="flex min-h-0 flex-1 flex-col" data-trajectory>
		<div className="flex shrink-0 items-center gap-1 px-2 pt-1.5">
			<SearchField value={query} onChange={setQuery} placeholder="搜索命令、输出、模型或调用 ID…" className="flex-1" />
			<IconButton size="sm" label="重新读取轨迹" icon={<RefreshCw size={12} />} onClick={refresh} />
			{available("sessions", "exportTrajectory") && <IconButton size="sm" label="导出完整 JSON 轨迹" icon={<Download size={12} />} onClick={() => void exportFile("json")} />}
			{available("sessions", "exportTrajectory") && <IconButton size="sm" label="查看完整 Markdown 轨迹" icon={<FileText size={12} />} onClick={() => void exportFile("md")} />}
		</div>
		<div className="flex shrink-0 items-center gap-2 px-3 pt-1 text-caption text-ink-faint tabular-nums" data-trace-count>
			<span>{entries.length}/{all.length}</span><span>{totals.tools} 次工具</span><span>{totals.tokens.toLocaleString()} tokens</span>{totals.cost > 0 && <span>${totals.cost.toFixed(4)}</span>}
		</div>
		<TraceTimeline entries={all} range={time} onRange={setTime} onSelect={navigate} />
		<SourceFilter selected={sources} counts={counts} onToggle={source => setSources(current => current.includes(source) ? current.filter(value => value !== source) : [...current, source])} onClear={() => setSources([])} />
		<div className="flex shrink-0 items-center gap-1 px-3 pb-1">
			<select aria-label="筛选执行状态" value={status ?? ""} className="min-w-0 bg-transparent text-caption text-ink-muted" onChange={event => { const value = event.target.value; setStatus(value === "running" || value === "done" || value === "error" || value === "cancelled" || value === "skipped" || value === "interrupted" ? value : undefined); }}><option value="">所有状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
			<span className="flex-1" />
			<IconButton size="sm" label={collapsed.size ? "展开所有轮次" : "收起所有轮次"} icon={collapsed.size ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(all.flatMap(entry => entry.turn === undefined ? [] : [entry.turn])))} />
		</div>
		{error && <p role="alert" className="px-3 py-1 text-caption text-danger">读取失败：{error}</p>}
		{loading ? <p role="status" className="px-3 py-2 text-caption text-ink-faint">读取中…</p> : !entries.length && <p className="px-3 py-2 text-caption text-ink-faint">{all.length ? "没有匹配的记录。" : "这个对话还没有记录。"}</p>}
		<TraceList entries={entries} selected={selected} onSelect={entry => { setTarget(null); setSelected(entryKey(entry)); }} resetKey={JSON.stringify([sources, deferredQuery, status, time])} collapsed={collapsed} onCollapse={turn => setCollapsed(previous => { const next = new Set(previous); if (next.has(turn)) next.delete(turn); else next.add(turn); return next; })} target={target} />
		{picked && <TraceInspector key={entryKey(picked)} entry={picked} all={all} query={deferredQuery} onSelect={navigate} onClose={() => setSelected(null)} onExport={() => void exportFile("json", picked)} onOutput={() => void exportFile("output", picked)} onFork={() => void fork()} />}
	</div>;
}
