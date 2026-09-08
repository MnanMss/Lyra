/** Shared request/stream budget prevents nested retry loops from multiplying the configured limit. */
import { normalizeRetryPolicy, policyDelay, type RetryPolicy, type RetryPolicySource, type RetryFailure } from "../config/retry-policy.ts";

/** Explicit low-level attempt overrides (e.g. commit titles) retain their bounded lifetime. */
function resolvePolicy(policy: RetryPolicy | undefined, legacyAttempts: number | undefined): RetryPolicy {
	const normalized = normalizeRetryPolicy(policy, legacyAttempts);
	if (policy || legacyAttempts === undefined) return normalized;
	const retries = Number.isFinite(legacyAttempts) ? Math.max(0, Math.round(legacyAttempts) - 1) : 10;
	const upstream = { ...normalized.upstream, retries };
	return { upstream, network: { ...upstream } };
}

export class RetryBudget {
	private used = { network: 0, upstream: 0 };
	private readonly read: () => RetryPolicy | undefined;
	private readonly legacyAttempts?: number;
	private cache?: { from: RetryPolicy | undefined; resolved: RetryPolicy };
	constructor(policy?: RetryPolicySource, legacyAttempts?: number) {
		this.read = typeof policy === "function" ? policy : () => policy;
		this.legacyAttempts = legacyAttempts;
	}
	/**
	 * The rules in force right now, not the ones this request started under.
	 *
	 * Normalising is not free and this is read on every attempt, so the result is kept until the
	 * settings object itself is replaced — which is what saving the settings page does.
	 */
	get policy(): RetryPolicy {
		const from = this.read();
		if (!this.cache || this.cache.from !== from) this.cache = { from, resolved: resolvePolicy(from, this.legacyAttempts) };
		return this.cache.resolved;
	}
	available(kind: RetryFailure): boolean { const { retries } = this.policy[kind]; return retries === null || this.used[kind] < retries; }
	next(kind: RetryFailure): { attempt: number; delayMs: number } { this.used[kind]++; return { attempt: this.used.network + this.used.upstream, delayMs: policyDelay(this.policy[kind], this.used[kind]) }; }
}

/** Transport-level failures, none of which mean the request itself was bad. */
const RETRYABLE_CAUSES = new Set([
	"UND_ERR_SOCKET",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"EPIPE",
	"EAI_AGAIN",
	"ENOTFOUND",
	"ENETUNREACH",
	"EHOSTUNREACH",
]);

/**
 * Status codes worth a second attempt.
 *
 * 429 is the server asking to be asked later. The 5xx range here is the set that means "not
 * right now" rather than "not ever" — a 500 from a relay is usually one bad upstream node, and
 * 501 or 505 are excluded because repeating them changes nothing.
 *
 * 529 is Anthropic's "overloaded", which is not in any RFC and was therefore falling through to
 * "report it and stop" — the one status in the list that most literally means "ask again shortly".
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524, 529]);

export interface RetryOptions {
	budget?: RetryBudget;
	/** Total attempts, including the first. */
	attempts?: number;
	signal?: AbortSignal;
	/** Called before each wait, so a caller can tell the user what is happening. */
	onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
	/** Injected in tests so they do not sleep. */
	sleep?: (ms: number) => Promise<void>;
}

export function isRetryableError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const cause = (error as { cause?: { code?: string } }).cause;
	if (cause?.code && RETRYABLE_CAUSES.has(cause.code)) return true;
	if (cause?.code && ["ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_INVALID_URL"].includes(cause.code)) return false;
	// undici reports a bare "fetch failed" with the cause attached; some runtimes lose the cause.
	const msg = error.message.toLowerCase();
	return (
		error.message === "fetch failed" ||
		msg.includes("socket hang up") ||
		msg.includes("stream_read_error") ||
		msg.includes("premature close") ||
		msg.includes("terminated")
	);
}

export function isRetryableStatus(status: number): boolean {
	return RETRYABLE_STATUS.has(status);
}

/**
 * The longest wait worth sitting through inside one turn.
 *
 * A relay asking for ten minutes is not something to do silently. A minute is: it is shorter than
 * the turn that is already in flight, and the alternative — giving up — throws away everything the
 * turn has assembled so far.
 */
const MAX_WAIT_MS = 60_000;

