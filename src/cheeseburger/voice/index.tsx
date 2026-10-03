import { after } from "@api/patcher";
import { jsxRuntime } from "@api/react/jsx";
import { waitForHydration } from "@api/storage";
import { React } from "@metro/common";

import { caught, safe } from "../crash";
import { micDebug, startMic, stopMic } from "./mic";
import { voiceProbeDebug } from "./probe";
import { noteSlider, resetSection, Section, sectionDebug } from "./Section";
import { useVoiceSettings } from "./storage";

const ROWS = /\/VoicePanelVoiceControlsButtons\.tsx$/;
const KEY = "cheeseburger-voice";
const G = globalThis as any;
const shells: Set<() => void> = G.__cheeseburgerVoiceShells ??= new Set();
const unpatches: (() => unknown)[] = [];

let rowTypes: Set<any> | null = null;
let chatType: any = null;
let lookTimer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let placed = 0;
let group = "";
let failures = 0;
let lastError = "";

class Shell extends React.Component<{}, { failed: boolean; n: number; }> {
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
        failures++;
        lastError = String(e?.message ?? e).slice(0, 120);
        caught("voice section", e);
    }

    render() {
        if (this.state.failed) return null;
        const Impl = G.__cheeseburgerVoiceImpl?.Section;
        return Impl ? React.createElement(Impl) : null;
    }
}

function bumpShells() {
    for (const bump of [...shells]) {
        try {
            bump();
        } catch { }
    }
}

function loadRows(): boolean {
    if (rowTypes) return true;
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const m = mods[id];
        const p = m?.__filePath;
        if (typeof p !== "string" || !ROWS.test(p) || !m.isInitialized) continue;
        const exp = m.publicModule?.exports;
        if (!exp) return false;
        const set = new Set<any>();
        for (const k of Object.keys(exp)) {
            const v = exp[k];
            if (typeof v === "function" || v && typeof v === "object" && v.$$typeof) set.add(v);
        }
        chatType = exp.ChatButton ?? null;
        if (set.size) rowTypes = set;
        return !!rowTypes;
    }
    return false;
}

function look(tries: number) {
    lookTimer = null;
    if (loadRows() || tries > 120) return;
    lookTimer = setTimeout(safe("voice look", () => look(tries + 1)), 2500);
}

const nameOf = (type: any): string => typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name ?? "";

function rows(ch: any, set: Set<any>, depth = 0): number {
    if (ch == null || typeof ch !== "object") return 0;
    if (Array.isArray(ch)) {
        let n = 0;
        for (const c of ch) n += rows(c, set, depth);
        return n;
    }
    if (chatType != null && ch.type === chatType) return 10;
    if (set.has(ch.type)) return 1;
    if (ch.type === React.Fragment && depth < 2) return rows(ch.props?.children, set, depth + 1);
    return 0;
}

function describe(el: any): string {
    const ch = el?.props?.children;
    const list = (Array.isArray(ch) ? ch : [ch]).filter(c => c && typeof c === "object").slice(0, 12).map((c: any) => {
        if (c.type === React.Fragment) return `[${(Array.isArray(c.props?.children) ? c.props.children : [c.props?.children]).filter(Boolean).map((x: any) => nameOf(x?.type) || "?").join("+")}]`;
        return nameOf(c.type) || (typeof c.props?.label === "string" ? `"${c.props.label}"` : "?");
    });
    const keys = Object.keys(el?.props ?? {}).filter(k => k !== "children").slice(0, 8).join(",");
    return `${nameOf(el?.type) || "?"} {${keys}} with ${list.join(", ")}`;
}

let lastLoad = 0;

function afterJsx(args: any[], ret: any) {
    const props = args[1];
    if (props && typeof props === "object" && "maximumValue" in props) noteSlider(args[0], props);
    if (!rowTypes && typeof args[0] === "function" && /^(?:ChatButton|VideoButton|ScreenshareButton)$/.test(args[0].name)) {
        const now = Date.now();
        if (now - lastLoad > 2000) {
            lastLoad = now;
            loadRows();
        }
    }
    const set = rowTypes;
    if (!set || busy || !ret || typeof ret !== "object" || ret.key === KEY || ret.type === React.Fragment || set.has(ret.type)) return;
    const ch = ret.props?.children;
    if (ch == null || typeof ch !== "object" || rows(ch, set) < 2) return;
    busy = true;
    Promise.resolve().then(() => {
        busy = false;
    });
    placed++;
    group = describe(ret);
    return React.createElement(React.Fragment, { key: ret.key ?? undefined }, ret, React.createElement(Shell, { key: KEY }));
}

export function voiceDebug(): string[] {
    return [
        ...micDebug(),
        `section: rows ${rowTypes ? `found (${rowTypes.size})` : "not yet"}, placed ${placed}, showing ${shells.size}${failures ? `, failed ${failures} (${lastError})` : ""}`,
        `group: ${group || "not seen yet"}`,
        ...sectionDebug(),
        ...voiceProbeDebug(),
    ];
}

export default {
    async start() {
        await waitForHydration(useVoiceSettings);
        G.__cheeseburgerVoiceImpl = { Section };
        bumpShells();
        look(0);
        const hook = safe("voice jsx", afterJsx);
        unpatches.push(after("jsx", jsxRuntime, hook));
        unpatches.push(after("jsxs", jsxRuntime, hook));
        startMic();
    },
    stop() {
        if (lookTimer) clearTimeout(lookTimer);
        lookTimer = null;
        for (const u of unpatches.splice(0)) {
            try {
                u();
            } catch { }
        }
        stopMic();
        rowTypes = null;
        chatType = null;
        lastLoad = 0;
        busy = false;
        resetSection();
        if (!G.__cheeseburgerSwapping) {
            G.__cheeseburgerVoiceImpl = null;
            bumpShells();
        }
    },
};
