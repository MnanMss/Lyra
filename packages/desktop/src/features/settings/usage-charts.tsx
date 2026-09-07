import type { ProviderTrend } from "./usage-aggregate.ts";
import { formatCompact, formatCost } from "./usage-format.ts";

export type TrendMetric = "cost" | "tokens";

const WIDTH = 640;
const HEIGHT = 212;
const PLOT = { left: 52, right: 12, top: 12, bottom: 28 };
const COLORS = ["var(--color-accent)", "var(--color-violet)", "var(--color-ok)", "var(--color-info)"];

export function trendColor(index: number): string {
	return COLORS[index % COLORS.length];
}

export function UsageTrendChart({ trends, metric }: { trends: ProviderTrend[]; metric: TrendMetric }) {
	const count = Math.max(0, ...trends.map((trend) => trend.points.length));
	const values = trends.flatMap((trend) => trend.points.map((point) => point[metric]));
	const maximum = Math.max(1, ...values);
	const plotWidth = WIDTH - PLOT.left - PLOT.right;
	const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
	const x = (index: number) => PLOT.left + (count <= 1 ? 0 : (index / (count - 1)) * plotWidth);
	const y = (value: number) => PLOT.top + plotHeight - (value / maximum) * plotHeight;
	const ticks = [1, 0.75, 0.5, 0.25, 0];

	return (
		<div className="px-3 pt-2 pb-2" data-usage-chart={metric}>
			<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`每日${metric === "cost" ? "费用" : "token"}趋势`}>
				{ticks.map((share) => {
					const at = PLOT.top + (1 - share) * plotHeight;
					return (
						<g key={share}>
							<line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={at} y2={at} stroke="var(--color-line)" strokeWidth="1" />
							<text x={PLOT.left - 8} y={at + 4} textAnchor="end" fill="var(--color-ink-faint)" fontSize="10" className="tabular-nums">
								{axisValue(maximum * share, metric)}
							</text>
						</g>
					);
				})}

				{trends.map((trend, trendIndex) => {
					const points = trend.points.map((point, index) => `${x(index)},${y(point[metric])}`).join(" ");
					const area = points ? `${PLOT.left},${PLOT.top + plotHeight} ${points} ${x(trend.points.length - 1)},${PLOT.top + plotHeight}` : "";
					const color = trendColor(trendIndex);
					return (
						<g key={trend.id}>
							{area && <polygon points={area} fill={color} opacity="0.055" />}
							<polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
							{count <= 90 &&
								trend.points.map((point, index) =>
									point[metric] > 0 ? (
										<circle
											key={point.day}
											cx={x(index)}
											cy={y(point[metric])}
											r="5"
											fill="transparent"
											stroke="transparent"
											data-ly-tip={`${dateLabel(point.day)} · ${metric === "cost" ? formatCostExact(point.cost) : `${point.tokens.toLocaleString()} token`}`}
											data-ly-tip-side="top"
										/>
									) : null,
								)}
						</g>
					);
				})}

				{count > 0 && (
					<>
						<text x={PLOT.left} y={HEIGHT - 6} fill="var(--color-ink-faint)" fontSize="10">{dateLabel(trends[0]?.points[0]?.day)}</text>
						<text x={WIDTH - PLOT.right} y={HEIGHT - 6} textAnchor="end" fill="var(--color-ink-faint)" fontSize="10">
							{dateLabel(trends[0]?.points[count - 1]?.day)}
						</text>
					</>
				)}
			</svg>
		</div>
	);
}

function axisValue(value: number, metric: TrendMetric): string {
	if (metric === "tokens") return formatCompact(value);
	if (value >= 1_000) return `$${formatCompact(value)}`;
	if (value >= 100) return `$${value.toFixed(0)}`;
	return formatCost(value) ?? "$0";
}

function formatCostExact(value: number): string {
	if (value < 0.005) return `$${value.toFixed(4)}`;
	return formatCost(value) ?? "$0.00";
}

function dateLabel(day: string | undefined): string {
	if (!day) return "";
	const [, month, date] = day.split("-");
	return `${Number(month)}/${Number(date)}`;
}
