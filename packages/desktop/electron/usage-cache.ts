/** Validation for the incremental usage cache. Invalid or old caches are simply rebuilt. */

import { readFile } from "node:fs/promises";
import type { UsageBucket } from "./usage-types.ts";

export interface UsageFileEntry {
	mtimeMs: number;
	size: number;
	buckets: UsageBucket[];
	days: Record<string, number>;
}

export type UsageFiles = Record<string, UsageFileEntry>;

interface UsageCache {
	version: 2;
	pricingKey: string;
	files: UsageFiles;
}

export const USAGE_CACHE_VERSION = 2 as const;

const BUCKET_NUMBERS: (keyof UsageBucket)[] = [
	"input", "output", "cacheRead", "cacheWrite", "reasoning", "cost", "inputCost", "outputCost",
	"cacheReadCost", "cacheWriteCost", "rawCost", "cacheSavings", "providerPricedTokens",
	"catalogPricedTokens", "manualPricedTokens", "recordedPricedTokens", "unpricedTokens", "replies",
];

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : null;
}

function isUsageBucket(value: unknown): value is UsageBucket {
	const bucket = asRecord(value);
	if (!bucket || typeof bucket.day !== "string" || typeof bucket.key !== "string" || typeof bucket.provider !== "string" || typeof bucket.model !== "string") return false;
	return BUCKET_NUMBERS.every((key) => {
		const field = bucket[key];
		return typeof field === "number" && Number.isFinite(field);
	});
}

function isFileEntry(value: unknown): value is UsageFileEntry {
	const entry = asRecord(value);
	if (!entry || typeof entry.mtimeMs !== "number" || typeof entry.size !== "number" || !Array.isArray(entry.buckets)) return false;
	const days = asRecord(entry.days);
	return Boolean(days) && Object.values(days ?? {}).every((count) => typeof count === "number") && entry.buckets.every(isUsageBucket);
}

function isUsageCache(value: unknown, expectedPricingKey: string): value is UsageCache {
	const cache = asRecord(value);
	if (!cache || cache.version !== USAGE_CACHE_VERSION || cache.pricingKey !== expectedPricingKey) return false;
	const files = asRecord(cache.files);
	return Boolean(files) && Object.values(files ?? {}).every(isFileEntry);
}

export async function readUsageCache(path: string, expectedPricingKey: string): Promise<UsageFiles> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return isUsageCache(parsed, expectedPricingKey) ? parsed.files : {};
	} catch {
		return {};
	}
}
