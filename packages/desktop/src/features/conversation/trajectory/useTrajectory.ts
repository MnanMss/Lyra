import { useEffect, useState, useCallback } from "react";
import type { Entry } from "@lyra/core/trajectory-view";
import { useApp } from "../../../store/index.ts";
import { bridge } from "../../../services/index.ts";

const cache = new Map<string, Entry[]>();
const durable = new Set(["command_status", "compacted", "message_end", "tool_start", "tool_end", "context", "request", "agent_start", "agent_end", "subagent", "subagent_done", "subagent_message", "subagent_event", "notice", "retry", "approval_request", "rewound"]);

/** Subscribe before reading; a single in-flight read drains invalidations without polling. */
export function useTrajectory() {
	const meta = useApp(state => state.meta);
	const sessionId = meta?.id, projectId = meta?.projectId;
	const key = `${projectId}:${sessionId}`;
	const [value, setValue] = useState<{ key: string; entries: Entry[] } | null>(null);
	const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
	const [revision, setRevision] = useState(0);
	const refresh = useCallback(() => setRevision(value => value + 1), []);
	useEffect(() => {
		if (!sessionId || !projectId) return;
		let live = true, reading = false, dirty = false;
		const read = async () => {
			dirty = true;
			if (reading) return;
			reading = true;
			try {
				do {
					dirty = false;
					const entries = await bridge.sessions.trajectory(projectId, sessionId);
					if (!live) return;
					cache.delete(key); cache.set(key, entries);
					while (cache.size > 4) { const oldest = cache.keys().next().value; if (oldest) cache.delete(oldest); }
					setValue({ key, entries }); setFailure(null);
				} while (dirty);
			} catch (error) { if (live) setFailure({ key, message: String(error) }); }
			finally { reading = false; }
		};
		const off = bridge.agent.onEvent(payload => { if (payload.sessionId === sessionId && durable.has(payload.event.type)) void read(); });
		void read();
		return () => { live = false; off(); };
	}, [projectId, sessionId, key, revision]);
	const all = value?.key === key ? value.entries : cache.get(key);
	return { all: all ?? [], loading: Boolean(sessionId && !all && failure?.key !== key), error: failure?.key === key ? failure.message : "", refresh };
}
