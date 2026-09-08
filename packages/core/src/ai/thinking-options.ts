import type { ModelConfig, ThinkingLevel, ThinkingOption } from "../types/provider.ts";

/**
 * Standard 4-level thinking set (off, low, medium, high).
 * Safe for Google Gemini, MiniMax, and basic 3-level reasoning models.
 */
export const STANDARD_3_LEVEL_OPTIONS: ThinkingOption[] = [
	{ id: "off", label: "关闭", detail: "不推理，直接作答。最快。" },
	{ id: "low", label: "低", detail: "简单任务够用。" },
	{ id: "medium", label: "中", detail: "日常编码的默认档。", isDefault: true },
	{ id: "high", label: "高", detail: "复杂重构、疑难排查。" },
];

/**
 * Standard 5-level thinking set (off, low, medium, high, xhigh).
 * Standard for GPT-5.4, GPT-5.5, and standard advanced OpenAI/Codex reasoning models.
 */
export const STANDARD_5_LEVEL_OPTIONS: ThinkingOption[] = [
	{ id: "off", label: "关闭", detail: "不推理，直接作答。最快。" },
	{ id: "low", label: "低", detail: "简单任务够用。" },
	{ id: "medium", label: "中", detail: "日常编码的默认档。", isDefault: true },
	{ id: "high", label: "高", detail: "复杂重构、疑难排查。" },
	{ id: "xhigh", label: "超高", detail: "超深度推演，处理高难度任务。" },
];

/**
 * GPT-5.6 standard / regular thinking set (off, minimal, low, medium, high, xhigh, max).
 * Standard GPT-5.6 variants where the ceiling is max.
 */
export const GPT_5_6_STANDARD_OPTIONS: ThinkingOption[] = [
	{ id: "off", label: "关闭", detail: "不推理，直接作答。最快。" },
	{ id: "minimal", label: "极简", detail: "只做最低限度的思考。" },
	{ id: "low", label: "低", detail: "简单任务够用。" },
	{ id: "medium", label: "中", detail: "日常编码的默认档。", isDefault: true },
	{ id: "high", label: "高", detail: "复杂重构、疑难排查。" },
	{ id: "xhigh", label: "超高", detail: "更深层次的逻辑推演。" },
	{ id: "max", label: "最高", detail: "把预算拉满，最慢也最稳。" },
];

/**
 * GPT-5.6-sol special thinking options with High, Extra High (xhigh), Max, and Ultra.
 */
export const GPT_5_6_SOL_OPTIONS: ThinkingOption[] = [
	{ id: "off", label: "关闭", detail: "不推理，直接作答。最快。" },
	{ id: "minimal", label: "极简", detail: "轻量预检与快速分析。" },
	{ id: "low", label: "低", detail: "常规单测与基础修改。" },
	{ id: "medium", label: "中", detail: "日常编码的默认档。", isDefault: true },
	{ id: "high", label: "高", detail: "跨模块重构与排障。" },
	{ id: "xhigh", label: "超高", detail: "深层次推演与复杂架构推导。" },
	{ id: "max", label: "最高", detail: "算力拉满，极深推演。" },
	{ id: "ultra", label: "极致", detail: "极致推理模式，算力全开。" },
];

/**
 * GPT-6-astra: low, medium, high, xhigh, max, ultra — and `low` is where it starts.
 *
 * Two things separate this from the GPT-5.6-sol set it otherwise resembles.
 *
 * There is no `minimal`. The vendor's own picker offers six levels and that is not one of them, and
 * a level in the menu that the endpoint has never heard of is the failure this file exists to
 * prevent — the same one `gemini` + `minimal` was.
 *
 * And the default is `low`, not `medium`. That is the vendor's choice, not a preference: on this
 * family `low` is already where `medium` used to sit, and the levels above it are priced and paced
 * accordingly — the last two are the ones its own menu warns 「consume usage limits faster」 about.
 * Inheriting `medium` from every other set would quietly start everyone one notch up.
 *
 * Until this existed the family fell through to `STANDARD_3_LEVEL_OPTIONS`, so a model with six
 * levels was offered four, three of them real and `xhigh`/`max`/`ultra` unreachable.
 */
export const GPT_6_ASTRA_OPTIONS: ThinkingOption[] = [
	{ id: "off", label: "关闭", detail: "不推理，直接作答。最快。" },
	{ id: "low", label: "低", detail: "轻量推理，响应快。这一档是它的默认。", isDefault: true },
	{ id: "medium", label: "中", detail: "速度与推理深度之间的平衡。" },
	{ id: "high", label: "高", detail: "复杂问题需要的推理深度。" },
	{ id: "xhigh", label: "超高", detail: "更深一层的推演，用于难题。" },
	{ id: "max", label: "最高", detail: "质量比速度重要时用，用量消耗更快。" },
	{ id: "ultra", label: "极致", detail: "多智能体协同的重活，用量消耗最快。" },
];

