/** A failed app shutdown must not strand the listeners that keep an E2E worker alive. */
export async function cleanupFixture(...cleanups: (() => void | Promise<void>)[]): Promise<void> {
	const failures: unknown[] = [];
	for (const cleanup of cleanups) {
		try {
			await cleanup();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, "E2E fixture cleanup failed");
}
