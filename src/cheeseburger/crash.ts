import { hotStatus } from "@api/hot/status";
import { BundleUpdaterManager, getNativeModule, NativeFileModule } from "@api/native/modules";
import { before, instead } from "@api/patcher";
import { FluxDispatcher, React } from "@metro/common";
import { SelectedChannelStore } from "@metro/common/stores";
import { AppState } from "react-native";

import { voiceSettings } from "./voice/storage";
import { volumeBoostSettings } from "./volume/storage";

type Kind = "crash" | "error" | "caught" | "closed" | "gone";

interface Entry { at: number; kind: Kind; what: string; stack?: string; n?: number; }
interface Session {
    started: number;
    beat: number;
    state: string;
    call?: boolean;
    rev: string;
    ended?: string;
    heap?: number;
    peak?: number;
    gains?: string;
    rss?: number;
    rssPeak?: number;
    free?: number;
    threads?: number;
    stuck?: number;
    crumbs?: string[];
}
interface Saved { log: Entry[]; session?: Session; }
interface Memory { rss?: number; peak?: number; threads?: number; free?: number; total?: number; swap?: number; }

const FILE = "rain/cheeseburger-crash.json";
const MAX = 14;
const g = globalThis as any;

let saved: Saved = { log: [] };
let session: Session | null = null;
let beat: ReturnType<typeof setInterval> | null = null;
let appSub: { remove(): void; } | null = null;
let unreload: (() => unknown) | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();
let restoring: Promise<void> = Promise.resolve();
let ready = false;
let waiting = false;
let gen = 0;
let tick: ReturnType<typeof setInterval> | null = null;
let unflux: (() => unknown) | null = null;
let lastTick = 0;
let activeSince = 0;
let lateSeen = 0;
let lastType = "";
let procOk: boolean | null = null;
let memory: Memory | null = null;
const listeners = new Set<() => void>();
const recent = new Map<string, number>();
const stalls: string[] = g.__cheeseburgerStalls ??= [];
const slow: { type: string; ms: number; at: number; }[] = g.__cheeseburgerSlowDispatches ??= [];

const current = () => g.__cheeseburgerCrashGen === gen;

function describe(e: any): string {
    try {
        if (e && typeof e === "object" && "message" in e) return `${e.name ?? "Error"}: ${String(e.message)}`;
        if (typeof e === "string") return e;
        return JSON.stringify(e) ?? String(e);
    } catch {
        return "unknown error";
    }
}

function shortStack(stack: unknown): string | undefined {
    if (typeof stack !== "string") return undefined;
    const out: string[] = [];
    for (const raw of stack.split("\n").slice(1)) {
        const line = raw.trim().replace(/^at\s+/, "");
        if (!line) continue;
        const m = line.match(/^(.*?)\s*\((?:address at\s+)?(.*)\)$/);
        const name = (m ? m[1] : line).trim() || "?";
        const loc = m?.[2].match(/([^/\\]+?):(\d+):(\d+)$/);
        out.push(loc ? `${name}@${loc[1]}:${loc[2]}:${loc[3]}` : name);
        if (out.length >= 8) break;
    }
    return out.length ? out.join(" < ") : undefined;
}

function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
        notifyTimer = null;
        listeners.forEach(l => {
            try {
                l();
            } catch { }
        });
    }, 0);
}

function trim() {
    saved.log.sort((a, b) => a.at - b.at);
    for (const kind of ["gone", "error", "caught", "closed", "crash"] as Kind[]) {
        while (saved.log.length > MAX) {
            const i = saved.log.findIndex(e => e.kind === kind);
            if (i === -1) break;
            saved.log.splice(i, 1);
        }
    }
}

function add(kind: Kind, what: string, stack?: string, at = Date.now()) {
    const i = saved.log.findIndex(x => x.kind === kind && x.what === what);
    if (i !== -1) {
        const [hit] = saved.log.splice(i, 1);
        hit.n = (hit.n ?? 1) + 1;
        hit.at = Math.max(hit.at, at);
        if (stack) hit.stack = stack;
        saved.log.push(hit);
    } else {
        saved.log.push(stack ? { at, kind, what, stack } : { at, kind, what });
    }
    trim();
    notify();
}

function write(): Promise<void> {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    if (!current()) return writing;
    if (!ready) {
        waiting = true;
        return writing;
    }
    const data = JSON.stringify({ log: saved.log, session: session ?? saved.session });
    writing = writing
        .then(() => NativeFileModule.writeFile("documents", FILE, data, "utf8"))
        .then(() => { }, () => { });
    return writing;
}

