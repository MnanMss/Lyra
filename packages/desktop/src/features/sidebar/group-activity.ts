import { visibleActivity, type SessionActivity } from "@lyra/core/activity";

const PRIORITY: SessionActivity[] = ["waiting", "running", "failed", "done"];

/** Count identities once, including sessions inside nested pinned projects. */
export function groupActivity(
	ids: readonly string[],
	activity: Readonly<Record<string, SessionActivity>>,
	activeId: string | null,
) {
	const counts: Record<SessionActivity, number> = { waiting: 0, running: 0, failed: 0, done: 0 };
	for (const id of new Set(ids)) {
		const state = visibleActivity(activity[id] ?? null, id === activeId);
		if (state) counts[state]++;
	}
	return { counts, activity: PRIORITY.find((state) => counts[state] > 0) ?? null };
}
