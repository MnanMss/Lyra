import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { ApprovalDecision } from "@lyra/core";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { ApprovalOverlay } from "../../src/features/conversation/ApprovalOverlay.tsx";
import { PermissionChoices } from "../../src/features/conversation/PermissionChoices.tsx";
import { QuestionChoices } from "../../src/features/conversation/QuestionChoices.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";

test("approval bodies preserve full content once and omit whitespace-only reasons", async () => {
	const previous = useApp.getState();
	const detail = "第一段需要完整保留。\n" + "长问题与路径 /workspace/very-long-name 需要换行。\n".repeat(50);
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({ activeSessionId: "owner", approvals: [{ id: "question", kind: "interactive", title: "需要你的意见", reason: detail.replaceAll("\n", "  "), detail, options: ["继续"], allowCustomInput: true }] });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		assert.equal(view.find("pre").textContent, detail);
		assert.equal(view.all(".ly-approval-scroll p").length, 0);
		for (const reason of ["  \n\t", "独立原因应当保留"]) {
			await act(async () => { useApp.setState({ approvals: [{ ...useApp.getState().approvals[0], reason }] }); });
			assert.equal(view.all(".ly-approval-scroll p").length, reason.trim() ? 1 : 0);
			assert.equal(view.find("pre").textContent, detail);
		}
	} finally { await view.unmount(); useApp.setState(previous, true); }
});

for (const permission of [false, true]) {
	test(`${permission ? "permission" : "question"} failures retain actionable buttons and permit one retry`, async () => {
		const answers: ApprovalDecision[] = [];
		let reject!: (error: Error) => void;
		const answer = async (decision: ApprovalDecision) => { answers.push(decision); return new Promise<void>((_, fail) => { reject = fail; }); };
		const view = await mount(permission ? h(PermissionChoices, { answer }) : h(QuestionChoices, { answer, options: ["继续"], allowCustomInput: true }));
		try {
			const buttons = view.all<HTMLButtonElement>("button");
			assert.ok(buttons.every(button => button.querySelector("svg")), "every action has an icon");
			const submit = buttons.at(-1)!;
			await click(submit); await click(submit);
			assert.equal(answers.length, 1);
			assert.ok(buttons.every(button => button.disabled));
			await act(async () => { reject(new Error("连接暂时中断")); });
			assert.equal(view.find('[role="alert"]').textContent, "连接暂时中断");
			assert.ok(buttons.every(button => !button.disabled));
			await click(submit);
			assert.equal(answers.length, 2);
			assert.equal(view.all('[role="alert"]').length, 0);
		} finally { await view.unmount(); }
	});
}

test("custom answers supplement choices on demand, retain retry drafts and leave candidate keys native", async () => {
	const answers: ApprovalDecision[] = [];
	const view = await mount(h(QuestionChoices, { options: ["继续"], allowCustomInput: true, answer: async (decision) => { answers.push(decision); throw new Error("请重试"); } }));
	try {
		assert.equal(view.all("input").length, 0);
		await click(view.find('button[aria-label="自定义回答"]'));
		const input = view.find<HTMLInputElement>("input");
		const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
		setValue.call(input, "保留中文草稿");
		await fire(input, new Event("input", { bubbles: true }));
		await fire(input, new Event("compositionstart", { bubbles: true }));
		for (const key of ["Enter", "ArrowDown", "Escape"]) {
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, isComposing: true });
			await fire(input, event);
			assert.equal(event.defaultPrevented, false);
		}
		assert.equal(answers.length, 0);
		await fire(input, new Event("compositionend", { bubbles: true }));
		await fire(view.find("form"), new Event("submit", { bubbles: true, cancelable: true }));
		assert.deepEqual(answers, [{ answer: "保留中文草稿" }]);
		assert.equal(input.value, "保留中文草稿");
		await click(view.find('button[aria-label="自定义回答"]'));
		await click(view.find('button[aria-label="自定义回答"]'));
		assert.equal(view.find<HTMLInputElement>("input").value, "保留中文草稿");
	} finally { await view.unmount(); }
});
