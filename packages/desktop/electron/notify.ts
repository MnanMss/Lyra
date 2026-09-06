/**
 * System notification on agent task events.
 *
 * Emits an OS notification when an agent finishes its work or asks for user assistance
 * while the user is away from the app window. Clicking the notification restores and
 * focuses the window, navigating directly to the conversation.
 */

export interface NotificationInstance {
	show(): void;
	on(event: "click", listener: () => void): void;
}

export interface TaskDoneDetails {
	sessionId: string;
	title?: string;
}

export interface NeedAssistanceDetails {
	sessionId: string;
	title?: string;
	question?: string;
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
	reveal(then?: () => void): void;
	sendTrayCommand(command: `open-session:${string}`): void;
	createNotification(options: NotificationOptionsLike): NotificationInstance;
}

let deps: NotifyDeps = {
	isSupported: () => false,
	window: () => null,
	appIcon: () => undefined,
	reveal: (_then) => {},
	sendTrayCommand: (_cmd) => {},
	createNotification: () => ({
		show: () => {},
		on: () => {},
	}),
};

export function configureNotify(next: Partial<NotifyDeps>): void {
	deps = { ...deps, ...next };
}

function isWindowActive(win: WindowLike | null): boolean {
	return Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized());
}

/**
 * Triggered when a turn finishes with reason "done".
 * Suppressed if the user is already looking at the focused window.
 */
export function notifyTaskDone(details: TaskDoneDetails): void {
	if (!deps.isSupported()) return;
	if (isWindowActive(deps.window())) return;

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
		deps.reveal(() => {
			deps.sendTrayCommand(`open-session:${details.sessionId}`);
		});
	});

	notification.show();
}

/**
 * Triggered when an agent requests user assistance or choices via ask_user.
 * Suppressed if the user is actively viewing the focused window.
 */
export function notifyNeedAssistance(details: NeedAssistanceDetails): void {
	if (!deps.isSupported()) return;
	if (isWindowActive(deps.window())) return;

	const sessionTitle = details.title?.trim();
	const question = details.question?.trim().replace(/\s+/g, " ");
	const questionSummary = question ? (question.length > 80 ? `${question.slice(0, 77)}...` : question) : undefined;

	let body: string;
	if (sessionTitle && questionSummary) {
		body = `「${sessionTitle}」模型需要协助：${questionSummary}`;
	} else if (sessionTitle) {
		body = `「${sessionTitle}」模型需要协助`;
	} else if (questionSummary) {
		body = `模型需要协助：${questionSummary}`;
	} else {
		body = "模型需要协助";
	}

	const icon = deps.appIcon();
	const notification = deps.createNotification({
		title: "Lyra",
		body,
		...(icon ? { icon } : {}),
		silent: false,
	});

	notification.on("click", () => {
		deps.reveal(() => {
			deps.sendTrayCommand(`open-session:${details.sessionId}`);
		});
	});

	notification.show();
}
