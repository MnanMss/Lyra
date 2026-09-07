import { ChevronsDownUp, ChevronsUpDown, Download, FileText, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { MenuBody, MenuItem } from "../../../ui/overlay/Menu.tsx";
import { Popover } from "../../../ui/overlay/Popover.tsx";

export function TraceActions({ collapsed, refreshing, onCollapse, onRefresh, onExport }: {
	collapsed: boolean;
	refreshing: boolean;
	onCollapse: () => void;
	onRefresh: () => void;
	onExport?: (format: "json" | "md") => void;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const run = (action: () => void) => { setAnchor(null); action(); };
	return <>
		<IconButton label="轨迹操作" icon={refreshing ? <RefreshCw size={14} className="animate-spin" /> : <MoreHorizontal size={16} />} onClick={event => setAnchor(anchor ? null : event.currentTarget)} />
		{anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" label="轨迹操作" width="default"><MenuBody>
			<MenuItem icon={<RefreshCw size={14} />} onClick={() => run(onRefresh)}>重新读取轨迹</MenuItem>
			<MenuItem icon={collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />} onClick={() => run(onCollapse)}>{collapsed ? "展开所有轮次" : "收起所有轮次"}</MenuItem>
			{onExport && <>
				<MenuItem icon={<Download size={14} />} onClick={() => run(() => onExport("json"))}>导出完整 JSON 轨迹</MenuItem>
				<MenuItem icon={<FileText size={14} />} onClick={() => run(() => onExport("md"))}>查看完整 Markdown 轨迹</MenuItem>
			</>}
		</MenuBody></Popover>}
	</>;
}
