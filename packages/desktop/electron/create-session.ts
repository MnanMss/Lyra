import type { Message, SessionStorage, Settings, UserContent } from "@lyra/core";
import type { SessionSnapshot } from "./ipc-types.ts";

export interface InitialPrompt {
	content: UserContent[];
	synthetic?: boolean;
}

/** Persist identity, title and the submitted message without starting MCP, Git or a provider. */
export async function createStoredSession(
	store: SessionStorage,
	settings: Settings,
	cwd: string,
	modelId: string,
	initial?: InitialPrompt,
): Promise<SessionSnapshot> {
	const text = initial?.content.find((block) => block.type === "text")?.text ?? "";
	const title = text.replace(/\s+/g, " ").trim().slice(0, 60) || (initial ? "图片消息" : "New session");
	let meta = await store.create(cwd, modelId || settings.defaultModelId || "", title);
	const messages: Message[] = initial ? [{ role: "user", content: initial.content, timestamp: Date.now(), ...(initial.synthetic ? { synthetic: true } : {}) }] : [];
	for (const message of messages) meta = await store.append(meta, { type: "message", message });
	if (initial || settings.worktrees?.autoCreateOnNewSession) {
		meta = await store.append(meta, { type: "meta", meta: {
			...meta,
			...(initial ? { pendingPrompt: true } : {}),
			...(settings.worktrees?.autoCreateOnNewSession ? { workspaceSetup: "worktree" } : {}),
		} });
	}
	return { meta, messages, running: Boolean(initial), pendingApprovals: [] };
}
