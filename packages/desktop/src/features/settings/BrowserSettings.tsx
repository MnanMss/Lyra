import { ExternalLink, Trash2 } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Card, InlineSelect, Row, SectionTitle } from "./controls.tsx";

export function BrowserSettings() {
	const settings = useApp((state) => state.settings);
	const saveSettings = useApp((state) => state.saveSettings);
	if (!settings) return null;
	const config = settings.browser ?? {};
	const patch = (next: Partial<NonNullable<typeof settings.browser>>) => void saveSettings({ ...settings, browser: { ...config, ...next } });
	return <div className="pt-8">
		<h1 className="pb-7 text-display leading-tight font-semibold tracking-tight text-ink">浏览器</h1>
		<SectionTitle>浏览习惯</SectionTitle>
		<Card className="mb-7">
			<Row title="默认打开链接" control={<InlineSelect value={config.openLinks ?? "system"} options={[{ value: "system", label: "系统浏览器" }, { value: "builtin", label: "内置浏览器" }]} onChange={(openLinks) => patch({ openLinks })} />} />
			<Row title="新页面缩放" control={<InlineSelect value={String(config.defaultZoom ?? 1)} options={[0.75,1,1.25,1.5,2].map((factor) => ({ value: String(factor), label: `${factor * 100}%` }))} onChange={(factor) => patch({ defaultZoom: Number(factor) })} />} />
			<Row title="Agent 操作" detail="直接操作同一页面，显示实时光标；各会话的标签独立。" />
			<Row title="页面检查" detail="在浏览器工具栏选取元素或框选区域，附上截图和修改要求发给 Agent。" />
			<Row title="开发者工具" detail="包含 Elements、Styles、Console 和 Network，可独立打开。" />
		</Card>
		<SectionTitle>书签</SectionTitle>
		<Card>
			{config.bookmarks?.length ? config.bookmarks.map((bookmark) => <div key={bookmark.url} className="group flex items-center gap-2 px-4 py-2.5">
				<div className="min-w-0 flex-1"><ScrollText text={bookmark.title} className="text-label text-ink" /><ScrollText text={bookmark.url} className="text-caption text-ink-faint" /></div>
				<IconButton label="打开书签" icon={<ExternalLink size={14} />} onClick={() => { useApp.getState().setView("chat"); void bridge.browser.command({ type: "open", url: bookmark.url, sessionId: useApp.getState().activeSessionId, newTab: true }).catch((error: unknown) => useApp.getState().notify(String(error), "error")); }} />
				<IconButton label="删除书签" tone="danger" icon={<Trash2 size={14} />} onClick={() => patch({ bookmarks: config.bookmarks?.filter((item) => item.url !== bookmark.url) })} />
			</div>) : <p className="p-4 text-detail text-ink-faint">点击浏览器地址栏旁的书签图标收藏网页。</p>}
		</Card>
	</div>;
}
