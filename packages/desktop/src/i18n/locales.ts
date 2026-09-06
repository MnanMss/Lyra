import type { UiLocale } from "@lyra/core";
import type { MessageKey, ResolvedUiLocale } from "./messages/index.ts";

export interface LocaleOption {
	value: UiLocale;
	mark: string;
	label: MessageKey;
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
	{ value: "system", mark: "Aa", label: "language.system" },
	{ value: "zh-CN", mark: "中", label: "language.zh-CN" },
	{ value: "zh-TW", mark: "繁", label: "language.zh-TW" },
	{ value: "en", mark: "EN", label: "language.en" },
	{ value: "fr", mark: "FR", label: "language.fr" },
	{ value: "ru", mark: "РУ", label: "language.ru" },
	{ value: "ko", mark: "한", label: "language.ko" },
	{ value: "ja", mark: "日", label: "language.ja" },
];

export function resolveUiLocale(locale: UiLocale, languages: readonly string[]): ResolvedUiLocale {
	if (locale !== "system") return locale;
	for (const language of languages) {
		const matched = matchLanguage(language);
		if (matched) return matched;
	}
	return "en";
}

function matchLanguage(language: string): ResolvedUiLocale | null {
	const normalized = language.trim().replaceAll("_", "-").toLowerCase();
	if (!normalized) return null;
	if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized.startsWith("zh-hant")) return "zh-TW";
	if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
	if (normalized === "en" || normalized.startsWith("en-")) return "en";
	if (normalized === "fr" || normalized.startsWith("fr-")) return "fr";
	if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
	if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
	if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
	return null;
}
