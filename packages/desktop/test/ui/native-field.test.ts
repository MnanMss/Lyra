import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h, createRef } from "react";
import { Input, Textarea } from "../../src/ui/inputs/NativeField.tsx";
import { TextInput } from "../../src/features/settings/inputs.tsx";
import { SearchField } from "../../src/ui/inputs/SearchField.tsx";
import { NameEditor } from "../../src/features/files/NameEditor.tsx";
import { composingKey } from "../../src/ui/keyboard.ts";
import { mount } from "../helpers/mount.ts";

test("native fields give IME keys to the candidate window, preserving the native default and refs", async () => {
	for (const multiline of [false, true]) {
		let called = 0;
		const ref = createRef<HTMLElement>();
		const props = { onKeyDown: () => called++, ref: (element: HTMLElement | null) => { ref.current = element; } };
		const view = await mount(h("div", { onKeyDown: () => called++ }, multiline ? h(Textarea, props) : h(Input, props)));
		try {
			const field = view.find("input,textarea");
			assert.equal(ref.current, field);
			await act(async () => field.dispatchEvent(new Event("compositionstart", { bubbles: true })));
			for (const key of ["Enter", "Escape", "ArrowDown", "ArrowUp", " "]) {
				const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
				await act(async () => { field.dispatchEvent(event); });
				assert.equal(event.defaultPrevented, false);
			}
			assert.equal(called, 0);
			await act(async () => field.dispatchEvent(new Event("compositionend", { bubbles: true })));
			const ending = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
			Object.defineProperty(ending, "keyCode", { value: 229 });
			await act(async () => field.dispatchEvent(ending));
			assert.equal(called, 0, "compositionend can precede the IME's final keydown");
			await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
			assert.equal(called, 2);
		} finally { await view.unmount(); }
	}
});

test("search, settings submissions and inline rename share the IME boundary", async () => {
	let submitted = 0;
	const views = [
		await mount(h(TextInput, { value: "测试", onChange: () => {}, onKeyDown: () => submitted++ })),
		await mount(h(SearchField, { value: "测试", onChange: () => submitted++, onEscape: () => submitted++ })),
		await mount(h(NameEditor, { initial: "测试.txt", onCommit: () => submitted++, onCancel: () => submitted++ })),
	];
	try {
		for (const view of views) {
			for (const key of ["Enter", "Escape", "ArrowDown"]) {
				await act(async () => view.find("input").dispatchEvent(new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true })));
			}
		}
		assert.equal(submitted, 0);
	} finally { for (const view of views) await view.unmount(); }
});

test("document capture shortcuts see composition before React receives the key", async () => {
	let escaped = 0;
	const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && !composingKey(event)) escaped++; };
	document.addEventListener("keydown", handler, true);
	const view = await mount(h(Input, { defaultValue: "中文" }));
	try {
		const field = view.find("input");
		await act(async () => field.dispatchEvent(new Event("compositionstart", { bubbles: true })));
		await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		assert.equal(escaped, 0);
		await act(async () => field.dispatchEvent(new Event("compositionend", { bubbles: true })));
		await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		assert.equal(escaped, 1);
	} finally { document.removeEventListener("keydown", handler, true); await view.unmount(); }
});