/**
 * How long the server itself said to wait, in milliseconds, or null if it did not say.
 *
 * Two places to look, because servers disagree about where to put it. `Retry-After` is the
 * standard one and comes as either seconds or an HTTP date. The body is the other, and ignoring it
 * is what made this useless against the relay in front of us: it answers a 503 with
 * `{"error":{"code":"model_unavailable","reset_seconds":54,"reset_time":"53s"}}` and no header at
 * all, so every wait fell back to the curve below and the whole retry budget was spent in a couple
 * of seconds against an outage it had been told would last just under a minute.
 *
 * Only well-known keys, and only numbers that look like a wait. Scanning for any number in the
 * body would eventually find a model name with digits in it and sleep for that long.
 */
export function serverDelay(header: string | null, body?: string): number | null {
	if (header) {
		const seconds = Number(header);
		const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
		if (Number.isFinite(ms) && ms > 0) return ms;
	}
	if (!body) return null;
	/*
	 * Regex rather than `JSON.parse`, deliberately.
	 *
	 * The field is nested — and nested differently per provider — so parsing would mean knowing
	 * every shape in advance. What is stable is the key next to a number, and an error body is
	 * small enough that scanning it costs nothing.
	 */
	const seconds = body.match(/"(?:reset_seconds|retry_after|retry_after_seconds|retryAfter)"\s*:\s*(\d+(?:\.\d+)?)/);
	if (seconds) {
		const ms = Number(seconds[1]) * 1000;
		if (ms > 0) return ms;
	}
	// `"reset_time":"53s"` — the same fact as a string, which some of them send instead.
	const written = body.match(/"(?:reset_time|retry_after)"\s*:\s*"(\d+(?:\.\d+)?)s"/);
	if (written) {
		const ms = Number(written[1]) * 1000;
		if (ms > 0) return ms;
	}
	return null;
}

/**
 * How long to wait, honouring the server's own answer when it gives one.
 *
 * A server under load knows better than any curve we could pick, so its number wins outright —
 * only capped, never shortened. Ours is the fallback, and it starts where a person would expect a
 * retry to start rather than where a tight loop would: the first version began at 600ms and
 * tripled, which spent three attempts inside two and a half seconds and read as the app hammering
 * a server that had just said it was busy.
 */
export function retryDelay(attempt: number, response?: Response, body?: string): number {
	const said = serverDelay(response?.headers.get("retry-after") ?? null, body);
	if (said !== null) return Math.min(said, MAX_WAIT_MS);
	// 2s, 5s, 12.5s, 31s, 60s — with jitter, so a fleet of clients does not return in lockstep.
	// The ceiling is applied *after* the jitter: capping first lets the ±25% push the result
	// back over the limit, which is what the test caught.
	const base = 2000 * 2.5 ** (attempt - 1);
	return Math.min(base * (0.75 + Math.random() * 0.5), MAX_WAIT_MS);
}

/**
 * Wait for the given delay, unless the signal aborts first.
 *
 * Plain `setTimeout` cannot be cancelled, so sleeping for 60 seconds against an un-abortable timer
 * would keep the turn alive for the whole minute even if the user pressed stop.
 */
function abortableSleep(ms: number, signal?: AbortSignal, customSleep?: (ms: number) => Promise<void>): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	if (customSleep) return customSleep(ms);
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}

/**
 * Perform a request, retrying only what is safe to retry.
 *
 * Returns the response as soon as one arrives with a status worth keeping — including a 4xx,
 * which the caller reports as-is. Throws the last transport error if every attempt failed.
 */
