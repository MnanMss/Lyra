import { Check, Circle, ListFilter, RotateCcw } from "lucide-react";
import { useState } from "react";
import { SOURCE_LABEL, SOURCE_ORDER, STATUS_LABEL, type Source, type TrajectoryFilter } from "@lyra/core/trajectory-view";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { MenuBody, MenuLabel, MenuItem } from "../../../ui/overlay/Menu.tsx";
import { Popover } from "../../../ui/overlay/Popover.tsx";
import { SourceIcon } from "./SourceIcon.tsx";

/** Detailed filters belong to a menu, leaving the ledger available at narrow pane widths. */
export function SourceFilter({ selected, counts, status, onToggle, onStatus, onClear }: {
	selected: Source[];
	counts: Record<string, number>;
	status: TrajectoryFilter["status"];
	onToggle: (source: Source) => void;
	onStatus: (status: TrajectoryFilter["status"]) => void;
	onClear: () => void;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const active = selected.length + (status ? 1 : 0);
	return <>
		<IconButton label="筛选轨迹" icon={<ListFilter size={15} />} active={Boolean(active)} badge={active} onClick={event => setAnchor(anchor ? null : event.currentTarget)} />
		{anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)} align="end" width="default" label="筛选轨迹">
			<MenuBody>
				<MenuItem icon={<RotateCcw size={14} />} onClick={() => { onClear(); onStatus(undefined); }} selected={!active}>全部记录</MenuItem>
				<MenuLabel>记录类型</MenuLabel>
				{SOURCE_ORDER.filter(source => counts[source] || selected.includes(source)).map(source => <MenuItem key={source} icon={<SourceIcon source={source} />} selected={selected.includes(source)} trailing={selected.includes(source) ? <Check size={13} /> : undefined} hint={counts[source]} onClick={() => onToggle(source)}>{SOURCE_LABEL[source]}</MenuItem>)}
				<MenuLabel>执行状态</MenuLabel>
				{Object.entries(STATUS_LABEL).map(([value, label]) => <MenuItem key={value} icon={<Circle size={12} />} selected={status === value} trailing={status === value ? <Check size={13} /> : undefined} onClick={() => {
					if (value === "running" || value === "done" || value === "error" || value === "cancelled" || value === "skipped" || value === "interrupted") onStatus(status === value ? undefined : value);
				}}>{label}</MenuItem>)}
			</MenuBody>
		</Popover>}
	</>;
}
