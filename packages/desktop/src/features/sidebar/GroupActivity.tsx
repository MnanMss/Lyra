import type { SessionMeta } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { SessionStatus } from "../conversation/index.ts";
import { groupActivity } from "./group-activity.ts";

export function GroupActivity({ sessions }: { sessions: readonly SessionMeta[] }) {
	// A primitive selector avoids waking every heading for unrelated session updates.
	const summary = useApp((state) => {
		const result = groupActivity(sessions.map((session) => session.id), state.activity, state.activeSessionId);
		return `${result.activity ?? ""}|${result.counts.waiting}|${result.counts.running}|${result.counts.failed}|${result.counts.done}`;
	});
	const [activity, waiting, running, failed, done] = summary.split("|");
	const label = [
		Number(waiting) > 0 ? `${waiting} 个会话等待批准` : "",
		Number(running) > 0 ? `${running} 个会话正在执行` : "",
		Number(failed) > 0 ? `${failed} 个会话执行失败` : "",
		Number(done) > 0 ? `${done} 个会话已完成` : "",
	].filter(Boolean).join("\n");
	const state = activity === "waiting" || activity === "running" || activity === "failed" || activity === "done" ? activity : null;
	return (
		<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" data-ly-tip={label || undefined} aria-label={label || undefined}>
			{state && <span aria-hidden className="pointer-events-none"><SessionStatus activity={state} /></span>}
		</span>
	);
}
