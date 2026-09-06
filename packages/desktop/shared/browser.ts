export interface BrowserViewport { width: number; height: number }
export interface BrowserPointer { x: number; y: number; action: "click" | "type" | "hover" | "scroll" | "press"; sequence: number }
export interface BrowserTab {
	id: string;
	sessionId: string | null;
	url: string;
	title: string;
	loading: boolean;
	error?: string;
	canGoBack: boolean;
	canGoForward: boolean;
	zoom: number;
	viewport: BrowserViewport | null;
	pointer?: BrowserPointer;
}
export interface BrowserState { tabs: BrowserTab[]; activeId: string | null }
export interface BrowserSelection {
	url: string;
	title: string;
	selector: string;
	html: string;
	text: string;
	styles: Record<string, string>;
	bounds: { x: number; y: number; width: number; height: number };
	screenshot: string;
}
export type BrowserCommand =
	| { type: "open"; url: string; sessionId: string | null; newTab?: boolean }
	| { type: "select" | "close" | "back" | "forward" | "reload" | "devtools"; id: string }
	| { type: "zoom"; id: string; factor: number }
	| { type: "resize"; id: string; width: number; height: number }
	| { type: "viewport"; id: string; viewport: BrowserViewport | null };

export function browserUrl(raw: string): string {
	const text = raw.trim();
	if (!text) return "about:blank";
	const url = new URL(/^[a-z][\w+.-]*:/i.test(text) && !/^[\w.-]+:\d/.test(text) ? text : `https://${text}`);
	if (!["http:", "https:", "ly-preview:"].includes(url.protocol) && url.href !== "about:blank") throw new Error("只允许网页地址或 Lyra 本地预览");
	return url.href;
}

export function browserZoom(factor: number): number {
	if (!Number.isFinite(factor) || factor < 0.25 || factor > 3) throw new Error("缩放范围为 25%–300%");
	return factor;
}

export function browserViewport(value: BrowserViewport | null): BrowserViewport | null {
	if (value === null) return null;
	if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 240 || value.width > 3840 || value.height < 240 || value.height > 2160) throw new Error("视口范围为 240–3840 × 240–2160");
	return { width: value.width, height: value.height };
}

/** IPC data is not made safe by a TypeScript annotation. */
export function parseBrowserCommand(value: unknown): BrowserCommand {
	if (!value || typeof value !== "object" || !("type" in value)) throw new Error("无效的浏览器操作");
	if (value.type === "open") {
		if (!("url" in value) || typeof value.url !== "string" || !("sessionId" in value) || (value.sessionId !== null && typeof value.sessionId !== "string") || ("newTab" in value && typeof value.newTab !== "boolean")) throw new Error("无效的打开请求");
		return { type: "open", url: browserUrl(value.url), sessionId: value.sessionId, newTab: "newTab" in value && value.newTab === true };
	}
	if (!("id" in value) || typeof value.id !== "string") throw new Error("需要标签 ID");
	const id = value.id;
	switch (value.type) {
		case "select": case "close": case "back": case "forward": case "reload": case "devtools": return { type: value.type, id };
		case "zoom": if (!("factor" in value) || typeof value.factor !== "number") throw new Error("需要缩放比例"); return { type: "zoom", id, factor: browserZoom(value.factor) };
		case "resize": if (!("width" in value) || typeof value.width !== "number" || !("height" in value) || typeof value.height !== "number") throw new Error("需要页面尺寸"); return { type: "resize", id, width: value.width, height: value.height };
		case "viewport": {
			if (!("viewport" in value)) throw new Error("需要视口尺寸");
			const viewport = value.viewport;
			if (viewport === null) return { type: "viewport", id, viewport };
			if (!viewport || typeof viewport !== "object" || !("width" in viewport) || typeof viewport.width !== "number" || !("height" in viewport) || typeof viewport.height !== "number") throw new Error("无效的视口尺寸");
			return { type: "viewport", id, viewport: browserViewport({ width: viewport.width, height: viewport.height }) };
		}
		default: throw new Error("未知浏览器操作");
	}
}
