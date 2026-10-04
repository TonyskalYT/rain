import { findAsset } from "@api/assets";
import { findByProps, findByStoreName } from "@metro";
import { React } from "@metro/common";
import { Animated as RNAnimated, Image, Pressable, StyleSheet, View } from "react-native";

import { caught, safe } from "../crash";
import { accentColor } from "../style/colors";
import { isPipRender, mineParticipant, onPinChange, participantForPin, pinnedPip, pinPip } from "./pip";
import { splitViewSettings, useSplitViewSettings } from "./storage";
import { chromeShown, noteControls, noteSafeArea, onChrome, safeAreaNote } from "./tiles";

const ICONS = ["PinIcon", "PictureInPictureIcon", "PipIcon", "ic_pip"];
const MARK = "__cheeseburgerNativePin";
const CONFIG = "__cheeseburgerPinConfig";
const MARKER = "cheeseburger-pin-marker";
const INLINE = "cheeseburger-inline-pin";
const FOCUS = /^(?:un)?focus\s/i;
const STOP = /^stop watching$/i;
const OURS = /^pop out pip/i;
const MOTION = /^(?:opacity|transform)$/;
const LAYOUTISH = /^(?:width|height|top|left|right|bottom|x|y|position|flex|aspectRatio|margin|padding|min|max)/i;
const FILL = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
const HIDDEN = { ...FILL, opacity: 0 } as const;
const FLIP = { transform: [{ scaleY: -1 }] } as const;
const RELATIVE = { position: "relative", top: undefined, left: undefined, right: undefined, bottom: undefined, margin: 0, marginTop: 0, marginLeft: 0, marginRight: 0, marginBottom: 0, marginHorizontal: 0, marginVertical: 0 } as const;

interface Level { name: string; handles: any[]; motion: any; entering?: any; exiting?: any; pointerEvents?: string; moving: string; }
interface Box { x: number; y: number; width: number; height: number; }
interface Template { type: any; props: any; }
interface MarkerRec { size?: { width: number; height: number; }; button: any; node: any; fiber: any; chain: any[]; outer: number; template: Template | null; rect?: Box & { at: number; }; sig: string; }
interface Inset { right: number; bottom: number; from: string; }
interface PinConfig { label: string; onPress: () => void; source: number; tint?: string; keep?: boolean; unflip?: boolean; flipGlyph?: boolean; }
interface InlineRec { pid: string | null; mine: boolean; why: string; }

const iconWrappers = new WeakMap<object, any>();
const markers = new Set<MarkerRec>();
const listeners = new Set<() => void>();
const owners = new Map<string, object>();
const insets = new Map<string, Inset>();
const seenButtons: string[] = [];
const seenSizes: string[] = [];
const inlines = new Map<string, InlineRec>();
const unflipNotes: string[] = [];
let latest: MarkerRec | null = null;
let active = false;
let icon: number | null | undefined;
let iconRetryAt = 0;
let reanimatedMod: any;
let reanimatedView: any;
let injected = 0;
let markersEver = 0;
let fibersFound = 0;
let fibersMissing = 0;
let hosts = 0;
let cloneRenders = 0;
let fallbackRenders = 0;
let cloneErrors = 0;
let inlineMounts = 0;
let inlineRenders = 0;
let fromRender = 0;
let fromMarker = 0;
let lastSeen: string[] = [];
export let pinIconName = "";

const nameOf = (type: any): string => typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name ?? "";

function notifyNow() {
    listeners.forEach(l => {
        try {
            l();
        } catch (e) {
            caught("pip pin listener", e);
        }
    });
    noteControls(markers.size > 0);
}

function reanimatedModule(): any {
    if (reanimatedMod !== undefined) return reanimatedMod;
    reanimatedMod = null;
    try {
        reanimatedMod = findByProps("useAnimatedStyle", "withTiming") ?? null;
    } catch (e) {
        caught("pip pin reanimated", e);
    }
    return reanimatedMod;
}

function animatedView(): any {
    if (reanimatedView !== undefined) return reanimatedView;
    reanimatedView = null;
    const m = reanimatedModule();
    try {
        reanimatedView = m?.default?.View ?? m?.View ?? (typeof m?.createAnimatedComponent === "function" ? m.createAnimatedComponent(View) : null);
    } catch (e) {
        caught("pip pin animated", e);
    }
    return reanimatedView;
}

function pinIcon(): number | null {
    if (icon != null || Date.now() < iconRetryAt) return icon ?? null;
    icon = null;
    iconRetryAt = Date.now() + 2000;
    for (const name of ICONS) {
        const asset = findAsset(name);
        if (asset?.name === name && typeof asset.id === "number" && Number.isFinite(asset.id) && asset.id > 0) {
            icon = asset.id;
            pinIconName = name;
            break;
        }
    }
    return icon;
}

class Guard extends React.Component<{ children?: any; fallback?: any; }, { failed: boolean; }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(e: any) {
        cloneErrors++;
        caught("pip pin", e);
    }

    render() {
        return this.state.failed ? this.props.fallback ?? null : this.props.children;
    }
}

const G = globalThis as any;
const shells: Set<() => void> = G.__cheeseburgerPinShells ??= new Set();

class Shell extends React.Component<{ part: string; props: any; }, { failed: boolean; n: number; }> {
    state = { failed: false, n: 0 };

    bump = () => this.setState(s => ({ failed: false, n: s.n + 1 }));

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidMount() {
        shells.add(this.bump);
    }

    componentWillUnmount() {
        shells.delete(this.bump);
    }

    componentDidCatch(e: any) {
        cloneErrors++;
        caught("pip pin shell", e);
    }

    render() {
        if (this.state.failed) return null;
        const Impl = G.__cheeseburgerPinImpl?.[this.props.part];
        return Impl ? React.createElement(Impl, this.props.props) : null;
    }
}

function flat(style: any): any {
    const out: any = {};
    const walk = (value: any) => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (typeof value === "function") return walk(value({ pressed: false, hovered: false, focused: false }));
        if (value?.initial?.value && value.viewDescriptors) return walk(value.initial.value);
        if (value && typeof value === "object") Object.assign(out, StyleSheet.flatten(value));
    };
    try {
        walk(style);
    } catch { }
    return out;
}

function placement(style: any): string {
    const f = flat(style);
    const out: any = {};
    for (const key of ["position", "top", "right", "bottom", "left", "width", "height", "padding", "flexDirection", "justifyContent", "alignItems"]) {
        if (f[key] !== undefined && typeof f[key] !== "object") out[key] = f[key];
    }
    return JSON.stringify(out).slice(0, 160);
}

const isNode = (v: any) => !!v && typeof v === "object" && typeof v.__getValue === "function";

