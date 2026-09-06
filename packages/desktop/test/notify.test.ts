/**
 * Logic and suppression guards for system notifications on task completion.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { configureNotify, notifyTaskDone, type NotificationInstance, type WindowLike } from "../electron/notify.ts";

function mockWindow(overrides: Partial<WindowLike> = {}): WindowLike {
	return {
		isDestroyed: () => false,
		isVisible: () => true,
		isFocused: () => true,
		isMinimized: () => false,
		...overrides,
	};
}

test("notifyTaskDone: suppresses notification when window is focused and visible", () => {
	let created = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isVisible: () => true }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyTaskDone({ sessionId: "sess-1", title: "Test Task" });
	assert.equal(created, false, "Window is focused; notification must not be created");
});

test("notifyTaskDone: suppresses notification when OS does not support it", () => {
	let created = false;
	configureNotify({
		isSupported: () => false,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyTaskDone({ sessionId: "sess-1", title: "Test Task" });
	assert.equal(created, false, "Notifications unsupported; must not attempt creation");
});

test("notifyTaskDone: shows notification when window is not focused, and sends the session to the shared tray dispatcher on click", () => {
	let shown = false;
	let capturedOptions: unknown = null;
	let clickHandler: (() => void) | null = null;
	let sentCommand: string | null = null;

	const dummyNotification: NotificationInstance = {
		show: () => {
			shown = true;
		},
		on: (event: string, handler: () => void) => {
			if (event === "click") clickHandler = handler;
		},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		appIcon: () => "/path/to/icon.png",
		createNotification: (options) => {
			capturedOptions = options;
			return dummyNotification;
		},
		sendTrayCommand: (cmd) => {
			sentCommand = cmd;
		},
	});

	notifyTaskDone({ sessionId: "sess-42", title: "重构登录逻辑" });

	assert.equal(shown, true, "Notification should be shown");
	assert.deepEqual(capturedOptions, {
		title: "Lyra",
		body: "「重构登录逻辑」已完成",
		icon: "/path/to/icon.png",
		silent: false,
	});

	// Simulate user clicking on notification
	assert.ok(clickHandler, "Click handler must be registered");
	(clickHandler as () => void)();

	assert.equal(sentCommand, "open-session:sess-42", "Must navigate to target session");
});

test("notifyTaskDone: shows notification when window is minimized even if previously focused", () => {
	let shown = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isMinimized: () => true }),
		createNotification: () => ({
			show: () => {
				shown = true;
			},
			on: () => {},
		}),
	});

	notifyTaskDone({ sessionId: "sess-min", title: "Minimized task" });
	assert.equal(shown, true, "Minimized window must receive notification");
});

test("notifyTaskDone: falls back to default body when title is empty or missing", () => {
	let capturedOptions: unknown = null;
	const dummyNotification: NotificationInstance = {
		show: () => {},
		on: () => {},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: (options) => {
			capturedOptions = options;
			return dummyNotification;
		},
	});

	notifyTaskDone({ sessionId: "sess-plain" });
	assert.equal(
		(capturedOptions as { title: string; body: string })?.body,
		"任务已完成",
	);
});

for (const [name, window] of [
	["closed", () => null],
	["hidden", () => mockWindow({ isVisible: () => false })],
	["destroyed", () => mockWindow({ isDestroyed: () => true })],
] satisfies [string, () => WindowLike | null][]) {
	test(`notifyTaskDone: a ${name} window still receives completion notifications`, () => {
		let shown = 0;
		configureNotify({
			isSupported: () => true,
			window,
			createNotification: () => ({ show: () => { shown++; }, on: () => {} }),
		});
		notifyTaskDone({ sessionId: "background" });
		assert.equal(shown, 1);
	});
}
