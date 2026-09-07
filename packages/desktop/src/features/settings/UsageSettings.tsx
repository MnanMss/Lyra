import { MODEL_CATALOG_SOURCE } from "@lyra/core/model-catalog";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageScan } from "../../../electron/usage-scan.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { SkeletonBar, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { ModelIcon } from "../models/index.ts";
import { Card, EmptyHint, Segmented } from "./controls.tsx";
import { dayTotals, providerLabel, summarise, type ModelUse, type Range } from "./usage-aggregate.ts";
import { heatLevel, heatmapWeeks, monthLabels, type DayUsage } from "./usage-heatmap.ts";
import { trendColor, UsageTrendChart, type TrendMetric } from "./usage-charts.tsx";
import { formatCompact, formatCost } from "./usage-format.ts";

const WEEKS = 52;

export function UsageSettings() {
	const providers = useApp((state) => state.settings?.providers);
	const [scan, setScan] = useState<UsageScan | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [range, setRange] = useState<Range>(30);
	const [metric, setMetric] = useState<TrendMetric>("cost");
	const [breakdown, setBreakdown] = useState<"model" | "day">("model");
	const slow = useSlowLoad(scan === null && !failed);

	const load = useCallback(async (refresh = false) => {
		if (refresh) setRefreshing(true);
		setFailed(false);
		try {
			setScan(await bridge.usage.scan());
		} catch {
			setFailed(true);
		} finally {
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const now = useMemo(() => new Date(), []);
	const view = useMemo(() => (scan ? summarise(scan, range, now) : null), [scan, range, now]);
	const grid = useMemo(() => heatmapWeeks(scan ? dayTotals(scan) : [], now, WEEKS), [scan, now]);
	const busiestDay = useMemo(() => Math.max(0, ...grid.flat().map((day) => day.tokens)), [grid]);

	return (
		<div className="pt-8">
			<header className="flex flex-wrap items-start justify-between gap-4 pb-5">
				<div>
					<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">使用统计</h1>
					<p className="mt-2 text-label text-ink-muted">本地会话的 token、缓存与费用分析，数据不会上传。</p>
				</div>
				<div className="flex items-center gap-2">
					<Segmented
						value={String(range)}
						onChange={(next) => setRange(Number(next) as Range)}
						options={[
							{ value: "7", label: "7 天" },
							{ value: "30", label: "30 天" },
							{ value: "90", label: "90 天" },
							{ value: "0", label: "全部" },
						]}
					/>
					<button
						type="button"
						aria-label="刷新用量统计"
						data-ly-tip="重新扫描本地会话日志"
						onClick={() => void load(true)}
						disabled={refreshing}
						className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50"
					>
						<RefreshCw size={14} strokeWidth={1.8} className={refreshing ? "animate-spin" : undefined} />
					</button>
				</div>
			</header>

			{view ? (
				<Dashboard view={view} providers={providers} metric={metric} setMetric={setMetric} breakdown={breakdown} setBreakdown={setBreakdown} grid={grid} busiestDay={busiestDay} />
			) : slow || failed ? (
				<UsageSkeleton failed={failed} />
			) : null}
		</div>
	);
}

type UsageView = ReturnType<typeof summarise>;

function Dashboard({
	view,
	providers,
	metric,
	setMetric,
	breakdown,
	setBreakdown,
	grid,
	busiestDay,
}: {
	view: UsageView;
	providers: { id: string; name: string }[] | undefined;
	metric: TrendMetric;
	setMetric: (metric: TrendMetric) => void;
	breakdown: "model" | "day";
	setBreakdown: (breakdown: "model" | "day") => void;
	grid: DayUsage[][];
	busiestDay: number;
}) {
	const totals = view.totals;
	const pricedTokens = totals.tokens - totals.quality.unpriced;
	const dateRange = rangeLabel(view.series);

	return (
		<div data-usage-dashboard="true" className="@container">
			<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-detail text-ink-faint">
				<span>{dateRange}</span>
				<span>{totals.activeDays} 个活跃日</span>
				<span>{totals.sessionDays} 个会话日</span>
				<span>{totals.messages.toLocaleString()} 条消息</span>
			</div>

			<div className="grid gap-3 @3xl:grid-cols-[minmax(245px,0.78fr)_minmax(0,1.45fr)]">
				<Card className="p-4">
					<div className="text-detail font-medium tracking-wide text-ink-faint">估算费用</div>
					<div className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.03em] text-ink tabular-nums">
						{pricedTokens > 0 ? costLabel(totals.cost) : "暂无价格"}
					</div>
					<div className="mt-1 text-detail text-ink-faint">已记录成本与目录参考价合并估算，中转账单以供应商为准</div>
					<div className="mt-4 space-y-3">
						{view.providers.slice(0, 4).map((provider, index) => (
							<ProviderSpend key={provider.id} name={providerLabel(providers, provider.id)} provider={provider} color={trendColor(index)} />
						))}
						{view.providers.length === 0 && <div className="py-5 text-center text-label text-ink-faint">这个区间没有用量</div>}
					</div>
				</Card>

				<Card>
					<div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
						<div>
							<div className="text-label font-medium text-ink">每日趋势</div>
							<div className="mt-0.5 text-detail text-ink-faint">按供应商拆分，悬停查看当日数据</div>
						</div>
						<Segmented value={metric} onChange={setMetric} options={[{ value: "cost", label: "费用" }, { value: "tokens", label: "Token" }]} />
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-detail text-ink-muted">
						{view.providerTrends.map((provider, index) => (
							<span key={provider.id} className="flex items-center gap-1.5">
								<span className="h-2 w-2 rounded-full" style={{ background: trendColor(index) }} />
								{providerLabel(providers, provider.id)}
							</span>
						))}
					</div>
					{totals.tokens > 0 ? <UsageTrendChart trends={view.providerTrends} metric={metric} /> : <EmptyHint>这个区间没有趋势数据。</EmptyHint>}
				</Card>
			</div>

			<div aria-label="用量指标" className="mt-3 grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-card/40 @2xl:grid-cols-5">
				<Metric label="已处理 Token" value={formatCompact(totals.tokens)} sub={`${formatCompact(totals.activeDays > 0 ? totals.tokens / totals.activeDays : 0)} / 活跃日`} />
				<Metric label="缓存命中" value={formatCompact(totals.cacheRead)} sub={`${percent(totals.cacheRead, totals.input + totals.cacheRead + totals.cacheWrite)} 输入`} />
				<Metric label="未缓存输入" value={formatCompact(totals.input)} sub={`${formatCompact(totals.cacheWrite)} 缓存写入`} />
				<Metric label="输出" value={formatCompact(totals.output)} sub={`含 ${formatCompact(totals.reasoning)} 推理`} />
				<Metric label="缓存净节省" value={signedCost(totals.cacheSavings)} sub={`无缓存约 ${costLabel(totals.rawCost)}`} />
			</div>

			<div className="mt-6 grid gap-3 @3xl:grid-cols-[minmax(0,1.55fr)_260px]">
				<Card>
					<div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
						<div className="text-label font-medium text-ink">明细</div>
						<Segmented value={breakdown} onChange={setBreakdown} options={[{ value: "model", label: "模型" }, { value: "day", label: "日期" }]} />
					</div>
					{breakdown === "model" ? <ModelBreakdown rows={view.models} providers={providers} totalCost={totals.cost} /> : <DayBreakdown rows={view.series} totalCost={totals.cost} />}
				</Card>

				<Card className="p-4">
					<div className="text-label font-medium text-ink">计价质量</div>
					<div className="mt-1 text-detail leading-relaxed text-ink-faint">按 Token 计算覆盖率，未计价用量仍完整保留。</div>
					<QualityBar totals={totals} />
					<div className="mt-3 divide-y divide-line-soft">
						<QualityRow label="供应商返回" value={percent(totals.quality.provider, totals.tokens)} />
						<QualityRow label="离线目录" value={percent(totals.quality.catalog, totals.tokens)} />
						<QualityRow label="手动价格" value={percent(totals.quality.manual, totals.tokens)} />
						<QualityRow label="历史已记录" value={percent(totals.quality.recorded, totals.tokens)} />
						<QualityRow label="未计价" value={percent(totals.quality.unpriced, totals.tokens)} />
						<QualityRow label="缓存净节省" value={signedCost(totals.cacheSavings)} />
					</div>
					<div className="mt-3 text-detail leading-relaxed text-ink-faint">
						目录版本 {MODEL_CATALOG_SOURCE.commit.slice(0, 8)} · {new Date(MODEL_CATALOG_SOURCE.updatedAt).toLocaleDateString()}
					</div>
				</Card>
			</div>

			<div className="pt-6 pb-4">
				<div className="mb-3 text-title font-medium text-ink">使用节奏</div>
				<Card>{busiestDay === 0 ? <EmptyHint>还没有使用记录。</EmptyHint> : <div className="px-4 py-4"><Heatmap grid={grid} busiest={busiestDay} /></div>}</Card>
			</div>
		</div>
	);
}

function ProviderSpend({ name, provider, color }: { name: string; provider: UsageView["providers"][number]; color: string }) {
	return (
		<div>
			<div className="flex items-center gap-2 text-label">
				<ModelIcon model={provider.id} name={name} size={14} />
				<span className="min-w-0 flex-1 truncate text-ink">{name}</span>
				<span className="shrink-0 font-medium text-ink tabular-nums">{provider.unpricedTokens === provider.tokens ? "未计价" : costLabel(provider.cost)}</span>
			</div>
			<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]"><div className="h-full rounded-full" style={{ width: `${Math.max(provider.share * 100, 1)}%`, background: color }} /></div>
			<div className="mt-1 text-detail text-ink-faint tabular-nums">{(provider.share * 100).toFixed(1)}% · {formatCompact(provider.tokens)} token</div>
		</div>
	);
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
	return <div className="min-w-0 border-b border-line-soft px-3.5 py-3 odd:border-r even:border-r-0 last:col-span-2 last:border-b-0 @2xl:border-b-0 @2xl:odd:border-r @2xl:even:border-r @2xl:last:col-span-1 @2xl:last:border-r-0"><div className="truncate text-detail text-ink-muted">{label}</div><div className="mt-1 text-title font-medium text-ink tabular-nums">{value}</div><div className="mt-0.5 truncate text-detail text-ink-faint tabular-nums">{sub}</div></div>;
}

function ModelBreakdown({ rows, providers, totalCost }: { rows: ModelUse[]; providers: { id: string; name: string }[] | undefined; totalCost: number }) {
	if (rows.length === 0) return <EmptyHint>这个区间还没有模型用量。</EmptyHint>;
	return <BreakdownTable rows={rows.slice(0, 12).map((row) => ({ key: row.key, label: row.model, provider: providerLabel(providers, row.provider), cost: row.cost, tokens: row.tokens, unpriced: row.unpricedTokens === row.tokens, share: totalCost > 0 ? row.cost / totalCost : row.share }))} remaining={Math.max(0, rows.length - 12)} />;
}

function DayBreakdown({ rows, totalCost }: { rows: UsageView["series"]; totalCost: number }) {
	const ranked = [...rows].filter((row) => row.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
	if (ranked.length === 0) return <EmptyHint>这个区间还没有每日用量。</EmptyHint>;
	const totalTokens = viewTokens(ranked);
	return <BreakdownTable rows={ranked.slice(0, 12).map((row) => ({ key: row.day, label: fullDate(row.day), provider: "", cost: row.cost, tokens: row.tokens, unpriced: row.cost === 0 && row.tokens > 0, share: totalCost > 0 ? row.cost / totalCost : row.tokens / Math.max(1, totalTokens) }))} remaining={Math.max(0, ranked.length - 12)} />;
}

interface BreakdownRow { key: string; label: string; provider: string; cost: number; tokens: number; unpriced: boolean; share: number }

function BreakdownTable({ rows, remaining }: { rows: BreakdownRow[]; remaining: number }) {
	return <div className="px-4 pb-2"><div className="grid grid-cols-[minmax(0,1fr)_78px_78px] gap-4 border-b border-line-soft py-2 text-detail text-ink-faint @xl:grid-cols-[minmax(0,1fr)_100px_78px_62px_90px]"><span>项目</span><span className="hidden text-right @xl:block">供应商</span><span className="text-right">费用</span><span className="hidden text-right @xl:block">占比</span><span className="text-right">Token</span></div>{rows.map((row) => <div key={row.key} className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_78px_78px] items-center gap-4 border-b border-line-soft text-label last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_100px_78px_62px_90px]"><div className="min-w-0"><div className="truncate text-ink">{row.label}</div>{row.provider && <div className="truncate text-detail text-ink-faint @xl:hidden">{row.provider}</div>}</div><div className="hidden truncate text-right text-detail text-ink-faint @xl:block">{row.provider}</div><div className="text-right text-ink tabular-nums">{row.unpriced ? "未计价" : costLabel(row.cost)}</div><div className="hidden text-right text-ink-muted tabular-nums @xl:block">{(row.share * 100).toFixed(1)}%</div><div className="text-right text-ink-muted tabular-nums">{formatCompact(row.tokens)}</div></div>)}{remaining > 0 && <div className="py-2 text-center text-detail text-ink-faint">另有 {remaining} 项</div>}</div>;
}

function QualityBar({ totals }: { totals: UsageView["totals"] }) {
	const parts = [totals.quality.provider, totals.quality.catalog, totals.quality.manual, totals.quality.recorded, totals.quality.unpriced];
	return <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink/[0.06]">{parts.map((value, index) => value > 0 ? <span key={index} style={{ width: `${(value / Math.max(1, totals.tokens)) * 100}%`, background: index === 4 ? "var(--color-line)" : trendColor(index) }} /> : null)}</div>;
}

function QualityRow({ label, value }: { label: string; value: string }) {
	return <div className="flex items-center justify-between gap-3 py-2 text-label"><span className="text-ink-muted">{label}</span><span className="shrink-0 text-ink tabular-nums">{value}</span></div>;
}

function UsageSkeleton({ failed }: { failed: boolean }) {
	if (failed) return <Card><EmptyHint>读取会话日志失败，用量暂时无法统计。</EmptyHint></Card>;
	return <div aria-busy="true" aria-live="polite"><span className="sr-only">正在读取会话日志</span><div className="grid gap-3 @3xl:grid-cols-2"><Card className="p-4"><SkeletonBar width="36%" height={10} /><SkeletonBar width="52%" height={30} className="mt-3" />{[76, 58, 42].map((width) => <SkeletonBar key={width} width={`${width}%`} height={12} className="mt-4" />)}</Card><Card className="p-4"><SkeletonBar width="24%" height={12} /><div className="mt-5 flex h-[170px] items-end gap-2">{[24, 38, 30, 62, 44, 78, 55, 70, 48, 66, 36, 58].map((height, index) => <span key={index} className="ly-skeleton flex-1 rounded-t" style={{ height: `${height}%` }} />)}</div></Card></div></div>;
}

function Heatmap({ grid, busiest }: { grid: DayUsage[][]; busiest: number }) {
	const labels = monthLabels(grid);
	return <div className="flex w-full overflow-x-auto [justify-content:safe_center]" dir="rtl"><div dir="ltr" className="inline-block py-1"><div className="relative mb-1 h-[14px]">{labels.map((label) => <span key={label.column} className="absolute top-0 text-detail text-ink-faint" style={{ left: label.column * 14 }}>{label.text}</span>)}</div><div className="flex gap-[3px]">{grid.map((week) => <div key={week[0]?.key} className="flex flex-col gap-[3px]">{week.map((day) => { const future = day.date.getTime() > Date.now(); return <span key={day.key} data-ly-tip={future ? undefined : heatTip(day)} data-ly-tip-side="top" className={`h-[11px] w-[11px] rounded-[3px] transition-colors duration-[var(--ly-t-quick)] ${future ? "opacity-40" : ""} ${SHADES[heatLevel(day.tokens, busiest)]}`} />; })}</div>)}</div><div className="mt-2.5 flex items-center justify-end gap-1 text-detail text-ink-faint"><span className="mr-1">少</span>{SHADES.map((shade, index) => <span key={shade} className={`h-[11px] w-[11px] rounded-[3px] ${shade}`} aria-label={`第 ${index} 档`} />)}<span className="ml-1">多</span></div></div></div>;
}

const SHADES = ["bg-ink/[0.06]", "bg-info/25", "bg-info/45", "bg-info/70", "bg-info"] as const;

function heatTip(day: DayUsage): string {
	const date = `${day.date.getMonth() + 1}月${day.date.getDate()}日`;
	if (day.messages === 0) return `${date} · 没有使用`;
	return `${date} · ${day.sessions} 个会话 · ${day.tokens.toLocaleString()} token${day.cost > 0 ? ` · ${costLabel(day.cost)}` : ""}`;
}

function costLabel(value: number): string { return formatCost(value) ?? "$0.00"; }
function signedCost(value: number): string { return `${value < 0 ? "−" : ""}${costLabel(Math.abs(value))}`; }
function percent(value: number, total: number): string { return `${(total > 0 ? (value / total) * 100 : 0).toFixed(1)}%`; }
function viewTokens(rows: { tokens: number }[]): number { return rows.reduce((sum, row) => sum + row.tokens, 0); }
function fullDate(day: string): string { const [year, month, date] = day.split("-"); return `${year}/${Number(month)}/${Number(date)}`; }
function rangeLabel(series: { day: string }[]): string { return series.length > 0 ? `${fullDate(series[0].day)} 至 ${fullDate(series[series.length - 1].day)}` : "暂无日期范围"; }
