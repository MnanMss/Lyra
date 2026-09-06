import { useState } from "react";
import type { ApprovalDecision } from "@lyra/core";

export function QuestionChoices({ options, allowCustomInput, answer }: {
	options: string[];
	allowCustomInput: boolean;
	answer(decision: ApprovalDecision): Promise<void>;
}) {
	const [text, setText] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	async function submit(decision: ApprovalDecision) {
		if (pending) return;
		setPending(true);
		setError("");
		try { await answer(decision); }
		catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
			setPending(false);
		}
	}
	return <div className="border-t border-line-soft px-4 py-3">
		<div className="flex flex-wrap gap-2">
			{options.map((option) => <button key={option} type="button" disabled={pending}
				onClick={() => void submit({ answer: option })}
				className="rounded-lg border border-line px-3 py-1.5 text-label text-ink transition-colors hover:bg-card-hover disabled:opacity-50">{option}</button>)}
			<button type="button" disabled={pending} onClick={() => void submit("reject")}
				className="rounded-lg px-3 py-1.5 text-label text-ink-muted hover:bg-card-hover disabled:opacity-50">取消</button>
		</div>
		{allowCustomInput && <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void submit({ answer: text.trim() }); }}>
			<input aria-label="自定义回答" placeholder="其他想法" value={text} disabled={pending} onChange={(event) => setText(event.target.value)}
				className="min-w-0 flex-1 rounded-lg border border-line bg-shell px-3 py-1.5 text-label text-ink" />
			<button type="submit" disabled={pending || !text.trim()} className="rounded-lg bg-ink px-3 text-label text-shell disabled:opacity-50">发送</button>
		</form>}
		{error && <p role="alert" className="mt-2 text-caption text-ink-muted">{error}</p>}
	</div>;
}
