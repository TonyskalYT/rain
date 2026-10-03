import { instead } from "@api/patcher";
import { findByStoreName } from "@metro";
import { FluxDispatcher } from "@metro/common";

import { caught, safe, safeInstead } from "../crash";
import { volumeBoostSettings } from "../volume/storage";
import { useVoiceSettings, voiceSettings } from "./storage";

const G = globalThis as any;
const LAYERS: [RegExp, string, string][] = [
    [/NativeMediaEngineModule\.tsx$/, "default", "native"],
    [/VoiceEngineModule\.android\.tsx$/, "VoiceEngine", "module"],
    [/media-engine\/native\/ios\/VoiceEngine\.tsx$/, "default", "engine"],
];

interface Hook { label: string; obj: any; orig: Function; wrapped: Function; own: boolean; }
interface Live { mic?: number; drive?: boolean; amount?: number; }
interface Handoff { label: string; args: any[]; slot: number; base: number; }

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
let running = false;
let live: Live = {};
let ours = 0;
let wantAgc = new WeakMap<object, boolean>();
let forced = new WeakSet<object>();
let forcedCount = 0;
let agcTargets = new WeakSet<object>();
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

export const maxMic = () => Math.max(400, Number(volumeBoostSettings.maxPercent) || 1000);
export const driveGain = (amount: number) => Math.pow(10, (6 + 0.26 * clamp(amount, 0, 100)) / 20);

export function micPercent(): number {
    const m = Number(live.mic ?? voiceSettings.mic);
    return Number.isFinite(m) ? clamp(m, 0, maxMic()) : 100;
}

export const driveOn = () => !!(live.drive ?? voiceSettings.drive);

export function driveAmount(): number {
    const a = Number(live.amount ?? voiceSettings.driveAmount);
    return Number.isFinite(a) ? clamp(a, 0, 100) : 50;
}

export const factor = () => Math.min(200, micPercent() / 100 * (driveOn() ? driveGain(driveAmount()) : 1));

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

function applyNow() {
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

export function applyMic() {
    try {
        applyNow();
    } catch (e) {
        caught("mic apply", e);
    }
}

function schedule() {
    const now = Date.now();
    if (now - lastApply >= 60) {
        lastApply = now;
        applyMic();
        return;
    }
    if (applyTimer) return;
    applyTimer = setTimeout(safe("mic apply timer", () => {
        applyTimer = null;
        lastApply = Date.now();
        applyMic();
    }), 60);
}

export function setLive(next: Live) {
    live = { ...live, ...next };
    schedule();
}

export function commitLive(key: keyof Live, value: number | boolean) {
    const field = key === "amount" ? "driveAmount" : key;
    try {
        useVoiceSettings.getState().updateSettings({ [field]: value } as any);
    } catch (e) {
        caught("voice save", e);
    }
    const next = { ...live };
    delete next[key];
    live = next;
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

function setAgc(conn: any, value: boolean) {
    ours++;
    try {
        conn.setAutomaticGainControl(value);
    } finally {
        ours--;
    }
}

export function applyAgc() {
    try {
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
                setAgc(conn, false);
                forced.add(conn);
                forcedCount++;
                return;
            }
            if (!forced.has(conn)) return;
            forced.delete(conn);
            forcedCount = Math.max(0, forcedCount - 1);
            const want = wantAgc.get(conn) ?? storeAgc();
            if (typeof want === "boolean") setAgc(conn, want);
        });
        agcNote = !found ? "no media engine" : !seen ? "no call" : !able ? "connection has no setAutomaticGainControl" : running && driveOn() ? `forced off on ${seen} connection${seen === 1 ? "" : "s"}` : "left to discord";
    } catch (e) {
        caught("mic agc apply", e);
    }
}

export function setDrive(on: boolean) {
    live = { ...live, drive: on };
    applyMic();
    applyAgc();
    commitLive("drive", on);
}

const onRtc = safe("mic rtc", (e: any) => {
    if (e?.state !== "RTC_CONNECTED") return;
    setTimeout(safe("mic rtc apply", () => {
        if (!running) return;
        applyAgc();
        applyMic();
    }), 400);
});

export function startMic() {
    running = true;
    note = "starting";
    FluxDispatcher.subscribe("RTC_CONNECTION_STATE", onRtc);
    unpatches.push(() => FluxDispatcher.unsubscribe("RTC_CONNECTION_STATE", onRtc));
    applyMic();
    applyAgc();
}

export function stopMic() {
    running = false;
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = null;
    applyAgc();
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
    forcedCount = 0;
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
    return [
        `mic ${micPercent()}%, distortion ${driveOn() ? `on ${driveAmount()}% (x${round(driveGain(driveAmount()))})` : "off"}, total x${round(factor())}`,
        `mic hook ${hook ? `${hook.label}.setInputVolume` : "none"}${skipped.length ? `, skipped ${skipped.join(", ")}` : ""}, discord sent ${base == null ? "-" : round(base)} (${calls} calls), we sent ${sent == null ? "-" : round(sent)}, replays ${replays}, ${note}`,
        `discord input volume ${get("getInputVolume")}, agc ${get("getAutomaticGainControl")}, noise ${get("getNoiseSuppression")}, krisp ${get("getNoiseCancellation")}, echo ${get("getEchoCancellation")}, mode ${get("getMode")}`,
        `agc override: ${agcNote || "idle"}${forcedCount ? `, forced ${forcedCount}` : ""}`,
    ];
}
