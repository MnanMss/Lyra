import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, normalizeSettings, UI_LOCALES } from "../src/config/settings.ts";

test("the interface locale follows the system by default and retains every supported choice", () => {
	assert.equal(DEFAULT_SETTINGS.uiLocale, "system");
	for (const uiLocale of UI_LOCALES) {
		assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, uiLocale }).uiLocale, uiLocale);
	}
});

test("unknown imported locale values cannot escape the supported locale boundary", () => {
	for (const uiLocale of ["de", "zh-HK-x-private", "", 42, null]) {
		assert.equal(normalizeSettings({ ...DEFAULT_SETTINGS, uiLocale }).uiLocale, "system");
	}
});