function soon() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        void write();
    }, 1500);
}

async function load(): Promise<Saved | null> {
    try {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${FILE}`;
        if (!(await NativeFileModule.fileExists(path))) return null;
        const data = JSON.parse(await NativeFileModule.readFile(path, "utf8"));
        return data && Array.isArray(data.log) ? { log: data.log, session: data.session } : null;
    } catch {
        return null;
    }
}

async function androidSaysCrashed(): Promise<boolean | null> {
    try {
        const m: any = getNativeModule("RNSentry");
        if (typeof m?.crashedLastRun !== "function") return null;
        const r = await Promise.race([m.crashedLastRun(), new Promise(res => setTimeout(() => res(null), 1500))]);
        return typeof r === "boolean" ? r : null;
    } catch {
        return null;
    }
}

function describeReport(r: any): string {
    if (r == null) return "";
    if (typeof r === "string") return r.slice(0, 600);
    try {
        const keep: any = {};
        for (const k of Object.keys(r).slice(0, 20)) {
            const v = r[k];
            keep[k] = typeof v === "string" ? v.slice(0, 300) : v;
        }
        return JSON.stringify(keep).slice(0, 900);
    } catch {
        return String(r).slice(0, 300);
    }
}

export async function lastCrashReport(): Promise<string> {
    try {
        const mods: any = g.modules ?? {};
        for (const id of Object.keys(mods)) {
            const m = mods[id];
            if (m?.__filePath !== "utils/SentryUtils.native.tsx" || !m.isInitialized) continue;
            const fn = m.publicModule?.exports?.default?.getLastCrashReport;
            if (typeof fn !== "function") return "no getLastCrashReport";
            const r = await Promise.race([Promise.resolve(fn.call(m.publicModule.exports.default)), new Promise(res => setTimeout(() => res("no answer"), 2000))]);
            return describeReport(r) || "nothing";
        }
        return "sentry utils not loaded";
    } catch (e: any) {
        return `failed: ${String(e?.message ?? e).slice(0, 80)}`;
    }
}

function inCall() {
    try {
        return !!SelectedChannelStore?.getVoiceChannelId?.();
    } catch {
        return false;
    }
}

export function caught(where: string, e: unknown) {
    try {
        const what = `${where}: ${describe(e)}`.slice(0, 300);
        const now = Date.now();
        const last = recent.get(what);
        if (last !== undefined && now - last < 1000) {
            const hit = saved.log.find(x => x.kind === "caught" && x.what === what);
            if (hit) {
                hit.n = (hit.n ?? 1) + 1;
                hit.at = now;
                soon();
                return;
            }
        }
        if (recent.size > 60) recent.clear();
        recent.set(what, now);
        add("caught", what, shortStack((e as any)?.stack), now);
        soon();
    } catch { }
}

export function safe<F extends (...a: any[]) => any>(where: string, fn: F): F {
    return function (this: any, ...args: Parameters<F>) {
        try {
            return fn.apply(this, args);
        } catch (e) {
            caught(where, e);
            return undefined;
        }
    } as F;
}

export function safeInstead(where: string, fn: (args: any[], orig: Function) => any) {
    return function (this: any, args: any[], orig: Function) {
        let state = 0;
        let result: any;
        let error: any;
        const call = function (this: any, ...a: any[]) {
            try {
                result = orig.apply(this, a);
                state = 1;
                return result;
            } catch (e) {
                state = 2;
                error = e;
                throw e;
            }
        };
        try {
            return fn.call(this, args, call);
        } catch (e) {
            if (state === 2 && e === error) throw e;
            caught(where, e);
            if (state === 1) return result;
            if (state === 2) throw error;
            return orig.apply(this, args);
        }
    };
}

function install() {
    const eu = g.ErrorUtils;
    if (typeof eu?.getGlobalHandler !== "function" || typeof eu.setGlobalHandler !== "function") return;
    const slot = g.__cheeseburgerCrash;
    const cur = eu.getGlobalHandler();
    const base = slot && cur === slot.handler ? slot.base : cur;
    const handler = (e: any, fatal?: boolean) => {
        let handed = false;
        const hand = () => {
            if (handed) return;
            handed = true;
            base?.(e, fatal);
        };
        try {
            add(fatal ? "crash" : "error", describe(e).slice(0, 400), shortStack(e?.stack));
            if (!fatal) {
                soon();
                hand();
                return;
            }
            if (session) session.ended = "crash";
            setTimeout(hand, 1200);
            restoring.then(() => write()).then(hand, hand);
        } catch {
            hand();
        }
    };
    g.__cheeseburgerCrash = { base, handler };
    eu.setGlobalHandler(handler);
}

function uninstall() {
    const eu = g.ErrorUtils;
    const slot = g.__cheeseburgerCrash;
    if (!eu || !slot) return;
    if (eu.getGlobalHandler?.() === slot.handler) eu.setGlobalHandler(slot.base);
    delete g.__cheeseburgerCrash;
}

function merge(entries: Entry[]) {
    const keys = new Set<string>();
    return entries.filter(e => {
        if (!e || typeof e.at !== "number" || typeof e.what !== "string") return false;
        const k = `${e.at}|${e.kind}|${e.what}`;
        if (keys.has(k)) return false;
        keys.add(k);
        return true;
    });
}

async function restore(checked: boolean) {
    const early = saved.log;
    const prevSaved = await load();
    if (!current()) return;
    saved = { log: merge([...(prevSaved?.log ?? []), ...early]), session: prevSaved?.session };
    trim();
    const prev = prevSaved?.session;
    if (!checked && prev && !prev.ended) {
        const android = await androidSaysCrashed();
        if (!current()) return;
        const report = await lastCrashReport();
        if (!current()) return;
        const crumbs = [Array.isArray(prev.crumbs) && prev.crumbs.length ? `before it: ${prev.crumbs.slice(-8).join(" | ")}` : "", report && !/^(nothing|sentry utils not loaded)$/.test(report) ? `discord's crash report: ${report}` : ""].filter(Boolean).join("\n    ") || undefined;
        const stuck = typeof prev.stuck === "number" ? `, screen stuck since ${when(prev.stuck)} (android "not responding")` : "";
        if (prev.state === "active" || prev.call || android) {
            const where = prev.state === "active" ? prev.call ? "open in a call" : "open" : prev.call ? "in a call in the background" : "in the background";
            add("closed", `closed while ${where}${stuck}, no error caught (${context(prev, android)})`, crumbs, prev.beat);
        } else if (typeof prev.beat === "number") {
            add("gone", `gone while in the background, reopened ${Math.max(0, Math.round((Date.now() - prev.beat) / 60000))}m later (${context(prev, android)})`, crumbs, prev.beat);
        }
    }
    ready = true;
    waiting = false;
    notify();
    await write();
}

