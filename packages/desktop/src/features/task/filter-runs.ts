import type { ToolRun } from "../../store/tool-run.ts";

const index = new WeakMap<ToolRun, string>();

/** Streaming replaces one run; unchanged historical outputs are indexed only once. */
export function filterRuns(runs: ToolRun[], query: string, status = ""): ToolRun[] {
	const needle = query.trim().toLowerCase();
	return runs.filter(run => {
		if (status && run.status !== status) return false;
		if (!needle) return true;
		let text = index.get(run);
		if (text === undefined) {
			text = [run.toolCallId, run.toolName, run.summary, JSON.stringify(run.args), JSON.stringify(run.result?.details), ...(run.result?.content ?? []).filter(part => part.type === "text").map(part => part.text)].join("\n").toLowerCase();
			index.set(run, text);
		}
		return text.includes(needle);
	});
}
