import type { CommandRun } from "@lyra/core";
import { Check, CircleAlert, LoaderCircle, Minus } from "lucide-react";
import { MessageActions } from "./MessageActions.tsx";

/** A local command is part of the transcript, but never a prompt sent to the agent. */
export function CommandRunRow({ command }: { command: CommandRun }) {
	const Icon = command.status === "running" ? LoaderCircle : command.status === "done" ? Check : command.status === "failed" ? CircleAlert : Minus;
	return <div className="group/msg mb-4" data-command-run={command.id} data-command-status={command.status}>
		<div className="flex justify-end">
			<p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[16px] rounded-br-[6px] bg-card px-4 py-2.5 text-body leading-relaxed">
				<span className="ly-command-token">/compact</span>{command.input.slice(8)}
			</p>
		</div>
		<MessageActions timestamp={command.timestamp} text={command.input} className="justify-end pr-1" />
		<div role="status" className={`flex min-h-9 items-center gap-2 text-label ${command.status === "failed" ? "text-danger" : "text-ink-muted"}`}>
			<Icon size={14} className={`shrink-0 ${command.status === "running" ? "animate-spin" : ""}`} />
			<span>{command.detail}</span>
		</div>
	</div>;
}
