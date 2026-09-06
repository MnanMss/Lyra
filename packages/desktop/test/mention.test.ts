import test from "node:test";
import assert from "node:assert/strict";
import { parseMentionTrigger, rankMentions, findMentionRanges } from "../src/features/composer/mention-catalog.ts";

test("parseMentionTrigger detects @ at start of line", () => {
	const result = parseMentionTrigger("@file", 5, 5);
	assert.ok(result);
	assert.equal(result.term, "file");
	assert.equal(result.start, 0);
	assert.equal(result.end, 5);
});

test("parseMentionTrigger detects @ after space", () => {
	const text = "hello @rev";
	const result = parseMentionTrigger(text, text.length, text.length);
	assert.ok(result);
	assert.equal(result.term, "rev");
	assert.equal(result.start, 6);
	assert.equal(result.end, 10);
});

test("parseMentionTrigger ignores email address like user@example.com", () => {
	const text = "user@example.com";
	const result = parseMentionTrigger(text, text.length, text.length);
	assert.equal(result, null);
});

test("findMentionRanges finds unquoted and quoted mentions in text", () => {
	const text = `check @src/a.ts and @"使用 'think' 技能" for details`;
	const ranges = findMentionRanges(text);
	assert.equal(ranges.length, 2);
	assert.equal(ranges[0].text, "@src/a.ts");
	assert.equal(ranges[0].inner, "src/a.ts");
	assert.equal(ranges[1].text, `@"使用 'think' 技能"`);
	assert.equal(ranges[1].inner, "使用 'think' 技能");
});

test("rankMentions filters items by search term", () => {
	const items = rankMentions("rev", {
		files: ["src/review.ts", "src/index.ts"],
		sessions: [{ id: "s-1", title: "code review session", cwd: "/test", projectName: "test", status: "idle", unread: false, createdAt: Date.now(), updatedAt: Date.now() }],
		allowAction: true,
	});

	assert.ok(items.some((i) => i.id === "subagent:review"));
	assert.ok(items.some((i) => i.title === "src/review.ts"));
	assert.ok(items.some((i) => i.id === "session:s-1" && i.title === "code review session"));
});
