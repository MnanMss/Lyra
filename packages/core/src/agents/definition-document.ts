import { isMap, parseDocument } from "yaml";
import type { AgentDefinition } from "../agents-builtin.ts";

export interface AgentDraft {
	name: string;
	description: string;
	systemPrompt: string;
	tools: string[] | "*";
}

export interface AgentDefinitionRecord {
	id: string;
	definition: AgentDefinition;
	scope: "builtin" | "user" | "project";
	editable: boolean;
	customized: boolean;
	revision: string;
	raw: string;
	shadowedSources: string[];
}

export interface AgentDefinitionSave {
	id?: string;
	copyFrom?: string;
	revision?: string;
	scope: "user" | "project";
	draft: AgentDraft;
}

/** Patch only form-owned fields; unknown metadata and advanced constraints survive editing. */
export function renderAgentDocument(draft: AgentDraft, raw?: string, builtin?: AgentDefinition): string {
	const front = raw?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (raw && !front) throw new Error("定义缺少完整的 YAML 元数据，请先修正原文件");
	const document = parseDocument(front?.[1] ?? "{}");
	if (document.errors.length || !isMap(document.contents)) throw new Error("智能体元数据必须是有效的 YAML 对象");
	if (builtin) {
		for (const key of ["model", "output", "schemaMode", "spawns"] as const) {
			if (builtin[key] !== undefined) document.set(key, builtin[key]);
		}
	}
	document.set("name", draft.name);
	document.set("description", draft.description);
	document.set("tools", draft.tools);
	return `---\n${document.toString()}---\n${draft.systemPrompt}\n`;
}

export function validateAgentDraft(value: AgentDraft, tools: readonly string[], existing?: AgentDefinition): void {
	if (!value || typeof value.name !== "string" || typeof value.description !== "string" || typeof value.systemPrompt !== "string") throw new Error("智能体字段不完整");
	if (existing ? value.name !== existing.name : !/^[a-z][a-z0-9_-]{0,63}$/.test(value.name) || value.name === "compact") throw new Error("调用名不可用：使用小写字母、数字、连字符或下划线");
	if (!value.description.trim() || !value.systemPrompt.trim()) throw new Error("请填写用途和指令");
	if (value.systemPrompt.length > 200_000 || value.description.length > 2000) throw new Error("智能体指令或用途过长");
	if (value.tools !== "*" && (!Array.isArray(value.tools) || value.tools.some(name => typeof name !== "string"))) throw new Error("工具权限格式无效");
	const previous = existing?.tools === "*" ? [] : existing?.tools ?? [];
	if (value.tools !== "*" && value.tools.some(name => !tools.includes(name) && !previous.includes(name))) throw new Error("存在不可用的工具，请重新选择");
}
