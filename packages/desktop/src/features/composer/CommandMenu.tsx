import { Box, Eraser, FoldVertical, Settings2, SquareTerminal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import type { CommandEntry } from "./command-catalog.ts";

const GROUPS = { builtin: "命令", command: "自定义命令", skill: "技能" };

/** One anchored list: names, descriptions and origins share a stable centre line. */
export function CommandMenu({ commands, active, onPick, onHover, id, term }: {
	commands: CommandEntry[];
	term: string;
	active: number;
	onPick: (command: CommandEntry) => void;
	onHover: (index: number) => void;
	id: string;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const previous = useRef<{ commands: CommandEntry[]; term: string; active: number }>({ commands: [], term, active });
	const [height, setHeight] = useState(340);
	const open = commands.length > 0;
	const shown = open ? commands : previous.current.commands;
	const shownTerm = open ? term : previous.current.term;
	const shownActive = open ? active : previous.current.active;
	useLayoutEffect(() => { if (open) previous.current = { commands, term, active }; }, [commands, term, active, open]);
	useLayoutEffect(() => {
		const anchor = panel.current?.parentElement;
		if (!anchor) return;
		const measure = () => setHeight(Math.max(0, Math.min(340, anchor.getBoundingClientRect().top - 12)));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(anchor);
		window.addEventListener("resize", measure);
		return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
	}, [open]);
	useLayoutEffect(() => {
		if (!open) return;
		const viewport = list.current;
		const row = viewport?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		if (!viewport || !row) return;
		// Scroll only this list, never the transcript behind its absolutely positioned popup.
		const box = row.getBoundingClientRect();
		const view = viewport.getBoundingClientRect();
		if (box.top < view.top + 36) viewport.scrollTop -= view.top + 36 - box.top;
		else if (box.bottom > view.bottom - 48) viewport.scrollTop += box.bottom - view.bottom + 48;
	}, [active, commands, open]);
	return <div ref={panel} id={id} role={open ? "listbox" : undefined} aria-label="斜杠命令" aria-hidden={!open} inert={!open}
		data-open={open} className="ly-command-menu ly-glass-solid absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-[18px] border border-line-soft">
		<div style={{ maxHeight: height }} className="flex flex-col">
			<Scroller scrollRef={list} className="min-h-0" contentClassName="p-1.5">
				{shown.map((command, index) => {
					const Icon = command.kind === "skill" ? Box : command.action === "compact" ? FoldVertical : command.action === "clear" ? Eraser : command.action === "manage-commands" ? Settings2 : SquareTerminal;
					return <div key={`${command.kind}:${command.name}`}>
						{!shownTerm && command.kind !== shown[index - 1]?.kind && <div className="px-3 pb-1 pt-2 text-detail text-ink-faint">{GROUPS[command.kind]}</div>}
						<button id={`${id}-${index}`} type="button" role={open ? "option" : undefined} tabIndex={-1}
							aria-label={`${command.name}，${command.description}，${command.origin}`} aria-selected={index === shownActive}
							data-index={index} data-command-kind={command.kind}
							onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(command)} onMouseMove={() => onHover(index)}
							className={`ly-scroll ly-command-option flex h-9 w-full items-center gap-2 rounded-[12px] px-3 text-left text-label transition-colors duration-[var(--ly-t-quick)] ${index === shownActive ? "bg-card-hover" : ""}`}>
							<Icon size={16} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
							<ScrollText text={command.name} className="min-w-0 max-w-[42%] shrink-0 text-ink" />
							<ScrollText text={command.description} className="min-w-0 flex-1 text-ink-muted" />
							<ScrollText text={command.origin} className="ml-auto min-w-0 max-w-[20%] shrink-0 text-detail text-ink-faint" />
						</button>
					</div>;
				})}
			</Scroller>
		</div>
	</div>;
}
