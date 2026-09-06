import {
	Anchor,
	Archive,
	BarChart3,
	Blocks,
	Bot,
	Camera,
	Database,
	FolderGit2,
	GitPullRequest,
	Globe,
	Info,
	Layers,
	Palette,
	Search,
	Settings2,
	ShieldCheck,
	Smartphone,
	Sparkles,
	SquareTerminal,
	Wand2,
} from "lucide-react";
import type { SettingsSection } from "../../store/index.ts";
import { groupsFor } from "./sections-for.ts";

const GROUPS: { label: string; items: { id: SettingsSection; label: string; icon: typeof Settings2 }[] }[] = [
	{
		label: "基础设置",
		items: [
			{ id: "general", label: "常规", icon: Settings2 },
			{ id: "appearance", label: "外观", icon: Palette },
			// Next to 外观 because they are asked about together, and separate because one changes
			// how code is drawn and the other changes what is written to disk.
			{ id: "formatting", label: "代码格式化", icon: Wand2 },
			{ id: "personalization", label: "个性化", icon: Sparkles },
			{ id: "models", label: "模型设置", icon: Layers },
			{ id: "forges", label: "代码托管", icon: GitPullRequest },
			{ id: "screenshot", label: "屏幕截图", icon: Camera },
			{ id: "browser", label: "浏览器", icon: Globe },
		],
	},
	{
		label: "Agent 能力",
		items: [
			{ id: "plugins", label: "插件", icon: Blocks },
			{ id: "agents", label: "子智能体", icon: Bot },
			{ id: "commands", label: "命令", icon: SquareTerminal },
			{ id: "hooks", label: "钩子", icon: Anchor },
			{ id: "search", label: "网页搜索", icon: Search },
			{ id: "access", label: "访问授权", icon: ShieldCheck },
		],
	},
	{
		label: "数据与统计",
		items: [
			{ id: "index", label: "索引库", icon: Database },
			{ id: "sync", label: "移动端同步", icon: Smartphone },
			{ id: "usage", label: "使用统计", icon: BarChart3 },
		],
	},
	{
		label: "代码与版本控制",
		items: [
			{ id: "worktrees", label: "Worktrees", icon: FolderGit2 },
		],
	},
	{
		label: "关于与归档",
		items: [
			{ id: "about", label: "关于", icon: Info },
			{ id: "archived", label: "已归档的聊天", icon: Archive },
		],
	},
];


/** Navigation and page resolution share the same platform-filtered registry. */
export function settingsGroups(platform: string, phone: boolean) {
	return groupsFor(GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) => item.id !== "screenshot" || platform === "darwin"),
	})), phone);
}
