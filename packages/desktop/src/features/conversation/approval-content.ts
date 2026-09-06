/** Whitespace-only formatting differences must not repeat the entire question above itself. */
export function approvalReason(reason: string | undefined, detail: string): string | undefined {
	const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
	return reason && normalize(reason) && normalize(reason) !== normalize(detail) ? reason : undefined;
}
