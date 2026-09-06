/**
 * Hook coordinating pointer-driven reordering for sidebar projects and sessions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../store/index.ts";
import type { DraggingItem, DropTarget, SidebarReorderContextValue } from "./reorder-context.ts";

const DRAG_THRESHOLD = 5;

export function useSidebarReorder(onReordered?: () => void): {
	contextValue: SidebarReorderContextValue;
	dragging: DraggingItem | null;
	dropTarget: DropTarget | null;
	pointer: { x: number; y: number };
} {
	const [dragging, setDragging] = useState<DraggingItem | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const [pointer, setPointer] = useState({ x: 0, y: 0 });

	const candidateRef = useRef<{ item: DraggingItem; originX: number; originY: number } | null>(null);
	const draggingRef = useRef<DraggingItem | null>(null);
	const dropTargetRef = useRef<DropTarget | null>(null);

	const reorderProjects = useApp((s) => s.reorderProjects);
	const reorderProjectSessions = useApp((s) => s.reorderProjectSessions);

	const startDrag = useCallback((item: DraggingItem, event: React.PointerEvent) => {
		// Only primary click
		if (event.button !== 0) return;
		candidateRef.current = {
			item,
			originX: event.clientX,
			originY: event.clientY,
		};
		setPointer({ x: event.clientX, y: event.clientY });
	}, []);

	const registerTarget = useCallback(
		(kind: "project" | "session", id: string, rect: DOMRect, clientY: number, projectPath?: string) => {
			const active = draggingRef.current;
			if (!active || active.kind !== kind || active.id === id) {
				return;
			}
			// For sessions, reject cross-project drags
			if (kind === "session" && active.projectPath !== projectPath) {
				return;
			}

			const mid = rect.top + rect.height / 2;
			const placement: "before" | "after" = clientY < mid ? "before" : "after";

			const current = dropTargetRef.current;
			if (!current || current.id !== id || current.placement !== placement) {
				const next: DropTarget = { kind, id, placement };
				dropTargetRef.current = next;
				setDropTarget(next);
			}
		},
		[],
	);

	const clearTarget = useCallback((id: string) => {
		if (dropTargetRef.current?.id === id) {
			dropTargetRef.current = null;
			setDropTarget(null);
		}
	}, []);

	useEffect(() => {
		const handlePointerMove = (e: PointerEvent) => {
			const candidate = candidateRef.current;
			if (candidate && !draggingRef.current) {
				const dx = e.clientX - candidate.originX;
				const dy = e.clientY - candidate.originY;
				if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
					draggingRef.current = candidate.item;
					setDragging(candidate.item);
				}
			}

			if (draggingRef.current) {
				setPointer({ x: e.clientX, y: e.clientY });
			}
		};

		const handlePointerUp = () => {
			const active = draggingRef.current;
			const target = dropTargetRef.current;

			candidateRef.current = null;
			draggingRef.current = null;
			dropTargetRef.current = null;
			setDragging(null);
			setDropTarget(null);

			if (active && target && active.id !== target.id) {
				if (active.kind === "project" && target.kind === "project") {
					void reorderProjects(active.id, target.id, target.placement);
				} else if (active.kind === "session" && target.kind === "session" && active.projectPath) {
					void reorderProjectSessions(active.projectPath, active.id, target.id, target.placement);
				}
				onReordered?.();
			}
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};
	}, [reorderProjects, reorderProjectSessions, onReordered]);

	return {
		contextValue: {
			dragging,
			dropTarget,
			startDrag,
			registerTarget,
			clearTarget,
		},
		dragging,
		dropTarget,
		pointer,
	};
}
