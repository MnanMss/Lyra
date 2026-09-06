import { Component, createRef, type HTMLAttributes } from "react";
import { motionReduced } from "../../ui/motion/reduced.ts";
import { DURATION, EASING } from "../../ui/motion/tokens.ts";

interface Props extends HTMLAttributes<HTMLDivElement> {
	carried: boolean;
	isHidden: boolean;
}

/** Keep layout work at the endpoints; only the compositor interpolates between them. */
export class PaneSurface extends Component<Props, Record<string, never>, DOMRect | null> {
	private element = createRef<HTMLDivElement>();
	private motion: Animation | null = null;
	private retained = false;

	// Hooks run after DOM mutations. A snapshot is needed before React writes the new box,
	// including the current visual position when a user reverses an unfinished transition.
	override getSnapshotBeforeUpdate(previous: Props): DOMRect | null {
		const element = this.element.current;
		if (!element || previous.carried || this.props.carried || previous.isHidden || this.props.isHidden) return null;
		const from = previous.style;
		const to = this.props.style;
		if (from?.left === to?.left && from?.top === to?.top && from?.width === to?.width && from?.height === to?.height) return null;
		return element.getBoundingClientRect();
	}

	override componentDidUpdate(_previous: Props, _state: Record<string, never>, before: DOMRect | null) {
		if (!before && !this.props.carried && !this.props.isHidden) return;
		this.motion?.cancel();
		this.motion = null;
		const element = this.element.current;
		if (!before || !element || element.hasAttribute("data-ly-frozen") || document.documentElement.hasAttribute("data-dock-settling")) return;
		if (motionReduced()) return;
		const after = element.getBoundingClientRect();
		if (!before.width || !before.height || !after.width || !after.height) return;
		const dx = before.left - after.left;
		const dy = before.top - after.top;
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(before.width - after.width) < 0.5 && Math.abs(before.height - after.height) < 0.5) return;
		const motion = element.animate([
			{ transform: `translate(${dx}px, ${dy}px) scale(${before.width / after.width}, ${before.height / after.height})` },
			{ transform: "none" },
		], {
			id: "ly-dock-geometry",
			duration: DURATION.base,
			easing: EASING.out,
		});
		this.motion = motion;
		motion.onfinish = () => {
			if (this.motion === motion) this.motion = null;
		};
	}

	override componentWillUnmount() {
		this.motion?.cancel();
	}

	override render() {
		const { carried: _carried, isHidden: _hidden, ...props } = this.props;
		if (this.props.isHidden) this.retained = true;
		return <div {...props} ref={this.element} inert={this.props.isHidden} data-dock-retained={this.retained ? "" : undefined} />;
	}
}
