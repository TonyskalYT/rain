import { instead } from "@api/patcher";
import { findByStoreName } from "@metro";
import { FluxDispatcher } from "@metro/common";

import { caught, safe, safeInstead } from "../crash";
import { volumeBoostSettings } from "../volume/storage";
import { useVoiceSettings, VoiceSettings, voiceSettings } from "./storage";

const G = globalThis as any;
const LAYERS: [RegExp, string, string][] = [
    [/NativeMediaEngineModule\.tsx$/, "default", "native"],
    [/VoiceEngineModule\.android\.tsx$/, "VoiceEngine", "module"],
    [/media-engine\/native\/ios\/VoiceEngine\.tsx$/, "default", "engine"],
];
const RATE_SETTERS = ["setVoiceBitRate", "setBitRate"];
const LOFI_TOP = 24000;
const LOFI_BOTTOM = 8000;

export type LiveKey = "mic" | "drive" | "driveAmount" | "lofi" | "lofiAmount";
type Live = Partial<Pick<VoiceSettings, LiveKey>>;
interface Hook { label: string; obj: any; orig: Function; wrapped: Function; own: boolean; }
interface Handoff { label: string; args: any[]; slot: number; base: number; }
export interface Preset { name: string; values: Live; }

export const PRESETS: Preset[] = [
    { name: "normal", values: { mic: 100, drive: false, lofi: false } },
    { name: "loud", values: { mic: 300, drive: false, lofi: false } },
    { name: "blown out", values: { mic: 150, drive: true, driveAmount: 90, lofi: false } },
    { name: "megaphone", values: { mic: 130, drive: true, driveAmount: 45, lofi: true, lofiAmount: 40 } },
    { name: "radio", values: { mic: 110, drive: true, driveAmount: 20, lofi: true, lofiAmount: 75 } },
    { name: "potato", values: { mic: 100, drive: false, lofi: true, lofiAmount: 100 } },
];

let hook: Hook | null = null;
let lastArgs: any[] | null = null;
let slot = -1;
let base: number | null = null;
let sent: number | null = null;
let calls = 0;
let replays = 0;
let skipped: string[] = [];
let note = "not started";
let agcNote = "";
let rateNote = "";
let running = false;
let live: Live = {};
let ours = 0;
let rateDepth = 0;
let wantAgc = new WeakMap<object, boolean>();
let forced = new WeakSet<object>();
let forcedCount = 0;
let agcTargets = new WeakSet<object>();
let wantRate = new WeakMap<object, number>();
let rateForced = new WeakSet<object>();
let rateHooked = new WeakMap<object, Set<string>>();
let lastRate = new WeakMap<object, number>();
let applyTimer: ReturnType<typeof setTimeout> | null = null;
let lastApply = 0;
const unpatches: (() => unknown)[] = [];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1000) / 1000;
const store = () => findByStoreName("MediaEngineStore");

function mediaEngine(): any {
    try {
        return store()?.getMediaEngine?.();
    } catch {
        return undefined;
    }
}

function exportOf(re: RegExp, key: string): any {
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const p = mods[id]?.__filePath;
        if (typeof p === "string" && re.test(p)) return mods[id].isInitialized ? mods[id].publicModule?.exports?.[key] : undefined;
    }
}

function num(key: "mic" | "driveAmount" | "lofiAmount", fallback: number, max: number): number {
    const v = Number(live[key] ?? voiceSettings[key]);
    return Number.isFinite(v) ? clamp(v, 0, max) : fallback;
}

export const maxMic = () => Math.max(400, Number(volumeBoostSettings.maxPercent) || 1000);
export const driveGain = (amount: number) => Math.pow(10, (6 + 0.26 * clamp(amount, 0, 100)) / 20);
export const micPercent = () => num("mic", 100, maxMic());
export const driveOn = () => !!(live.drive ?? voiceSettings.drive);
export const driveAmount = () => num("driveAmount", 50, 100);
export const lofiOn = () => !!(live.lofi ?? voiceSettings.lofi);
export const lofiAmount = () => num("lofiAmount", 50, 100);
export const lofiBitrate = () => Math.round(LOFI_TOP * Math.pow(LOFI_BOTTOM / LOFI_TOP, lofiAmount() / 100));
export const factor = () => Math.min(200, micPercent() / 100 * (driveOn() ? driveGain(driveAmount()) : 1));

export function summary(s: Partial<VoiceSettings>): string {
    const parts: string[] = [];
    const mic = Number(s.mic);
    if (Number.isFinite(mic) && Math.round(mic) !== 100) parts.push(`mic ${Math.round(mic)}%`);
    if (s.drive) parts.push("distortion");
    if (s.lofi) parts.push("lo-fi");
    return parts.join(" · ") || "off";
}

