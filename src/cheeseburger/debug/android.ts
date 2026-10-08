import { getNativeModule, NativeFileModule } from "@api/native/modules";
import { isPluginEnabled, pluginInstances } from "@plugins";

import { lastCrashReport, readMemory } from "../crash";

let lines: string[] = ["not checked yet"];
let running: Promise<void> | null = null;

const MARKERS = ["last_anr_report", ".sentry-native/last_crash", "last_crash", "startup_crash", "session.json", "previous_session.json", ".scope-cache/breadcrumbs.json", ".options-cache/release.json"];
const FOLDERS = [".crashlytics.v3", "bugsnag", "sentry", "logs", "log", "crash", "crashes", "tombstones", "anr"];
const SENTRY_METHODS = ["crashedLastRun", "fetchNativeDeviceContexts", "fetchNativeRelease", "captureEnvelope", "fetchNativeAppStart", "fetchNativeFrames", "initNativeSdk", "fetchNativeSdkInfo", "closeNativeSdk", "fetchViewHierarchy"];
const GUESSES = ["RNSentry"];
const INTERESTING = /exit.?(?:info|reason)|crashed.?last|last.?crash|\banr\b|anr.?(?:info|report)|tombstone|debug.?logs?|upload.?logs?|crash.?report|app.?exit/i;

function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise(resolve => {
        const t = setTimeout(() => resolve(fallback), ms);
        p.then(v => {
            clearTimeout(t);
            resolve(v);
        }, () => {
            clearTimeout(t);
            resolve(fallback);
        });
    });
}

async function exists(path: string): Promise<boolean> {
    try {
        return !!(await within(NativeFileModule.fileExists(path), 1500, false));
    } catch {
        return false;
    }
}

async function read(path: string): Promise<string | null> {
    try {
        const text = await within<string | null>(NativeFileModule.readFile(path, "utf8"), 2500, null);
        return typeof text === "string" ? text : null;
    } catch {
        return null;
    }
}