function levelOf(type: any, props: any): Level {
    const handles: any[] = [];
    const moving: string[] = [];
    let motion: any = null;
    const walk = (s: any) => {
        if (!s || typeof s !== "object") return;
        if (Array.isArray(s)) return s.forEach(walk);
        if (s.viewDescriptors && s.initial) {
            const keys = Object.keys(s.initial.value ?? {});
            moving.push(...keys);
            if (keys.length && keys.every(k => MOTION.test(k))) handles.push(s);
            return;
        }
        if (isNode(s.opacity)) (motion ??= {}).opacity = s.opacity;
        if (Array.isArray(s.transform) && s.transform.some((t: any) => t && Object.values(t).some(isNode))) (motion ??= {}).transform = s.transform;
    };
    if (typeof props?.style !== "function") walk(props?.style);
    return {
        name: nameOf(type) || "anonymous",
        handles,
        motion,
        entering: props?.entering,
        exiting: props?.exiting,
        pointerEvents: typeof props?.pointerEvents === "string" ? props.pointerEvents : undefined,
        moving: [...new Set(moving.filter(k => !LAYOUTISH.test(k) || MOTION.test(k)))].join(" ") + (moving.some(k => LAYOUTISH.test(k)) ? " +layout" : ""),
    };
}

const animatedLevel = (l: Level) => l.handles.length > 0 || !!l.motion || l.entering != null || l.exiting != null;

const isFiber = (f: any) => !!f && typeof f === "object" && "return" in f && "memoizedProps" in f && "tag" in f;

function fiberOf(inst: any): any {
    if (!inst || typeof inst !== "object") return null;
    try {
        for (const key of ["__internalInstanceHandle", "_internalInstanceHandle", "_internalFiberInstanceHandleDEV"]) if (isFiber(inst[key])) return inst[key];
        for (const sym of Object.getOwnPropertySymbols(inst)) if (isFiber(inst[sym])) return inst[sym];
        for (const key of Object.keys(inst)) if (/internal|fiber|handle/i.test(key) && isFiber(inst[key])) return inst[key];
        if (isFiber(inst.canonical?.internalInstanceHandle)) return inst.canonical.internalInstanceHandle;
    } catch { }
    return null;
}

const same = (a: any, b: any) => a === b || !!a && !!b && a.alternate === b;
const labelOf = (props: any): string => (props && typeof props === "object" && typeof props.accessibilityLabel === "string" ? props.accessibilityLabel : "");
const focusLabel = (props: any) => FOCUS.test(labelOf(props));
const theirMax = (f: any) => !f.memoizedProps?.[MARK] && focusLabel(f.memoizedProps);
const ourPin = (f: any) => OURS.test(labelOf(f.memoizedProps));
const stopButton = (f: any) => STOP.test(labelOf(f.memoizedProps));

function walkFibers(root: any, visit: (f: any, depth: number) => "stop" | "skip" | void, limit = 600) {
    const stack: [any, number][] = [];
    if (root?.child) stack.push([root.child, 1]);
    let n = 0;
    while (stack.length && n++ < limit) {
        const [f, d] = stack.pop()!;
        if (f.sibling) stack.push([f.sibling, d]);
        const r = visit(f, d);
        if (r === "stop") return;
        if (r !== "skip" && f.child) stack.push([f.child, d + 1]);
    }
}

function findIn(root: any, pred: (f: any) => boolean, limit = 900): any {
    let hit: any = null;
    for (const start of [root, root?.alternate]) {
        if (!start) continue;
        walkFibers(start, f => {
            if (!pred(f)) return;
            hit = f;
            return "stop";
        }, limit);
        if (hit) return hit;
    }
    return null;
}

function hostOf(f: any): any {
    const sn = f?.stateNode;
    for (const c of [sn?.canonical?.publicInstance, sn?.canonical, sn]) if (c && typeof c.measureInWindow === "function") return c;
    return null;
}

function firstHost(f: any): any {
    if (!f) return null;
    if (typeof f.type === "string" && hostOf(f)) return f;
    let hit: any = null;
    walkFibers(f, x => {
        if (typeof x.type !== "string" || !hostOf(x)) return;
        hit = x;
        return "stop";
    }, 200);
    return hit;
}

function withoutMarker(props: any): any {
    const ch = props?.children;
    if (!Array.isArray(ch) || !ch.some((c: any) => c?.key === MARKER)) return props;
    const rest = ch.filter((c: any) => c?.key !== MARKER);
    return { ...props, children: rest.length === 1 ? rest[0] : rest };
}

function noteButton(line: string) {
    if (seenButtons.includes(line)) return;
    seenButtons.push(line);
    if (seenButtons.length > 6) seenButtons.shift();
}

function inspect(rec: MarkerRec) {
    const chain: any[] = [];
    let outer = -1;
    for (let f = rec.fiber?.return, i = 0; f && i < 80; f = f.return, i++) {
        const props = f.memoizedProps;
        if (props && typeof props === "object" && props.sharedCoords != null) break;
        chain.push(f);
        if (focusLabel(props)) outer = chain.length - 1;
    }
    rec.chain = chain;
    rec.outer = outer;
    if (outer >= 0) {
        const f = chain[outer];
        rec.template = { type: f.elementType ?? f.type, props: withoutMarker(f.memoizedProps) };
    } else if (rec.button) {
        rec.template = { type: rec.button.type, props: withoutMarker(rec.button.props) };
    } else rec.template = null;
    const levels = chain.slice(outer + 1, outer + 13).map(f => levelOf(f.elementType ?? f.type, f.memoizedProps));
    lastSeen = [
        `maximize button (last seen ${new Date().toISOString().slice(11, 19)}): ${nameOf(rec.template?.type) || "anonymous"} depth ${outer}, keys=${Object.keys(rec.template?.props ?? {}).slice(0, 14).join(",")}`,
        `maximize parents: ${levels.map((l, i) => `${i}:${l.name}${l.moving ? ` moves ${l.moving}` : ""}${l.handles.length ? ` handles ${l.handles.length}` : ""}${l.motion ? " rn-animated" : ""}${l.entering ? " entering" : ""}${l.exiting ? " exiting" : ""}${l.pointerEvents ? ` pe=${l.pointerEvents}` : ""}`).join(" < ") || "none"}`,
    ];
    rec.sig = `${outer}:${nameOf(rec.template?.type)}:${levels.map(l => `${l.name}${l.handles.length}${l.motion ? "m" : ""}${l.entering ? "e" : ""}${l.exiting ? "x" : ""}${l.pointerEvents ?? ""}`).join(",")}`;
}

