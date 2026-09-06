/**
 * Summarises the opening turn of a conversation into a concise title.
 *
 * Runs once at the beginning of a session when the initial user prompt is longer than a short
 * sentence (threshold of 12 characters). Before the summary lands, the session is given an
 * immediate fallback title sliced from the raw prompt so the sidebar is never left blank.
 *
 * When configured, the `@fast` role model is preferred to keep the summary lightweight and cheap;
 * otherwise it falls back to the session's active model.
 */

import type { streamAssistant } from "../ai/index.ts";
import type { ModelConfig, ProviderConfig } from "../types.ts";

/** Short prompts below or equal to this character count do not need summarisation. */
export const TITLE_SUMMARY_THRESHOLD = 12;

/** Maximum time allowed for title generation before falling back to the initial title. */
export const TITLE_SUMMARY_TIMEOUT_MS = 15_000;

const SUMMARY_SYSTEM =
	"你是一个会话标题生成助手。请为用户的提问或任务生成一个极简、精准的会话标题。\\n" +
	"规则：\\n" +
	"1. 长度控制在 6 到 18 个字符之间，突出核心任务或意图；\\n" +
	"2. 保持与用户输入一致的语言（中文或英文等）；\\n" +
	"3. 仅输出标题纯文本，严禁包含任何前缀（如“标题：”）、严禁包裹书名号《》、引号或反引号、严禁以句号等标点结尾。";

export interface SummarizeTitleOptions {
	text: string;
	provider: ProviderConfig;
	model: ModelConfig;
	stream: typeof streamAssistant;
	signal?: AbortSignal;
}

/** Clean up raw model outputs, stripping unwanted quotes, markdown markers, and prefixes. */
export function cleanTitleSummary(raw: string): string {
	let text = raw.trim();
	// Strip thinking tags or code blocks if any leaked through
	text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
	text = text.replace(/^```[a-z]*\n?([\s\S]*?)```$/i, "$1").trim();

	// Strip common prefixes
	text = text.replace(/^(?:标题|主题|Title|Session Title)\s*[:：]\s*/i, "");

	// Strip surrounding quotes / brackets
	text = text.replace(/^[《"“'‘`]+|[》"”'’`]+$/g, "").trim();

	// Strip trailing punctuation
	text = text.replace(/[。.!！?？;；]+$/g, "").trim();

	// Normalize internal whitespace
	text = text.replace(/\s+/g, " ").trim();

	return text.slice(0, 30);
}

/**
 * Request a concise title summary from the model.
 * Returns null on timeout, network error, empty reply, or model failure.
 */
export async function summarizeTitle(options: SummarizeTitleOptions): Promise<string | null> {
	const trimmed = options.text.trim();
	if (!trimmed) return null;

	const stream = options.stream(
		options.provider,
		options.model,
		{
			systemPrompt: SUMMARY_SYSTEM,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: trimmed }],
					timestamp: Date.now(),
				},
			],
			tools: [],
		},
		{
			thinking: "off",
			signal: options.signal,
			maxTokens: Math.min(60, options.model.maxOutputTokens || 60),
		},
	);

	let final: Awaited<ReturnType<typeof stream.next>>;
	try {
		do {
			final = await stream.next();
		} while (!final.done);
	} catch {
		return null;
	}

	const reply = final.value;
	if (reply.stopReason === "error" || reply.stopReason === "aborted") return null;

	const collected = reply.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");

	const cleaned = cleanTitleSummary(collected);
	return cleaned || null;
}
