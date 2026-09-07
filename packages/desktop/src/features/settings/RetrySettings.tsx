import { useState } from "react";
import type { RetryPolicy, RetryRule, RetryFailure, Settings } from "@lyra/core";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { useApp } from "../../store/index.ts";
import { InlineSelect } from "./controls.tsx";

export function RetrySettings({ settings }: { settings: Settings }) {
	const policy: RetryPolicy = settings.retryPolicy ?? { network: { retries: null, strategy: "fixed", intervalMs: 5000, maxIntervalMs: 30000 }, upstream: { retries: Math.max(0, settings.retryAttempts - 1), strategy: "fixed", intervalMs: 5000, maxIntervalMs: 30000 } };
	const [draft, setDraft] = useState<RetryPolicy>(policy);
	const [kind, setKind] = useState<RetryFailure>("network");
	const rule = draft[kind];
	const [busy, setBusy] = useState(false), [error, setError] = useState("");
	const dirty = JSON.stringify(policy) !== JSON.stringify(draft);
	const patch = (value: Partial<RetryRule>) => setDraft(current => ({ ...current, [kind]: { ...current[kind], ...value } }));
	return <form data-retry-settings className="px-4 py-4" onSubmit={event => {
		event.preventDefault(); if (busy) return; setBusy(true); setError("");
		const current = useApp.getState().settings; if (!current) { setBusy(false); return; }
		void useApp.getState().saveSettings({ ...current, retryPolicy: draft }).catch(cause => setError(String(cause))).finally(() => setBusy(false));
	}}>
		<p className="text-label text-ink">请求重试策略</p>
		<p className="mt-1 text-detail leading-relaxed text-ink-muted">网络中断、限流或服务暂时不可用时自动重试。两类故障独立配置，次数不含首次请求；已执行的工具不会重做，点击停止可立即取消等待。</p>
		<div className="mt-3 flex items-center gap-3"><InlineSelect ariaLabel="重试故障类型" value={kind} options={[{ value: "network", label: "网络中断" }, { value: "upstream", label: "上游故障" }]} onChange={value => { if (value === "network" || value === "upstream") setKind(value); }} /><span className="text-caption text-ink-muted">{kind === "network" ? "连接失败、超时、传输中断" : "限流、服务过载、暂时不可用"}</span></div>
		<fieldset disabled={busy} className="mt-4 flex flex-wrap items-end gap-4 border-0 p-0 text-label disabled:opacity-60">
			<label className="flex flex-col gap-2">重试次数<div className="flex h-[30px] items-center gap-2"><Input aria-label="重试次数" type="number" min={0} max={1000000} step={1} required disabled={rule.retries === null} value={rule.retries !== null && Number.isFinite(rule.retries) ? rule.retries : ""} className="h-[30px] w-20 rounded-lg border border-line bg-input px-2 disabled:opacity-40" onChange={event => patch({ retries: event.target.valueAsNumber })} /><span>次</span></div></label>
			<label className="flex h-[30px] items-center gap-2"><Input type="checkbox" aria-label="无限重试" checked={rule.retries === null} onChange={event => patch({ retries: event.target.checked ? null : 10 })} />无限重试</label>
			<div className="flex flex-col gap-2"><span>间隔方式</span><InlineSelect ariaLabel="重试间隔方式" value={rule.strategy} options={[{ value: "fixed", label: "固定间隔" }, { value: "linear", label: "逐次递增" }]} onChange={value => { if (value === "fixed" || value === "linear") patch({ strategy: value }); }} /></div>
			<label className="flex flex-col gap-2">{rule.strategy === "fixed" ? "间隔" : "初始间隔 / 每次增加"}<div className="flex h-[30px] items-center gap-2"><Input aria-label="重试间隔秒数" type="number" min={1} max={3600} step={1} required value={Number.isFinite(rule.intervalMs) ? rule.intervalMs / 1000 : ""} className="h-[30px] w-20 rounded-lg border border-line bg-input px-2" onChange={event => { const intervalMs = event.target.valueAsNumber * 1000; patch({ intervalMs, maxIntervalMs: Math.max(rule.maxIntervalMs, Number.isFinite(intervalMs) ? intervalMs : 1000) }); }} /><span>秒</span></div></label>
			{rule.strategy === "linear" && <label className="flex flex-col gap-2">最长间隔<div className="flex h-[30px] items-center gap-2"><Input aria-label="最长重试间隔秒数" type="number" min={rule.intervalMs / 1000} max={3600} step={1} required value={Number.isFinite(rule.maxIntervalMs) ? rule.maxIntervalMs / 1000 : ""} className="h-[30px] w-20 rounded-lg border border-line bg-input px-2" onChange={event => patch({ maxIntervalMs: event.target.valueAsNumber * 1000 })} /><span>秒</span></div></label>}
		</fieldset>
		<p className="mt-3 text-caption text-ink-faint">{rule.retries === 0 ? "失败后立即报错。" : rule.strategy === "linear" ? "等待时间按初始间隔逐次增加，到达上限后保持不变。" : "每次等待相同时间。"} 保存后用于下一次模型请求。</p>
		{dirty && <button type="submit" disabled={busy} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-label text-white disabled:opacity-50">{busy ? "保存中" : "保存重试策略"}</button>}
		{error && <p role="alert" className="mt-2 text-detail text-danger">{error}</p>}
	</form>;
}