/**
 * GPT-4.1 / fast reasoning 3-level set (off, low, high).
 */
export const FAST_3_LEVEL_OPTIONS: ThinkingOption[] = [
	{ id: "off", label: "关闭", detail: "不推理，直接作答。最快。" },
	{ id: "low", label: "低", detail: "快速推理。" },
	{ id: "high", label: "高", detail: "深度推理。", isDefault: true },
];

/**
 * Resolve effective thinking options for a given model.
 * If the model has explicit options configured, use them.
 * Otherwise, infer the appropriate options dynamically based on model brand/ID.
 */
export function resolveModelThinkingOptions(model?: ModelConfig | null): ThinkingOption[] {
	if (!model || model.supportsThinking === false) {
		return [];
	}

	if (model.thinkingOptions !== undefined) {
		return model.thinkingOptions;
	}

	const id = (model.modelId || model.id || "").toLowerCase();

	/*
	 * The vendor decides first, because the vendor is what the API contract belongs to.
	 *
	 * This used to sit third, behind a rule that matched a bare `ultra` anywhere in the id — so
	 * `gemini-ultra` and `gemini-3.0-ultra`, both real models, were handed GPT-5.6-sol's eight
	 * levels and offered 「极简」 in the menu. Which is precisely the case the whole exercise was
	 * for: Google's API rejects `minimal` with an HTTP 400.
	 *
	 * The clamp in `resolveReasoningEffort` caught it before it reached the wire, so nothing ever
	 * failed — but the menu was showing four settings that could not do anything: 极简 and 低 both
	 * sent `low`, and 超高/最高/极致 all sent `high`. A control that cannot affect what it names is
	 * worse than a missing one.
	 */
	if (id.includes("gemini") || id.includes("gemma")) {
		return STANDARD_3_LEVEL_OPTIONS;
	}

	/*
	 * GPT-6-astra, ahead of the `gpt-` + `ultra` rule below.
	 *
	 * Named variants rather than a bare `gpt-6`: `astra` covers the family that shipped — `-pro`,
	 * `-fast`, and the `openai/`, `openai.`, `azure/` prefixes relays put in front of it — while a
	 * later `gpt-6-<something else>` keeps falling through to the conservative set rather than being
	 * handed six levels on the strength of sharing a version number. Claiming a capability for a
	 * model nobody has seen yet is how `minimal` reached Gemini.
	 */
	if (id.includes("gpt-6-astra") || id.includes("gpt6-astra")) {
		return GPT_6_ASTRA_OPTIONS;
	}

	/*
	 * GPT-5.6-sol and its ultra tier.
	 *
	 * `ultra` is qualified by the family rather than matched on its own: it is a word that appears
	 * in other vendors' model names, and on its own it was reaching past every rule below it.
	 */
	if (id.includes("5.6-sol") || id.includes("5.6-terra") || (id.includes("gpt-") && id.includes("ultra"))) {
		return GPT_5_6_SOL_OPTIONS;
	}

	/*
	 * Standard GPT-5.6.
	 *
	 * `gpt-5.6` spelled out, not a bare `5.6` — that matched `llama-5.6b` and anything else whose
	 * name happens to contain those two digits, and handed it a set of levels its API has never
	 * heard of.
	 */
	if (id.includes("gpt-5.6") || id.includes("gpt5.6")) {
		return GPT_5_6_STANDARD_OPTIONS;
	}

	// GPT-5.4 / 5.5 models
	if (id.includes("gpt-5.5") || id.includes("gpt-5.4") || id.includes("gpt-5.3")) {
		if (id.includes("mini")) {
			return STANDARD_3_LEVEL_OPTIONS;
		}
		return STANDARD_5_LEVEL_OPTIONS;
	}

	// 5. GPT-4.1 / o3 / o4-mini
	if (id.includes("gpt-4.1") || id.includes("o3") || id.includes("o4-mini")) {
		return FAST_3_LEVEL_OPTIONS;
	}

	// Compatibility fallback for unrecognised relay aliases, not a provider capability claim.
	// Explicit thinkingOptions (including an empty list) always take precedence.
	return STANDARD_3_LEVEL_OPTIONS;
}

/** Use the same capability list as the UI; stale selections inherit its displayed default. */
export function resolveReasoningEffort(level: ThinkingLevel | undefined, model?: ModelConfig | null): string | undefined {
	if (!level || level === "off") return undefined;
	const options = resolveModelThinkingOptions(model);
	const selected = options.find((option) => option.id === level)
		?? options.find((option) => option.isDefault) ?? options[0];
	return selected?.id === "off" ? undefined : selected?.id;
}
