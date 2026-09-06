/**
 * The question asked before something cannot be taken back.
 *
 * `docs/todolist.md` records twelve places wired to this — uninstalling a plugin, deleting a branch,
 * discarding working-tree changes, removing an MCP server. The component's comment states two
 * decisions that are easy to lose in a refactor and expensive to lose in production: cancel holds
 * the focus, and the destructive button is the one that is not focused. A rewrite that swaps them
 * turns Enter from "never mind" into "do it".
 *
 * Body tests cover wording and actions; focus is tested through the real modal shell.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { Confirm, ConfirmBody } from "../../src/ui/overlay/Confirm.tsx";
import { click, mount } from "../helpers/mount.ts";

function open(overrides: Record<string, unknown> = {}) {
	return mount(
		h(ConfirmBody, {
			title: "卸载 Chrome？",
			detail: "它的技能和目录会一并删除。",
			confirmLabel: "卸载",
			onConfirm: () => {},
			onCancel: () => {},
			...overrides,
		}),
	);
}

test("Confirm: 标题、说明与动词都照原样显示", async () => {
	const view = await open();
	const text = view.text();

	// 标题点名了要删的东西，不是「确定吗？」——这是组件注释里写死的要求。
	assert.match(text, /卸载 Chrome？/);
	assert.match(text, /它的技能和目录会一并删除。/);
	assert.match(text, /卸载/);

	await view.unmount();
});

test("Confirm: 焦点在取消上，不在那个不可逆的按钮上", async () => {
	const view = await mount(h(Confirm, { title: "卸载 Chrome？", confirmLabel: "卸载", onConfirm: () => {}, onCancel: () => {} }));
	const buttons = document.querySelectorAll<HTMLButtonElement>('[data-ly-modal] button');

	assert.equal(buttons.length, 2, "两个出口：取消与执行");
	const [cancel, confirm] = buttons;

	assert.equal(cancel!.textContent, "取消");
	// The shell owns focus so short dialogs do not scroll past their title at mount.
	assert.equal(document.activeElement, cancel, "取消必须持有焦点");
	assert.notEqual(document.activeElement, confirm, "焦点不能落在不可逆的那一半上");

	await view.unmount();
});

test("Confirm: 执行按钮用危险色，取消不用", async () => {
	const view = await open();
	const [cancel, confirm] = view.all<HTMLButtonElement>("button");

	assert.match(confirm!.className, /ly-dialog-action-danger/, "不可逆的动作要看起来不可逆");
	assert.doesNotMatch(cancel!.className, /ly-dialog-action-danger/, "取消是安全的那一个");

	await view.unmount();
});

test("Confirm: 两个按钮各自只触发自己的回调", async () => {
	let confirmed = 0;
	let cancelled = 0;
	const view = await open({ onConfirm: () => confirmed++, onCancel: () => cancelled++ });
	const [cancel, confirm] = view.all<HTMLButtonElement>("button");

	await click(cancel!);
	assert.deepEqual([confirmed, cancelled], [0, 1]);

	await click(confirm!);
	assert.deepEqual([confirmed, cancelled], [1, 1]);

	await view.unmount();
});

test("Confirm: 没有 detail 时不留空段落", async () => {
	const view = await open({ detail: undefined });
	assert.equal(view.all("p").length, 0, "标题已经说清楚时不该多一个空行");
	await view.unmount();
});