function Marker({ button }: { button: any; }) {
    const ref = React.useRef<any>(null);
    const rec = React.useRef<MarkerRec>({ button, node: null, fiber: null, chain: [], outer: -1, template: null, sig: "" }).current;
    rec.button = button;
    React.useLayoutEffect(() => {
        markers.add(rec);
        markersEver++;
        return () => {
            markers.delete(rec);
            if (latest === rec) latest = null;
            notifyNow();
        };
    }, []);
    React.useLayoutEffect(() => {
        try {
            const node = ref.current;
            const fresh = rec.node !== node;
            rec.node = node;
            const fiber = fiberOf(node);
            if (fresh) {
                if (fiber) fibersFound++;
                else fibersMissing++;
            }
            rec.fiber = fiber;
            const before = rec.sig;
            const props = rec.template?.props;
            inspect(rec);
            latest = rec;
            if (fresh || before !== rec.sig || props !== rec.template?.props) notifyNow();
        } catch (e) {
            caught("pip pin marker", e);
        }
    });
    const onLayout = safe("pip pin marker layout", (e: any) => {
        const l = e?.nativeEvent?.layout;
        if (l) rec.size = { width: l.width, height: l.height };
        measureNode(ref.current, b => {
            rec.rect = { ...b, at: Date.now() };
        });
    });
    return <View ref={ref} collapsable={false} pointerEvents="none" style={HIDDEN} onLayout={onLayout} />;
}

function isWrapper(type: any, props: any): boolean {
    if (typeof type === "string" || props.icon == null || typeof props.onPress !== "function") return false;
    const f = flat(props.style);
    return f.position === "absolute" && (f.top != null || f.bottom != null) && (f.right != null || f.left != null);
}

export const watchControls = safe("pip pin controls", (args: any[], ret: any) => {
    if (!active || !ret || typeof ret !== "object" || isPipRender()) return;
    const props = ret.props;
    if (!props || props[MARK] || !focusLabel(props)) return;
    const name = nameOf(args[0]) || "anonymous";
    noteButton(`${name} ${placement(props.style)} keys=${Object.keys(props).slice(0, 12).join(",")}${typeof props.children === "function" ? " children=fn" : ""}`);
    if (isWrapper(args[0], props)) {
        if (splitViewSettings.pipPins === false) return;
        siblings++;
        pinNote = "next to discord's maximize";
        const pin = React.createElement(Shell, { key: INLINE, part: "InlinePin", props: { owner: null, button: ret, path: [] } });
        return React.createElement(React.Fragment, { key: ret.key ?? undefined }, ret, pin);
    }
    const ch = props.children;
    if (!/Pressable|Touchable/i.test(name) || ch == null || typeof ch !== "object") return;
    if (Array.isArray(ch) && ch.some((c: any) => c?.key === MARKER)) return;
    injected++;
    const marker = React.createElement(Shell, { key: MARKER, part: "Marker", props: { button: ret } });
    return { ...ret, props: { ...props, children: Array.isArray(ch) ? [...ch, marker] : [ch, marker] } };
});

function measureNode(node: any, done: (b: Box) => void) {
    if (typeof node?.measureInWindow !== "function") return;
    try {
        node.measureInWindow(safe("pip pin measure", (x: number, y: number, width: number, height: number) => {
            if ([x, y, width, height].every(n => typeof n === "number" && Number.isFinite(n)) && width > 0 && height > 0) done({ x, y, width, height });
        }));
    } catch (e) {
        caught("pip pin measure", e);
    }
}

function glyph(el: any, config: PinConfig): any {
    const props = el.props ?? {};
    const f: any = typeof props.style === "function" ? {} : StyleSheet.flatten(props.style) ?? {};
    const size = typeof props.size === "number" ? props.size : 20;
    return React.createElement(Image, {
        key: el.key ?? undefined,
        source: config.source,
        style: [
            { width: props.width ?? f.width ?? size, height: props.height ?? f.height ?? size },
            typeof props.style === "function" ? undefined : props.style,
            { tintColor: config.tint ?? f.tintColor ?? props.color ?? f.color ?? "#ffffff" },
            config.flipGlyph ? FLIP : undefined,
        ],
        accessible: false,
    });
}

function PinGlyph(props: any): any {
    const source = pinIcon();
    return source == null ? null : glyph({ props }, { source, label: "", onPress() { } });
}

const glyphTypes = new Map<string, any>();
const glyphSet = new WeakSet<object>([PinGlyph]);

function glyphType(config: PinConfig): any {
    const key = `${config.flipGlyph ? 1 : 0}|${config.tint ?? ""}`;
    let T = glyphTypes.get(key);
    if (!T) {
        T = (props: any) => {
            const source = pinIcon();
            return source == null ? null : glyph({ props }, { source, label: "", onPress() { }, tint: config.tint, flipGlyph: config.flipGlyph });
        };
        T.displayName = "PinGlyph";
        glyphTypes.set(key, T);
        glyphSet.add(T);
    }
    return T;
}

function noteUnflip(line: string) {
    if (unflipNotes.includes(line)) return;
    unflipNotes.push(line);
    if (unflipNotes.length > 4) unflipNotes.shift();
}

function unflipButton(el: any, depth = 0): { out: any; done: boolean; } {
    if (Array.isArray(el)) {
        let done = false;
        const out = el.map(child => {
            if (done) return child;
            const r = unflipButton(child, depth);
            done = r.done;
            return r.out;
        });
        return { out, done };
    }
    if (!el || typeof el !== "object" || !("$$typeof" in el) || depth > 7) return { out: el, done: false };
    const p = el.props ?? {};
    if (depth > 0 && labelOf(p) && typeof p.onPress === "function") {
        noteUnflip(`wrapped ${nameOf(el.type) || "anonymous"} at depth ${depth}`);
        return { out: React.createElement(View, { key: el.key ?? "cheeseburger-unflip", collapsable: false, pointerEvents: "box-none", style: FLIP }, el), done: true };
    }
    if (p.children == null || typeof p.children !== "object") return { out: el, done: false };
    const r = unflipButton(p.children, depth + 1);
    return r.done ? { out: { ...el, props: { ...p, children: r.out } }, done: true } : { out: el, done: false };
}

function unflipContents(el: any): any {
    if (!el || typeof el !== "object" || Array.isArray(el) || !("$$typeof" in el)) return null;
    const ch = el.props?.children;
    if (ch == null || typeof ch !== "object") return null;
    noteUnflip(`wrapped what's inside ${nameOf(el.type) || "anonymous"}`);
    return { ...el, props: { ...el.props, children: React.createElement(View, { key: "cheeseburger-unflip", collapsable: false, pointerEvents: "box-none", style: FLIP }, ch) } };
}

function rendered(result: any, config: PinConfig): any {
    if (!config.unflip) return walkButton(result, config, false);
    const r = unflipButton(result);
    if (r.done) return walkButton(r.out, { ...config, unflip: false }, false);
    const inside = unflipContents(result);
    if (inside) return walkButton(inside, { ...config, unflip: false }, false);
    noteUnflip(`nothing to wrap in ${nameOf(result?.type) || typeof result}, flipped the icon instead`);
    return walkButton(result, { ...config, unflip: false, flipGlyph: true }, false);
}

