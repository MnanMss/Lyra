import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import type { Settings } from "@lyra/core";
import { agentProfile, withAgentProfile, availableModels, resolveModelRef, type SubAgentProfile } from "@lyra/core/model-roles";
import { resolveModelThinkingOptions } from "@lyra/core/thinking-options";
import { AlertCircle, Bot, Brain } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { Badge, Card, InlineSelect, SectionTitle } from "./controls.tsx";
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

	async function persist(next: Settings) {
		if (savingRef.current) return;
		savingRef.current = true; setSaving(true); setError("");
		try { await useApp.getState().saveSettings(next); }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { savingRef.current = false; setSaving(false); }
	}

	function save(name: string, profile: SubAgentProfile) {
		const current = useApp.getState().settings;
		if (current) void persist(withAgentProfile(current, name, profile));
	}

	const agents = capabilities?.agents ?? BUILTIN_AGENTS;
	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">智能体</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				通过 @ 选择，模型配置在下次执行时生效。
			</p>
			<SectionTitle>可用（{agents.length}）</SectionTitle>
			{error && <p role="alert" className="mb-3 text-label text-danger">{error}</p>}
			<Card className="mb-6">
				{agents.map((agent) => (
					<div key={agent.name} data-agent-profile={agent.name} className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-4">
						<div className="min-w-0 flex-[1_1_240px]">
							<div className="flex flex-wrap items-center gap-2">
								<Bot size={16} strokeWidth={1.8} className="shrink-0 text-info" />
								<span className="break-all font-mono text-label text-ink">{agent.name}</span>
								{agent.source !== "builtin" && <Badge tone="muted">{SOURCE_LABEL[agent.source] ?? agent.source}</Badge>}
							</div>
							<p className="mt-1 line-clamp-2 text-label leading-relaxed text-ink-muted">{agent.description}</p>
						</div>
						{settings && <AgentModelControls agent={agent} settings={settings} mainModelId={mainModelId} disabled={saving} onChange={(profile) => { void save(agent.name, profile); }} />}
					</div>
				))}
			</Card>
			{settings && <>
				<SectionTitle>会话</SectionTitle>
				<Card>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4" data-agent-profile="compact">
						<div><span className="text-label text-ink">compact</span><p className="mt-1 text-detail text-ink-muted">压缩上下文</p></div>
						<ModelSelect ariaLabel="compact 模型" value={agentProfile(settings, "compact").modelId ?? ""} inheritLabel="跟随主会话" disabled={saving}
							onChange={(modelId) => save("compact", modelId ? { modelId } : {})} />
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
						<span className="text-label text-ink">侧边聊天默认模型</span>
						<ModelSelect ariaLabel="侧边聊天默认模型" value={settings.sideChatModelId ?? ""} inheritLabel="跟随主会话" inheritDetail="用于新的侧边聊天" disabled={saving}
							onChange={(modelId) => { const current = useApp.getState().settings; if (current) void persist({ ...current, sideChatModelId: modelId || null }); }} />
					</div>
				</Card>
			</>}
		</div>
	);
}

function AgentModelControls({ agent, settings, mainModelId, disabled, onChange }: {
	agent: Pick<AgentCapabilities["agents"][number], "name" | "model">; settings: Settings; mainModelId?: string | null;
	disabled: boolean; onChange: (profile: SubAgentProfile) => void;
}) {
	const models = availableModels(settings);
	const profile = agentProfile(settings, agent.name);
	const fallback = models.find(({ model }) => model.id === (mainModelId || settings.defaultModelId));
	const selected = profile.modelId ? models.find(({ model }) => model.id === profile.modelId) : undefined;
	const inherited = fallback ? resolveModelRef(withAgentProfile(settings, agent.name, {}), agent.model, fallback) : undefined;
	const current = profile.modelId ? selected : inherited;
	const levels = resolveModelThinkingOptions(current?.model);
	const invalid = profile.modelId && !selected;
	const invalidThinking = profile.thinking && levels.length > 0 && !levels.some((level) => level.id === profile.thinking);
	const inheritedThinking = profile.modelId ? settings.thinking : inherited?.thinking ?? settings.thinking;
	const defaultThinking = levels.find((level) => level.id === inheritedThinking) ?? levels.find((level) => level.isDefault) ?? levels[0];

	return (
		<fieldset disabled={disabled} aria-label={`${agent.name} 运行配置`} className="m-0 flex min-w-0 max-w-full flex-wrap items-center gap-2 border-0 p-0 disabled:opacity-60 [&>button]:max-w-full">
			<ModelSelect ariaLabel={`${agent.name} 模型`} value={profile.modelId ?? ""} disabled={disabled}
				inheritLabel={inherited && inherited.via !== "会话当前的模型" ? "遵循定义" : "跟随主会话"} inheritDetail={inherited ? `${inherited.provider.name} · ${inherited.model.name}` : "跟随主会话"} onChange={(modelId) => onChange(modelId ? { modelId } : {})} />
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
