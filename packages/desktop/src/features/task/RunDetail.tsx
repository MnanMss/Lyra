import { History, ScrollText as OutputIcon } from "lucide-react";
import type { ToolRun } from "../../store/index.ts";
import { useApp } from "../../store/index.ts";
import { TraceText, showTrace } from "../conversation/index.ts";
import { bridge } from "../../services/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { companionOf, useDock } from "../dock/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";

export function RunDetail({ run, query = "" }: { run: ToolRun; query?: string }) {
	const sessionId = useApp(state => state.activeSessionId);
	const meta = useApp(state => state.meta);
	const openOutput = async () => {
		if (!meta) return;
		try {
			const path = await bridge.sessions.exportTrajectory(meta.projectId, meta.id, "output", { correlationId: run.toolCallId });
			await useOpenFile.getState().open({ path, name: path.split(/[\\/]/).pop() || path, isDirectory: false, size: 0 });
			useDock.getState().open("file", companionOf("file"));
		} catch (error) { useApp.getState().notify(String(error), "error"); }
	};
	const output = (run.result?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
	return <>
		<div className="flex items-center gap-2 px-3 pt-2 text-caption text-ink-faint">
			<span className="min-w-0 flex-1 break-all">{run.toolName} · {run.toolCallId}</span>
			{run.result?.details && typeof run.result.details === "object" && "outputPath" in run.result.details && typeof run.result.details.outputPath === "string" ? <IconButton size="sm" label="查看完整原始输出" icon={<OutputIcon size={13} />} onClick={() => void openOutput()} /> : null}
			{sessionId && <IconButton size="sm" label="在轨迹中查看这次调用" icon={<History size={13} />} onClick={() => showTrace(sessionId, run.toolCallId)} />}
		</div>
		<p className="px-3 pt-1 text-caption text-ink-faint tabular-nums">{new Date(run.startedAt).toLocaleString()} {run.finishedAt === undefined ? "· 进行中" : `→ ${new Date(run.finishedAt).toLocaleString()}`}</p>
		<TraceText title="参数" kind="json" text={JSON.stringify(run.args, null, 2)} query={query} />
		<TraceText title={run.status === "error" ? "错误" : "结果"} text={output || (run.status === "running" ? "等待输出…" : "（无文本输出）")} query={query} />
		{run.result?.details !== undefined && <TraceText title="执行详情" kind="json" text={JSON.stringify(run.result.details, null, 2)} query={query} />}
		{run.result?.content.filter(part => part.type === "image").map((part, index) => <img key={index} alt={`工具结果图片 ${index + 1}`} src={`data:${part.mimeType};base64,${part.data}`} className="mx-3 my-2 max-h-40 max-w-[calc(100%-24px)] rounded-lg object-contain" />)}
	</>;
}
