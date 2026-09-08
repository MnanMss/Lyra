/**
 * 派活派得多积极，跟着这一轮的推理等级走。
 *
 * `dispatch-guard.ts` 定的是**安全边界**——最多几个同时跑、最深几层、不许自己派自己。那三条
 * 跟推理等级无关，任何等级下都不能破。这里定的是另一件事：在边界之内，模型该有多想派。
 *
 * 为什么这不是可有可无的调味：派一个子代理的成本，是一整轮独立的模型调用加一份从零开始的上下文，
 * 而它省下来的是「中间过程不进我的上下文」。这笔账划不划算，恰恰取决于当前这一轮值多少钱——
 * 推理等级正是用户对这一轮值多少钱的表态。等级调到低，意思是「这件事不值得慢慢想」，而在那种
 * 时候还并行派四个子代理去查，是把用户刚刚省下来的钱，从另一个口子花掉，而且花得更多。
 *
 * 用户看得见的症状是反过来的：把 gpt-6-astra 开到中档，子代理照样一派一大把。因为在此之前，
 * 派活的倾向根本不看等级——提示词里只有一句「最多几个同时跑」，那是上限，不是建议，而模型读
 * 上限的方式历来是「那就派满」。
 *
 * 两头一起管，缺一不可：
 *
 *   - 提示词里说清这一轮该有多想派（软），因为模型是照着提示词决定要不要调 `task` 的；
 *   - 闸门跟着收窄（硬），因为一句建议挡不住一个已经决定要派八个的模型，而排队是唯一不用
 *     拒绝就能把八个变成两个一批的办法。
 */

import type { ThinkingLevel } from "../types/provider.ts";

/**
 * 四档倾向，不是八档。
 *
 * 推理等级有八个名字，但「该不该派活」只有这么几种真正不同的答案。一档一句话会让提示词里多出
 * 五段互相之间只差一个副词的文字，而模型读到的差别近似于零。
 */
export type DelegationTier = "sparing" | "selective" | "ready" | "eager";

/**
 * 等级到倾向。
 *
 * 认不出来的等级（模型自己声明的 `adaptive`、`deep-custom` 之类）按 `selective` 算：那是唯一
 * 一个猜错了两边都不太糟的答案——既不会在便宜的一轮里铺开摊子，也不会把一个真的调高了的会话
 * 按死在「什么都自己做」上。
 */
export function delegationTier(thinking?: ThinkingLevel): DelegationTier {
	switch (thinking) {
		case "off":
		case "minimal":
		case "low":
			return "sparing";
		case "high":
			return "ready";
		case "xhigh":
		case "max":
		case "ultra":
			return "eager";
		default:
			return "selective";
	}
}

/**
 * 这一轮真正的并发上限。
 *
 * 永远只往下收，从不往上放：`maxConcurrentSubAgents` 是用户（或项目配置）定的天花板，推理等级
 * 是在天花板底下的一个选择。把等级调到极致不该让会话突破用户写下的那个数字——那样的话，这个
 * 设置就成了一个可以被别的设置绕过去的设置。
 */
export function delegationConcurrency(limit: number, thinking?: ThinkingLevel): number {
	const ceiling = Math.max(1, Math.floor(limit));
	switch (delegationTier(thinking)) {
		// 一次一个。低档下并行派活省不出时间——它省的是思考，而这里花掉的是调用。
		case "sparing":
			return 1;
		// 一半，向上取整：默认的 4 变成 2，够做「两路并查」，不够做「铺开八个」。
		case "selective":
			return Math.max(1, Math.ceil(ceiling / 2));
		default:
			return ceiling;
	}
}

/**
 * 并发派活之前必须先做完的两件事。
 *
 * 都是看着它出错才写下来的，不是从道理上推出来的。跟着倾向一起走，而不是跟着并发上限走：
 * 一个一次只派一个的等级，读到「并发之前要先……」只会多一段用不上的字。
 */
const PARALLEL_PRECONDITIONS = [
	"并发派活之前，两件事必须先做完：",
	"1. 每个任务都要跳过验证（构建、lint、测试）。跑到一半的验证会让它们互相阻塞——A 的测试跑在 B 改了一半的代码上。最后统一验证一次。",
	"2. 跨任务的契约（A 实现、B 消费的那个接口）必须在派活之前定好，写进各自的 prompt 里。子代理之间看不见对方，没法协商。",
].join("\n");

/**
 * 写进提示词里的那一段。
 *
 * 每一段都带着「为什么」，因为只说结论的规则模型会绕：告诉它「少派点」，它会把八个改成七个；
 * 告诉它派一个的成本是一整轮模型调用加一份新上下文，它才有东西可以拿来跟自己做一遍比较。
 */
export function delegationNote(thinking?: ThinkingLevel): string {
	switch (delegationTier(thinking)) {
		case "sparing":
			return (
				"这一轮的推理等级调得很低，派活也要跟着省着来。除非用户点名要派，或者要读的东西明显" +
				"装不进上下文，否则自己做完——派一个子代理的代价是一整轮独立的模型调用加一份从零" +
				"开始的上下文，在这个等级上，它通常比你自己 grep 一遍还慢，而且更贵。"
			);
		case "selective":
			return (
				"这一轮的推理等级是中档，派活要挑着派。值得派的只有一种：**中间过程你并不需要**的活——" +
				"翻几十个文件找一个答案、把一大段输出压成一句结论。这种活隔离上下文是赚的。" +
				"能用 grep / read 直接做完的就直接做，不要为了并行而并行；也不要把一件事拆成三个" +
				"子代理再自己把结果拼回来，那样你既付了三份调用，又要把三份结果重新读进上下文。" +
				`\n\n${PARALLEL_PRECONDITIONS}`
			);
		case "ready":
			return (
				"这一轮的推理等级偏高，可以主动派活：互相独立的子任务并行派出去是划算的，" +
				"你自己留着做拆分、串联和收口。" +
				`\n\n${PARALLEL_PRECONDITIONS}`
			);
		default:
			return (
				"这一轮的推理等级拉满了，可以放开编排：能拆成互不依赖的几块就并行派出去，" +
				"把闸门用满，自己专心做拆分、串联和最后的验证。" +
				`\n\n${PARALLEL_PRECONDITIONS}`
			);
	}
}
