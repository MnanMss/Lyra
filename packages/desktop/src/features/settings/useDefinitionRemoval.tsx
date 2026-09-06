import { useRef, useState } from "react";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";

const LABELS = { command: "命令", skill: "技能", rule: "规则" };

export function useDefinitionRemoval(kind: keyof typeof LABELS, cwd: string, reload: () => void) {
	const confirm = useConfirmer();
	const inflight = useRef(new Set<string>());
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	async function remove(path: string) {
		if (inflight.current.has(path)) return;
		inflight.current.add(path);
		setPending(new Set(inflight.current));
		try {
			await bridge.capabilities.trash(kind, cwd, path);
			useApp.getState().bumpExtensions();
			reload();
		} catch (cause) {
			useApp.getState().notify(`删除失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
		} finally {
			inflight.current.delete(path);
			setPending(new Set(inflight.current));
		}
	}
	return {
		pending,
		element: confirm.element,
		ask(name: string, path: string) {
			confirm.ask({
				title: `删除${LABELS[kind]}「${name}」？`,
				detail: <><span>{kind === "skill" ? "技能目录及其资源会移入系统废纸篓，可从那里恢复。" : "定义文件会移入系统废纸篓，可从那里恢复。"}</span><span className="mt-2 block break-all font-mono">{path}</span></>,
				confirmLabel: "移入废纸篓",
				onConfirm: () => void remove(path),
			});
		},
	};
}
