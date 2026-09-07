import { TrajectoryReader, type SessionStorage, type TrajectoryChanges } from "@lyra/core";

const readers = new WeakMap<SessionStorage, TrajectoryReader>();

/** Desktop IPC and paired clients share projections but retain independent revision cursors. */
export function readTrajectoryChanges(store: SessionStorage, projectId: string, sessionId: string, cursor?: string, running = false): Promise<TrajectoryChanges> {
	let reader = readers.get(store);
	if (!reader) { reader = new TrajectoryReader(store); readers.set(store, reader); }
	return reader.changes(projectId, sessionId, cursor, running);
}