function iconType(type: any): any {
    if (!type || typeof type !== "function" && typeof type !== "object") return type;
    const found = iconWrappers.get(type);
    if (found) return found;
    const name = nameOf(type);
    if (/^(?:RCT|Native|Animated|View$|Pressable|Touchable|Gesture|Image|Text|Svg|Cut$|Notches$)/i.test(name)) return type;
    const run = (original: Function, self: any, props: any, ref?: any) => {
        const config = props[CONFIG];
        const clean = { ...props };
        delete clean[CONFIG];
        const result = original.call(self, clean, ref);
        return config ? rendered(result, config) : result;
    };
    let wrapper: any;
    if (typeof type === "function" && type.prototype?.isReactComponent) {
        wrapper = class extends type {
            render() {
                const result = super.render();
                return this.props[CONFIG] ? rendered(result, this.props[CONFIG]) : result;
            }
        };
    } else if (typeof type === "function") wrapper = function (this: any, props: any) { return run(type, this, props); };
    else if (type.$$typeof === Symbol.for("react.forward_ref") && typeof type.render === "function") wrapper = React.forwardRef((props: any, ref: any) => run(type.render, undefined, props, ref));
    else if (type.$$typeof === Symbol.for("react.memo") && type.type) wrapper = React.memo(iconType(type.type), type.compare);
    else return type;
    wrapper.displayName = name;
    if (type.defaultProps) wrapper.defaultProps = type.defaultProps;
    iconWrappers.set(type, wrapper);
    iconWrappers.set(wrapper, wrapper);
    return wrapper;
}

function relative(style: any): any {
    if (typeof style === "function") return (state: any) => [style(state), RELATIVE];
    return style == null ? RELATIVE : [style, RELATIVE];
}

function walkButton(el: any, config: PinConfig, top = true): any {
    if (Array.isArray(el)) return el.map(child => walkButton(child, config, false));
    if (typeof el === "string" && el.trim().length <= 3 && /[^\w\s]/.test(el)) return glyph({ props: {} }, config);
    if (!el || typeof el !== "object" || !("$$typeof" in el)) return el;
    const props = el.props ?? {};
    const name = nameOf(el.type);
    const next: any = { ...props };
    const nested = top && config.unflip ? { ...config, unflip: false } : config;
    const pressable = typeof props.onPress === "function";
    if (pressable) {
        next.onPress = config.onPress;
        next.onLongPress = undefined;
        next.accessibilityLabel = config.label;
        next.accessibilityHint = undefined;
        next.onLayout = undefined;
        if (!config.keep) next.style = relative(props.style);
        next.ref = null;
        next[MARK] = true;
    } else if (top) {
        if (!config.keep) next.style = relative(props.style);
        next.ref = null;
        next[MARK] = true;
    }
    if (labelOf(props) && !pressable) next.accessibilityLabel = config.label;
    if (glyphSet.has(el.type)) return el;
    if (/Text/i.test(name) && typeof props.children === "string" && props.children.trim().length <= 3) return glyph(el, nested);
    if (/Icon$|Svg(?:View)?$/i.test(name) || props.viewBox != null || el.type === Image || /Image(?:View)?$/i.test(name) && props.source != null || typeof props.source === "number") return glyph(el, nested);
    for (const key of ["icon", "Icon", "IconComponent", "iconComponent", "leadingIcon", "trailingIcon", "leftIcon", "rightIcon"]) {
        const value = props[key];
        if (value == null) continue;
        if (typeof value === "object" && value.props) next[key] = glyph(value, nested);
        else if (typeof value === "function" || value && typeof value === "object" && value.$$typeof) next[key] = glyphType(nested);
        else if (typeof value === "number") next[key] = config.source;
        else if (typeof value === "string") next[key] = pinIconName;
        else next[key] = undefined;
    }
    if (typeof props.renderIcon === "function") next.renderIcon = safe("pip pin icon", (...args: any[]) => walkButton(props.renderIcon(...args), nested, false));
    if (typeof props.children === "function") {
        const children = props.children;
        next.children = safe("pip pin children", (...args: any[]) => walkButton(children(...args), nested, false));
    } else if (props.children != null) next.children = walkButton(props.children, nested, false);
    const type = iconType(el.type);
    const wrapped = type !== el.type || iconWrappers.has(type);
    if (wrapped) next[CONFIG] = top ? config : nested;
    else if (top && config.unflip && next.children != null && typeof next.children !== "function") {
        const r = unflipButton(next.children, 1);
        next.children = r.done ? r.out : React.createElement(View, { key: "cheeseburger-unflip", collapsable: false, pointerEvents: "box-none", style: FLIP }, next.children);
        noteUnflip(r.done ? "wrapped the inner button" : "wrapped the button contents");
    }
    return { ...el, key: top ? "cheeseburger-pin-button" : el.key, type, props: next, ...(pressable || top ? { ref: null } : {}) };
}

function pinConfig(pid: string, source: number): PinConfig {
    const here = pinnedPip() === pid;
    return {
        label: here ? "pop out pip, pinned" : "pop out pip",
        onPress: safe("pip pin press", () => pinPip(here ? null : pid)),
        source,
        tint: here ? accentColor("#ff0048") : undefined,
    };
}

function cloneOf(template: Template, config: PinConfig): any {
    try {
        const el = React.createElement(template.type, { ...template.props, accessibilityLabel: config.label, [MARK]: true });
        return walkButton(el, config);
    } catch (e) {
        cloneErrors++;
        caught("pip pin clone", e);
        return null;
    }
}

function Fallback({ config }: { config: PinConfig; }) {
    const shownNow = chromeShown();
    const fade = React.useRef(new RNAnimated.Value(shownNow ? 1 : 0)).current;
    React.useEffect(() => {
        const anim = RNAnimated.timing(fade, { toValue: shownNow ? 1 : 0, duration: 200, useNativeDriver: true });
        anim.start();
        return () => anim.stop();
    }, [shownNow]);
    return <RNAnimated.View pointerEvents={shownNow ? "auto" : "none"} style={{ opacity: fade }}>
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={config.label}
            hitSlop={6}
            onPress={config.onPress}
            style={({ pressed }: any) => ({ backgroundColor: "#00000085", borderRadius: 8, padding: 6, opacity: pressed ? 0.7 : 1 })}
        >
            <Image source={config.source} style={{ width: 20, height: 20, tintColor: config.tint ?? "#ffffff" }} />
        </Pressable>
    </RNAnimated.View>;
}