export function presetOf(s: Partial<VoiceSettings>): string | null {
    for (const p of PRESETS) {
        const v = p.values;
        if (Math.round(Number(s.mic)) !== v.mic || !!s.drive !== !!v.drive || !!s.lofi !== !!v.lofi) continue;
        if (v.drive && Math.round(Number(s.driveAmount)) !== v.driveAmount) continue;
        if (v.lofi && Math.round(Number(s.lofiAmount)) !== v.lofiAmount) continue;
        return p.name;
    }
    return null;
}

function numberSlot(a: any[]): number {
    for (let i = a.length - 1; i >= 0; i--) if (typeof a[i] === "number" && Number.isFinite(a[i])) return i;
    return -1;
}

function scaled(a: any[]): any[] {
    calls++;
    const i = numberSlot(a);
    if (i < 0) return a;
    lastArgs = [...a];
    slot = i;
    base = a[i];
    if (!running) return a;
    const out = [...a];
    out[i] = a[i] * factor();
    sent = out[i];
    note = "discord set it";
    return out;
}

function install(): boolean {
    if (hook) return true;
    const candidates: [any, string][] = [...LAYERS.map(([re, key, label]) => [exportOf(re, key), label] as [any, string]), [mediaEngine(), "top"]];
    const tried = new Set<any>();
    for (const [obj, label] of candidates) {
        if (!obj || tried.has(obj) || skipped.some(s => s.startsWith(`${label} `))) continue;
        tried.add(obj);
        let orig: any;
        try {
            orig = obj.setInputVolume;
        } catch {
            continue;
        }
        if (typeof orig !== "function") continue;
        const own = Object.prototype.hasOwnProperty.call(obj, "setInputVolume");
        const wrapped = function (this: any, ...a: any[]) {
            let args = a;
            try {
                args = scaled(a);
            } catch (e) {
                caught("mic scale", e);
            }
            return orig.apply(this, args);
        };
        try {
            obj.setInputVolume = wrapped;
        } catch { }
        let ok = false;
        try {
            ok = obj.setInputVolume === wrapped;
        } catch { }
        if (!ok) {
            skipped.push(`${label} (blocked)`);
            continue;
        }
        hook = { label, obj, orig, wrapped, own };
        const handoff: Handoff | undefined = G.__cheeseburgerMic;
        if (base == null && handoff?.label === label && Array.isArray(handoff.args) && Number.isFinite(handoff.base)) {
            lastArgs = handoff.args;
            slot = handoff.slot;
            base = handoff.base;
        }
        return true;
    }
    return false;
}

function uninstall(restore: boolean) {
    const h = hook;
    hook = null;
    if (!h) return;
    if (restore && lastArgs && slot >= 0 && base != null && sent != null && sent !== base) {
        try {
            const a = [...lastArgs];
            a[slot] = base;
            h.orig.apply(h.obj, a);
            sent = base;
        } catch (e) {
            caught("mic restore", e);
        }
    }
    try {
        if (h.obj.setInputVolume === h.wrapped) {
            if (h.own) h.obj.setInputVolume = h.orig;
            else delete h.obj.setInputVolume;
        }
    } catch { }
}

function replay(): "seen" | "unseen" | "unavailable" {
    const engine = mediaEngine();
    let v: any;
    try {
        v = store()?.getInputVolume?.();
    } catch { }
    if (typeof engine?.setInputVolume !== "function" || typeof v !== "number" || !Number.isFinite(v)) return "unavailable";
    const before = calls;
    try {
        engine.setInputVolume(v);
    } catch (e) {
        caught("mic replay", e);
        return "unavailable";
    }
    replays++;
    return calls > before ? "seen" : "unseen";
}

function applyGain() {
    if (!running) return;
    if (!install()) {
        note = "no setInputVolume found";
        return;
    }
    if (lastArgs && slot >= 0 && base != null) {
        const a = [...lastArgs];
        a[slot] = base * factor();
        try {
            hook!.orig.apply(hook!.obj, a);
            sent = a[slot];
            note = "applied";
        } catch (e) {
            caught("mic apply", e);
        }
        return;
    }
    for (let i = 0; i < 4 && hook; i++) {
        const r = replay();
        if (r === "seen") {
            note = "applied after replay";
            return;
        }
        if (r === "unavailable") {
            note = "waiting for discord to set the mic once";
            return;
        }
        skipped.push(`${hook.label} (bypassed)`);
        uninstall(false);
        if (!install()) {
            note = "every layer was bypassed";
            return;
        }
    }
}

function connContext(conn: any): string {
    const c = conn?.context ?? conn?.mediaContext ?? conn?._context;
    if (typeof c === "string") return c;
    if (conn?.streamUserId != null || conn?.isStream || conn?.streamKey != null) return "stream";
    return "default";
}

