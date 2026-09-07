export interface RetryRule {
	/** Retries after the initial request; null means until cancelled. */
	retries: number | null;
	strategy: "fixed" | "linear";
	intervalMs: number;
	maxIntervalMs: number;
}
export interface RetryPolicy { network: RetryRule; upstream: RetryRule }
export type RetryFailure = keyof RetryPolicy;

export const DEFAULT_RETRY_RULE: RetryRule = { retries: 10, strategy: "fixed", intervalMs: 5000, maxIntervalMs: 30_000 };
export const DEFAULT_RETRY_POLICY: RetryPolicy = { network: { ...DEFAULT_RETRY_RULE, retries: null }, upstream: { ...DEFAULT_RETRY_RULE } };

function normalizeRule(value: unknown, fallback: RetryRule): RetryRule {
	const raw = value && typeof value === "object" ? value : {};
	const number = (candidate: unknown, defaultValue: number, min: number, max: number) => typeof candidate === "number" && Number.isFinite(candidate) ? Math.min(max, Math.max(min, Math.round(candidate))) : defaultValue;
	const retries = "retries" in raw ? raw.retries : fallback.retries;
	const intervalMs = number("intervalMs" in raw ? raw.intervalMs : undefined, fallback.intervalMs, 1000, 3_600_000);
	return {
		retries: retries === null ? null : number(retries, fallback.retries ?? 10, 0, 1_000_000),
		strategy: "strategy" in raw && raw.strategy === "linear" ? "linear" : "fixed",
		intervalMs,
		maxIntervalMs: Math.max(intervalMs, number("maxIntervalMs" in raw ? raw.maxIntervalMs : undefined, fallback.maxIntervalMs, 1000, 3_600_000)),
	};
}

/** Separate fault policies; legacy explicit attempt limits remain meaningful for upstream failures. */
export function normalizeRetryPolicy(value: unknown, legacyAttempts?: number): RetryPolicy {
	const raw = value && typeof value === "object" ? value : {};
	const legacy = typeof legacyAttempts === "number" && Number.isFinite(legacyAttempts) && legacyAttempts !== 5 ? { ...DEFAULT_RETRY_RULE, retries: Math.max(0, legacyAttempts - 1) } : DEFAULT_RETRY_RULE;
	return {
		network: normalizeRule("network" in raw ? raw.network : undefined, DEFAULT_RETRY_POLICY.network),
		upstream: normalizeRule("upstream" in raw ? raw.upstream : "retries" in raw ? raw : undefined, legacy),
	};
}

export function policyDelay(policy: RetryRule, retry: number): number {
	return policy.strategy === "fixed" ? policy.intervalMs : Math.min(policy.maxIntervalMs, policy.intervalMs * Math.max(1, retry));
}
