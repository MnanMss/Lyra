import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { Composer } from "../../src/features/composer/Composer.tsx";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

for (const switched of [false, true]) {
	test(`a rejected send restores its session references ${switched ? "without changing another draft" : "in the visible composer"}`, async () => {
		const previous = useApp.getState();
		const refs = [{ id: "one", title: "同名引用" }, { id: "two", title: "同名引用" }];
		let finish!: (accepted: boolean) => void;
		let sentRefs: typeof refs | undefined;
		useApp.setState({ activeSessionId: "a", meta: null, workspace: null, scratchCwd: "/test", settings: null,
			messages: [], running: false, drafts: { a: { text: "恢复这条消息", attachments: [], sessionRefs: refs }, b: { text: "另一份草稿", attachments: [], sessionRefs: [{ id: "other", title: "独立引用" }] } },
			send: async (_content, options) => { sentRefs = options?.sessionRefs; return new Promise<boolean>((resolve) => { finish = resolve; }); },
		});
		Object.defineProperty(window, "lyra", { configurable: true, value: { commands: { list: async () => ({ commands: [], skills: [], agents: [] }) } } });
		const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(Composer) }) }));
		try {
			await click(view.find('[aria-label="发送"]'));
			assert.deepEqual(sentRefs, refs);
			assert.equal(view.find<HTMLTextAreaElement>("textarea").value, "");
			if (switched) await act(async () => { useApp.setState({ activeSessionId: "b" }); });
			await act(async () => { finish(false); });
			assert.deepEqual(useApp.getState().drafts.a.sessionRefs, refs);
			assert.equal(view.find<HTMLTextAreaElement>("textarea").value, switched ? "另一份草稿" : "恢复这条消息");
			if (switched) {
				assert.deepEqual(useApp.getState().drafts.b.sessionRefs, [{ id: "other", title: "独立引用" }]);
				assert.equal(view.all('[aria-label^="移除会话引用："]').length, 1);
			} else assert.equal(view.all('[aria-label^="移除会话引用："]').length, 2);
		} finally { await view.unmount(); useApp.setState(previous, true); }
	});

test("text attachment does not inline contents into prompt, but issues a file reference hint", async () => {
	const previous = useApp.getState();
	let sentContent: any[] = [];
	useApp.setState({
		activeSessionId: "test-ref",
		meta: null,
		workspace: { name: "test-proj", path: "/work/project", isGitRepo: true, branch: "main" },
		scratchCwd: null,
		settings: null,
		messages: [],
		running: false,
		drafts: {
			"test-ref": {
				text: "分析这个文件",
				attachments: [
					{
						id: "att-1",
						name: "file.ts",
						mimeType: "text/typescript",
						isText: true,
						path: "/work/project/src/file.ts",
						text: "SECRET_FILE_CONTENT_THAT_MUST_NEVER_BE_INLINED",
					},
				],
				sessionRefs: [],
			},
		},
		send: async (content, options) => {
			sentContent = content;
			assert.equal(options?.displayText, "分析这个文件", "气泡展示文本必须是纯净的用户输入，绝不能露馅系统提示词");
			assert.deepEqual(options?.fileRefs, [{ name: "file.ts", path: "/work/project/src/file.ts" }], "必须正确传递 fileRefs 元数据");
			return true;
		},
	});
	Object.defineProperty(window, "lyra", { configurable: true, value: { commands: { list: async () => ({ commands: [], skills: [], agents: [] }) }, workspace: { foreignConfigs: async () => ({ seen: true, lines: [] }) } } });
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(Composer) }) }));
	try {
		await click(view.find('[aria-label="发送"]'));
		const textBlock = sentContent.find((c) => c.type === "text")?.text ?? "";
		assert.ok(!textBlock.includes("SECRET_FILE_CONTENT_THAT_MUST_NEVER_BE_INLINED"), "文件正文绝对不应内联进 prompt");
		assert.ok(textBlock.includes("[文件引用提示]"), "应当生成文件引用提示");
		assert.ok(textBlock.includes("src/file.ts"), "应当生成相对或规范路径引用");
		assert.ok(textBlock.includes("read"), "应当指导模型使用 read 工具");
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});
}
