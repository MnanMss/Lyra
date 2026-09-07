/**
 * 趋势曲线画出来的形状，尤其是它在数据点之间去了哪里。
 *
 * 一条平滑曲线要替数据之间的部分编一个形状出来，这里关心的就是它编到什么程度。用量图的纵轴
 * 从 0 起，一段冲到 0 以下的曲线画的是一天负的花费；这在真实数据上不是理论问题——一个 27.8M
 * 的尖峰旁边就跟着一个几乎为 0 的日子，而那正是最容易冲出去的形状。
 *
 * 所以测的不是「路径字符串长什么样」，是把每一段三次贝塞尔采样出来，看它有没有走到它两端的
 * 值之外。路径怎么写可以变，这条性质不能。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { curveArea, curvePath, type Point } from "../src/features/settings/usage-chart-curve.ts";

/** 均匀铺开的一串值，就是图表喂给它的形状：x 等距，y 是当天的用量。 */
function series(values: number[]): Point[] {
	return values.map((y, index) => ({ x: index * 10, y }));
}

type Segment = [Point, Point, Point, Point];

/** 把 `d` 读回成一段段贝塞尔。测试不重算切线——它只看画出来的那条线。 */
function segments(d: string): Segment[] {
	const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
	assert.ok(numbers.length >= 2, `路径里没有起点：${d}`);
	let from: Point = { x: numbers[0], y: numbers[1] };
	const out: Segment[] = [];
	for (let i = 2; i + 5 < numbers.length; i += 6) {
		const to: Point = { x: numbers[i + 4], y: numbers[i + 5] };
		out.push([from, { x: numbers[i], y: numbers[i + 1] }, { x: numbers[i + 2], y: numbers[i + 3] }, to]);
		from = to;
	}
	return out;
}

function at([p0, p1, p2, p3]: Segment, t: number): number {
	const u = 1 - t;
	return u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
}

/** 整条曲线上的极值，采得够密以至于错过一个鼓包的可能性可以忽略。 */
function extremes(d: string): { low: number; high: number } {
	let low = Infinity;
	let high = -Infinity;
	for (const segment of segments(d)) {
		for (let step = 0; step <= 50; step++) {
			const y = at(segment, step / 50);
			low = Math.min(low, y);
			high = Math.max(high, y);
		}
	}
	return { low, high };
}

describe("趋势曲线", () => {
	it("穿过每一个真实的点", () => {
		const points = series([12, 40, 5, 33]);
		const drawn = segments(curvePath(points));
		assert.equal(drawn.length, 3);
		points.forEach((point, index) => {
			const on = index === 0 ? drawn[0][0] : drawn[index - 1][3];
			assert.equal(on.x, point.x, `第 ${index} 天的横坐标`);
			assert.equal(on.y, point.y, `第 ${index} 天的值`);
		});
	});

	/*
	 * 这条是整个文件存在的理由。
	 *
	 * 数据取的就是截图里那张图的形状：一个远高于其余的尖峰，紧接着落回接近 0。随手一条
	 * Catmull-Rom 在这里会冲过 0 再拐回来——画面上是曲线钻到横轴底下，读出来是负的用量。
	 */
	it("尖峰旁边不会冲到数据之外", () => {
		const values = [7, 4.6, 27.8, 13.9, 8, 3, 0];
		const { low, high } = extremes(curvePath(series(values)));
		assert.ok(low >= Math.min(...values) - 1e-9, `曲线跌到了数据下面：${low}`);
		assert.ok(high <= Math.max(...values) + 1e-9, `曲线冲到了数据上面：${high}`);
	});

	it("零值那天就是零，不会被邻居托起来", () => {
		// SVG 里 0 在下边，所以「不低于 0」在这条曲线上是「不小于 0」——方向无关，夹住就行。
		const { low } = extremes(curvePath(series([0, 90, 0, 90, 0])));
		assert.ok(low >= 0, `曲线在零值附近下探到了 ${low}`);
	});

	it("持平的一段是平的，不是一串包", () => {
		const { low, high } = extremes(curvePath(series([20, 20, 20, 60])));
		assert.ok(low >= 20 - 1e-9 && high <= 60 + 1e-9, `平段被鼓了起来：${JSON.stringify({ low, high })}`);
	});

	it("单调上升的一段一路不回头", () => {
		const drawn = segments(curvePath(series([1, 5, 9, 30, 90])));
		let previous = -Infinity;
		for (const segment of drawn) {
			for (let step = 0; step <= 50; step++) {
				const y = at(segment, step / 50);
				assert.ok(y >= previous - 1e-9, `曲线在上升途中回落了：${y} < ${previous}`);
				previous = y;
			}
		}
	});

	it("一天画不成线，零天什么也不画", () => {
		assert.equal(curvePath([]), "");
		assert.equal(curvePath([{ x: 4, y: 9 }]), "M4,9");
		assert.equal(curveArea([], 100), "");
	});

	it("面积和线是同一条曲线，只多了合回基线的两笔", () => {
		const points = series([3, 18, 7]);
		const line = curvePath(points);
		const area = curveArea(points, 200);
		assert.ok(area.startsWith(line), "面积的上沿就是那条线，差半个像素都会显得线在发毛");
		assert.equal(area.slice(line.length), "L20,200L0,200Z");
	});
});
