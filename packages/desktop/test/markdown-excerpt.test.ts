import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownExcerpt } from "../src/lib/markdown/excerpt.ts";

test("navigation excerpts retain text without rendering markdown controls or separators", () => {
	assert.equal(markdownExcerpt("## 标题\n\n**摘要** 和 [文件](./file.ts)\n\n---\n\n- `代码`\n- 下一项"), "标题 摘要 和 文件 代码 下一项");
	assert.equal(markdownExcerpt("<details><summary>详情</summary>\n内容\n</details>\n\n![截图](a.png)"), "详情 内容 截图");
});