function begin(checked: boolean) {
    restoring = restore(checked).catch(() => {
        if (!current()) return;
        ready = true;
        if (waiting) void write();
    });
}

function heapMb(): number | undefined {
    try {
        const stats = g.HermesInternal?.getInstrumentedStats?.();
        const v = stats?.js_heapSize ?? stats?.js_allocatedBytes;
        return typeof v === "number" && v > 0 ? Math.round(v / 1048576) : undefined;
    } catch {
        return undefined;
    }
}

function gains(): string {
    try {
        const mic = Number(voiceSettings.mic);
        const boosts = Object.values(volumeBoostSettings.boosted ?? {}).map(Number).filter(Number.isFinite);
        return `mic ${Number.isFinite(mic) ? Math.round(mic) : 100}%, boost ${boosts.length ? Math.round(Math.max(...boosts)) : 0}%`;
    } catch {
        return "";
    }
}

const kb = (text: string, key: string) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return m ? Math.round(Number(m[1]) / 1024) : undefined;
};

export async function readMemory(): Promise<Memory | null> {
    if (procOk === false) return null;
    try {
        const status = await NativeFileModule.readFile("/proc/self/status", "utf8");
        if (typeof status !== "string" || !status.includes("VmRSS")) {
            procOk = false;
            return null;
        }
        procOk = true;
        const threads = status.match(/^Threads:\s+(\d+)/m);
        const out: Memory = { rss: kb(status, "VmRSS"), peak: kb(status, "VmHWM"), threads: threads ? Number(threads[1]) : undefined, swap: kb(status, "VmSwap") };
        try {
            const info = await NativeFileModule.readFile("/proc/meminfo", "utf8");
            if (typeof info === "string") {
                out.free = kb(info, "MemAvailable");
                out.total = kb(info, "MemTotal");
            }
        } catch { }
        memory = out;
        return out;
    } catch {
        procOk = false;
        return null;
    }
}