function eachConnection(cb: (conn: any) => void): boolean {
    const engine = mediaEngine();
    if (typeof engine?.eachConnection !== "function") return false;
    engine.eachConnection((conn: any) => {
        try {
            cb(conn);
        } catch (e) {
            caught("mic connection", e);
        }
    });
    return true;
}

function hookAgc(conn: any) {
    const proto = Object.getPrototypeOf(conn);
    const target = proto && typeof proto.setAutomaticGainControl === "function" ? proto : conn;
    if (typeof target?.setAutomaticGainControl !== "function" || agcTargets.has(target)) return;
    agcTargets.add(target);
    unpatches.push(instead("setAutomaticGainControl", target, safeInstead("mic agc", function (this: any, args: any[], orig: Function) {
        if (typeof args[0] !== "boolean" || connContext(this) !== "default") return orig.apply(this, args);
        if (!ours) wantAgc.set(this, args[0]);
        return orig.apply(this, running && driveOn() ? [false, ...args.slice(1)] : args);
    })));
}

function storeAgc(): boolean | undefined {
    try {
        const v = store()?.getAutomaticGainControl?.();
        return typeof v === "boolean" ? v : undefined;
    } catch {
        return undefined;
    }
}

function ourCall(fn: () => void) {
    ours++;
    try {
        fn();
    } finally {
        ours--;
    }
}

function applyAgc() {
    let seen = 0;
    let able = 0;
    const found = eachConnection(conn => {
        if (connContext(conn) !== "default") return;
        seen++;
        hookAgc(conn);
        if (typeof conn.setAutomaticGainControl !== "function") return;
        able++;
        if (running && driveOn()) {
            if (forced.has(conn)) return;
            ourCall(() => conn.setAutomaticGainControl(false));
            forced.add(conn);
            forcedCount++;
            return;
        }
        if (!forced.has(conn)) return;
        forced.delete(conn);
        forcedCount = Math.max(0, forcedCount - 1);
        const want = wantAgc.get(conn) ?? storeAgc();
        if (typeof want === "boolean") ourCall(() => conn.setAutomaticGainControl(want));
    });
    agcNote = !found ? "no media engine" : !seen ? "no call" : !able ? "connection has no setAutomaticGainControl" : running && driveOn() ? `forced off on ${seen} connection${seen === 1 ? "" : "s"}` : "left to discord";
}

const rateFor = (want: number) => (want < 1000 ? lofiBitrate() / 1000 : lofiBitrate());

function hookRate(conn: any) {
    const proto = Object.getPrototypeOf(conn);
    for (const name of RATE_SETTERS) {
        const target = proto && typeof proto[name] === "function" ? proto : conn;
        if (typeof target?.[name] !== "function") continue;
        let names = rateHooked.get(target);
        if (!names) rateHooked.set(target, names = new Set());
        if (names.has(name)) continue;
        names.add(name);
        unpatches.push(instead(name, target, safeInstead("mic bitrate", function (this: any, args: any[], orig: Function) {
            const v = args[0];
            if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || connContext(this) !== "default") return orig.apply(this, args);
            if (!ours && rateDepth === 0) wantRate.set(this, v);
            rateDepth++;
            try {
                return orig.apply(this, running && lofiOn() ? [Math.min(v, rateFor(v)), ...args.slice(1)] : args);
            } finally {
                rateDepth--;
            }
        })));
    }
}

function rateSetter(conn: any): string | null {
    for (const name of RATE_SETTERS) if (typeof conn?.[name] === "function") return name;
    return null;
}

function applyLofi() {
    let seen = 0;
    let setterName = "";
    const found = eachConnection(conn => {
        if (connContext(conn) !== "default") return;
        seen++;
        hookRate(conn);
        const setter = rateSetter(conn);
        if (!setter) return;
        setterName = setter;
        if (running && lofiOn()) {
            if (!wantRate.has(conn)) {
                const current = Number(conn.voiceBitrate);
                wantRate.set(conn, Number.isFinite(current) && current > 0 ? current : 64000);
            }
            const want = wantRate.get(conn)!;
            const target = Math.min(want, rateFor(want));
            rateForced.add(conn);
            if (lastRate.get(conn) === target) return;
            ourCall(() => conn[setter](want));
            lastRate.set(conn, target);
            return;
        }
        if (!rateForced.has(conn)) return;
        rateForced.delete(conn);
        lastRate.delete(conn);
        const want = wantRate.get(conn);
        if (typeof want === "number") ourCall(() => conn[setter](want));
    });
    rateNote = !found ? "no media engine" : !seen ? "no call" : !setterName ? "connection has no bitrate setter" : running && lofiOn() ? `${setterName} capped at ${lofiBitrate()}` : "left to discord";
}

