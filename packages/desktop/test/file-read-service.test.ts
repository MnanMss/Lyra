import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listReadableFiles, readReadableFile } from "../electron/file-read-service.ts";

test("phone file reads stay read-only and share the desktop text rules", async () => {
	const root = await mkdtemp(join(tmpdir(), "lyra-file-read-"));
	try {
		await mkdir(join(root, "src"));
		await writeFile(join(root, "b.txt"), "second\n");
		await writeFile(join(root, "a.txt"), "first\n");

		const entries = await listReadableFiles(root);
		assert.deepEqual(entries.map((entry) => entry.name), ["src", "a.txt", "b.txt"]);
		assert.equal(entries[1]?.size, 6);

		const contents = await readReadableFile(join(root, "a.txt"), true);
		assert.equal(contents?.text, "first\n");
		assert.equal(contents?.readOnly, true);
		assert.equal(contents?.truncated, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a refused path never reaches the filesystem reader", async () => {
	assert.deepEqual(await listReadableFiles(null), []);
	assert.equal(await readReadableFile(null, true), null);
});
