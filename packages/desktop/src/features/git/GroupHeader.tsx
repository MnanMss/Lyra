/**
 * A labelled divider between groups of rows.
 *
 * Shared by the changes and branches views, which both present lists that would run together
 * without one.
 */

import { Text } from "../../ui/primitives/Text.tsx";

export function GroupHeader({
	label,
	count,
	actions,
}: {
	label: string;
	count: number;
	actions?: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 items-center gap-1.5 px-1.5 pt-2 pb-1">
			<Text size="caption" tone="faint" weight="medium" className="shrink-0 whitespace-nowrap">
				{label}
			</Text>
			<Text size="caption" tone="faint" numeric className="shrink-0 whitespace-nowrap">
				{count}
			</Text>
			{actions && <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>}
		</div>
	);
}

/**
 * The log, drawn as the graph it is.
 *
 * A flat list of subjects cannot answer the questions people actually bring to a history: where
 * did this branch off, when did it come back, what was on main while this was happening. Those
 * are shape, not text — so the shape is drawn. Each lane keeps one colour from the commit that
 * starts it to the merge that ends it, which is what makes a column followable.
 */