function applyAllNow() {
    try {
        applyGain();
    } catch (e) {
        caught("mic apply", e);
    }
    try {
        applyAgc();
    } catch (e) {
        caught("mic agc apply", e);
    }
    try {
        applyLofi();
    } catch (e) {
        caught("mic lofi apply", e);
    }
}

export const applyMic = applyAllNow;

function schedule() {
    const now = Date.now();
    if (now - lastApply >= 60) {
        lastApply = now;
        applyAllNow();
        return;
    }
    if (applyTimer) return;
    applyTimer = setTimeout(safe("mic apply timer", () => {
        applyTimer = null;
        lastApply = Date.now();
        applyAllNow();
    }), 60);
}

export function setLive(next: Live) {
    live = { ...live, ...next };
    schedule();
}

function save(values: Live) {
    try {
        useVoiceSettings.getState().updateSettings(values);
    } catch (e) {
        caught("voice save", e);
    }
}

export function commitLive(key: LiveKey, value: number | boolean) {
    save({ [key]: value } as Live);
    const next = { ...live };
    delete next[key];
    live = next;
}

export function setSwitch(key: "drive" | "lofi", on: boolean) {
    live = { ...live, [key]: on };
    applyAllNow();
    commitLive(key, on);
}

export function applyPreset(values: Live) {
    save(values);
    live = {};
    applyAllNow();
}

export function resetVoice() {
    applyPreset({ mic: 100, drive: false, driveAmount: 50, lofi: false, lofiAmount: 50 });
}

const onRtc = safe("mic rtc", (e: any) => {
    if (e?.state !== "RTC_CONNECTED") return;
    setTimeout(safe("mic rtc apply", () => {
        if (running) applyAllNow();
    }), 400);
});

export function startMic() {
    running = true;
    note = "starting";
    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", onRtc);
    unpatches.push(() => FluxDispatcher.unsubscribe("RTC_CONNECTION_STATE", onRtc));
    applyAllNow();
}

export function stopMic() {
    running = false;
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = null;
    try {
        applyAgc();
    } catch (e) {
        caught("mic agc restore", e);
    }
    try {
        applyLofi();
    } catch (e) {
        caught("mic lofi restore", e);
    }
    if (G.__cheeseburgerSwapping && hook && lastArgs && base != null) G.__cheeseburgerMic = { label: hook.label, args: lastArgs, slot, base } satisfies Handoff;
    else G.__cheeseburgerMic = undefined;
    uninstall(true);
    for (const u of unpatches.splice(0)) {
        try {
            u();
        } catch { }
    }
    wantAgc = new WeakMap();
    forced = new WeakSet();
    agcTargets = new WeakSet();
    wantRate = new WeakMap();
    rateForced = new WeakSet();
    rateHooked = new WeakMap();
    lastRate = new WeakMap();
    forcedCount = 0;
    rateDepth = 0;
    live = {};
    skipped = [];
    lastArgs = null;
    slot = -1;
    base = sent = null;
    note = "stopped";
}

export function micDebug(): string[] {
    const s = store();
    const get = (n: string) => {
        try {
            const f = s?.[n];
            return typeof f === "function" ? String(f.call(s)) : "-";
        } catch {
            return "err";
        }
    };
    const rates: string[] = [];
    eachConnection(conn => {
        if (connContext(conn) === "default") rates.push(`now ${String(conn.voiceBitrate)}, discord wants ${String(wantRate.get(conn) ?? "-")}`);
    });
    return [
        `mic ${micPercent()}%, distortion ${driveOn() ? `on ${driveAmount()}% (x${round(driveGain(driveAmount()))})` : "off"}, lo-fi ${lofiOn() ? `on ${lofiAmount()}% (${lofiBitrate()} bps)` : "off"}, total x${round(factor())}`,
        `mic hook ${hook ? `${hook.label}.setInputVolume` : "none"}${skipped.length ? `, skipped ${skipped.join(", ")}` : ""}, discord sent ${base == null ? "-" : round(base)} (${calls} calls), we sent ${sent == null ? "-" : round(sent)}, replays ${replays}, ${note}`,
        `discord input volume ${get("getInputVolume")}, agc ${get("getAutomaticGainControl")}, noise ${get("getNoiseSuppression")}, krisp ${get("getNoiseCancellation")}, echo ${get("getEchoCancellation")}, mode ${get("getMode")}`,
        `agc override: ${agcNote || "idle"}${forcedCount ? `, forced ${forcedCount}` : ""}`,
        `bitrate: ${rateNote || "idle"}${rates.length ? `, ${rates.join("; ")}` : ""}`,
    ];
}
