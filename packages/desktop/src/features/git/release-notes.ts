/** The same outline for initial loading and explicit regeneration. */
export function releaseNotes(commits: readonly { subject: string }[], lang: "zh" | "en") {
	const groups = [
		{ title: lang === "zh" ? "新功能" : "Features", pattern: /^feat(\(.*\))?:/i },
		{ title: lang === "zh" ? "优化" : "Improvements", pattern: /^(perf|style|refactor)(\(.*\))?:/i },
		{ title: lang === "zh" ? "修复" : "Fixes", pattern: /^fix(\(.*\))?:/i },
		{ title: lang === "zh" ? "其他变更" : "Other changes", pattern: /./ },
	];
	const sections: string[][] = groups.map(() => []);
	for (const { subject } of commits) {
		const at = groups.findIndex((group) => group.pattern.test(subject));
		if (at >= 0) sections[at].push(`- ${subject.replace(/^(feat|fix|perf|style|refactor|docs|chore|test)(\(.*?\))?:\s*/i, "")}`);
	}
	return groups.flatMap((group, index) => sections[index].length ? [`### ${group.title}\n${sections[index].join("\n")}`] : []).join("\n\n") || (lang === "zh" ? "无新增变更记录" : "No new changes recorded");
}
