import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import type { Settings } from "@lyra/core";
import { availableModels, resolveModelRef, type SubAgentProfile } from "@lyra/core/model-roles";
import { resolveModelThinkingOptions } from "@lyra/core/thinking-options";
import { AlertCircle, Bot, Brain } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { Badge, Card, EmptyHint, InlineSelect, SectionTitle } from "./controls.tsx";
import { ModelSelect } from "../models/index.ts";
import { bridge } from "../../services/index.ts";

const SOURCE_LABEL: Record<string, string> = { builtin: "内置", workspace: "项目", user: "用户" };

export function AgentsSettings() {
	const activeSessionId = useApp((s) => s.activeSessionId);
	const settings = useApp((s) => s.settings);
	const mainModelId = useApp((s) => s.meta?.modelId);
	const sharedCapabilities = useApp((s) => s.capabilities);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		setCapabilities(activeSessionId ? sharedCapabilities : null);
		setError("");
		if (!activeSessionId || sharedCapabilities) return;
		void bridge.sessions.capabilities(activeSessionId).then((value) => {
			if (!cancelled) setCapabilities(value);
		}).catch((cause: unknown) => {
			if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
		});
		return () => { cancelled = true; };
	}, [activeSessionId, sharedCapabilities]);

	async function save(name: string, profile: SubAgentProfile) {
		const current = useApp.getState().settings;
		if (!current || savingRef.current) return;
		savingRef.current = true; setSaving(true); setError("");
		const profiles = { ...current.subAgentProfiles };
		if (profile.modelId || profile.thinking) profiles[name] = profile;
		else delete profiles[name];
		try { await useApp.getState().saveSettings({ ...current, subAgentProfiles: profiles }); }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { savingRef.current = false; setSaving(false); }
	}

	const agents = capabilities?.agents ?? BUILTIN_AGENTS;
	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">子智能体</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				独立思考，只把结论交回主对话。模型与思考等级在下次派发时生效。
			</p>
			<SectionTitle>可用（{agents.length}）</SectionTitle>
			{!capabilities && <p className="mb-3 text-detail text-ink-muted">内置子智能体始终可用；会话加载后会合并项目与用户定义。</p>}
			{error && <p role="alert" className="mb-3 text-label text-danger">{error}</p>}
			<Card className="mb-6">
				{agents.length === 0 ? <EmptyHint>打开一个会话后即可看到可用的子智能体。</EmptyHint> : agents.map((agent) => (
					<div key={agent.name} data-agent-profile={agent.name} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line-soft px-4 py-4 last:border-b-0">
						<div className="min-w-0 flex-[1_1_240px]">
							<div className="flex flex-wrap items-center gap-2">
								<Bot size={16} strokeWidth={1.8} className="shrink-0 text-info" />
								<span className="break-all font-mono text-label text-ink">{agent.name}</span>
								<Badge tone="muted">{SOURCE_LABEL[agent.source] ?? agent.source}</Badge>
								<Badge tone="muted">{agent.tools === "*" ? "全部工具" : `${agent.tools.length} 个工具`}</Badge>
							</div>
							<p className="mt-1 text-label leading-relaxed text-ink-muted">{agent.description}</p>
						</div>
						{settings && <AgentModelControls agent={agent} settings={settings} mainModelId={mainModelId} disabled={saving} onChange={(profile) => { void save(agent.name, profile); }} />}
					</div>
				))}
			</Card>
		</div>
	);
}

function AgentModelControls({ agent, settings, mainModelId, disabled, onChange }: {
	agent: AgentCapabilities["agents"][number]; settings: Settings; mainModelId?: string | null;
	disabled: boolean; onChange: (profile: SubAgentProfile) => void;
}) {
	const models = availableModels(settings);
	const profile = settings.subAgentProfiles?.[agent.name] ?? {};
	const fallback = models.find(({ model }) => model.id === (mainModelId || settings.defaultModelId));
	const selected = profile.modelId ? models.find(({ model }) => model.id === profile.modelId) : undefined;
	const inherited = fallback ? resolveModelRef(settings, agent.model, fallback) : undefined;
	const current = profile.modelId ? selected : inherited;
	const levels = resolveModelThinkingOptions(current?.model);
	const invalid = profile.modelId && !selected;
	const invalidThinking = profile.thinking && levels.length > 0 && !levels.some((level) => level.id === profile.thinking);
	const inheritedThinking = profile.modelId ? settings.thinking : inherited?.thinking ?? settings.thinking;
	const defaultThinking = levels.find((level) => level.id === inheritedThinking) ?? levels.find((level) => level.isDefault) ?? levels[0];

	return (
		<fieldset disabled={disabled} aria-label={`${agent.name} 运行配置`} className="m-0 flex min-w-0 max-w-full flex-wrap items-center gap-2 border-0 p-0 disabled:opacity-60 [&>button]:max-w-full">
			<ModelSelect ariaLabel={`${agent.name} 模型`} value={profile.modelId ?? ""} disabled={disabled}
				inheritLabel="遵循定义" inheritDetail={inherited ? `${inherited.provider.name} · ${inherited.model.name}` : "使用定义中的模型角色，未配置时跟随主会话"} onChange={(modelId) => onChange(modelId ? { modelId } : {})} />
			{levels.length > 0 ? <InlineSelect ariaLabel={`${agent.name} 思考等级`} value={profile.thinking ?? ""}
				options={[
					{ value: "", label: `默认 · ${defaultThinking?.label ?? "关闭"}`, icon: <Brain size={14} /> },
					...(invalidThinking && profile.thinking ? [{ value: profile.thinking, label: "等级不可用" }] : []),
					...levels.map((level) => ({ value: level.id, label: level.label, detail: level.detail, icon: <Brain size={14} /> })),
				]} onChange={(thinking) => onChange({ ...profile, thinking: thinking || undefined })} /> :
				<span className="flex h-[30px] items-center gap-1.5 text-label text-ink-faint"><Brain size={14} />{current ? "不支持思考" : "思考等级"}</span>}
			{(invalid || invalidThinking) && <AlertCircle size={15} className="text-danger" aria-label="配置不可用" data-ly-tip="请重新选择模型或思考等级，避免派发失败。" />}
		</fieldset>
	);
}
