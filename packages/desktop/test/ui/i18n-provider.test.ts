import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { I18nProvider, useI18n } from "../../src/i18n/index.ts";
import { mount } from "../helpers/mount.ts";

function Probe() {
	const { t } = useI18n();
	return h("span", null, t("empty.projectQuestion", { project: "Lyra" }));
}

test("changing locale updates visible text and the document language without remounting the app", async () => {
	const view = await mount(h(I18nProvider, { locale: "en", children: h(Probe) }));
	try {
		assert.equal(view.text(), "What would you like to build in Lyra?");
		assert.equal(document.documentElement.lang, "en");
		await view.rerender(h(I18nProvider, { locale: "ja", children: h(Probe) }));
		assert.equal(view.text(), "Lyra で何を作りますか？");
		assert.equal(document.documentElement.lang, "ja");
	} finally {
		await view.unmount();
	}
});
