import { Activity, useState } from "react";

/** Retain a small number of visited pages; hidden pages suspend effects and keep local state. */
export function RetainedViews<T extends string>({ active, render, limit = 3 }: {
	active: T;
	render: (key: T) => React.ReactNode;
	limit?: number;
}) {
	const [recent, setRecent] = useState<T[]>([active]);
	let keys = recent;
	if (recent[recent.length - 1] !== active) {
		keys = [...recent.filter((key) => key !== active), active].slice(-limit);
		setRecent(keys);
	}
	return <>{keys.map((key) => (
		<Activity key={key} mode={key === active ? "visible" : "hidden"}>
			<div className="ly-page-enter flex min-h-0 min-w-0 flex-1 flex-col" data-view={key}>
				{render(key)}
			</div>
		</Activity>
	))}</>;
}
