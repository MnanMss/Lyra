import { useLayoutEffect, useRef, useState } from "react";
import { questionWindow, type questionsIn } from "./question-navigation.ts";

export function QuestionNav({ questions, viewport, onSelect }: {
	questions: ReturnType<typeof questionsIn>;
	viewport: React.RefObject<HTMLDivElement | null>;
	onSelect: (index: number) => void;
}) {
	const [active, setActive] = useState<number | null>(null);
	const [hovered, setHovered] = useState<number | null>(null);
	const [center, setCenter] = useState(questions.length - 1);
	const [preview, setPreview] = useState<{ text: string; answer: string; slot: number } | null>(null);
	const nav = useRef<HTMLElement>(null);
	const rail = useRef<HTMLDivElement>(null);
	const engaged = useRef(false);
	const position = Math.max(0, questions.findIndex((q) => q.index === active));
	useLayoutEffect(() => { if (!engaged.current) setCenter(position); }, [position]);
	useLayoutEffect(() => {
		const el = viewport.current;
		if (!el) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const top = el.getBoundingClientRect().top + 60;
			const rows = el.querySelectorAll<HTMLElement>("[data-question-index]");
			let current: number | null = null;
			for (const row of rows) {
				if (row.getBoundingClientRect().top > top && current !== null) break;
				current = Number(row.dataset.questionIndex);
			}
			setActive(current);
		};
		const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
		measure();
		el.addEventListener("scroll", schedule, { passive: true });
		const observer = new MutationObserver(schedule);
		observer.observe(el, { childList: true, subtree: true });
		const resize = new ResizeObserver(schedule);
		if (el.firstElementChild) resize.observe(el.firstElementChild);
		return () => {
			el.removeEventListener("scroll", schedule);
			observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
		};
	}, [viewport, questions.length]);
	useLayoutEffect(() => {
		const element = rail.current;
		if (!element) return;
		let delta = 0;
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			delta += event.deltaY;
			if (Math.abs(delta) < 24) return;
			engaged.current = true;
			setHovered(null);
			const steps = Math.sign(delta) * 3;
			delta = 0;
			setCenter((value) => Math.max(0, Math.min(questions.length - 1, value + steps)));
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, [questions.length]);
	const window = questionWindow(questions.length, center);
	const show = (position: number) => {
		engaged.current = true;
		setHovered(position);
		setPreview({ ...questions[position], slot: position - window.start });
	};
	const select = (position: number, focus = false) => {
		const next = Math.max(0, Math.min(questions.length - 1, position));
		setCenter(next);
		setHovered(null);
		onSelect(questions[next].index);
		if (focus) requestAnimationFrame(() => nav.current?.querySelector<HTMLButtonElement>(`[data-position="${next}"]`)?.focus());
	};
	return (
		<nav ref={nav} className="ly-question-nav absolute inset-y-3 left-3 z-20 flex w-7 items-center" aria-label="用户问题导航">
			<div ref={rail} role="toolbar" tabIndex={-1} aria-label="选择问题" className="ly-question-rail relative w-full"
			onMouseLeave={() => { engaged.current = false; setHovered(null); setCenter(position); }}
			onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { engaged.current = false; setHovered(null); } }}
				onKeyDown={(event) => {
				const current = hovered ?? center;
				const next = event.key === "Home" ? 0 : event.key === "End" ? questions.length - 1 : event.key === "ArrowUp" ? current - 1 : event.key === "ArrowDown" ? current + 1 : null;
				if (next !== null) { event.preventDefault(); select(next, true); }
			}}>
				{questions.slice(window.start, window.end).map((question, slot) => {
					const at = window.start + slot;
					const distance = hovered === null ? 5 : Math.abs(at - hovered);
					return <button key={question.index} type="button" data-position={at} className="ly-question-mark rounded-sm flex h-3 w-7 items-center pl-1.5"
						aria-label={`跳转到第 ${at + 1} 个问题：${question.text}`} aria-current={active === question.index ? "location" : undefined}
						onMouseEnter={() => show(at)} onFocus={() => show(at)} onClick={() => select(at)}>
						<span style={{ width: distance < 4 ? 24 - distance * 5 : active === question.index ? 12 : 6 }} className={`block h-[2px] rounded-full transition-[width,background-color,opacity] duration-[var(--ly-t-quick)] ${distance === 0 ? "bg-ink" : active === question.index ? "bg-ink-muted" : "bg-ink-faint/40"}`} />
					</button>;
				})}
				{preview && <div className="ly-question-preview pointer-events-none absolute left-9 w-[min(320px,calc(100cqw-60px))] rounded-xl border border-line bg-float p-3 text-label shadow-lg" role="tooltip" aria-hidden={hovered === null} data-open={hovered !== null} style={{ top: Math.max(-24, Math.min((window.end - window.start) * 12 - 80, preview.slot * 12 - 24)) }}>
					<p className="line-clamp-2 break-words font-medium text-ink">{preview.text}</p>
					{preview.answer && <p className="mt-1 line-clamp-3 break-words leading-relaxed text-ink-faint">{preview.answer}</p>}
				</div>}
			</div>
		</nav>
	);
}
