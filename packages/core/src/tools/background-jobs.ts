import type { SandboxProcess } from "../kernel/services.ts";

export interface BackgroundJob {
	id: string;
	command: string;
	startedAt: number;
	exitCode: number | null;
	finishedAt?: number;
	output: string;
	outputPath?: string;
	outputComplete?: boolean;
	outputError?: string;
	pid?: number;
	status: "running" | "stopping" | "exited" | "failed";
	error?: string;
}
interface OwnedJob { info: BackgroundJob; process: SandboxProcess }
const KEY = "backgroundJobs";

/** The only handles accepted by stop come from processes this session actually started. */
export class BackgroundJobs {
	private readonly entries = new Map<string, OwnedJob>();
	add(info: BackgroundJob, process: SandboxProcess): void { this.entries.set(info.id, { info, process }); }
	get(id: string): BackgroundJob | undefined { return this.entries.get(id)?.info; }
	list(): BackgroundJob[] { return [...this.entries.values()].map(({ info }) => ({ ...info })); }
	stop(id: string, force = false): boolean {
		const job = this.entries.get(id);
		if (!job || job.info.finishedAt !== undefined || job.info.status === "exited") return false;
		job.info.status = "stopping";
		try { job.process.kill(force ? "SIGKILL" : "SIGTERM"); }
		catch (error) { job.info.status = "failed"; job.info.error = String(error); throw error; }
		return true;
	}
	dispose(): void { for (const id of this.entries.keys()) this.stop(id, true); }
}

export function backgroundJobs(state: Map<string, unknown>): BackgroundJobs {
	const current = state.get(KEY);
	if (current instanceof BackgroundJobs) return current;
	const registry = new BackgroundJobs();
	state.set(KEY, registry);
	return registry;
}