function Levels({ levels, fill, children }: { levels: Level[]; fill?: boolean; children: any; }) {
    const A = animatedView();
    let node = children;
    levels.forEach((l, i) => {
        if (l.motion) node = <RNAnimated.View key={`m${i}`} pointerEvents="box-none" style={fill ? [FILL, l.motion] : l.motion}>{node}</RNAnimated.View>;
        if (A && (l.handles.length || l.entering != null || l.exiting != null)) node = <A key={`r${i}`} pointerEvents="box-none" style={fill ? [FILL, ...l.handles] : l.handles} entering={l.entering} exiting={l.exiting}>{node}</A>;
    });
    return node;
}

function contains(outer: Box, inner: Box) {
    return inner.x >= outer.x - 2 && inner.y >= outer.y - 2 && inner.x + inner.width <= outer.x + outer.width + 2 && inner.y + inner.height <= outer.y + outer.height + 2;
}

const clampInset = (v: number) => Math.min(48, Math.max(0, Math.round(v)));

function insetFrom(tile: Box, button: Box): Inset {
    const right = clampInset(tile.x + tile.width - (button.x + button.width));
    const top = clampInset(button.y - tile.y);
    const bottom = clampInset(tile.y + tile.height - (button.y + button.height));
    if (button.y + button.height / 2 > tile.y + tile.height / 2) return { right: right + Math.round(button.width) + Math.max(6, right), bottom, from: "left of maximize" };
    return { right, bottom: top, from: "mirrors maximize" };
}

function sizeOk(layout: { width: number; height: number; }, coords: any) {
    const w = typeof coords?.width === "number" ? coords.width : 0;
    const h = typeof coords?.height === "number" ? coords.height : 0;
    if (!w || !h) return false;
    const tol = (v: number) => Math.max(4, v * 0.03);
    const wOk = Math.abs(layout.width - w) <= tol(w);
    const hOk = Math.abs(layout.height - h) <= tol(h);
    return wOk && hOk || layout.width <= w + tol(w) && layout.height <= h + tol(h) && (wOk || hOk);
}

function readCoords(sv: any): any {
    try {
        return typeof sv?.get === "function" ? sv.get() : sv?.value;
    } catch {
        return undefined;
    }
}

function noteSize(line: string) {
    if (seenSizes.includes(line)) return;
    seenSizes.push(line);
    if (seenSizes.length > 4) seenSizes.shift();
}

interface Match { rec: MarkerRec; levels: Level[]; }

function matchFor(pinFiber: any, tile: Box | null): Match | null {
    const mine: any[] = [];
    for (let f = pinFiber, i = 0; f && i < 16; f = f.return, i++) mine.push(f);
    let best: { rec: MarkerRec; j: number; k: number; } | null = null;
    if (mine.length) {
        for (const rec of markers) {
            if (!rec.chain.length) continue;
            for (let j = rec.outer + 1; j < rec.chain.length; j++) {
                const k = mine.findIndex(f => same(f, rec.chain[j]));
                if (k < 0) continue;
                if (!best || k < best.k) best = { rec, j, k };
                break;
            }
        }
    }
    if (best) return { rec: best.rec, levels: best.rec.chain.slice(best.rec.outer + 1, best.j).map(f => levelOf(f.elementType ?? f.type, f.memoizedProps)) };
    if (!tile) return null;
    const hit = [...markers].filter(m => m.rect && Date.now() - m.rect.at < 3000 && contains(tile, m.rect)).sort((a, b) => b.rect!.at - a.rect!.at)[0];
    return hit ? { rec: hit, levels: [] } : null;
}

let insetsSource: { context: any; hook: any; } | null | undefined;
function useInsets(): any {
    if (insetsSource === undefined) {
        insetsSource = null;
        try {
            const m = findByProps("SafeAreaInsetsContext") ?? findByProps("useSafeAreaInsets");
            if (m?.SafeAreaInsetsContext) insetsSource = { context: m.SafeAreaInsetsContext, hook: null };
            else if (typeof m?.useSafeAreaInsets === "function") insetsSource = { context: null, hook: m.useSafeAreaInsets };
        } catch { }
    }
    if (!insetsSource) return null;
    if (insetsSource.context) return React.useContext(insetsSource.context);
    try {
        return insetsSource.hook();
    } catch {
        return null;
    }
}

function Pin({ coords, pid, stream }: { coords: any; pid: string; stream: boolean; }) {
    const safeArea = useInsets();
    const on = useSplitViewSettings((s: any) => s.pipPins !== false);
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    const owner = React.useRef({}).current;
    const host = React.useRef<any>(null);
    const pinFiber = React.useRef<any>(null);
    const tileBox = React.useRef<Box | null>(null);
    const misses = React.useRef(0);
    const [valid, setValid] = React.useState(false);
    const kind = stream ? "stream" : "camera";

    if (safeArea) noteSafeArea(safeArea);

    React.useLayoutEffect(() => {
        hosts++;
        listeners.add(force);
        const offPin = onPinChange(force);
        const offChrome = onChrome(force);
        return () => {
            hosts--;
            listeners.delete(force);
            offPin();
            offChrome();
            if (owners.get(pid) === owner) {
                owners.delete(pid);
                notifyNow();
            }
        };
    }, []);

    React.useLayoutEffect(() => {
        if (!pinFiber.current && host.current) pinFiber.current = fiberOf(host.current);
        if (valid && !owners.has(pid)) {
            owners.set(pid, owner);
            force();
        } else if (!valid && owners.get(pid) === owner) {
            owners.delete(pid);
            notifyNow();
        }
    });

    const check = safe("pip pin host", (layout: { width: number; height: number; }) => {
        const c = readCoords(coords);
        if (sizeOk(layout, c)) {
            misses.current = 0;
            if (!valid) setValid(true);
            return;
        }
        noteSize(`${kind} host ${Math.round(layout.width)}x${Math.round(layout.height)} vs tile ${Math.round(c?.width)}x${Math.round(c?.height)}`);
        if (++misses.current >= 2 && valid) setValid(false);
    });

    const onLayout = safe("pip pin layout", (e: any) => {
        const layout = e?.nativeEvent?.layout;
        if (layout) check(layout);
    });

    const fallbackOnly = !fcType;
    const visible = fallbackOnly && active && on && valid && owners.get(pid) === owner;
    const match = visible ? matchFor(pinFiber.current, tileBox.current) : null;

    React.useEffect(() => {
        if (!visible) return;
        const locate = safe("pip pin locate", () => {
            for (const m of markers) measureNode(m.node, b => {
                m.rect = { ...b, at: Date.now() };
            });
            setTimeout(safe("pip pin match", () => measureNode(host.current, tile => {
                tileBox.current = tile;
                const m = matchFor(pinFiber.current, tile);
                if (!m?.rec.rect || !contains(tile, m.rec.rect)) return;
                const next = insetFrom(tile, m.rec.rect);
                const prev = insets.get(kind);
                if (!prev || prev.right !== next.right || prev.bottom !== next.bottom || prev.from !== next.from) {
                    insets.set(kind, next);
                    notifyNow();
                }
            })), 120);
        });
        locate();
        const timer = setInterval(locate, 2000);
        return () => clearInterval(timer);
    }, [visible, match?.rec]);

    let content: any = null;
    const source = visible ? pinIcon() : null;
    if (visible && source != null && !inlines.get(pid)) {
        const config = pinConfig(pid, source);
        const inset = insets.get(kind) ?? insets.get(stream ? "camera" : "stream") ?? { right: 8, bottom: 8, from: "default" };
        const fallback = <Fallback config={config} />;
        const rec = match?.rec ?? (markers.size ? null : undefined);
        let inner: any = null;
        if (rec?.template) {
            const clone = cloneOf(rec.template, config);
            if (clone) {
                cloneRenders++;
                inner = <Levels levels={match!.levels}><Guard fallback={fallback}>{clone}</Guard></Levels>;
            } else inner = fallback;
        } else if (rec === undefined && !markersEver) {
            fallbackRenders++;
            inner = fallback;
        }
        content = <View key="cheeseburger-pin-spot" pointerEvents="box-none" style={{ position: "absolute", right: inset.right, bottom: inset.bottom }}>
            {inner}
        </View>;
    }

    return <View ref={host} collapsable={false} pointerEvents="box-none" style={[FILL, { zIndex: 50 }]} onLayout={onLayout}>
        {content}
    </View>;
}

