import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyUsage } from "../src/types/message.ts";
import type { ModelConfig, ModelPricing } from "../src/types/provider.ts";
import { computeCost, selectPricingRates } from "../src/utils/pricing.ts";

function model(pricing: ModelPricing): ModelConfig {
	return {
		id: "qa/model",
		providerId: "qa",
		modelId: "model",
		name: "model",
		contextWindow: 1_000_000,
		maxOutputTokens: 100_000,
		supportsThinking: true,
		supportsImages: true,
		supportsTools: true,
		pricing,
	};
}

describe("model pricing", () => {
	it("prices the four token buckets independently and records the selected rates", () => {
		const usage = { ...emptyUsage(), input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
		const priced = computeCost(usage, model({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, source: "catalog", catalogVersion: "abc" }));
		assert.deepEqual(priced.cost, {
			input: 1,
			output: 2,
			cacheRead: 0.1,
			cacheWrite: 1.25,
			total: 4.35,
			source: "catalog",
			catalogVersion: "abc",
			rates: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
		});
	});

	it("uses ordinary input pricing when a provider has no distinct cache rate", () => {
		assert.deepEqual(selectPricingRates({ input: 1, cacheRead: 1, cacheWrite: 1 }, { input: 3, output: 9 }), {
			input: 3,
			output: 9,
			cacheRead: 3,
			cacheWrite: 3,
		});
	});

	it("selects the highest matching long-context tier", () => {
		const pricing: ModelPricing = {
			input: 1,
			output: 2,
			cacheRead: 0.1,
			tiers: [
				{ aboveTokens: 200_000, input: 2, output: 4, cacheRead: 0.2 },
				{ aboveTokens: 500_000, input: 3, output: 6, cacheRead: 0.3 },
			],
		};
		assert.equal(selectPricingRates({ input: 600_000, cacheRead: 0, cacheWrite: 0 }, pricing).input, 3);
		assert.equal(selectPricingRates({ input: 200_000, cacheRead: 0, cacheWrite: 0 }, pricing).input, 1);
	});
});