const sampleMemory = () => {
    void readMemory().then(m => {
        if (!m || !session) return;
        if (typeof m.rss === "number") {
            session.rss = m.rss;
            session.rssPeak = Math.max(session.rssPeak ?? 0, m.peak ?? m.rss);
        }
        if (typeof m.free === "number") session.free = m.free;
        if (typeof m.threads === "number") session.threads = m.threads;
    }, () => { });
};

function touch(state?: string) {
    if (!session) return;
    if (state && state !== session.state) crumb(`app ${state === "active" ? "opened" : state}`);
    if (state) session.state = state;
    session.beat = Date.now();
    const call = inCall();
    if (call !== !!session.call) crumb(call ? "joined a call" : "left the call");
    session.call = call;
    const heap = heapMb();
    if (heap !== undefined) {
        session.heap = heap;
        session.peak = Math.max(session.peak ?? 0, heap);
    }
    session.gains = gains();
    sampleMemory();
    void write();
}

function context(prev: Session, android: boolean | null): string {
    const parts = [`sentry ${android === null ? "unknown" : android ? "crash" : "clean"}`];
    if (typeof prev.heap === "number") parts.push(`heap ${prev.heap}mb (peak ${prev.peak ?? prev.heap}mb)`);
    if (typeof prev.rss === "number") parts.push(`app memory ${prev.rss}mb (peak ${prev.rssPeak ?? prev.rss}mb)${typeof prev.free === "number" ? `, phone free ${prev.free}mb` : ""}${typeof prev.threads === "number" ? `, ${prev.threads} threads` : ""}`);
    if (prev.gains) parts.push(prev.gains);
    if (typeof prev.started === "number" && typeof prev.beat === "number") parts.push(`up ${Math.max(0, Math.round((prev.beat - prev.started) / 60000))}m`);
    return parts.join(", ");
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function crumb(line: string) {
    if (!session) return;
    const list = session.crumbs ??= [];
    list.push(`${when(Date.now()).replace(/^\S+ /, "")} ${line}`.slice(0, 100));
    if (list.length > 12) list.splice(0, list.length - 12);
}

function stall(line: string) {
    stalls.push(`${when(Date.now())} ${line}`);
    if (stalls.length > 15) stalls.splice(0, stalls.length - 15);
    crumb(line);
    soon();
}

const onTick = safe("crash tick", () => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    lateSeen = 0;
    if (session && typeof session.stuck === "number") {
        stall(`screen froze ${secs(now - session.stuck)}, js kept running`);
        session.stuck = undefined;
        return;
    }
    if (gap > 2500 && activeSince && now - activeSince > gap + 500 && AppState.currentState === "active") {
        stall(`app froze ${secs(gap - 1000)}${lastType ? ` (last action ${lastType})` : ""}`);
    }
});

const onAppState = safe("crash state", (s: string) => {
    activeSince = s === "active" ? Date.now() : 0;
    touch(s);
});

const timeFlux = safeInstead("crash flux", (args: any[], orig: Function) => {
    const start = Date.now();
    const type = typeof args[0]?.type === "string" ? args[0].type : "";
    if (session && session.stuck === undefined && activeSince && AppState.currentState === "active") {
        const since = Math.max(lastTick, activeSince);
        if (start - since > 1500) {
            if (!lateSeen) lateSeen = start;
            else if (start - lateSeen > 400 && start - since > 4000) {
                session.stuck = since;
                crumb(`screen stuck for ${secs(start - since)} while js still runs`);
                void write();
            }
        }
    }
    if (type) lastType = type;
    const ret = orig(...args);
    const ms = Date.now() - start;
    if (ms >= 400) {
        slow.push({ type: type || "?", ms, at: start });
        if (slow.length > 12) slow.splice(0, slow.length - 12);
        crumb(`${type || "action"} took ${secs(ms)}`);
        soon();
    }
    return ret;
});

function startWatchdog() {
    lastTick = Date.now();
    activeSince = AppState.currentState === "active" ? Date.now() : 0;
    tick = setInterval(onTick, 1000);
    try {
        unflux = instead("dispatch", FluxDispatcher, timeFlux);
    } catch {
        unflux = null;
    }
    sampleMemory();
}

function stopWatchdog() {
    if (tick) clearInterval(tick);
    tick = null;
    try {
        unflux?.();
    } catch { }
    unflux = null;
}

