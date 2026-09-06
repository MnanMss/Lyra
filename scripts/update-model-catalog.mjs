/**
 * Refresh the compact model catalogue bundled with Lyra.
 *
 * Runtime lookups must work without a network connection, so the application never reads
 * models.dev directly. This script is the only networked part: it includes all published text-model providers, keeps the fields used by the model editor and cost calculator, and records the
 * upstream revision at refresh time into the generated snapshot.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const API = "https://models.dev/api.json";
const COMMIT = "https://api.github.com/repos/anomalyco/models.dev/commits/dev";
const DEFAULT_OUTPUT = resolve("packages/core/src/catalog/model-catalog.json");

function outputPath() {
	const index = process.argv.indexOf("--output");
	if (index < 0) return DEFAULT_OUTPUT;
	const value = process.argv[index + 1];
	if (!value) throw new Error("--output requires a path");
	return resolve(value);
}

async function json(url) {
	const response = await fetch(url, { headers: { "User-Agent": "Lyra model catalogue updater" } });
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json();
}

function finite(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function contextTiers(cost) {
	if (!Array.isArray(cost?.tiers)) return undefined;
	const tiers = cost.tiers
		.filter((tier) => tier?.tier?.type === "context" && finite(tier.tier.size) !== undefined)
		.map((tier) => ({
			aboveTokens: tier.tier.size,
			input: finite(tier.input),
			output: finite(tier.output),
			cacheRead: finite(tier.cache_read),
			cacheWrite: finite(tier.cache_write),
		}))
		.filter((tier) => tier.input !== undefined && tier.output !== undefined)
		.sort((a, b) => a.aboveTokens - b.aboveTokens);
	return tiers.length > 0 ? tiers : undefined;
}

function compactModel(id, model) {
	const inputPrice = finite(model.cost?.input);
	const outputPrice = finite(model.cost?.output);
	if (!model.modalities?.output?.includes("text")) return null;
	const contextWindow = finite(model.limit?.context);
	const maxOutputTokens = finite(model.limit?.output);
	if (!contextWindow || !maxOutputTokens) return null;
	return {
		id,
		name: typeof model.name === "string" && model.name ? model.name : id,
		contextWindow,
		maxOutputTokens,
		inputPrice,
		outputPrice,
		...(finite(model.cost?.cache_read) === undefined ? {} : { cacheReadPrice: model.cost.cache_read }),
		...(finite(model.cost?.cache_write) === undefined ? {} : { cacheWritePrice: model.cost.cache_write }),
		...(contextTiers(model.cost) ? { tiers: contextTiers(model.cost) } : {}),
		supportsThinking: model.reasoning === true,
		supportsImages: model.modalities?.input?.includes("image") === true,
		supportsTools: model.tool_call === true,
	};
}

const [raw, commit] = await Promise.all([json(API), json(COMMIT)]);
const providers = [];
for (const [id, provider] of Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))) {
	if (!provider || typeof provider !== "object") throw new Error(`models.dev no longer contains provider ${id}`);
	const models = Object.entries(provider.models ?? {})
		.map(([modelId, model]) => compactModel(modelId, model))
		.filter(Boolean)
		.sort((a, b) => a.id.localeCompare(b.id));
	if (models.length === 0) continue;
	providers.push({
		id,
		name: provider.name,
		...(typeof provider.api === "string" ? { api: provider.api } : {}),
		...(typeof provider.doc === "string" ? { doc: provider.doc } : {}),
		models,
	});
}

const snapshot = {
	schema: 1,
	source: {
		name: "models.dev",
		url: API,
		repository: "https://github.com/anomalyco/models.dev",
		commit: commit.sha,
		updatedAt: commit.commit?.committer?.date ?? commit.commit?.author?.date,
		license: "MIT",
	},
	providers,
};

await writeFile(outputPath(), `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Wrote ${providers.length} providers and ${providers.reduce((sum, provider) => sum + provider.models.length, 0)} text models to ${outputPath()}`);
