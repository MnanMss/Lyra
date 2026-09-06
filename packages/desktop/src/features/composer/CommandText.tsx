import type { CommandDecoration } from "./command-catalog.ts";

/** Decoration never owns input, selection or clipboard data; the native textarea does. */
export function CommandText({ value, decoration, mirror }: {
	value: string;
	decoration: CommandDecoration;
	mirror: React.RefObject<HTMLDivElement | null>;
}) {
	return <div aria-hidden className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${decoration.hint ? "ly-fade-edge" : ""}`}>
		<div ref={mirror} className="ly-composer-text whitespace-pre-wrap break-words" data-command-mirror>
			{value.slice(0, decoration.start)}<span className="ly-command-token">{value.slice(decoration.start, decoration.end)}</span>{value.slice(decoration.end)}
			{/* A native textarea reserves a line after a trailing newline; an empty div line collapses. */}
			{value.endsWith("\n") && "\u200b"}
			{decoration.hint && <span className="ly-command-hint text-ink-faint">{value.length === decoration.end ? " " : ""}{decoration.hint}</span>}
		</div>
	</div>;
}
