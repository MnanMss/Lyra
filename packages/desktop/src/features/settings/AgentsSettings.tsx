import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import type { Settings } from "@lyra/core";
import { agentProfile, withAgentProfile, availableModels, resolveModelRef, type SubAgentProfile } from "@lyra/core/model-roles";
import { resolveModelThinkingOptions } from "@lyra/core/thinking-options";
import { AlertCircle, Bot, Brain, Plus, Ellipsis, Copy, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { Badge, Card, InlineSelect, SectionTitle } from "./controls.tsx";
import { ModelSelect } from "../models/index.ts";
import { AgentDefinitionEditor } from "./AgentDefinitionEditor.tsx";
import { useAgentDefinitions } from "./useAgentDefinitions.ts";
import type { AgentDefinitionRecord } from "@lyra/core";
import { Popover, MenuBody, MenuItem, usePopover } from "../../ui/overlay/Popover.tsx";
import { bridge } from "../../services/index.ts";

const SOURCE_LABEL: Record<string, string> = { builtin: "内置", workspace: "项目", user: "用户" };

export function AgentsSettings() {
	const catalogue = useAgentDefinitions();
	const [editor, setEditor] = useState<{ record?: AgentDefinitionRecord; copy?: boolean; projectId: string | null } | null>(null);
	const [undo, setUndo] = useState<{ token: string; projectId: string | null } | null>(null);
	const [notice, setNotice] = useState("");
	const [highlight, setHighlight] = useState("");
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

	const agents = catalogue.records?.map(record => record.definition) ?? capabilities?.agents ?? BUILTIN_AGENTS;
	const openEditor = async (record: AgentDefinitionRecord, copy = false) => {
		try { const fresh = await bridge.agentDefinitions.read(catalogue.projectId, record.id); setEditor({ record: fresh, copy, projectId: catalogue.projectId }); }
		catch (cause) { setError(String(cause)); }
	};
	const remove = async (record: AgentDefinitionRecord) => {
		setSaving(true);
		try {
			const result = await bridge.agentDefinitions.remove(catalogue.projectId, record.id, record.revision);
			setUndo({ token: result.undoToken, projectId: catalogue.projectId }); setNotice(result.warning ?? "已移除定义，可以撤销"); await catalogue.refresh();
		} catch (cause) { setError(String(cause)); }
		finally { setSaving(false); }
	};
	if (editor) return <AgentDefinitionEditor record={editor.record} copy={editor.copy} projectId={editor.projectId} projectName={catalogue.projectName} tools={catalogue.tools} onClose={() => setEditor(null)} onSaved={(name, warning) => { setEditor(null); setHighlight(name); setNotice(warning ?? "已保存，将用于下一次执行"); void catalogue.refresh(); }} />;
	return (
		<div className="pt-8">
			<div className="flex items-center justify-between gap-3"><h1 className="text-display leading-tight font-semibold tracking-tight text-ink">智能体</h1>{catalogue.enabled && <button type="button" className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-label text-white" onClick={() => setEditor({ projectId: catalogue.projectId })}><Plus size={16} />新增智能体</button>}</div>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				创建和管理通过 @ 调用的智能体。模型与思考等级即时保存，用于下一次执行。
			</p>
			<SectionTitle>可用（{agents.length}）</SectionTitle>
			{catalogue.error && <p role="alert" className="mb-3 text-label text-danger">{catalogue.error} <button type="button" onClick={() => void catalogue.refresh()}>重新加载</button></p>}
			{notice && <p role="status" className="mb-3 text-label text-ink-muted">{notice} {undo && <button type="button" className="text-info" onClick={() => { void bridge.agentDefinitions.restore(undo.projectId, undo.token).then(() => { setUndo(null); setNotice("已恢复定义"); return catalogue.refresh(); }).catch(cause => setError(String(cause))); }}>撤销</button>}</p>}
			{error && <p role="alert" className="mb-3 text-label text-danger">{error}</p>}
			<Card className="mb-6">
				{agents.map((agent) => (
					<div key={agent.name} data-agent-profile={agent.name} data-agent-saved={highlight === agent.name || undefined} className={`flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-4 ${highlight === agent.name ? "bg-info/5" : ""}`}>
						<div className="min-w-0 flex-[1_1_240px]">
							<div className="flex flex-wrap items-center gap-2">
								<Bot size={16} strokeWidth={1.8} className="shrink-0 text-info" />
								<span className="break-all font-mono text-label text-ink">{agent.name}</span>
								<Badge tone="muted">{catalogue.records?.find(record => record.definition.name === agent.name)?.customized ? "内置 · 已自定义" : SOURCE_LABEL[agent.source] ?? agent.source}</Badge>
							</div>
							<p className="mt-1 line-clamp-2 text-label leading-relaxed text-ink-muted">{agent.description}</p>
						</div>
						{settings && <AgentModelControls agent={agent} settings={settings} mainModelId={mainModelId} disabled={saving} onChange={(profile) => { void save(agent.name, profile); }} />}
						{catalogue.records?.filter(record => record.definition.name === agent.name).map(record => <DefinitionActions key={record.id} record={record} disabled={saving} edit={() => void openEditor(record)} copy={() => void openEditor(record, true)} remove={() => void remove(record)} />)}
					</div>
				))}
			</Card>
			{settings && <>
				<SectionTitle>会话</SectionTitle>
				<Card>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4" data-agent-profile="compact">
						<div><span className="text-label text-ink">compact</span><p className="mt-1 text-detail text-ink-muted">压缩上下文</p></div>
						<ModelSelect ariaLabel="compact 模型" value={agentProfile(settings, "compact").modelId ?? ""} inheritLabel="跟随主会话" inheritedModelId={mainModelId ?? settings.defaultModelId ?? undefined} inheritedSource="随主会话" disabled={saving}
							onChange={(modelId) => save("compact", modelId ? { modelId } : {})} />
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
						<span className="text-label text-ink">侧边聊天默认模型</span>
						<ModelSelect ariaLabel="侧边聊天默认模型" value={settings.sideChatModelId ?? ""} inheritLabel="跟随主会话" inheritedModelId={mainModelId ?? settings.defaultModelId ?? undefined} inheritedSource="随主会话" inheritDetail="用于新的侧边聊天" disabled={saving}
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
			<ModelSelect ariaLabel={`${agent.name} 模型`} value={profile.modelId ?? ""} disabled={disabled} inheritedModelId={inherited?.model.id} inheritedSource={inherited?.via === "会话当前的模型" ? "随主会话" : "默认"}
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

function DefinitionActions({ record, disabled, edit, copy, remove }: { record: AgentDefinitionRecord; disabled: boolean; edit: () => void; copy: () => void; remove: () => void }) {
	const menu = usePopover();
	return <div className="flex shrink-0 items-center gap-1">
		{record.editable && <button type="button" aria-label={`编辑 ${record.definition.name}`} disabled={disabled} className="rounded-lg px-2 py-1.5 text-label text-info hover:bg-hover" onClick={edit}>编辑</button>}
		<button type="button" aria-label={`${record.definition.name} 更多操作`} aria-haspopup="menu" aria-expanded={menu.open} disabled={disabled} className="rounded-lg p-1.5 text-ink-muted hover:bg-hover" onClick={menu.toggle}><Ellipsis size={16} /></button>
		{menu.open && <Popover anchor={menu.anchor} onClose={menu.close} label="智能体操作"><MenuBody>
			<MenuItem icon={<Copy size={14} />} onClick={() => { menu.close(); copy(); }}>复制为新智能体</MenuItem>
			{record.editable && record.scope !== "builtin" && <MenuItem icon={record.customized ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => { menu.close(); remove(); }}>{record.customized ? record.scope === "project" ? "移除项目覆盖" : "恢复内置指令" : "删除智能体"}</MenuItem>}
		</MenuBody></Popover>}
	</div>;
}
