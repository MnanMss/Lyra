import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Keyboard, Linking, Platform, Pressable, Text, ToastAndroid, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { backPress, type BackState } from "../src/back";
import { bridgeScript } from "../src/bridge";
import { keyboardOverlap, type ScreenFrame } from "../src/keyboard";
import { useMobile } from "../src/store";
import { appUrlOf, isAppUrl, originOf } from "../src/connection";
import { mobileTranslator } from "../src/i18n";

/**
 * The desktop's own interface, on the phone.
 *
 * Not a copy of it — the actual build, loaded from the machine this phone is paired with, so the
 * two are the same by construction rather than by discipline. What this file adds is the three
 * things a WebView cannot work out for itself: where to load from, what `window.lyra` is, and how
 * to sit inside a phone's chrome.
 *
 * The safe area is handled here rather than in the page. The renderer's layout already knows how
 * to be narrow (it goes there whenever a desktop window is dragged in), and it has no notion of a
 * notch or a home indicator — those are the phone's, so they are padding around the WebView
 * instead of a media query inside it.
 */
export default function DeskScreen() {
	const t = useMemo(() => mobileTranslator(), []);
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const nativeScheme = useColorScheme();
	const connection = useMobile((s) => s.connection);

	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState<string | null>(null);
	const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting" | "offline">("connecting");
	/*
	 * The page's theme, mirrored so the phone's own chrome can match it.
	 *
	 * Everything outside the WebView is painted here — the status bar, and the strips behind the
	 * notch and the home indicator. The page can be switched to a light theme from the desktop, and
	 * nothing would otherwise tell this side: white status text over a white page, in a dark frame.
	 *
	 * Starts from the device theme, then adopts the renderer's exact material before loading ends.
	 */
	const [theme, setTheme] = useState<{ dark: boolean; shell: string }>(() =>
		nativeScheme === "light" ? { dark: false, shell: "#ffffff" } : { dark: true, shell: "#171717" },
	);
	/*
	 * `WebView<object>`, not `WebView`.
	 *
	 * The library declares `class WebView<P = undefined> extends Component<WebViewProps & P>`, and
	 * `WebViewProps & undefined` collapses to `never` under strict mode — so the bare form accepts
	 * no props at all. Naming the parameter restores the intersection. A library-side bug, worked
	 * around rather than patched.
	 */
	const webview = useRef<WebView<object>>(null);
	const webviewHost = useRef<View>(null);
	const keyboardFrame = useRef<ScreenFrame | null>(null);
	const [nativeKeyboardInset, setNativeKeyboardInset] = useState(0);

	/*
	 * Resize the native WebView to the visible screen, before iOS scrolls the entire page to reveal
	 * its input. Android adjustResize produces zero overlap; an overlaid keyboard reserves only the
	 * measured intersection, without guessing a device- or keyboard-specific height.
	 */
	const measureKeyboardOverlap = useCallback(() => {
		const keyboard = keyboardFrame.current;
		if (!keyboard) {
			setNativeKeyboardInset(0);
			return;
		}
		webviewHost.current?.measureInWindow((x, y, width, height) => {
			if (keyboardFrame.current !== keyboard) return;
			setNativeKeyboardInset(keyboardOverlap({ x, y, width, height }, keyboard));
		});
	}, []);

	useEffect(() => {
		const shown = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow", ({ endCoordinates }) => {
			keyboardFrame.current = {
				x: endCoordinates.screenX,
				y: endCoordinates.screenY,
				width: endCoordinates.width,
				height: endCoordinates.height,
			};
			requestAnimationFrame(measureKeyboardOverlap);
		});
		const hidden = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
			keyboardFrame.current = null;
			setNativeKeyboardInset(0);
		});
		return () => {
			shown.remove();
			hidden.remove();
		};
	}, [measureKeyboardOverlap]);

	const reload = useCallback(() => {
		setFailed(null);
		setLoading(true);
		webview.current?.reload();
	}, []);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") webview.current?.injectJavaScript("window.__lyraProbe && window.__lyraProbe(); true;");
		});
		return () => subscription.remove();
	}, []);

	/*
	 * Android's back button.
	 *
	 * `BackHandler` wants an answer synchronously — it cannot wait for a round trip into the WebView
	 * — so the page reports how many layers it has open and this keeps a mirror of that number. A
	 * ref rather than state: it is read inside the handler and never drawn, and re-rendering the
	 * WebView every time a drawer opens would be a reload.
	 */
	const back = useRef<BackState>({ depth: 0 });

	useEffect(() => {
		if (Platform.OS !== "android") return;
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			const action = backPress(back.current, Date.now());
			if (action.do === "close") {
				webview.current?.injectJavaScript("window.__lyraBack && window.__lyraBack(); true;");
				return true;
			}
			if (action.do === "warn") {
				back.current = action.state;
				ToastAndroid.show(t("desk.exitAgain"), ToastAndroid.SHORT);
				return true;
			}
			return false;
		});
		return () => subscription.remove();
	}, [t]);

	if (!connection) {
		return (
			<View className="flex-1 items-center justify-center bg-shell px-8" style={{ paddingTop: insets.top }}>
				<Text className="text-center text-[15px] text-ink">{t("desk.none")}</Text>
				<Pressable onPress={() => router.replace("/pair")} className="mt-5 rounded-xl bg-ink px-5 py-3 active:opacity-85">
					<Text className="text-[14px] font-medium text-shell">{t("desk.pair")}</Text>
				</Pressable>
			</View>
		);
	}

	const origin = originOf(connection);
	const appUrl = appUrlOf(connection);

	const replyNative = (id: string, ok: boolean, value: unknown) => {
		webview.current?.injectJavaScript(
			`window.__lyraNativeResult && window.__lyraNativeResult(${JSON.stringify(id)}, ${JSON.stringify(ok)}, ${JSON.stringify(value)}); true;`,
		);
	};

	const onPageMessage = async (raw: string) => {
		let message: { type?: string; depth?: number; dark?: boolean; shell?: string; status?: string; id?: string; method?: string; value?: unknown };
		try {
			message = JSON.parse(raw) as typeof message;
		} catch {
			return;
		}
		if (message.type === "layers" && typeof message.depth === "number") {
			back.current = { ...back.current, depth: message.depth };
			return;
		}
		if (message.type === "theme" && typeof message.dark === "boolean") {
			setTheme({ dark: message.dark, shell: message.shell || (message.dark ? "#171717" : "#ffffff") });
			return;
		}
		if (message.type === "connection" && typeof message.status === "string") {
			if (
				message.status === "connecting" ||
				message.status === "connected" ||
				message.status === "reconnecting" ||
				message.status === "offline"
			) setConnectionStatus(message.status);
			return;
		}
		if (message.type !== "native_request" || typeof message.id !== "string" || typeof message.method !== "string") return;

		try {
			if (message.method === "clipboardWrite") {
				await Clipboard.setStringAsync(typeof message.value === "string" ? message.value : "");
				replyNative(message.id, true, null);
				return;
			}
			if (message.method === "clipboardRead") {
				replyNative(message.id, true, await Clipboard.getStringAsync());
				return;
			}
			if (message.method === "openExternal" && typeof message.value === "string") {
				await Linking.openURL(message.value);
				replyNative(message.id, true, null);
				return;
			}
			replyNative(message.id, false, t("desk.unsupported"));
		} catch (error) {
			replyNative(message.id, false, error instanceof Error ? error.message : String(error));
		}
	};

	return (
		<View
			ref={webviewHost}
			className="flex-1"
			onLayout={measureKeyboardOverlap}
			// The page's own background, so the safe areas read as part of it rather than as a frame
			// around it. `bg-shell` was right for exactly one of the two themes.
			style={{
				backgroundColor: theme.shell,
				paddingTop: insets.top,
				paddingLeft: insets.left,
				paddingRight: insets.right,
				paddingBottom: Math.max(insets.bottom, nativeKeyboardInset),
			}}
		>
			<StatusBar style={theme.dark ? "light" : "dark"} />
			<WebView<object>
				ref={webview}
				source={{ uri: appUrl }}
				/*
				 * Injected before the page's own scripts, because the very first thing the app does
				 * is read `window.lyra`. `injectedJavaScript` — without the suffix — runs after
				 * load, which is far too late: the renderer would already have crashed looking for
				 * an interface that was not there yet.
				 */
				injectedJavaScriptBeforeContentLoaded={bridgeScript(connection)}
				onLoadStart={() => webview.current?.injectJavaScript(`${bridgeScript(connection)}\ntrue;`)}
				/*
				 * What the page tells us about itself: how many layers it has open, for the back
				 * button, and which theme it is in, for the status bar and the safe areas.
				 *
				 * Anything else is from a newer bridge than this build knows and is ignored
				 * rather than thrown — an unrecognised message is not a reason to take down a
				 * socket handler.
				 */
				onMessage={({ nativeEvent }) => void onPageMessage(nativeEvent.data)}
				onLoadEnd={() => setLoading(false)}
				onError={({ nativeEvent }) => {
					setLoading(false);
					setFailed(nativeEvent.description || t("desk.openFailed"));
				}}
				onHttpError={({ nativeEvent }) => {
					setLoading(false);
					setFailed(t("desk.response", { status: nativeEvent.statusCode }));
				}}
				/*
				 * Belt and braces against the focus zoom.
				 *
				 * The page it loads already asks for `maximum-scale=1`, but iOS has honoured that
				 * inconsistently across versions — and when it does zoom, the damage outlives the
				 * keyboard: the viewport stays wide and the send button stays off-screen. These two
				 * settle it at the WebView rather than relying on the page being obeyed.
				 */
				scalesPageToFit={false}
				setBuiltInZoomControls={false}
				// The renderer manages its own scrolling regions; a bouncing page underneath them
				// makes the whole interface feel detached from the phone.
				bounces={false}
				overScrollMode="never"
				// Native layout handles IME overlap; the page still covers visualViewport cases.
				automaticallyAdjustContentInsets={false}
				contentInsetAdjustmentBehavior="never"
				// Other relay capabilities belong in the external browser, outside this session bridge.
				originWhitelist={["http://*", "https://*", "about:blank"]}
				onShouldStartLoadWithRequest={(request) => {
					if (isAppUrl(request.url, connection)) return true;
					if (/^(https?:|mailto:)/i.test(request.url)) void Linking.openURL(request.url);
					return false;
				}}
				// Text selection and long-press callouts read as a web page rather than an app.
				{...(Platform.OS === "ios" ? { allowsLinkPreview: false } : {})}
				style={{ backgroundColor: "transparent" }}
			/>

			{loading && (
				<View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: theme.shell }}>
					<ActivityIndicator color="#9a9a9a" />
					<Text className="mt-3 text-[12.5px] text-ink-faint">{t("desk.loading")}</Text>
				</View>
			)}

			{!loading && connectionStatus !== "connected" && !failed && (
				<View
					pointerEvents="none"
					className="absolute left-0 right-0 items-center"
					style={{ top: insets.top + 8 }}
				>
					<View className="flex-row items-center gap-2 rounded-full border border-line bg-card/95 px-3 py-2">
						<ActivityIndicator size="small" color="#9a9a9a" />
						<Text className="text-[12px] text-ink-muted">{t("desk.reconnecting")}</Text>
					</View>
				</View>
			)}

			{failed && (
				<View className="absolute inset-0 items-center justify-center bg-shell px-8">
					<Text className="text-center text-[15px] font-medium text-ink">{t("desk.failed")}</Text>
					<Text className="mt-2 text-center text-[13px] leading-6 text-ink-muted">{failed}</Text>
					<Text className="mt-1 text-center text-[12px] text-ink-faint">
						{origin}
					</Text>
					<View className="mt-6 flex-row gap-3">
						<Pressable onPress={reload} className="rounded-xl bg-ink px-5 py-3 active:opacity-85">
							<Text className="text-[14px] font-medium text-shell">{t("desk.retry")}</Text>
						</Pressable>
						<Pressable
							onPress={() => router.replace("/pair")}
							className="rounded-xl border border-line px-5 py-3 active:bg-card-hover"
						>
							<Text className="text-[14px] text-ink-muted">{t("desk.repair")}</Text>
						</Pressable>
					</View>
				</View>
			)}
		</View>
	);
}