function stamp(v: unknown): string {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1e12 || n > 4e12) return String(v).slice(0, 60);
    const d = new Date(n);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 8)}`;
}

function describeMarker(name: string, text: string): string {
    const body = text.trim();
    if (name.endsWith(".json")) {
        try {
            const data = JSON.parse(body);
            if (Array.isArray(data)) {
                const last = data.slice(-6).map((b: any) => `${b?.timestamp ?? "?"} ${b?.category ?? b?.type ?? ""} ${String(b?.message ?? "").slice(0, 60)}`.trim());
                return `${data.length} entries, last: ${last.join(" | ")}`;
            }
            if (data && typeof data === "object") {
                const keep = ["status", "abnormal_mechanism", "started", "timestamp", "errors", "duration", "init", "release", "environment"];
                return keep.filter(k => data[k] !== undefined).map(k => `${k}=${JSON.stringify(data[k]).slice(0, 60)}`).join(", ") || `keys ${Object.keys(data).slice(0, 10).join(",")}`;
            }
        } catch { }
        return `${body.length} bytes, not plain json`;
    }
    return `${stamp(body)}${body.length > 40 ? ` (${body.length} bytes)` : ""}`;
}

function nativeModules(): string[] {
    const out: string[] = [];
    for (const name of GUESSES) {
        let m: any;
        try {
            m = getNativeModule(name);
        } catch {
            m = null;
        }
        if (!m) continue;
        const keys = new Set<string>();
        try {
            for (const k in m) keys.add(k);
        } catch { }
        try {
            for (const k of Object.keys(m)) keys.add(k);
        } catch { }
        if (name === "RNSentry") {
            for (const k of SENTRY_METHODS) {
                try {
                    if (typeof m[k] === "function") keys.add(k);
                } catch { }
            }
        }
        out.push(`  native ${name}: ${[...keys].slice(0, 30).join(",") || "found, methods hidden"}`);
    }
    return out.length ? out : ["  no RNSentry native module"];
}

async function sentryRun(): Promise<string> {
    try {
        const m: any = getNativeModule("RNSentry");
        if (typeof m?.crashedLastRun !== "function") return "no RNSentry.crashedLastRun";
        const r = await within<any>(Promise.resolve(m.crashedLastRun()), 2000, "no answer");
        return `RNSentry.crashedLastRun says ${JSON.stringify(r)}`;
    } catch (e) {
        return `RNSentry.crashedLastRun failed (${String((e as any)?.message ?? e).slice(0, 80)})`;
    }
}

function jsHints(): string[] {
    const mods: any = (globalThis as any).modules ?? {};
    const out: string[] = [];
    const until = Date.now() + 400;
    let n = 0;
    for (const id of Object.keys(mods)) {
        if (out.length >= 15) break;
        if (++n % 500 === 0 && Date.now() > until) {
            out.push(`  stopped after ${n} modules to keep the app smooth`);
            break;
        }
        const m = mods[id];
        if (!m?.isInitialized) continue;
        const exp = m.publicModule?.exports;
        if (!exp || typeof exp !== "object" && typeof exp !== "function") continue;
        const hits: string[] = [];
        try {
            for (const k of Object.keys(exp)) if (INTERESTING.test(k)) hits.push(k);
            const d = Object.getOwnPropertyDescriptor(exp, "default");
            const v = d && "value" in d ? d.value : undefined;
            if (v && typeof v === "object") {
                for (const kk of Object.keys(v).slice(0, 80)) if (INTERESTING.test(kk)) hits.push(`default.${kk}`);
            }
        } catch { }
        if (hits.length) out.push(`  ${m.__filePath ?? `module ${id}`}: ${hits.slice(0, 6).join(",")}`);
    }
    return out.length ? out : ["  nothing that looks like exit reasons or crash logs"];
}

async function crashLibs(): Promise<string> {
    const maps = await read("/proc/self/maps");
    if (!maps) return "can't read the loaded libraries";
    const libs = new Set<string>();
    for (const line of maps.split("\n")) {
        const m = line.match(/\/([^/\s]+\.so)\s*$/);
        if (m && /sentry|crashlytics|bugsnag|breakpad|crashpad|acra|unwind|anr/i.test(m[1])) libs.add(m[1]);
    }
    return libs.size ? `crash libraries loaded: ${[...libs].join(", ")}` : "no crash reporting libraries loaded";
}

async function collect(full: boolean): Promise<string[]> {
    const out: string[] = [];
    const mem = await within(readMemory(), 2500, null);
    out.push(mem
        ? `memory now: app ${mem.rss ?? "?"}mb (peak ${mem.peak ?? "?"}mb), ${mem.threads ?? "?"} threads, swap ${mem.swap ?? "?"}mb, phone free ${mem.free ?? "?"} of ${mem.total ?? "?"}mb`
        : "memory now: can't read /proc/self/status");
    const oom = await read("/proc/self/oom_score_adj");
    if (oom != null) out.push(`oom score adj ${oom.trim()} (0 means android treats it as the app on screen)`);
    let consts: any = {};
    try {
        consts = NativeFileModule.getConstants?.() ?? {};
    } catch { }
    const files = String(consts.DocumentsDirPath ?? "");
    const cache = String(consts.CacheDirPath ?? "");
    out.push(`app folders: files ${files ? files.replace(/^\/data\/user\/0\//, "") : "?"}, cache ${cache ? cache.replace(/^\/data\/user\/0\//, "") : "?"}`);
    out.push(await sentryRun());
    out.push(`discord's last crash report: ${await within(lastCrashReport(), 3000, "no answer")}`);
    out.push(...nativeModules());
    for (const base of [cache, files].filter(Boolean)) {
        const found: string[] = [];
        for (const f of FOLDERS) if (await exists(`${base}/${f}`)) found.push(f);
        out.push(`  folders in ${base === cache ? "cache" : "files"}: ${found.join(", ") || "none of the usual crash folders"}`);
        if (!found.includes("sentry")) continue;
        for (const name of MARKERS) {
            const path = `${base}/sentry/${name}`;
            if (!(await exists(path))) continue;
            const text = await read(path);
            out.push(`  sentry ${name}: ${text == null ? "can't read" : describeMarker(name, text)}`);
        }
    }
    if (full) {
        out.push(await crashLibs());
        out.push("discord code that looks crash related:", ...jsHints());
    }
    return out;
}

export function refreshAndroid(full = true): Promise<void> {
    running ??= within(collect(full).then(l => {
        lines = l;
    }, e => {
        lines = [`android check failed: ${String((e as any)?.message ?? e).slice(0, 100)}`];
    }), 12000, undefined).finally(() => {
        running = null;
    });
    return running;
}

export function androidDebug(): string[] {
    return lines;
}

export function pluginList(): string[] {
    const on: string[] = [];
    const off: string[] = [];
    for (const id of pluginInstances.keys()) {
        let enabled = false;
        try {
            enabled = isPluginEnabled(id);
        } catch { }
        (enabled ? on : off).push(id.replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, ""));
    }
    return [`plugins on (${on.length}): ${on.join(", ")}`, `plugins off (${off.length}): ${off.join(", ") || "none"}`];
}
