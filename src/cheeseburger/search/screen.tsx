import { findAssetId } from "@api/assets";
import { after, before } from "@api/patcher";
import { jsxRuntime } from "@api/react/jsx";
import { React } from "@metro/common";
import { Image, Pressable, Text } from "react-native";

import { caught, safe } from "../crash";
import { themeColor } from "../style/colors";
import { openAdvanced } from "./Advanced";
import { searchSettings } from "./storage";

const PATH = "modules/search/native/components/layout/autocomplete/SearchFilterButton.tsx";
const NAME = "SearchFilterButton";
const MEMO = Symbol.for("react.memo");
const ICONS = ["MagnifyingGlassPlusIcon", "ZoomInIcon", "SparklesIcon", "MagnifyingGlassIcon", "SearchIcon", "ic_search_24px", "ic_search"];
const KEY = "cheeseburger-advanced";

const stats = { found: "", via: "", renders: 0, cloned: 0, plain: 0, shape: "", error: "" };
const unpatches: (() => unknown)[] = [];
let patchedMemo: any = null;
let poll: ReturnType<typeof setInterval> | null = null;
let iconId: number | null | undefined;

function icon(): number | null {
    if (iconId === undefined) iconId = ICONS.map(n => findAssetId(n)).find(id => id !== undefined) ?? null;
    return iconId ?? null;
}

const open = safe("search screen open", () => openAdvanced(null));

class Guard extends React.Component<{ children?: any; }, { failed: boolean; }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(e: any) {
        stats.error = String(e?.message ?? e).slice(0, 120);
        caught("search screen button", e);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}

function typeName(t: any): string {
    if (typeof t === "string") return t;
    if (t?.$$typeof === MEMO) return `memo(${typeName(t.type)})`;
    return t?.displayName ?? t?.name ?? t?.render?.displayName ?? t?.render?.name ?? "?";
}

function shapeOf(el: any, depth = 0): string {
    if (!el || typeof el !== "object" || !("props" in el) || depth > 3) return "";
    const p = el.props ?? {};
    const keys = Object.keys(p).filter(k => k !== "children").slice(0, 8).join(",");
    const kids: any[] = Array.isArray(p.children) ? p.children : p.children ? [p.children] : [];
    const inner = kids.map(k => shapeOf(k, depth + 1)).filter(Boolean).join(" ");
    return `${typeName(el.type)}{${keys}}${inner ? `[${inner}]` : ""}`;
}

interface Copy { el: any; press: boolean; pic: boolean; }

function copyOf(el: any, depth = 0): Copy {
    if (!el || typeof el !== "object" || !("props" in el) || depth > 5) return { el, press: false, pic: false };
    const p = el.props ?? {};
    const next: any = {};
    let press = false;
    let pic = false;
    const src = icon();
    if (typeof p.onPress === "function") {
        next.onPress = open;
        press = true;
    }
    if (typeof p.onLongPress === "function") next.onLongPress = open;
    if (typeof p.accessibilityLabel === "string") next.accessibilityLabel = "Advanced search";
    if (src != null && typeof p.source === "number") {
        next.source = src;
        pic = true;
    }
    if (src != null && p.icon != null) {
        if (typeof p.icon === "number") {
            next.icon = src;
            pic = true;
        } else if (typeof p.icon === "object" && "props" in p.icon && typeof p.icon.props?.source === "number") {
            next.icon = React.cloneElement(p.icon, { source: src });
            pic = true;
        }
    }
    let children = p.children;
    if (Array.isArray(children)) {
        children = children.map((c: any) => {
            const r = copyOf(c, depth + 1);
            press ||= r.press;
            pic ||= r.pic;
            return r.el;
        });
    } else if (children && typeof children === "object") {
        const r = copyOf(children, depth + 1);
        press ||= r.press;
        pic ||= r.pic;
        children = r.el;
    }
    if (children !== p.children) next.children = children;
    return { el: React.cloneElement(el, next), press, pic };
}

function PlainButton() {
    const tint = themeColor("ICON_PRIMARY") ?? themeColor("INTERACTIVE_NORMAL") ?? "#b5bac1";
    const src = icon();
    return (
        <Pressable
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel="Advanced search"
            hitSlop={8}
            style={({ pressed }) => ({ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
        >
            {src != null ? <Image source={src} style={{ width: 24, height: 24, tintColor: tint }} /> : <Text style={{ color: tint, fontSize: 20 }}>⌕</Text>}
        </Pressable>
    );
}

function patchMemo(memo: any, via: string) {
    if (!memo || patchedMemo || typeof memo.type !== "function") return;
    patchedMemo = memo;
    stats.found = memo.type.name || "anonymous";
    stats.via = via;
    try {
        unpatches.push(after("type", memo, safe("search screen button", (_args: any[], ret: any) => {
            if (searchSettings.screenButton === false || !ret || typeof ret !== "object") return;
            stats.renders++;
            if (!stats.shape) stats.shape = shapeOf(ret).slice(0, 360);
            let ours: any = null;
            try {
                const c = copyOf(ret);
                if (c.press && c.pic) {
                    ours = c.el;
                    stats.cloned++;
                }
            } catch (e: any) {
                stats.error = String(e?.message ?? e).slice(0, 120);
            }
            if (!ours) {
                ours = <PlainButton />;
                stats.plain++;
            }
            return <React.Fragment><Guard key={KEY}>{ours}</Guard>{ret}</React.Fragment>;
        })));
    } catch (e: any) {
        stats.error = String(e?.message ?? e).slice(0, 120);
        patchedMemo = null;
    }
}

const onJsx = safe("search screen jsx", (args: any[]) => {
    const t = args[0];
    if (patchedMemo || !t || t.$$typeof !== MEMO) return;
    if (t.type?.name === NAME) patchMemo(t, "jsx");
});

function lookByPath() {
    if (patchedMemo) {
        if (poll) clearInterval(poll);
        poll = null;
        return;
    }
    const mods: any = (globalThis as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const m = mods[id];
        if (m?.__filePath !== PATH) continue;
        if (m.isInitialized) patchMemo(m.publicModule?.exports?.default, "path");
        return;
    }
}

export function startScreenButton() {
    const hook = (args: any[]) => onJsx(args);
    unpatches.push(before("jsx", jsxRuntime, hook));
    unpatches.push(before("jsxs", jsxRuntime, hook));
    poll = setInterval(safe("search screen look", lookByPath), 15000);
}

export function stopScreenButton() {
    if (poll) clearInterval(poll);
    poll = null;
    for (const u of unpatches.splice(0)) {
        try {
            u();
        } catch { }
    }
    patchedMemo = null;
}

export function screenButtonDebug(): string {
    return `search screen button: ${searchSettings.screenButton === false ? "off" : "on"}, ${stats.found ? `patched ${stats.found} (via ${stats.via})` : "discord's filter button not seen yet"}, drawn ${stats.renders} (copy of discord's button ${stats.cloned}, plain ${stats.plain})${stats.error ? `, error ${stats.error}` : ""}${stats.shape ? `, shape ${stats.shape}` : ""}`;
}
