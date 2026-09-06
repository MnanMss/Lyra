import { MODEL_CATALOG_PROVIDERS, MODEL_CATALOG_SOURCE, type CatalogMatch } from "@lyra/core/model-catalog";
import { useMemo, useState } from "react";
import { TextInput } from "./inputs.tsx";

const PRIMARY = new Set(["openai", "anthropic", "google", "moonshotai", "alibaba", "zai", "deepseek", "xai", "minimax", "openrouter"]);

export function ModelCatalog({ match, onApply }: { match: CatalogMatch | null; onApply: (match: CatalogMatch) => void }) {
	const [query, setQuery] = useState("");
	const results = useMemo(() => {
		const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return [];
		return MODEL_CATALOG_PROVIDERS.flatMap((provider) => provider.models
			.filter((model) => words.every((word) => `${provider.name} ${provider.id} ${model.id} ${model.name}`.toLowerCase().includes(word)))
			.map((model) => ({ provider, model, match: "binding" } satisfies CatalogMatch)))
			.sort((a, b) => Number(PRIMARY.has(b.provider.id)) - Number(PRIMARY.has(a.provider.id)))
			.slice(0, 30);
	}, [query]);
	return (
		<div className="space-y-2 rounded-[10px] border border-line px-3 py-2.5">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-label font-medium text-ink">{match ? "离线模型目录已匹配" : "尚未识别上游模型"}</div>
					<div className="break-words text-detail text-ink-faint">
						{match ? `${match.provider.name} · ${match.model.id}` : "可搜索并绑定实际型号；不会改动发送给供应商的模型 ID。"}
					</div>
				</div>
				{match && <button type="button" onClick={() => onApply(match)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-label font-medium text-accent hover:bg-accent/10">同步目录信息</button>}
			</div>
			<TextInput value={query} onChange={setQuery} aria-label="搜索模型目录" placeholder="搜索目录：GPT、Gemini、Kimi、Qwen、HY、GLM、Claude…" />
			{query.trim() && <div className="max-h-48 overflow-y-auto" aria-label="模型目录搜索结果">
				{results.length === 0 ? <p className="py-2 text-detail text-ink-muted">目录暂无该型号，请填写已确认的价格和能力。</p> : results.map((entry) => (
					<button type="button" key={`${entry.provider.id}/${entry.model.id}`} onClick={() => { onApply(entry); setQuery(""); }}
						className="block w-full rounded-lg px-2 py-2 text-left hover:bg-accent/10">
						<span className="block break-all text-label text-ink">{entry.model.id}</span>
						<span className="text-detail text-ink-muted">{entry.provider.name} · {entry.model.inputPrice === undefined || entry.model.outputPrice === undefined ? "暂无价格" : `$${entry.model.inputPrice} / $${entry.model.outputPrice} 每百万 token`}</span>
					</button>
				))}
			</div>}
			<p className="text-detail text-ink-faint">models.dev · {new Date(MODEL_CATALOG_SOURCE.updatedAt).toLocaleDateString()} · {MODEL_CATALOG_PROVIDERS.length} 个供应商。目录价用于估算，中转实际账单以供应商为准。</p>
		</div>
	);
}