function findDown(root: any, limit: number): any {
    let found: any = null;
    walkFibers(root, f => {
        const props = f.memoizedProps;
        if (!props || typeof props !== "object" || props.sharedCoords == null) return;
        const part = participantForPin(props);
        if (!part) return;
        found = part;
        return "stop";
    }, limit);
    return found;
}

function participantNear(fiber: any): any {
    const ups: any[] = [];
    for (let f = fiber?.return, i = 0; f && i < 40; f = f.return, i++) ups.push(f);
    for (const f of ups.slice(0, 12)) {
        const props = f.memoizedProps;
        if (!props || typeof props !== "object") continue;
        const part = participantForPin(props);
        if (part) return part;
    }
    for (const f of ups.slice(0, 24)) {
        const part = findDown(f, 400);
        if (part) return part;
    }
    return null;
}

const isControls = (f: any) => !!f && /FloatingControls/.test(nameOf(f.elementType ?? f.type));

function controlsAbove(fiber: any): any {
    for (let f = fiber?.return, i = 0; f && i < 12; f = f.return, i++) if (isControls(f)) return f;
    return null;
}

const short = (v: any): string => v == null ? String(v) : typeof v === "number" ? String(Math.round(v * 100) / 100) : typeof v === "string" ? v.slice(0, 24) : typeof v === "boolean" ? String(v) : typeof v === "function" ? `fn ${nameOf(v)}`.trim() : Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).slice(0, 5).join(",")}}`;

const animNames = new WeakMap<object, string>();

function animName(v: any): string {
    if (v == null || typeof v !== "object" && typeof v !== "function") return short(v);
    const cached = animNames.get(v);
    if (cached !== undefined) return cached;
    let name = "";
    const R = reanimatedModule();
    if (R) {
        for (const k of Object.keys(R)) {
            let e: any;
            try {
                e = R[k];
            } catch {
                continue;
            }
            if (e && (e === v || typeof v === "object" && e === v.constructor)) {
                name = k;
                break;
            }
        }
    }
    if (!name) name = nameOf(typeof v === "object" ? v.constructor : v) || (typeof v === "function" ? "fn" : "object");
    let fields = "";
    try {
        if (typeof v === "object") fields = Object.keys(v).filter(k => /V$|^(?:duration|delay|damping|stiffness|mass|easing|definitions|value|randomize)/i.test(k)).slice(0, 8).map(k => `${k}=${short(v[k])}`).join(" ");
        if (typeof v === "object" && "value" in v && !fields.includes("value=")) fields += ` value=${short(v.value)}`;
    } catch { }
    const out = fields.trim() ? `${name}(${fields.trim()})` : name;
    animNames.set(v, out);
    return out;
}

function handleText(s: any): string {
    const init = s?.initial?.value;
    if (!init || typeof init !== "object") return "anim{}";
    return `anim{${Object.entries(init).slice(0, 8).map(([k, v]) => k === "transform" && Array.isArray(v) ? `transform=${v.map((t: any) => Object.entries(t ?? {}).map(([a, b]) => `${a}:${short(b)}`).join("")).join(",")}` : `${k}=${short(v)}`).join(" ")}}`;
}

function styleText(style: any): string {
    if (style == null) return "";
    if (typeof style === "function") return "style=fn";
    const anims: string[] = [];
    const rn: string[] = [];
    const walk = (s: any) => {
        if (!s || typeof s !== "object") return;
        if (Array.isArray(s)) return s.forEach(walk);
        if (s.viewDescriptors && s.initial) {
            anims.push(handleText(s));
            return;
        }
        for (const [k, v] of Object.entries(s)) if (isNode(v) || k === "transform" && Array.isArray(v) && v.some((t: any) => t && Object.values(t).some(isNode))) rn.push(k);
    };
    try {
        walk(style);
    } catch { }
    const f = flat(style);
    const keep: string[] = [];
    for (const key of ["position", "top", "right", "bottom", "left", "width", "height", "opacity", "zIndex", "overflow", "padding", "margin", "alignItems", "justifyContent", "flexDirection"]) {
        if (f[key] !== undefined && typeof f[key] !== "object") keep.push(`${key}:${short(f[key])}`);
    }
    if (Array.isArray(f.transform) && f.transform.length) keep.push(`transform:${f.transform.map((t: any) => Object.entries(t ?? {}).map(([a, b]) => `${a}=${short(b)}`).join("")).join(",")}`);
    return [keep.length ? `{${keep.join(" ")}}` : "", ...anims, rn.length ? `rnanim(${rn.join(",")})` : ""].filter(Boolean).join(" ");
}

function propsText(props: any): string {
    if (!props || typeof props !== "object") return "";
    const label = labelOf(props);
    const st = styleText(props.style);
    const la = ["entering", "exiting", "layout"].filter(k => props[k] != null).map(k => `${k}=${animName(props[k])}`).join(" ");
    const pe = typeof props.pointerEvents === "string" ? `pe=${props.pointerEvents}` : "";
    return [label ? `"${label.slice(0, 28)}"` : "", st, la, pe, props[MARK] ? "[ours]" : ""].filter(Boolean).join(" ");
}

const INTERESTING = /Animated|Reanimated|Floating|Control|Label|Pressable|Button|Pill|Icon|Card|Overlay/i;

function treeLines(root: any): string[] {
    const out: string[] = [];
    walkFibers(root, (f, d) => {
        if (out.length >= 140) return "stop";
        const props = f.memoizedProps;
        const name = nameOf(f.elementType ?? f.type) || "anonymous";
        const text = propsText(props);
        if (typeof f.type === "string" || text || INTERESTING.test(name)) out.push(`${"  ".repeat(Math.min(d, 16))}${name}${text ? ` ${text}` : ""}`.slice(0, 280));
        if (props?.[MARK]) return "skip";
    }, 900);
    return out;
}

function elementLines(el: any, depth: number, out: string[]) {
    if (out.length >= 90 || depth > 9) return;
    if (Array.isArray(el)) {
        el.forEach(child => elementLines(child, depth, out));
        return;
    }
    if (!el || typeof el !== "object" || !("$$typeof" in el)) return;
    const p = el.props ?? {};
    const name = el.type === React.Fragment ? "Fragment" : nameOf(el.type) || "anonymous";
    const text = propsText(p);
    out.push(`${"  ".repeat(depth)}${name}${el.key != null ? `#${String(el.key).slice(0, 20)}` : ""}${text ? ` ${text}` : ""} props=${Object.keys(p).filter(k => k !== "children").slice(0, 12).join(",")}`.slice(0, 300));
    if (p[MARK] || el.key === INLINE) return;
    if (typeof p.children === "function") out.push(`${"  ".repeat(depth + 1)}(render function)`);
    else if (p.children != null && typeof p.children === "object") elementLines(p.children, depth + 1, out);
}

const labRuns: string[][] = [];
let labTree: string[] = [];
const labElements: string[] = [];
const labElementsAt = 0;
let labSeq = 0;
const labListeners = new Set<() => void>();
const labOn = () => active && splitViewSettings.labOn === true;

export function onLabReady(l: () => void) {
    labListeners.add(l);
    return () => void labListeners.delete(l);
}

function emitLab() {
    labListeners.forEach(l => {
        try {
            l();
        } catch (e) {
            caught("pip lab listener", e);
        }
    });
}

function nameHost(fc: any): any {
    const iconFiber = findIn(fc, f => /LabelIcon/i.test(nameOf(f.elementType ?? f.type)));
    if (!iconFiber) return null;
    for (let f = iconFiber.return, i = 0; f && i < 10 && !same(f, fc); f = f.return, i++) if (/Pressable/.test(nameOf(f.elementType ?? f.type))) return hostOf(firstHost(f));
    for (let f = iconFiber.return, i = 0; f && i < 10; f = f.return, i++) if (typeof f.type === "string" && hostOf(f)) return hostOf(f);
    return null;
}

interface LabTarget { area: () => any; fc: () => any; kind: string; }

function runLab(event: string, target: LabTarget) {
    if (!labOn()) return;
    const seq = ++labSeq;
    const started = Date.now();
    const lines: string[] = [`${event} #${seq} on a ${target.kind} tile at ${new Date().toISOString().slice(11, 19)}`];
    let prev = "";
    let ticks = 0;
    let last: Record<string, Box> = {};
    const rel = (b: Box | undefined, card: Box | undefined) => (b && card ? `${Math.round(b.x - card.x)},${Math.round(b.y - card.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : "-");
    const sample = (next: () => void) => {
        const fc = target.fc();
        const nodes: [string, any][] = [
            ["card", target.area()],
            ["max", hostOf(firstHost(findIn(fc, theirMax)))],
            ["pin", hostOf(firstHost(findIn(fc, ourPin)))],
            ["x", hostOf(firstHost(findIn(fc, stopButton)))],
            ["name", nameHost(fc)],
        ];
        const got: Record<string, Box> = {};
        let left = nodes.length;
        let flushed = false;
        const flush = () => {
            if (flushed) return;
            flushed = true;
            const card = got.card;
            const line = `card ${card ? `${Math.round(card.width)}x${Math.round(card.height)}` : "-"} | max ${rel(got.max, card)} | pin ${rel(got.pin, card)} | x ${rel(got.x, card)} | name ${rel(got.name, card)}`;
            if (line !== prev) {
                lines.push(`  +${Date.now() - started}ms ${line}`);
                prev = line;
            }
            if (got.card) last = got;
            next();
        };
        const one = () => {
            if (--left <= 0) flush();
        };
        for (const [key, node] of nodes) {
            if (!node || typeof node.measureInWindow !== "function") {
                one();
                continue;
            }
            try {
                node.measureInWindow(safe("pip lab measure", (x: number, y: number, width: number, height: number) => {
                    if ([x, y, width, height].every(n => typeof n === "number" && Number.isFinite(n))) got[key] = { x, y, width, height };
                    one();
                }));
            } catch {
                one();
            }
        }
        setTimeout(safe("pip lab flush", flush), 60);
    };
    const finish = () => {
        const card = last.card;
        const max = last.max;
        const pin = last.pin;
        if (!card) lines.push("  result: card not measured");
        else if (!pin) lines.push(`  result: pin not on screen${max ? `, maximize at ${rel(max, card)}` : ""}`);
        else if (!max) lines.push(`  result: maximize gone, pin at ${rel(pin, card)}`);
        else {
            const mirroredY = card.height - (max.y - card.y + max.height);
            const dx = Math.round(pin.x - max.x);
            const dy = Math.round(pin.y - card.y - mirroredY);
            const level = Math.round(pin.y - max.y);
            lines.push(`  result: pin vs mirrored maximize dx ${dx} dy ${dy}${Math.abs(dy) > 2 && Math.abs(level) <= 2 ? " (measured before the flip)" : ""}, size ${Math.round(pin.width)}x${Math.round(pin.height)} vs ${Math.round(max.width)}x${Math.round(max.height)}${Math.abs(dx) <= 2 && (Math.abs(dy) <= 2 || Math.abs(level) <= 2) ? " ✓" : ""}`);
        }
        labRuns.push(lines);
        while (labRuns.length > 6) labRuns.shift();
        emitLab();
    };
    const step = safe("pip lab step", () => {
        if (seq !== labSeq && ticks > 0) {
            lines.push("  cut short by the next event");
            finish();
            return;
        }
        sample(() => {
            ticks++;
            if (ticks === 6) {
                try {
                    const fc = target.fc();
                    if (fc) labTree = treeLines(fc);
                } catch (e) {
                    caught("pip lab tree", e);
                }
            }
            if (ticks < 22 && labOn()) setTimeout(step, 70);
            else finish();
        });
    });
    step();
}

export function labText(): string[] {
    return [
        `pin lab: ${labSeq} events, ${pinNote}, reanimated ${reanimatedModule() ? "found" : "missing"}, flip ${unflipNotes.join("; ") || "nothing wrapped yet"}`,
        ...labRuns.flat(),
        "controls tree (live):",
        ...(labTree.length ? labTree : ["  not captured yet"]),
        "controls render output:",
        ...(labElements.length ? labElements : ["  not captured yet"]),
    ];
}

interface InlineProps { owner: any; button: any; path?: any[]; }

function InlinePin({ owner, button, path }: InlineProps) {
    const on = useSplitViewSettings((s: any) => s.pipPins !== false);
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    const ref = React.useRef<any>(null);
    const me = React.useRef<InlineRec>({ pid: null, mine: false, why: "starting" }).current;
    const fc = React.useRef<any>(null);
    const stream = React.useRef(false);
    const shown = React.useRef<boolean | null>(null);

    const resolve = () => {
        if (me.pid || me.mine) return false;
        try {
            const fiber = fiberOf(ref.current);
            if (!fiber) {
                me.why = "no fiber";
                return false;
            }
            fc.current ??= controlsAbove(fiber);
            const part = participantForPin(owner ?? {}) ?? participantNear(fiber);
            if (!part || part.id == null) {
                me.why = "no participant";
                return false;
            }
            if (mineParticipant(part)) {
                me.mine = true;
                me.why = "yours";
                return false;
            }
            me.pid = String(part.id);
            stream.current = part.type === 0 || me.pid.startsWith("call:");
            me.why = "ready";
            inlines.set(me.pid, me);
            return true;
        } catch (e) {
            caught("pip inline pin", e);
            return false;
        }
    };

    React.useLayoutEffect(() => {
        inlineMounts++;
        listeners.add(force);
        const offPin = onPinChange(force);
        if (resolve()) notifyNow();
        force();
        return () => {
            listeners.delete(force);
            offPin();
            if (me.pid && inlines.get(me.pid) === me) inlines.delete(me.pid);
            noteWhy(me, "gone");
        };
    }, []);

    React.useLayoutEffect(() => {
        if (!fc.current && ref.current) fc.current = controlsAbove(fiberOf(ref.current));
        if (!me.pid && !me.mine && resolve()) force();
        noteWhy(me, me.why);
    });

    const rec = !button && fc.current ? [...markers].find(m => m.chain.some(f => same(f, fc.current))) ?? null : null;
    let template: Template | null = null;
    let levels: Level[] = [];
    if (button) {
        template = { type: button.type, props: withoutMarker(button.props) };
        levels = (path ?? []).map(el => levelOf(el.type, el.props));
    } else if (rec?.template) {
        template = rec.template;
        const top = rec.chain.findIndex(f => same(f, fc.current));
        levels = top > rec.outer ? rec.chain.slice(rec.outer + 1, top).map(f => levelOf(f.elementType ?? f.type, f.memoizedProps)) : [];
    }
    const present = !!template && !!me.pid && !me.mine;

    React.useLayoutEffect(() => {
        if (shown.current === present) return;
        const first = shown.current === null;
        shown.current = present;
        if (first && !present || me.mine) return;
        try {
            runLab(present ? "show" : "hide", {
                area: () => ref.current,
                fc: () => controlsAbove(fiberOf(ref.current)) ?? fc.current,
                kind: stream.current ? "stream" : "camera",
            });
        } catch (e) {
            caught("pip lab", e);
        }
    });

    const source = active && on && present ? pinIcon() : null;
    let content: any = null;
    if (source != null && template && me.pid) {
        const clone = cloneOf(template, { ...pinConfig(me.pid, source), keep: true, unflip: true });
        if (clone) {
            inlineRenders++;
            if (button) fromRender++;
            else fromMarker++;
            const blocked = levels.some(l => l.pointerEvents === "none" || l.pointerEvents === "box-only");
            content = <View key="cheeseburger-pin-flip" collapsable={false} pointerEvents={blocked ? "none" : "box-none"} style={[FILL, FLIP]}>
                <Levels levels={levels} fill>
                    <Guard>{clone}</Guard>
                </Levels>
            </View>;
        }
    } else if (me.pid && !me.mine) me.why = template ? "off" : fc.current ? "waiting for maximize" : "controls not found above";
    return <View ref={ref} collapsable={false} pointerEvents="box-none" style={FILL}>
        {content}
    </View>;
}

const whyLog: string[] = [];
const lastWhy = new WeakMap<InlineRec, string>();
let siblings = 0;
let pinNote = "waiting for discord's controls";

function noteWhy(rec: InlineRec, why: string) {
    if (lastWhy.get(rec) === why) return;
    lastWhy.set(rec, why);
    whyLog.push(`${new Date().toISOString().slice(11, 19)} ${rec.pid ? rec.pid.slice(-4) : "?"} ${why}`);
    if (whyLog.length > 10) whyLog.shift();
}

const fcType: any = null;

function cleanOldHooks() {
    const old = G.__cheeseburgerPinFc;
    if (old && Array.isArray(old.unpatches)) {
        for (const u of old.unpatches.splice(0)) {
            try {
                u();
            } catch { }
        }
    }
    delete G.__cheeseburgerPinFc;
    G.__cheeseburgerPinControls = null;
}

export function startPins() {
    active = true;
    cleanOldHooks();
    G.__cheeseburgerPinImpl = { TilePin: Pin, InlinePin, Marker };
    for (const bump of [...shells]) {
        try {
            bump();
        } catch { }
    }
    setTimeout(safe("pip pin refresh", () => findByStoreName("ChannelRTCStore")?.emitChange?.()), 60);
}

export function stopPins() {
    active = false;
    owners.clear();
    markers.clear();
    latest = null;
    notifyNow();
}

export function tilePinFor(_props: any): any {
    return null;
}

export function pinControlsDebug(): string[] {
    const A = animatedView();
    const rec = latest ?? [...markers][0] ?? null;
    return [
        `pins: inline mounts ${inlineMounts}, renders ${inlineRenders} (from render ${fromRender}, from markers ${fromMarker}), live ${[...inlines.values()].map(r => r.why).join(", ") || "none"}, clone errors ${cloneErrors}, reanimated ${A ? "found" : "missing"}`,
        `controls hook: ${pinNote}, next to maximize ${siblings}x`,
        `pin states: ${whyLog.join(" | ") || "none yet"}`,
        `flip: ${unflipNotes.join("; ") || "nothing wrapped yet"}`,
        `fallback layer: hosts ${hosts}, owners ${owners.size}, markers ${markers.size} (ever ${markersEver}, injected ${injected}), fibers ${fibersFound} found ${fibersMissing} missing, clone renders ${cloneRenders}, plain renders ${fallbackRenders}, safe area ${safeAreaNote()}`,
        ...(rec ? [`maximize button now: ${nameOf(rec.template?.type) || "anonymous"}${rec.rect ? ` at ${Math.round(rec.rect.x)},${Math.round(rec.rect.y)} ${Math.round(rec.rect.width)}x${Math.round(rec.rect.height)}` : ""}`] : []),
        ...lastSeen,
        ...seenButtons.map(p => `  labelled ${p}`),
        ...seenSizes.map(s => `  skipped ${s}`),
        ...labRuns.slice(-2).flat(),
    ];
}
