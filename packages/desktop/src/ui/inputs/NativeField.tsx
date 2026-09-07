import { useRef, type ComponentPropsWithRef, type DOMAttributes, type KeyboardEvent } from "react";
import { composingKey, markComposition } from "../keyboard.ts";

/** Keep the native editor in charge of composing text, including candidate navigation. */
function useComposition<T extends HTMLElement>(props: DOMAttributes<T>) {
	const composing = useRef(false);
	const guard = (handler?: (event: KeyboardEvent<T>) => void) => (event: KeyboardEvent<T>) => {
		if (composing.current || composingKey(event.nativeEvent)) {
			// Do not preventDefault: the IME still needs Enter, arrows, Space and Escape.
			event.stopPropagation();
			return;
		}
		handler?.(event);
	};
	return {
		onCompositionStart: (event: React.CompositionEvent<T>) => {
			composing.current = true;
			markComposition(event.currentTarget, true);
			props.onCompositionStart?.(event);
		},
		onCompositionEnd: (event: React.CompositionEvent<T>) => {
			composing.current = false;
			markComposition(event.currentTarget, false);
			props.onCompositionEnd?.(event);
		},
		onBlur: (event: React.FocusEvent<T>) => {
			composing.current = false;
			markComposition(event.currentTarget, false);
			props.onBlur?.(event);
		},
		onKeyDown: guard(props.onKeyDown),
		onKeyUp: guard(props.onKeyUp),
		onKeyDownCapture: guard(props.onKeyDownCapture),
		onKeyUpCapture: guard(props.onKeyUpCapture),
	};
}

/** Unstyled native controls: callers retain their layout, refs, selection and undo history. */
export function Input(props: ComponentPropsWithRef<"input">) {
	const handlers = useComposition(props);
	return <input {...props} {...handlers} />;
}

export function Textarea(props: ComponentPropsWithRef<"textarea">) {
	const handlers = useComposition(props);
	return <textarea {...props} {...handlers} />;
}
