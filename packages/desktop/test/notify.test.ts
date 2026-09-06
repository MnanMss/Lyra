/**
 * Logic and suppression guards for system notifications on task completion.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { configureNotify, notifyNeedAssistance, notifyTaskDone, type NotificationInstance, type WindowLike } from "../electron/notify.ts";

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

test("notifyTaskDone: shows notification when window is not focused, and triggers reveal on click", () => {
	let shown = false;
	let capturedOptions: unknown = null;
	let clickHandler: (() => void) | null = null;
	let revealed = false;
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
		reveal: (then) => {
			revealed = true;
			then?.();
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

	assert.equal(revealed, true, "Clicking notification must reveal the window");
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

test("notifyNeedAssistance: suppresses notification when window is focused and visible", () => {
	let created = false;
	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => true, isVisible: () => true }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyNeedAssistance({ sessionId: "sess-ask-1", title: "Test Task", question: "需要删除临时文件吗？" });
	assert.equal(created, false, "Window is focused; assistance notification must not be created");
});

test("notifyNeedAssistance: suppresses notification when OS does not support it", () => {
	let created = false;
	configureNotify({
		isSupported: () => false,
		window: () => mockWindow({ isFocused: () => false }),
		createNotification: () => {
			created = true;
			return { show: () => {}, on: () => {} };
		},
	});

	notifyNeedAssistance({ sessionId: "sess-ask-2", title: "Test Task", question: "需要删除临时文件吗？" });
	assert.equal(created, false, "Notifications unsupported; must not attempt creation");
});

test("notifyNeedAssistance: shows notification when window is blurred and navigates on click", () => {
	let shown = false;
	let capturedOptions: unknown = null;
	let clickHandler: (() => void) | null = null;
	let revealed = false;
	let receivedCommand: string | null = null;

	const mockNotificationInstance: NotificationInstance = {
		show: () => {
			shown = true;
		},
		on: (event: string, handler: () => void) => {
			if (event === "click") {
				clickHandler = handler;
			}
		},
	};

	configureNotify({
		isSupported: () => true,
		window: () => mockWindow({ isFocused: () => false }),
		appIcon: () => "/path/to/icon.png",
		reveal: (then) => {
			revealed = true;
			then?.();
		},
		sendTrayCommand: (cmd) => {
			receivedCommand = cmd;
		},
		createNotification: (options) => {
			capturedOptions = options;
			return mockNotificationInstance;
		},
	});

	notifyNeedAssistance({
		sessionId: "sess-ask-99",
		title: "重构数据库",
		question: "请选择迁移模式：自动还是手动？",
	});

	assert.equal(shown, true, "Notification must be shown when window is not focused");
	assert.deepEqual(capturedOptions, {
		title: "Lyra",
		body: "「重构数据库」模型需要协助：请选择迁移模式：自动还是手动？",
		icon: "/path/to/icon.png",
		silent: false,
	});

	assert.ok(clickHandler, "Click handler must be registered");
	clickHandler!();

	assert.equal(revealed, true, "Clicking notification must reveal the window");
	assert.equal(receivedCommand, "open-session:sess-ask-99", "Must navigate to the session requesting assistance");
});

test("notifyNeedAssistance: handles missing title or question and truncates long question", () => {
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

	notifyNeedAssistance({ sessionId: "sess-empty" });
	assert.equal(
		(capturedOptions as { title: string; body: string })?.body,
		"模型需要协助",
	);

	const longQuestion = "a".repeat(100);
	notifyNeedAssistance({ sessionId: "sess-long", question: longQuestion });
	assert.equal(
		(capturedOptions as { title: string; body: string })?.body,
		`模型需要协助：${"a".repeat(77)}...`,
	);
});

test("notifyNeedAssistance: shows notification when window is minimized", () => {
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

	notifyNeedAssistance({ sessionId: "sess-min", title: "后台任务", question: "是否继续？" });
	assert.equal(shown, true, "Minimized window must receive assistance notification");
});
