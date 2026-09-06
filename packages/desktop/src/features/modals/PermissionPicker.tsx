import type { PermissionMode } from "@lyra/core";
import { Folder, Terminal, Globe,
	Check,
	CircleAlert,
	Hand,
	SquareTerminal,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import {
	MenuBody,
	MenuItem,
	MenuLabel,
	Popover,
	type Anchor,
} from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { useApp } from "../../store/index.ts";

const MODES: {
	value: PermissionMode;
	icon: typeof Hand;
	title: string;
	detail: string;
	danger?: boolean;
}[] = [
	{
		value: "ask",
		icon: Hand,
		title: "请求批准",
		detail: "编辑文件和访问网络时始终询问",
	},
	{
		value: "auto",
		icon: SquareTerminal,
		title: "帮我批准",
		detail: "仅对检测到的风险操作请求批准",
	},
	{
		value: "full",
		icon: CircleAlert,
		title: "完全访问权限",
		detail: "可不受限制地访问网络和你电脑上的任何文件",
		danger: true,
	},
];

/**
* Permission mode, anchored to the chip that shows it.
*
* It was a centred dialog, which read as a decision about the whole app rather than a setting
* attached to the control right there in the composer — the same reason the model and effort
* menus hang off their own chips.
*/
export function PermissionPicker({
	anchor,
	onClose,
}: {
	anchor: Anchor;
	onClose: () => void;
}) {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const current = settings?.permissionMode ?? "auto";
	const [confirming, setConfirming] = useState(false);

	function choose(mode: PermissionMode) {
		if (!settings) return;
		void saveSettings({ ...settings, permissionMode: mode });
		onClose();
	}

	return (
		<>
			{!confirming && (
				<Popover
					anchor={anchor}
					onClose={onClose}
					placement="top"
					align="start"
					width="wide"
					label="权限模式"
				>
					<MenuBody>
						<MenuLabel>应如何批准 Lyra 操作？</MenuLabel>
						{MODES.map((mode) => (
							<MenuItem
								key={mode.value}
								icon={
									<mode.icon
										size={13}
										strokeWidth={1.8}
										className={mode.danger ? "text-danger" : undefined}
									/>
								}
								detail={mode.detail}
								selected={current === mode.value}
								trailing={
									current === mode.value ? (
										<Check
											size={13}
											strokeWidth={2.2}
											className={`mt-[3px] shrink-0 ${mode.danger ? "text-danger" : ""}`}
										/>
									) : undefined
								}
								onClick={() => {
									/*
									* Turning full access on is asked about once, deliberately.
									*
									* Every other row here narrows what happens without asking; this one
									* removes the asking entirely, for the file system and the network
									* both. A setting that consequential should not be one stray click
									* away — and the click that reaches it is usually aimed at the row
									* above.
									*/
									if (mode.danger && current !== mode.value)
										setConfirming(true);
									else choose(mode.value);
								}}
							>
								{/* Full access keeps its colour even though every other row is plain ink: it is
						    the one setting that must never be quietly on. */}
								<span className={mode.danger ? "text-danger" : undefined}>
									{mode.title}
								</span>
							</MenuItem>
						))}
					</MenuBody>
				</Popover>
			)}

			{confirming && (
				<Overlay onClose={() => { setConfirming(false); onClose(); }} returnFocus={anchor instanceof HTMLElement ? anchor : undefined} width={480}>{(dismiss) => <>
					<Scroller contentClassName="p-6">
						<h2 className="flex items-center gap-2.5 text-body font-semibold text-ink"><TriangleAlert size={20} className="shrink-0 text-danger" />开启完全访问权限？</h2>
						<p className="mt-3 text-label leading-relaxed text-ink-muted">Lyra 将直接执行操作，不再逐项请求批准。</p>
						<div className="mt-4 divide-y divide-line-soft rounded-2xl bg-card px-4">
							{[
								{ icon: <Folder size={23} className="text-accent" />, title: "文件和文件夹", detail: "读写、上传或删除此电脑上的文件，不限于当前项目。" },
								{ icon: <Terminal size={23} className="text-ink-muted" />, title: "终端与 Git", detail: "运行命令、安装软件、更改系统设置与 Git 历史。" },
								{ icon: <Globe size={23} className="text-accent" />, title: "网络与插件", detail: "访问网络、发送数据及调用已连接的工具。" },
							].map((item) => <div key={item.title} className="flex items-center gap-3 py-3"><span className="shrink-0">{item.icon}</span><div><p className="text-label font-medium text-ink">{item.title}</p><p className="mt-0.5 text-detail leading-relaxed text-ink-muted">{item.detail}</p></div></div>)}
						</div>
						<p className="mt-4 text-detail leading-relaxed text-ink-faint">可能造成数据丢失或泄露。可随时切回「帮我批准」。</p>
						<div className="mt-5 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => dismiss()}
								className="ly-dialog-action ly-dialog-action-secondary"
							>
								取消
							</button>
							<button
								type="button"
								onClick={() => {
									dismiss(() => { setConfirming(false); choose("full"); });
								}}
								className="ly-dialog-action ly-dialog-action-danger font-medium"
							>
								确认开启
							</button>
						</div>
					</Scroller>
				</>}</Overlay>
			)}
		</>
	);
}
