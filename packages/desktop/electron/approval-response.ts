import type { AgentSession } from "@lyra/core";

/** Keep permission persistence tied to the pending request owned by the runtime. */
export async function resolveSessionApproval(
	session: Pick<AgentSession, "resolveApproval" | "listPendingApprovals">,
	requestId: string,
	decision: unknown,
	remember: (subject: string) => Promise<void>,
): Promise<void> {
	// Resolution consumes the request synchronously, so retain its trusted subject first.
	const pending = session.listPendingApprovals().find((entry) => entry.id === requestId);
	if (!session.resolveApproval(requestId, decision)) throw new Error("Invalid or expired approval response");
	if (decision === "always" && pending) await remember(pending.request.subject);
}
