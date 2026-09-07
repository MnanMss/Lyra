import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseFrontmatter, type Skill } from "@lyra/core";
import path from "../resources/skills/browser/SKILL.md?asset";

export function browserSkill(): Skill {
	const parsed = parseFrontmatter(readFileSync(path, "utf8"));
	if (!parsed || typeof parsed.frontmatter.name !== "string" || typeof parsed.frontmatter.description !== "string") throw new Error("内置浏览器技能格式无效");
	return { name: parsed.frontmatter.name, description: parsed.frontmatter.description, content: parsed.body, path, dir: dirname(path), source: "builtin", disableModelInvocation: false };
}
