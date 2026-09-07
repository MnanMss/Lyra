import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveUiLocale } from "../src/i18n/locales.ts";
import { MESSAGE_CATALOGS } from "../src/i18n/messages/index.ts";

test("system languages resolve by BCP 47 family, including traditional Chinese regions", () => {
	assert.equal(resolveUiLocale("system", ["zh-Hant-HK"]), "zh-TW");
	assert.equal(resolveUiLocale("system", ["zh-CN"]), "zh-CN");
	assert.equal(resolveUiLocale("system", ["fr-CA"]), "fr");
	assert.equal(resolveUiLocale("system", ["ko-KR"]), "ko");
	assert.equal(resolveUiLocale("system", ["es-MX", "ja-JP"]), "ja");
	assert.equal(resolveUiLocale("system", ["es-MX"]), "en");
});

test("an explicit interface language is stable regardless of the operating system", () => {
	assert.equal(resolveUiLocale("ru", ["en-US"]), "ru");
	assert.equal(resolveUiLocale("zh-TW", ["zh-CN"]), "zh-TW");
});

test("all bundled language packs cover the same interface keys", () => {
	const source = Object.keys(MESSAGE_CATALOGS["zh-CN"]).sort();
	for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
		assert.deepEqual(Object.keys(catalog).sort(), source, `${locale} 缺少界面文案`);
	}
});
