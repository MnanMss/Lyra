/**
 * 60-turn epoch health watchdog for agent runs.
 *
 * Monitors progress across epochs (default 60 turns per epoch) to detect
 * pathological retry churn and deadlocks without cutting off healthy long-running tasks.
 */

import type { ToolResult } from "../types.ts";

export const EPOCH_TURNS = 60;
export const MAX_SAFE_EPOCHS = 4; // Safety ceiling: 240 turns max

export interface EpochHealthReport {
	/** Whether the watchdog considers this epoch healthy. */
	healthy: boolean;
	/** Whether the run has repeatedly failed to make progress and should be halted. */
	stalled: boolean;
	/** Warning message to inject if this is the first warning checkpoint. */
	warning?: string;
}

export class EpochWatch {
	private readonly interval: number;
	private totalCallsInEpoch = 0;
	private failedCallsInEpoch = 0;
	private consecutiveFailedTurns = 0;
	private warnedEpoch = false;

	constructor(interval = EPOCH_TURNS) {
		this.interval = interval;
	}

	/**
	 * Observe one completed turn with its tool calls and results.
	 */
	observeTurn(toolCalls: { name: string }[], results: ToolResult[]): void {
		if (toolCalls.length === 0) return;

		this.totalCallsInEpoch += toolCalls.length;
		const failures = results.filter((r) => r.isError).length;
		this.failedCallsInEpoch += failures;

		if (failures === toolCalls.length) {
			this.consecutiveFailedTurns += 1;
		} else {
			this.consecutiveFailedTurns = 0;
		}
	}

	/**
	 * Check whether the given turn is an epoch checkpoint boundary.
	 */
	isCheckpoint(turn: number): boolean {
		return turn > 0 && turn % this.interval === 0;
	}

	/**
	 * Evaluate health at a checkpoint.
	 */
	evaluateCheckpoint(turn: number): EpochHealthReport {
		const failureRate = this.totalCallsInEpoch > 0 ? this.failedCallsInEpoch / this.totalCallsInEpoch : 0;
		// A chronically failing epoch: high failure rate (> 60%) or long streak of completely failed turns
		const isChronicallyFailing = (this.totalCallsInEpoch >= 10 && failureRate >= 0.6) || this.consecutiveFailedTurns >= 10;

		if (!isChronicallyFailing) {
			// Healthy epoch: reset epoch stats and clear any warning
			this.resetEpoch();
			this.warnedEpoch = false;
			return { healthy: true, stalled: false };
		}

		if (this.warnedEpoch) {
			// Second consecutive failing epoch -> stall
			return {
				healthy: false,
				stalled: true,
			};
		}

		// First failing epoch -> warn and give the model another epoch to course-correct
		this.warnedEpoch = true;
		this.resetEpoch();
		return {
			healthy: false,
			stalled: false,
			warning:
				`（系统心跳检查点：已执行 ${turn} 轮）检测到近期多数尝试均返回错误或遇到同类阻碍。` +
				`请不要继续重复已失效的操作；请重新评估排查假设、更换工具方法，或直接说明当前卡在哪里、需要什么。`,
		};
	}

	private resetEpoch(): void {
		this.totalCallsInEpoch = 0;
		this.failedCallsInEpoch = 0;
		this.consecutiveFailedTurns = 0;
	}
}