export async function fetchWithRetry(
	doFetch: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
	options: RetryOptions = {},
): Promise<Response> {
	const attempts = options.budget ? Infinity : Math.max(1, options.attempts ?? 3);
	let lastError: unknown;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (options.signal?.aborted) break;
		try {
			const response = await doFetch(url, init);
			if ((options.budget ? options.budget.available("upstream") : attempt < attempts) && isRetryableStatus(response.status)) {
				/*
				 * The body is read, off a clone, purely to find out how long to wait.
				 *
				 * It used to be skipped on the grounds that nothing had been shown to anyone and a
				 * fresh attempt replaces it entirely — true of the *content*, and it cost us the one
				 * number that mattered. The relay puts `reset_seconds` in there and no `Retry-After`
				 * header, so without this every 503 was retried on the blind curve and the budget was
				 * gone long before the outage was. A clone, so the response the caller may still
				 * return is untouched; failures here fall back to the curve rather than throwing.
				 */
				const body = options.budget ? undefined : await response
					.clone()
					.text()
					.catch(() => undefined);
				const retry = options.budget?.next("upstream") ?? { attempt, delayMs: retryDelay(attempt, response, body) };
				const delay = retry.delayMs;
				// Release each failed response before an unlimited wait can accumulate connections.
				await response.body?.cancel().catch(() => undefined);
				options.onRetry?.({ ...retry, reason: `HTTP ${response.status}` });
				await abortableSleep(delay, options.signal, options.sleep);
				continue;
			}
			return response;
		} catch (error) {
			lastError = error;
			// A cancelled turn is not a failed one; stop immediately rather than waiting to retry.
			if (options.signal?.aborted || !isRetryableError(error) || (options.budget ? !options.budget.available("network") : attempt === attempts)) throw error;
			const retry = options.budget?.next("network") ?? { attempt, delayMs: retryDelay(attempt) };
			const delay = retry.delayMs;
			options.onRetry?.({ ...retry, reason: describeCause(error) });
			await abortableSleep(delay, options.signal, options.sleep);
		}
	}

	/*
	 * How many attempts it took to give up, attached to the error.
	 *
	 * Without it a failure after five tries and a failure on the first look identical in the
	 * transcript, and they call for opposite things: one is a wobble worth continuing through, the
	 * other is something that is not going to work no matter how long you wait.
	 */
	if (lastError instanceof Error && attempts > 1) {
		lastError.message = `${lastError.message}（已重试 ${attempts} 次）`;
	}
	throw lastError ?? new Error("请求已取消");
}

function describeCause(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause = (error as { cause?: { code?: string } }).cause;
	return cause?.code ?? error.message;
}

/**
 * A tool call's id, invented if the provider did not supply one.
 *
 * The id is the only thing tying a call to its result and to the card on screen. A provider
 * that omits it — some relays drop `call_id` on a truncated stream — used to yield the empty
 * string for every such call, so they all collided on one entry: the newest call reset the
 * shared record to "running" and every earlier card in the transcript started spinning again,
 * all showing the same elapsed time because they were all reading the same object.
 *
 * The fallback is remembered per output index, because one call arrives across several events
 * and they have to agree on what it is called.
 */
export function toolCallId(given: unknown, outputIndex: number, invented: Map<number, string>): string {
	const supplied = String(given ?? "").trim();
	if (supplied) return supplied;
	let generated = invented.get(outputIndex);
	if (!generated) {
		generated = `ly-call-${outputIndex}-${Math.random().toString(36).slice(2, 10)}`;
		invented.set(outputIndex, generated);
	}
	return generated;
}

/**
 * Run a streamed request, and start it over if the stream itself dies.
 *
 * `fetchWithRetry` covers getting the connection; this covers keeping it. They are different
 * failures with the same cause and very different odds: a request that takes forty seconds to
 * stream a large reply is exposed to a dropped socket for the whole of it, and a long piece of
 * work is exactly where the replies are longest. Losing one there ends the turn — and with it a
 * plan the agent was eight steps into.
 *
 * Starting over is safe because nothing has happened yet. Tools are executed by the caller after
 * a complete reply arrives, so a half-streamed one has changed nothing; the only cost is the
 * tokens spent saying it again.
 *
 * `reset` is called before every attempt to clear whatever the last one accumulated. Anything
 * already emitted to the UI is replaced by what the retry emits, because each update carries the
 * whole message rather than a delta to apply.
 */
export async function* retryStream<T>(
	attempt: (attemptNumber: number) => AsyncGenerator<T, void>,
	options: {
		budget?: RetryBudget;
		attempts?: number;
		signal?: AbortSignal;
		reset: () => void;
		onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
		sleep?: (ms: number) => Promise<void>;
	},
): AsyncGenerator<T, void> {
	const attempts = options.budget ? Infinity : Math.max(1, options.attempts ?? 3);

	for (let number = 1; number <= attempts; number++) {
		if (options.signal?.aborted) throw options.signal.reason ?? new Error("请求已取消");
		options.reset();
		try {
			yield* attempt(number);
			return;
		} catch (error) {
			const last = options.budget ? !options.budget.available("network") : number === attempts;
			if (last || options.signal?.aborted || !isRetryableError(error)) throw error;
			const retry = options.budget?.next("network") ?? { attempt: number, delayMs: retryDelay(number) };
			const delayMs = retry.delayMs;
			options.onRetry?.({ ...retry, reason: describeError(error) });
			await abortableSleep(delayMs, options.signal, options.sleep);
		}
	}
}

function describeError(error: unknown): string {
	const cause = (error as { cause?: { code?: string } })?.cause?.code;
	if (cause) return cause;
	return error instanceof Error ? error.message : String(error);
}
