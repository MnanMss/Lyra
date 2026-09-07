import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SessionReadCursor } from "../session/read-changes.ts";
import type { SessionRecord } from "../session/store.ts";
import type { TrajectorySource } from "./read.ts";
import { projectTrajectory } from "./project.ts";
import { entryKey, type Entry, type TrajectoryChanges } from "./types.ts";

interface Snapshot {
	epoch: string;
	revision: number;
	cursor?: SessionReadCursor;
	records: SessionRecord[];
	entries: Map<string, { entry: Entry; revision: number }>;
	removals: Map<string, number>;
	running: boolean;
	pending: Promise<void>;
}

/** Each client owns its cursor; reading a delta never consumes another subscriber's updates. */
export class TrajectoryReader {
	private readonly store: TrajectorySource;
	private readonly snapshots = new Map<string, Snapshot>();
	private readonly capacity: number;

	constructor(store: TrajectorySource, capacity = 4) {
		this.store = store;
		this.capacity = capacity;
	}

	async changes(projectId: string, sessionId: string, cursor?: string, running = false): Promise<TrajectoryChanges> {
		const key = `${projectId}\0${sessionId}`;
		let snapshot = this.snapshots.get(key);
		if (!snapshot) {
			snapshot = { epoch: randomUUID(), revision: 0, records: [], entries: new Map(), removals: new Map(), running, pending: Promise.resolve() };
		}
		this.snapshots.delete(key);
		this.snapshots.set(key, snapshot);
		if (this.snapshots.size > this.capacity) {
			const oldest = this.snapshots.keys().next().value;
			if (oldest !== undefined) this.snapshots.delete(oldest);
		}
		const current = snapshot;
		const update = current.pending.then(() => this.refresh(current, projectId, sessionId, running));
		// A failed I/O attempt remains visible to its caller without poisoning future refreshes.
		current.pending = update.catch(() => {});
		await update;
		const parts = cursor?.split(":");
		const revision = parts?.length === 2 && parts[0] === current.epoch ? Number(parts[1]) : -1;
		const reset = !Number.isSafeInteger(revision) || revision < 0 || revision > current.revision;
		return {
			cursor: `${current.epoch}:${current.revision}`,
			reset,
			upserts: [...current.entries.values()].filter(item => reset || item.revision > revision).map(item => item.entry),
			removals: reset ? [] : [...current.removals].filter(([, removedAt]) => removedAt > revision).map(([id]) => id),
		};
	}

	private async refresh(snapshot: Snapshot, projectId: string, sessionId: string, running: boolean): Promise<void> {
		let incoming: SessionRecord[];
		let reset = false;
		let nextCursor: SessionReadCursor | undefined;
		if (this.store.readChanges) {
			const changes = await this.store.readChanges(projectId, sessionId, snapshot.cursor);
			incoming = changes.records;
			reset = changes.reset;
			nextCursor = changes.cursor;
			if (!reset && incoming.length === 0 && snapshot.running === running) {
				snapshot.cursor = nextCursor;
				return;
			}
		} else {
			incoming = [];
			for await (const record of this.store.read(projectId, sessionId)) incoming.push(record);
		}
		const records = this.store.readChanges && !reset ? [...snapshot.records] : [];
		for (const record of incoming) {
			if (record.type === "truncate") {
				while (records.length && records[records.length - 1].seq > record.afterSeq) records.pop();
			} else records.push(record);
		}
		const projected = projectTrajectory(records, running);
		if (reset && snapshot.cursor) {
			snapshot.epoch = randomUUID();
			snapshot.revision = 0;
			snapshot.entries.clear();
			snapshot.removals.clear();
		}
		const revision = snapshot.revision + 1;
		const entries = new Map<string, { entry: Entry; revision: number }>();
		for (const entry of projected) {
			const id = entryKey(entry);
			const previous = snapshot.entries.get(id);
			entries.set(id, previous && isDeepStrictEqual(previous.entry, entry) ? previous : { entry, revision });
			snapshot.removals.delete(id);
		}
		for (const id of snapshot.entries.keys()) if (!entries.has(id)) snapshot.removals.set(id, revision);
		snapshot.entries = entries;
		snapshot.revision = revision;
		snapshot.records = records;
		snapshot.cursor = nextCursor;
		snapshot.running = running;
	}
}
