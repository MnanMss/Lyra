import { useLayoutEffect, useRef, useState } from "react";
import type { questionsIn } from "./question-navigation.ts";
import { Scroller } from "../../ui/scroll/Scroller.tsx";

export function QuestionNav({ questions, viewport, onSelect }: {
	questions: ReturnType<typeof questionsIn>;
	viewport: React.RefObject<HTMLDivElement | null>;
	onSelect: (index: number) => void;
}) {
	const [active, setActive] = useState<number | null>(null);
	const [hovered, setHovered] = useState<number | null>(null);
	const [previewTop, setPreviewTop] = useState(0);
	const nav = useRef<HTMLElement>(null);
	const rail = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (active === null || nav.current?.matches(":hover, :focus-within")) return;
		const el = rail.current;
		const mark = el?.querySelector<HTMLElement>('[aria-current="location"]');
		if (!el || !mark) return;
		const box = el.getBoundingClientRect();
		const target = mark.getBoundingClientRect();
		if (target.top < box.top + 36 || target.bottom > box.bottom - 48) el.scrollTop += target.top - box.top - el.clientHeight / 2;
	}, [active]);
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
	const show = (index: number, button: HTMLButtonElement) => {
		const host = nav.current;
		if (!host) return;
		setHovered(index);
		setPreviewTop(Math.max(0, Math.min(host.clientHeight - 90, button.getBoundingClientRect().top - host.getBoundingClientRect().top - 12)));
	};
	const preview = questions.find((question) => question.index === hovered);
	return (
		<nav ref={nav} className="ly-question-nav absolute inset-y-3 left-4 z-20 flex w-7 items-center" aria-label="用户问题导航">
			<Scroller scrollRef={rail} scrollbar={false} className="max-h-full w-full" contentClassName="py-2">
				{questions.map((question, position) => (
					<button key={question.index} type="button" className="ly-question-mark group flex h-4 w-7 items-center justify-start pl-1.5" aria-label={`跳转到第 ${position + 1} 个问题：${question.text}`} aria-current={active === question.index ? "location" : undefined}
						onMouseLeave={() => setHovered(null)} onMouseEnter={(event) => show(question.index, event.currentTarget)} onFocus={(event) => show(question.index, event.currentTarget)} onBlur={() => setHovered(null)} onClick={() => onSelect(question.index)}>
						<span className="block h-[2px] w-2 rounded-full bg-ink-faint/40 transition-[width,background-color] duration-[var(--ly-t-quick)] group-hover:w-5 group-hover:bg-ink group-focus-visible:w-5 group-aria-[current=location]:w-4 group-aria-[current=location]:bg-ink-muted" />
					</button>
				))}
			</Scroller>
			{preview && <div className="ly-question-preview pointer-events-none absolute left-8 w-[min(360px,calc(100cqw-48px))] rounded-xl border border-line bg-float px-3 py-2 text-label text-ink shadow-lg" role="tooltip" style={{ top: previewTop }}>
				<p className="line-clamp-3 break-words">{preview.text}</p>
			</div>}
		</nav>
	);
}
