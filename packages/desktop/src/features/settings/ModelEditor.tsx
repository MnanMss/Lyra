import type { ModelConfig, ProviderConfig } from "@lyra/core";
import { catalogModelFor, catalogPricing, withCatalogDefaults, type CatalogMatch } from "@lyra/core/model-catalog";
import { ModelCatalog } from "./ModelCatalog.tsx";
import { Box } from "lucide-react";
import { useState } from "react";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Field, GhostButton, PrimaryButton, TextInput, Toggle } from "./controls.tsx";

export function ModelEditor({
	provider,
	model: savedModel,
	onSave,
	onCancel,
}: {
	provider: Pick<ProviderConfig, "id" | "baseUrl">;
	model: ModelConfig | null;
	onSave: (model: ModelConfig) => void;
	onCancel: () => void;
}) {
	const model = savedModel ? withCatalogDefaults(provider, savedModel) : null;
	const [catalogRef, setCatalogRef] = useState(model?.catalogRef);
	const [metadataSource, setMetadataSource] = useState<ModelConfig["metadataSource"]>(model?.metadataSource ?? "manual");
	const initialCatalog = model ? catalogModelFor(provider, model.modelId, model.catalogRef) : null;
	const initialPricing = model?.pricing ?? (initialCatalog ? catalogPricing(initialCatalog.provider.id, initialCatalog.model) : undefined);
	const [modelId, setModelId] = useState(model?.modelId ?? "");
	const [name, setName] = useState(model?.name ?? "");
	const [contextWindow, setContextWindow] = useState(String(model?.contextWindow ?? 200000));
	const [maxOutput, setMaxOutput] = useState(String(model?.maxOutputTokens ?? 16384));
	const [supportsThinking, setSupportsThinking] = useState(model?.supportsThinking ?? false);
	const [supportsImages, setSupportsImages] = useState(model?.supportsImages ?? false);
	const [supportsTools, setSupportsTools] = useState(model?.supportsTools ?? false);
	const [priceIn, setPriceIn] = useState(String(initialPricing?.input ?? ""));
	const [priceOut, setPriceOut] = useState(String(initialPricing?.output ?? ""));
	const [priceCacheRead, setPriceCacheRead] = useState(String(initialPricing?.cacheRead ?? ""));
	const [priceCacheWrite, setPriceCacheWrite] = useState(String(initialPricing?.cacheWrite ?? ""));
	const [pricingSource, setPricingSource] = useState<"manual" | "catalog" | null>(
		initialPricing ? initialPricing.source ?? (model?.pricing ? "manual" : "catalog") : null,
	);

	const trimmedId = modelId.trim();
	const window_ = Number(contextWindow);
	const output = Number(maxOutput);
	const windowOk = Number.isInteger(window_) && window_ > 0 && window_ <= 100_000_000;
	const outputOk = Number.isInteger(output) && output > 0 && output <= window_;
	const catalog = catalogModelFor(provider, trimmedId, catalogRef);
	const parsePrice = (value: string) => {
		if (!value.trim()) return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
	};
	const prices = [priceIn, priceOut, priceCacheRead, priceCacheWrite].map(parsePrice);
	const pricingComplete = prices[0] !== null && prices[1] !== null;
	const pricingEmpty = prices.every((price) => price === null);
	const pricingOk = prices.every((price) => price === null || Number.isFinite(price)) && (pricingComplete || pricingEmpty);
	const valid = trimmedId.length > 0 && windowOk && outputOk && pricingOk;

	function changePrice(setter: (value: string) => void, value: string) {
		setter(value);
		setPricingSource("manual");
	}

	function applyCatalog(found: CatalogMatch) {
		const entry = found.model;
		setCatalogRef(found.match === "binding" ? { providerId: found.provider.id, modelId: entry.id } : undefined);
		setMetadataSource("catalog");
		setName(entry.name);
		setContextWindow(String(entry.contextWindow));
		setMaxOutput(String(entry.maxOutputTokens));
		setSupportsThinking(entry.supportsThinking);
		setSupportsImages(entry.supportsImages);
		setSupportsTools(entry.supportsTools);
		setPriceIn(String(entry.inputPrice ?? ""));
		setPriceOut(String(entry.outputPrice ?? ""));
		setPriceCacheRead(entry.cacheReadPrice === undefined ? "" : String(entry.cacheReadPrice));
		setPriceCacheWrite(entry.cacheWritePrice === undefined ? "" : String(entry.cacheWritePrice));
		setPricingSource("catalog");
	}

	function changeModelId(value: string) {
		setModelId(value);
		setCatalogRef(undefined);
		const found = catalogModelFor(provider, value);
		if (found) applyCatalog(found);
		else {
			setName(value); setContextWindow("200000"); setMaxOutput("16384");
			setSupportsThinking(false); setSupportsImages(false); setSupportsTools(false);
			setMetadataSource("manual"); setPricingSource(null);
			setPriceIn(""); setPriceOut(""); setPriceCacheRead(""); setPriceCacheWrite("");
		}
	}

	function changeMetadata<T>(setter: (value: T) => void, value: T) {
		setter(value);
		setMetadataSource("manual");
	}

	function submit() {
		if (!valid) return;
		const [parsedIn, parsedOut, parsedCacheRead, parsedCacheWrite] = prices;
		const cataloguePricing = pricingSource === "catalog" && catalog ? catalogPricing(catalog.provider.id, catalog.model) : null;
		onSave({
			...model,
			id: `${provider.id}/${trimmedId}`,
			providerId: provider.id,
			modelId: trimmedId,
			name: name.trim() || trimmedId,
			contextWindow: window_,
			maxOutputTokens: output,
			supportsThinking,
			supportsImages,
			supportsTools,
			catalogRef,
			metadataSource,
			pricing:
				parsedIn !== null && parsedOut !== null
					? {
						...cataloguePricing,
						input: parsedIn,
						output: parsedOut,
						cacheRead: parsedCacheRead ?? undefined,
						cacheWrite: parsedCacheWrite ?? undefined,
						source: cataloguePricing ? "catalog" : "manual",
					}
					: undefined,
		});
	}

	return (
		<Overlay onClose={onCancel} width={560}>
			{(dismiss) => (
				<>
					<div className="border-b border-line px-5 py-3.5">
						<h3 className="flex items-center gap-2.5 text-body font-semibold text-ink">
							<Box size={20} className="text-accent" />
							{model ? "编辑模型" : "添加模型"}
						</h3>
					</div>

					<Scroller className="max-h-[64vh]" contentClassName="space-y-4 px-5 py-4">
						<Field label="模型 ID" hint="发送给供应商的实际模型名，例如 deepseek-v4-flash">
							<TextInput value={modelId} onChange={changeModelId} placeholder="deepseek-v4-flash" mono spellCheck={false} />
						</Field>

						<Field label="显示名称" hint="留空则使用模型 ID">
							<TextInput value={name} onChange={setName} placeholder="DeepSeek V4 Flash" />
						</Field>

						<ModelCatalog match={catalog} onApply={applyCatalog} />

						<div className="grid grid-cols-2 gap-3">
							<Field label="上下文窗口（token）" hint={windowOk ? undefined : "正整数，最大 1 亿"}>
								<TextInput value={contextWindow} onChange={(value) => changeMetadata(setContextWindow, value)} invalid={!windowOk} mono inputMode="numeric" />
							</Field>
							<Field label="最大输出（token）" hint={outputOk ? undefined : "正整数，且不超过上下文窗口"}>
								<TextInput value={maxOutput} onChange={(value) => changeMetadata(setMaxOutput, value)} invalid={!outputOk} mono inputMode="numeric" />
							</Field>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<Field label="输入价格（$/百万 token）" hint={!pricingOk && !pricingComplete ? "输入、输出价格需同时填写" : undefined}>
								<TextInput value={priceIn} onChange={(value) => changePrice(setPriceIn, value)} placeholder="未设置" mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
							<Field label="输出价格（$/百万 token）">
								<TextInput value={priceOut} onChange={(value) => changePrice(setPriceOut, value)} placeholder="未设置" mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
							<Field label="缓存命中价格（$/百万 token）">
								<TextInput value={priceCacheRead} onChange={(value) => changePrice(setPriceCacheRead, value)} placeholder="未设置" mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
							<Field label="缓存写入价格（$/百万 token）">
								<TextInput value={priceCacheWrite} onChange={(value) => changePrice(setPriceCacheWrite, value)} placeholder="未设置" mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
						</div>
						<p className="-mt-2 text-detail text-ink-faint">
							{pricingEmpty
								? "未设置价格；未匹配的模型只统计 token，不估算费用"
								: pricingSource === "catalog"
									? `价格来自 models.dev 离线快照（参考估算）${catalog?.model.tiers?.length ? `，含 ${catalog.model.tiers.length} 档长上下文价格` : ""}`
									: "当前使用手动价格，优先于离线目录"}
						</p>

						{!catalog && <p className="text-detail text-ink-muted">该型号的上下文、输出上限与能力尚未核实，请按供应商说明配置。</p>}
						<div className="space-y-3 rounded-[10px] border border-line px-3.5 py-3">
							<Capability label="支持思考 / 推理" checked={supportsThinking} onChange={(value) => changeMetadata(setSupportsThinking, value)} />
							<Capability label="支持图片输入" checked={supportsImages} onChange={(value) => changeMetadata(setSupportsImages, value)} />
							<Capability label="支持工具调用" checked={supportsTools} onChange={(value) => changeMetadata(setSupportsTools, value)} />
						</div>
					</Scroller>

					<div className="flex justify-end gap-2 border-t border-line px-5 py-3">
						<GhostButton onClick={() => dismiss()}>取消</GhostButton>
						<PrimaryButton onClick={() => dismiss(submit)} disabled={!valid}>保存</PrimaryButton>
					</div>
				</>
			)}
		</Overlay>
	);
}

function Capability({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<label className="flex items-center justify-between">
			<span className="text-label text-ink">{label}</span>
			<Toggle checked={checked} onChange={onChange} />
		</label>
	);
}
