import assert from "node:assert/strict";
import { test } from "node:test";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorAccess } from "../../src/features/editor/CodeEditor.tsx";

test("read-only files cannot summon an editable DOM surface", () => {
	const state = EditorState.create({ extensions: editorAccess(true) });
	const parent = document.body.appendChild(document.createElement("div"));
	const view = new EditorView({ state, parent });
	assert.equal(state.readOnly, true);
	assert.equal(state.facet(EditorView.editable), false);
	assert.equal(view.contentDOM.contentEditable, "false");
	assert.equal(view.contentDOM.getAttribute("aria-readonly"), "true");
	view.destroy();
	parent.remove();
});

test("ordinary files remain editable", () => {
	const state = EditorState.create({ extensions: editorAccess(false) });
	const parent = document.body.appendChild(document.createElement("div"));
	const view = new EditorView({ state, parent });
	assert.equal(state.readOnly, false);
	assert.equal(state.facet(EditorView.editable), true);
	assert.equal(view.contentDOM.contentEditable, "true");
	assert.equal(view.contentDOM.getAttribute("aria-readonly"), null);
	view.destroy();
	parent.remove();
});
