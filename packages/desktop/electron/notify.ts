/**
 * System notification on agent task completion.
 *
 * Emits an OS notification when an agent finishes its work while the user is away
 * from the app window. Clicking the notification restores and focuses the window,
 * navigating directly to the conversation.
 */

export interface NotificationInstance {
	show(): void;
	on(event: "click", listener: () => void): void;
}

export interface TaskDoneDetails {
	sessionId: string;
	title?: string;
}

export interface WindowLike {
	isDestroyed(): boolean;
	isVisible(): boolean;
	isFocused(): boolean;
	isMinimized(): boolean;
}

export interface NotificationOptionsLike {
	title: string;
	body: string;
	icon?: string;
	silent?: boolean;
}

export interface NotifyDeps {
	isSupported(): boolean;
	window(): WindowLike | null;
	appIcon(): string | undefined;
	sendTrayCommand(command: `open-session:${string}`): void;
	createNotification(options: NotificationOptionsLike): NotificationInstance;
}

let deps: NotifyDeps = {
	isSupported: () => false,
	window: () => null,
	appIcon: () => undefined,
	sendTrayCommand: (_cmd) => {},
	createNotification: () => ({
		show: () => {},
		on: () => {},
	}),
};

export function configureNotify(next: Partial<NotifyDeps>): void {
	deps = { ...deps, ...next };
}

/**
 * Triggered when a turn finishes with reason "done".
 * Suppressed if the user is already looking at the focused window.
 */
export function notifyTaskDone(details: TaskDoneDetails): void {
	if (!deps.isSupported()) return;
	const win = deps.window();
	if (win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized()) {
		return;
	}

	const sessionTitle = details.title?.trim();
	const body = sessionTitle ? `「${sessionTitle}」已完成` : "任务已完成";
	const icon = deps.appIcon();

	const notification = deps.createNotification({
		title: "Lyra",
		body,
		...(icon ? { icon } : {}),
		silent: false,
	});

	notification.on("click", () => {
		// The shared tray dispatcher reveals the window and waits for a cold renderer.
		deps.sendTrayCommand(`open-session:${details.sessionId}`);
	});

	notification.show();
}
