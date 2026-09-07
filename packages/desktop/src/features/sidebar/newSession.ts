/**
 * Starting a conversation in one particular project.
 *
 * Its own file because two places offer it — the button on the project row and the row's context
 * menu — and those two live in directories that already import each other. Putting the action in
 * either one makes the cycle real.
 */

import { useApp } from "../../store/index.ts";

/**
 * Switching project also resets the conversation before saving recency. Resetting again after
 * that write could discard a session submitted in the meantime. Unfold the group so its next
 * session is visible.
 */
export async function startProjectSession(path: string, expand?: () => void): Promise<void> {
	const { workspace, openWorkspace, newSession, setView } = useApp.getState();
	expand?.();
	if (workspace?.path !== path) {
		setView("chat");
		await openWorkspace(path);
	}
	else await newSession();
}
