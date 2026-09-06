import { useEffect } from "react";
import { create } from "zustand";
import type { BrowserCommand, BrowserState } from "../../../shared/browser.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useDock, useSide } from "../dock/index.ts";

export const useBrowser = create<BrowserState>(() => ({ tabs: [], activeId: null }));
export async function commandBrowser(command: BrowserCommand): Promise<void> {
	try { useBrowser.setState(await bridge.browser.command(command)); }
	catch (error) { useApp.getState().notify(String(error), "error"); }
}

export function useBrowserWorkspace(): void {
	useEffect(() => {
		if (onPhone()) return;
		const unsubscribe = bridge.browser.onChanged((state) => {
			useBrowser.setState({ tabs: state.tabs, activeId: state.activeId });
			if (state.reveal) useDock.getState().open("browser");
		});
		void bridge.browser.state().then((state) => useBrowser.setState(state));
		const unwatch = useSide.subscribe((state, previous) => {
			if (state.browserTarget === previous.browserTarget || !state.browserTarget) return;
			const target = state.browserTarget;
			const url = target.kind === "url" ? target.url : `ly-preview://${target.preview.sessionId}/${target.preview.id}/${target.preview.entry}`;
			void commandBrowser({ type: "open", url, sessionId: useApp.getState().activeSessionId, newTab: true });
		});
		return () => { unsubscribe(); unwatch(); };
	}, []);
}
