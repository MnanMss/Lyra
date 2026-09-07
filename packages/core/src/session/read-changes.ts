import { open } from "node:fs/promises";

/** Internal byte cursor; callers must obtain it from the same trusted storage instance. */
export interface SessionReadCursor {
	identity: string;
	version: string;
	size: number;
	offset: number;
}

export interface SessionRecordChanges<T> {
	cursor: SessionReadCursor;
	reset: boolean;
	records: T[];
}

/** Read only complete appended JSONL lines, bounded by the opened file's actual version. */
export async function readRecordChanges<T>(file: string, previous?: SessionReadCursor): Promise<SessionRecordChanges<T>> {
	const handle = await open(file, "r").catch((error: unknown) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	});
	if (!handle) return { cursor: { identity: "missing", version: "missing", size: 0, offset: 0 }, reset: previous?.identity !== "missing", records: [] };
	try {
		const stat = await handle.stat();
		const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
		const version = `${identity}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
		const reset = !previous || previous.identity !== identity || stat.size < previous.size || (stat.size === previous.size && previous.version !== version);
		let offset = reset ? 0 : previous.offset;
		const records: T[] = [];
		if (version !== previous?.version && offset < stat.size) {
			const stream = handle.createReadStream({ start: offset, end: stat.size - 1, encoding: "utf8", autoClose: false });
			let pending = "";
			for await (const chunk of stream) {
				pending += chunk;
				let end: number;
				let start = 0;
				while ((end = pending.indexOf("\n", start)) !== -1) {
					const line = pending.slice(start, end);
					offset += Buffer.byteLength(line, "utf8") + 1;
					start = end + 1;
					if (!line.trim()) continue;
					try {
						const record: T = JSON.parse(line);
						records.push(record);
					} catch {
						// Match the full reader's recovery of damaged lines without consuming an unfinished tail.
					}
				}
				pending = pending.slice(start);
			}
			if (pending.trim()) {
				try {
					const record: T = JSON.parse(pending);
					records.push(record);
					offset += Buffer.byteLength(pending, "utf8");
				} catch {
					// Legacy logs may omit the newline; an incomplete JSON value must be retried on append.
				}
			}
		}
		return { cursor: { identity, version, size: stat.size, offset }, reset, records };
	} finally { await handle.close(); }
}
