/**
 * 把一串每日数值画成一条曲线，而且是一条不说谎的曲线。
 *
 * 折线把每一天用直线接起来，读起来是对的，看起来是一排折角——尤其在 7 天这种点很少的区间，
 * 整张图就是几个尖。曲线柔和得多，代价是它会替数据之间的部分编造形状，而这里编造是有下限的：
 * 这是用量图，纵轴从 0 开始，任何一段冲到 0 以下都在说一件没发生过的事。
 *
 * 所以用的是保形的单调三次插值（Fritsch–Carlson），不是随手一条 Catmull-Rom。区别只在极值点：
 * 一个 27.8M 的尖峰旁边跟着一个几乎为 0 的日子，Catmull-Rom 会冲过那个 0 再拐回来，画出一段
 * 负用量；这里在每个峰谷把切线放平，于是每一段都被夹在它两端的值之间——曲线穿过每一个真实的
 * 点，中间不去任何一个数据没到过的地方。
 *
 * 单独一个文件，因为这是纯算术：它值得被直接测，而测它不需要 DOM，也不需要挂一棵 React 树。
 */

export interface Point {
	x: number;
	y: number;
}

/** 两位小数就够画了，路径字符串还能短一半——它每帧都在重算。 */
function trim(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * 每个点上的切线斜率，取到能画出曲线又不会越过数据的那个值。
 *
 * 两条规矩，都是为了「不编造」：峰谷处（左右斜率异号，或者其中一边是平的）切线放平，曲线在那
 * 里到顶就往回走，不会冲过去；其余地方按 Fritsch–Carlson 的圆判据限幅，把过陡的切线拉回单调
 * 区。剩下的就是普通的三点平均，也就是曲线看起来顺的那部分。
 */
function tangents(points: Point[]): number[] {
	const n = points.length;
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		const run = points[i + 1].x - points[i].x;
		slopes.push(run === 0 ? 0 : (points[i + 1].y - points[i].y) / run);
	}

	const m = Array.from<number>({ length: n });
	m[0] = slopes[0];
	m[n - 1] = slopes[n - 2];
	for (let i = 1; i < n - 1; i++) {
		// 异号或有一边为零，就是一个峰或一个谷：切线放平，这一点成为这一段的极值。
		m[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
	}

	for (let i = 0; i < n - 1; i++) {
		if (slopes[i] === 0) {
			// 平段：两端切线都得是平的，否则曲线会在两个相等的值之间鼓出一个包。
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / slopes[i];
		const b = m[i + 1] / slopes[i];
		const radius = a * a + b * b;
		if (radius > 9) {
			const scale = 3 / Math.sqrt(radius);
			m[i] = scale * a * slopes[i];
			m[i + 1] = scale * b * slopes[i];
		}
	}
	return m;
}

/**
 * 穿过所有点的那条曲线，写成 `path` 的 `d`。
 *
 * 一个点画不出线，返回一个只有起笔的路径——`<path>` 认它，画出来什么也没有，而这正是一天的
 * 区间该有的样子。空数组返回空串，`d=""` 同样是合法的什么都不画。
 */
export function curvePath(points: Point[]): string {
	if (points.length === 0) return "";
	const head = `M${trim(points[0].x)},${trim(points[0].y)}`;
	if (points.length === 1) return head;

	const m = tangents(points);
	let d = head;
	for (let i = 0; i < points.length - 1; i++) {
		const from = points[i];
		const to = points[i + 1];
		// 三分之一段长，是埃尔米特形式转成三次贝塞尔时控制点该在的地方。
		const reach = (to.x - from.x) / 3;
		d += `C${trim(from.x + reach)},${trim(from.y + m[i] * reach)} ${trim(to.x - reach)},${trim(to.y - m[i + 1] * reach)} ${trim(to.x)},${trim(to.y)}`;
	}
	return d;
}

/**
 * 同一条曲线，往下合到基线围成的面。
 *
 * 和线共用 `curvePath`，不是另画一条：两条各算各的，是那种谁也不会发现的错位——填充的上沿离
 * 线差半个像素，看上去只是线「毛」了一点。
 */
export function curveArea(points: Point[], baseline: number): string {
	if (points.length === 0) return "";
	const line = curvePath(points);
	const last = points[points.length - 1];
	const first = points[0];
	return `${line}L${trim(last.x)},${trim(baseline)}L${trim(first.x)},${trim(baseline)}Z`;
}
