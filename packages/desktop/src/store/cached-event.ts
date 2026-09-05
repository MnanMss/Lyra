import type { AgentEvent } from "@lyra/core";
import { settleTail } from "../lib/transcript.ts";
import { applyToolEvent } from "./apply-tool.ts";
import { howItStopped, rebuildToolRuns, todosFrom, type Cache, type CachedSessionState } from "./derive.ts";
import { messageEvent } from "./message-event.ts";

/** Cache entries have history, so unlike never-visited sessions they can consume live events. */
export function cachedEvent(cached: Cache[string], event: AgentEvent): Cache[string] {
	let messages = cached.messages;
	let toolRuns = cached.toolRuns;
	let meta = cached.meta;
	let state: CachedSessionState = cached.state ?? {
		running: false, todos: todosFrom(messages), compactions: [], approvals: [],
		stopped: howItStopped(messages), retrying: null, capabilities: null, pendingUserMessage: null,
	};
	switch (event.type) {
		case "message_start": case "message_update": case "message_end": {
			const next = messageEvent({ messages, pendingUserMessage: state.pendingUserMessage }, event);
			messages = next.messages;
			state = { ...state, pendingUserMessage: next.pendingUserMessage, retrying: null };
			break;
		}
		case "tool_start": case "tool_update": case "tool_end":
			applyToolEvent(event, (patch) => {
				toolRuns = patch.toolRuns ?? toolRuns;
				state = { ...state, todos: patch.todos ?? state.todos, retrying: null };
			}, () => ({ toolRuns, todos: state.todos }));
			break;
		case "agent_start":
			state = { ...state, running: true, stopped: null, retrying: null };
			break;
		case "agent_end":
			messages = settleTail(messages, event);
			state = { ...state, running: false, approvals: [], pendingUserMessage: null, retrying: null, stopped: howItStopped(messages, event.reason) };
			break;
		case "approval_request":
			state = { ...state, approvals: [...state.approvals, { id: event.requestId, kind: event.kind, title: event.title, detail: event.detail, subject: event.subject }] };
			break;
		case "title": meta = { ...meta, title: event.title }; break;
		case "rewound":
			messages = messages.slice(0, event.messageCount);
			toolRuns = rebuildToolRuns(messages);
			state = { ...state, todos: todosFrom(messages), pendingUserMessage: null };
			break;
		case "compacted":
			state = { ...state, compactions: [...state.compactions, { at: messages.length, before: event.before, after: event.after }] };
			break;
		case "retry":
			state = { ...state, running: state.running || event.resume === true, retrying: { attempt: event.attempt, until: Date.now() + event.delayMs, reason: event.reason, resume: event.resume === true } };
			break;
		default: return cached;
	}
	return { ...cached, meta, messages, toolRuns, state, dirty: true };
}