export function watchdogDebug(): string[] {
    const m = memory;
    return [
        `memory: ${m ? `app ${m.rss ?? "?"}mb (peak ${m.peak ?? "?"}mb), ${m.threads ?? "?"} threads, swap ${m.swap ?? "?"}mb, phone free ${m.free ?? "?"} of ${m.total ?? "?"}mb` : procOk === false ? "can't read /proc" : "not read yet"}`,
        `freezes: ${stalls.length ? "" : "none seen"}`,
        ...stalls.map(s => `  ${s}`),
        `slow actions (over 0.4s): ${slow.length ? "" : "none"}`,
        ...slow.map(s => `  ${when(s.at)} ${s.type} ${secs(s.ms)}`),
        `last moments kept for a crash: ${session?.crumbs?.length ? session.crumbs.join(" | ") : "nothing yet"}`.slice(0, 1200),
    ];
}

export function startCrashLog() {
    gen = (g.__cheeseburgerCrashGen ?? 0) + 1;
    g.__cheeseburgerCrashGen = gen;
    install();
    const handoff = g.__cheeseburgerCrashState;
    if (handoff) {
        delete g.__cheeseburgerCrashState;
        saved = handoff.saved;
        session = handoff.session;
        ready = !!handoff.ready;
        if (!ready) begin(true);
        crumb(`cheeseburger updated to ${hotStatus.revision.slice(0, 7)}`);
    } else {
        session = { started: Date.now(), beat: Date.now(), state: AppState.currentState ?? "active", call: inCall(), rev: hotStatus.revision };
        crumb("discord started");
        begin(false);
    }
    beat = setInterval(safe("crash beat", () => {
        if (AppState.currentState === "active") touch();
    }), 30_000);
    appSub = AppState.addEventListener("change", onAppState);
    startWatchdog();
    try {
        if (typeof BundleUpdaterManager?.reload === "function") {
            unreload = before("reload", BundleUpdaterManager, safe("crash reload", () => {
                if (session) session.ended = "reload";
                void write();
            }));
        }
    } catch {
        unreload = null;
    }
}

export function stopCrashLog() {
    if (beat) clearInterval(beat);
    beat = null;
    stopWatchdog();
    appSub?.remove();
    appSub = null;
    try {
        unreload?.();
    } catch { }
    unreload = null;
    if (g.__cheeseburgerSwapping) {
        g.__cheeseburgerCrashState = { saved, session, ready };
        return;
    }
    if (session) session.ended = "stopped";
    const done = write();
    uninstall();
    const snapshot = saved;
    void done.then(() => {
        if (saved === snapshot && !beat) {
            saved = { log: [] };
            session = null;
            ready = false;
        }
    });
}

export function markReload() {
    if (session) session.ended = "reload";
    return write();
}

const two = (n: number) => String(n).padStart(2, "0");

function when(t: number) {
    const d = new Date(t);
    const h = d.getHours();
    return `${d.getMonth() + 1}/${d.getDate()} ${h % 12 || 12}:${two(d.getMinutes())}:${two(d.getSeconds())} ${h < 12 ? "AM" : "PM"}`;
}

const label = (e: Entry) => `${when(e.at)} ${e.kind}${e.n && e.n > 1 ? ` x${e.n}` : ""}: ${e.what}`;

export function crashSummary(): string {
    const last = [...saved.log].reverse().find(e => e.kind !== "error") ?? saved.log[saved.log.length - 1];
    return last ? label(last).slice(0, 90) : "nothing yet";
}

export function useCrashSummary() {
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        listeners.add(force);
        return () => void listeners.delete(force);
    }, []);
    return crashSummary();
}

export function crashDebug(): string[] {
    const heap = heapMb();
    return [
        `crash log, running since ${session ? when(session.started) : "?"}, cheeseburger ${hotStatus.source} ${hotStatus.revision.slice(0, 7)}, heap ${heap ?? "?"}mb (peak ${Math.max(session?.peak ?? 0, heap ?? 0) || "?"}mb)`,
        ...(saved.log.length
            ? [...saved.log].reverse().flatMap(e => [`  ${label(e)}`, ...(e.stack ? [`    ${e.stack}`] : [])])
            : ["  nothing yet"]),
    ];
}

export function lastCrashAt(): number {
    let t = 0;
    for (const e of saved.log) if (e.kind === "crash" || e.kind === "closed") t = Math.max(t, e.at);
    return t;
}
