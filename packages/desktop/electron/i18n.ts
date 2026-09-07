import type { UiLocale } from "@lyra/core";

export type NativeLocale = Exclude<UiLocale, "system">;

const zhCN = {
	"tray.show": "打开 Lyra",
	"tray.hide": "隐藏 Lyra",
	"tray.newChat": "新对话",
	"tray.recent": "最近会话",
	"tray.noChats": "还没有会话",
	"tray.pullRequests": "拉取请求",
	"tray.scheduled": "已安排",
	"tray.settings": "设置…",
	"tray.updates": "检查更新…",
	"tray.launchAtLogin": "开机时启动",
	"tray.quit": "退出 Lyra",
	"dialog.projectDirectory": "选择项目目录",
	"dialog.screenshotDirectory": "选择截图保存位置",
} as const;

type NativeMessageKey = keyof typeof zhCN;
type NativeCatalog = Record<NativeMessageKey, string>;

const catalogs: Record<NativeLocale, NativeCatalog> = {
	"zh-CN": zhCN,
	"zh-TW": {
		"tray.show": "開啟 Lyra", "tray.hide": "隱藏 Lyra", "tray.newChat": "新對話", "tray.recent": "最近對話", "tray.noChats": "還沒有對話", "tray.pullRequests": "拉取請求", "tray.scheduled": "已排程", "tray.settings": "設定…", "tray.updates": "檢查更新…", "tray.launchAtLogin": "開機時啟動", "tray.quit": "結束 Lyra", "dialog.projectDirectory": "選擇專案目錄", "dialog.screenshotDirectory": "選擇截圖儲存位置",
	},
	en: {
		"tray.show": "Open Lyra", "tray.hide": "Hide Lyra", "tray.newChat": "New chat", "tray.recent": "Recent chats", "tray.noChats": "No chats yet", "tray.pullRequests": "Pull requests", "tray.scheduled": "Scheduled", "tray.settings": "Settings…", "tray.updates": "Check for updates…", "tray.launchAtLogin": "Launch at login", "tray.quit": "Quit Lyra", "dialog.projectDirectory": "Choose project folder", "dialog.screenshotDirectory": "Choose screenshot folder",
	},
	fr: {
		"tray.show": "Ouvrir Lyra", "tray.hide": "Masquer Lyra", "tray.newChat": "Nouvelle discussion", "tray.recent": "Discussions récentes", "tray.noChats": "Aucune discussion", "tray.pullRequests": "Demandes de fusion", "tray.scheduled": "Planifiées", "tray.settings": "Réglages…", "tray.updates": "Rechercher des mises à jour…", "tray.launchAtLogin": "Ouvrir à la connexion", "tray.quit": "Quitter Lyra", "dialog.projectDirectory": "Choisir le dossier du projet", "dialog.screenshotDirectory": "Choisir le dossier des captures",
	},
	ru: {
		"tray.show": "Открыть Lyra", "tray.hide": "Скрыть Lyra", "tray.newChat": "Новый чат", "tray.recent": "Недавние чаты", "tray.noChats": "Чатов пока нет", "tray.pullRequests": "Запросы на слияние", "tray.scheduled": "Запланировано", "tray.settings": "Настройки…", "tray.updates": "Проверить обновления…", "tray.launchAtLogin": "Запускать при входе", "tray.quit": "Выйти из Lyra", "dialog.projectDirectory": "Выберите папку проекта", "dialog.screenshotDirectory": "Выберите папку для снимков",
	},
	ko: {
		"tray.show": "Lyra 열기", "tray.hide": "Lyra 숨기기", "tray.newChat": "새 대화", "tray.recent": "최근 대화", "tray.noChats": "아직 대화가 없습니다", "tray.pullRequests": "Pull request", "tray.scheduled": "예약됨", "tray.settings": "설정…", "tray.updates": "업데이트 확인…", "tray.launchAtLogin": "로그인할 때 실행", "tray.quit": "Lyra 종료", "dialog.projectDirectory": "프로젝트 폴더 선택", "dialog.screenshotDirectory": "스크린샷 저장 폴더 선택",
	},
	ja: {
		"tray.show": "Lyra を開く", "tray.hide": "Lyra を隠す", "tray.newChat": "新しい会話", "tray.recent": "最近の会話", "tray.noChats": "会話はまだありません", "tray.pullRequests": "プルリクエスト", "tray.scheduled": "予約済み", "tray.settings": "設定…", "tray.updates": "アップデートを確認…", "tray.launchAtLogin": "ログイン時に起動", "tray.quit": "Lyra を終了", "dialog.projectDirectory": "プロジェクトフォルダーを選択", "dialog.screenshotDirectory": "スクリーンショットの保存先を選択",
	},
};

export function resolveNativeLocale(locale: UiLocale, systemLocale: string): NativeLocale {
	if (locale !== "system") return locale;
	const normalized = systemLocale.trim().replaceAll("_", "-").toLowerCase();
	if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized.startsWith("zh-hant")) return "zh-TW";
	if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
	if (normalized === "fr" || normalized.startsWith("fr-")) return "fr";
	if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
	if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
	if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
	return "en";
}

export function nativeTranslator(locale: UiLocale, systemLocale: string): (key: NativeMessageKey) => string {
	const catalog = catalogs[resolveNativeLocale(locale, systemLocale)];
	return (key) => catalog[key];
}
