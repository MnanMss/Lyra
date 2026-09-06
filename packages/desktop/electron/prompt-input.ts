import type { UserContent } from "@lyra/core";
import type { InitialPrompt } from "./create-session.ts";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function promptContent(value: unknown): UserContent[] {
	// The remote contract also accepts plain text from older paired clients.
	if (typeof value === "string" && value.trim()) return [{ type: "text", text: value }];
	if (!Array.isArray(value) || value.length === 0) throw new Error("content must be a non-empty array");
	return value.map((block: unknown) => {
		if (!object(block)) throw new Error("Invalid content block");
		if (block.type === "text" && typeof block.text === "string") return { type: "text", text: block.text };
		if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
			return { type: "image", data: block.data, mimeType: block.mimeType };
		}
		throw new Error("Invalid user content block");
	});
}

export function initialPrompt(value: unknown): InitialPrompt | undefined {
	if (value === undefined) return undefined;
	if (!object(value)) throw new Error("initial must be an object");
	if (value.synthetic !== undefined && typeof value.synthetic !== "boolean") throw new Error("synthetic must be boolean");
	return {
		content: promptContent(value.content),
		...(value.synthetic === undefined ? {} : { synthetic: value.synthetic }),
		...(typeof value.displayText === "string" ? { displayText: value.displayText } : {}),
		...(object(value.skillRef) && typeof value.skillRef.name === "string" ? { skillRef: value.skillRef as InitialPrompt["skillRef"] } : {}),
		...(Array.isArray(value.sessionRefs) ? { sessionRefs: value.sessionRefs as InitialPrompt["sessionRefs"] } : {}),
	};
}

export function promptOptions(value: unknown): {
	synthetic?: boolean;
	deliver?: "steer" | "followUp";
	resumePending?: boolean;
	displayText?: string;
	skillRef?: { name: string; path?: string; pluginId?: string };
	sessionRefs?: Array<{ id: string; title: string }>;
} {
	if (value === undefined || value === null) return {};
	if (!object(value)) throw new Error("options must be an object");
	const { synthetic, deliver, resumePending, displayText, skillRef, sessionRefs } = value;
	if (synthetic !== undefined && typeof synthetic !== "boolean") throw new Error("synthetic must be boolean");
	if (resumePending !== undefined && typeof resumePending !== "boolean") throw new Error("resumePending must be boolean");
	if (deliver !== undefined && deliver !== "steer" && deliver !== "followUp") throw new Error("Invalid delivery mode");
	return {
		...(synthetic === undefined ? {} : { synthetic }),
		...(deliver === undefined ? {} : { deliver }),
		...(resumePending === undefined ? {} : { resumePending }),
		...(typeof displayText === "string" ? { displayText } : {}),
		...(object(skillRef) && typeof skillRef.name === "string" ? { skillRef: skillRef as any } : {}),
		...(Array.isArray(sessionRefs) ? { sessionRefs: sessionRefs as any } : {}),
	};
}
