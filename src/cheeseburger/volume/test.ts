import { showToast } from "@api/ui/toasts";
import { findByStoreName } from "@metro";

import { caught, safe } from "../crash";
import { micPercent, rawInput } from "../voice/mic";
import { readRoute } from "./route";
import { short } from "./trail";

interface Entry { path: string; obj: any; }
interface Sample { value: number; phase: number; fields: Record<string, number>; at: number; }
interface TestLog { running: string | null; output: string[]; input: string[]; }

const G = globalThis as any;
const log: TestLog = G.__cheeseburgerVolumeTest ??= { running: null, output: [], input: [] };
const WANTED = /level|energy|duration|volume|gain|power|rms|peak|speech|voice|loud|db/i;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(safe("volume test wait", () => resolve()), ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const times = (v: number) => `x${short(v)}`;
const shortId = (v: any) => (typeof v === "string" && v.length > 8 ? `…${v.slice(-4)}` : String(v));

function engine(): any {
    try {
        return findByStoreName("MediaEngineStore")?.getMediaEngine?.();
    } catch {
        return undefined;
    }
}

function context(conn: any): string {
    const c = conn?.context ?? conn?.mediaContext ?? conn?._context;
    if (typeof c === "string") return c;
    if (conn?.streamUserId != null || conn?.isStream || conn?.streamKey != null) return "stream";
    return "default";
}

function defaultConnection(): any {
    let found: any = null;
    try {
        engine()?.eachConnection?.((conn: any) => {
            if (!found && context(conn) === "default") found = conn;
        });
    } catch { }
    return found;
}

function nativeModule(): any {
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const p = mods[id]?.__filePath;
        if (typeof p === "string" && /NativeMediaEngineModule\.tsx$/.test(p)) return mods[id].isInitialized ? mods[id].publicModule?.exports?.default : undefined;
    }
}

function settle<T>(start: (done: (v: T | null) => void) => void, ms = 1500): Promise<T | null> {
    return new Promise(resolve => {
        let done = false;
        const finish = safe("volume test stats", (v: any) => {
            if (done) return;
            done = true;
            resolve(v ?? null);
        });
        try {
            start(finish);
        } catch {
            finish(null);
        }
        setTimeout(safe("volume test timeout", () => finish(null)), ms);
    });
}

function viaPromiseOrCallback(call: (cb: (v: any) => void) => any, done: (v: any) => void) {
    const r = call(done);
    if (r && typeof r.then === "function") r.then(done, () => done(null));
    else if (r != null && typeof r !== "undefined") done(r);
}

const fromConnection = (conn: any) => settle<any>(done => viaPromiseOrCallback(cb => conn.getStats(cb), done));

function connId(conn: any): number | null {
    const raw = conn?.mediaEngineConnectionId;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const m = /(\d+)\s*$/.exec(String(raw ?? ""));
    return m ? Number(m[1]) : null;
}

function fromNative(conn: any): Promise<any> {
    const native = nativeModule();
    const id = connId(conn);
    if (typeof native?.connectionInstanceGetStats !== "function" || id == null) return Promise.resolve(null);
    return settle<any>(done => {
        try {
            viaPromiseOrCallback(cb => native.connectionInstanceGetStats(id, cb), done);
        } catch {
            viaPromiseOrCallback(() => native.connectionInstanceGetStats(id), done);
        }
    });
}

function normalize(v: any, depth = 0): any {
    if (depth === 0 && typeof v === "string") {
        try {
            return normalize(JSON.parse(v), 1);
        } catch {
            return v;
        }
    }
    if (!v || typeof v !== "object" || depth > 9) return v;
    if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), normalize(x, depth + 1)]));
    if (Array.isArray(v)) return v.map(x => normalize(x, depth + 1));
    if (typeof v.forEach === "function" && typeof v.get === "function" && typeof v.has === "function") {
        const o: any = {};
        try {
            v.forEach((x: any, k: any) => {
                o[String(k)] = normalize(x, depth + 1);
            });
        } catch { }
        return o;
    }
    const o: any = {};
    for (const k of Object.keys(v).slice(0, 120)) o[k] = normalize(v[k], depth + 1);
    return o;
}

const LEVEL = /level|energy|loud|rms|power|volume|gain|peak|db/i;

function walk(v: any, path: string[], out: Entry[], depth: number) {
    if (!v || typeof v !== "object" || depth > 8 || out.length > 60) return;
    if (!Array.isArray(v) && Object.keys(v).some(k => LEVEL.test(k) && typeof v[k] === "number")) out.push({ path: path.join("."), obj: v });
    for (const k of Object.keys(v).slice(0, 120)) walk(v[k], [...path, k], out, depth + 1);
}

function numericNames(v: any, out: Set<string>, depth = 0) {
    if (!v || typeof v !== "object" || depth > 8 || out.size > 60) return;
    for (const k of Object.keys(v).slice(0, 120)) {
        if (typeof v[k] === "number") out.add(k);
        else numericNames(v[k], out, depth + 1);
    }
}

function numbers(obj: any): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of Object.keys(obj ?? {})) {
        const v = obj[k];
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
        else if (v && typeof v === "object" && !Array.isArray(v)) {
            for (const k2 of Object.keys(v)) if (typeof v[k2] === "number" && Number.isFinite(v[k2])) out[`${k}.${k2}`] = v[k2];
        }
    }
    return out;
}

function shape(v: any, depth = 0): string {
    if (Array.isArray(v)) return `[${v.length}${v.length ? ` ${shape(v[0], depth + 1)}` : ""}]`;
    if (!v || typeof v !== "object") return typeof v;
    if (depth > 3) return "{…}";
    return `{${Object.keys(v).slice(0, 12).map(k => `${k.length > 12 ? short(k) : k}:${shape(v[k], depth + 1)}`).join(",")}}`;
}

const label = (e: Entry) => `${e.path.split(".").map(p => (p.length > 12 ? short(p) : p)).join(".")}${e.obj.type ? ` type=${e.obj.type}` : ""}${e.obj.kind ? ` kind=${e.obj.kind}` : ""}${e.obj.ssrc != null ? ` ssrc=${e.obj.ssrc}` : ""}`;

function pick(entries: Entry[], mode: "inbound" | "outbound", userId: string, ssrc: any): Entry | null {
    const video = (e: Entry) => e.obj.type === "video" || e.obj.kind === "video" || /video/i.test(e.path);
    const pool = entries.filter(e => !video(e));
    const bySsrc = pool.find(e => ssrc != null && String(e.obj.ssrc) === String(ssrc));
    if (bySsrc) return bySsrc;
    if (mode === "inbound") {
        const mine = pool.find(e => userId && (e.path.includes(userId) || String(e.obj.userId ?? e.obj.user_id ?? "") === userId));
        if (mine) return mine;
        const incoming = pool.filter(e => /inbound|recv|receive|remote/i.test(e.path) || /inbound|remote/i.test(String(e.obj.type ?? "")));
        return incoming.length === 1 ? incoming[0] : null;
    }
    return pool.find(e => /outbound|send|local|media-source|sender|input/i.test(e.path) || /outbound|media-source|local/i.test(String(e.obj.type ?? ""))) ?? null;
}

interface Plan { failed?: string; title: string; values: number[]; set: (v: number) => string | null; restore: () => void; mode: "inbound" | "outbound"; userId: string; ssrc: () => any; }

async function measure(conn: any, plan: Plan, lines: string[]): Promise<Sample[]> {
    const samples: Sample[] = [];
    let source: "connection" | "native" | null = null;
    let entry: Entry | null = null;
    for (const [phase, value] of plan.values.entries()) {
        const err = plan.set(value);
        if (err) {
            lines.push(`  couldn't set ${times(value)}: ${err}`);
            plan.failed = err;
            return samples;
        }
        await sleep(400);
        for (let i = 0; i < 6; i++) {
            let hit: Entry | null = null;
            const order: ("connection" | "native")[] = source ? [source] : ["connection", "native"];
            for (const which of order) {
                const raw = which === "connection" ? await fromConnection(conn) : await fromNative(conn);
                const stats = normalize(raw);
                const entries: Entry[] = [];
                walk(stats, [], entries, 0);
                const found = pick(entries, plan.mode, plan.userId, plan.ssrc());
                if (!source && phase === 0 && i === 0) {
                    lines.push(`  ${which} stats: ${raw == null ? "nothing came back" : `${typeof raw === "string" ? "text " : ""}${shape(stats)}`}`.slice(0, 900));
                    if (raw != null) {
                        const names = new Set<string>();
                        numericNames(stats, names);
                        lines.push(`  ${which} number fields: ${[...names].join(",") || "none"}`.slice(0, 700));
                        lines.push(`  ${which} level entries: ${entries.slice(0, 8).map(label).join(" | ") || "none"}`.slice(0, 700));
                    }
                }
                if (found) {
                    source = which;
                    hit = found;
                    break;
                }
            }
            if (hit) {
                if (!entry) {
                    entry = hit;
                    lines.push(`  using ${source} ${label(hit)}: ${Object.keys(numbers(hit.obj)).join(",").slice(0, 400)}`);
                }
                samples.push({ value, phase, fields: numbers(hit.obj), at: Date.now() });
            }
            await sleep(150);
        }
    }
    if (!entry) lines.push(`  no ${plan.mode === "inbound" ? "incoming audio for that person" : "outgoing audio"} with a level in either stats source`);
    return samples;
}

function rank(f: string) {
    if (/(^|\.)audioLevel$/i.test(f)) return 0;
    if (/level/i.test(f) && !/total|energy|duration/i.test(f)) return 1;
    if (/energy/i.test(f) && !/duration/i.test(f)) return 2;
    return 3;
}

type Round = [number | null, number | null, number | null];
interface Levels { field: string | null; quiet: boolean; rounds: Round[]; }

function phaseStat(group: Sample[], f: string, durationField: string | undefined, cumulative: boolean): number | null {
    if (cumulative) {
        let e = 0;
        let d = 0;
        for (let i = 1; i < group.length; i++) {
            e += group[i].fields[f] - group[i - 1].fields[f];
            const dd = durationField ? group[i].fields[durationField] - group[i - 1].fields[durationField] : (group[i].at - group[i - 1].at) / 1000;
            d += Number.isFinite(dd) ? dd : 0;
        }
        return d > 0 ? e / d : null;
    }
    const sorted = group.map(s => s.fields[f]).sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    return top.reduce((a, b) => a + b, 0) / top.length;
}

function summarize(samples: Sample[], values: number[], lines: string[]): Levels {
    const fields = [...new Set(samples.flatMap(s => Object.keys(s.fields)))].filter(f => WANTED.test(f));
    const durationField = fields.find(f => /duration/i.test(f));
    const byPhase: Record<string, (number | null)[]> = {};
    for (const f of fields) {
        if (/duration/i.test(f)) continue;
        const cumulative = /total|energy/i.test(f);
        byPhase[f] = values.map((_, phase) => {
            const group = samples.filter(s => s.phase === phase && typeof s.fields[f] === "number");
            const stat = group.length ? phaseStat(group, f, durationField, cumulative) : null;
            return stat != null && Number.isFinite(stat) ? stat : null;
        });
        lines.push(`  ${f}${cumulative ? " (per second)" : ""}: ${values.map((v, i) => `${times(v)} ${byPhase[f][i] == null ? "-" : short(byPhase[f][i])}`).join(", ")}`.slice(0, 400));
    }
    const preferred = Object.keys(byPhase).filter(f => rank(f) < 3).sort((x, y) => rank(x) - rank(y))[0] ?? null;
    if (!preferred) return { field: null, quiet: false, rounds: [] };
    const energy = /energy/i.test(preferred);
    const raw = samples.map(s => s.fields[preferred]).filter((v): v is number => typeof v === "number");
    const peak = Math.max(0, ...raw);
    const scale = energy || peak <= 1.01 ? 1 : peak <= 9.01 && raw.every(Number.isInteger) ? 9 : 32767;
    const amp = (x: number | null) => (x == null ? null : energy ? Math.sqrt(Math.max(0, x)) : x / scale);
    const levels = byPhase[preferred].map(amp);
    const rounds: Round[] = [];
    for (let i = 0; i + 2 < levels.length; i += 3) rounds.push([levels[i], levels[i + 1], levels[i + 2]]);
    const quiet = levels.every(x => x == null || Math.abs(x) < 1e-4);
    lines.push(`  measured with ${preferred}${energy ? " (as loudness)" : scale !== 1 ? ` (out of ${scale})` : ""}: ${rounds.map(r => r.map(x => (x == null ? "-" : short(x))).join("/")).join(", ")}`);
    return { field: preferred, quiet, rounds };
}

type Vote = "works" | "capped" | "loud" | "flat";

function verdict(r: Levels, values: number[]): string {
    const [lo, mid, hi] = values;
    if (!r.field) return "couldn't find audio levels in discord's stats, send a debug";
    if (r.quiet) return "no sound from your mic during the test";
    const votes: Vote[] = [];
    const ratios: number[] = [];
    for (const [a, b, c] of r.rounds) {
        if (a == null || b == null || c == null || a <= 0 || b <= 0) continue;
        const expected = Math.min(hi / mid, 0.98 / b);
        if (expected < 1.35) votes.push("loud");
        else if (b / a < 1.3) votes.push("flat");
        else {
            votes.push(c / b >= Math.sqrt(expected) ? "works" : "capped");
            ratios.push(c / b);
        }
    }
    if (!votes.length) return "not enough sound, keep talking the whole time";
    const count = (v: Vote) => votes.filter(x => x === v).length;
    const top = (["works", "capped", "loud", "flat"] as Vote[]).sort((x, y) => count(y) - count(x))[0];
    if (count(top) * 2 <= votes.length) return `mixed results (${votes.join(", ")}), run it again and keep talking`;
    const got = ratios.length ? short(ratios.sort((x, y) => x - y)[Math.floor(ratios.length / 2)]) : "?";
    if (top === "loud") return `too loud to tell, ${times(mid)} already maxes out the meter, talk a bit quieter`;
    if (top === "flat") return `the level didn't change from ${times(lo)} to ${times(mid)} either, so these stats can't show volume`;
    if (top === "capped") return `capped at 200%: ${times(hi)} measured the same as ${times(mid)} (x${got}), discord won't go higher`;
    return `works: ${times(hi)} measured x${got} of ${times(mid)} (200%)`;
}

async function runMicTest() {
    const lines: string[] = [];
    const conn = defaultConnection();
    const finish = (text: string) => {
        lines.push(`  result: ${text}`);
        log.input.splice(0, log.input.length, ...lines);
        log.running = null;
        showToast(`mic test: ${text}`.slice(0, 120));
    };
    if (!conn) {
        lines.push(`mic test ${stamp()}: no call`);
        finish("join a call first");
        return;
    }
    const plan: Plan = {
        title: `mic test ${stamp()}, connection ${String(conn.mediaEngineConnectionId)}, ssrc ${String(conn.audioSSRC ?? "?")}, mic set to ${micPercent()}%`,
        values: [1, 2, 4, 1, 2, 4, 1, 2, 4],
        set: v => rawInput(v),
        restore: () => {
            rawInput(null);
        },
        mode: "outbound",
        userId: String(conn.userId ?? ""),
        ssrc: () => conn.audioSSRC,
    };
    lines.push(plan.title);
    try {
        const samples = await measure(conn, plan, lines);
        plan.restore();
        lines.push(`  samples ${samples.length}`);
        if (plan.failed) {
            finish(`couldn't change the volume: ${plan.failed.slice(0, 60)}`);
            return;
        }
        finish(verdict(summarize(samples, plan.values, lines), plan.values));
    } catch (e) {
        caught("mic test", e);
        try {
            plan.restore();
        } catch { }
        finish(`stopped: ${String((e as any)?.message ?? e).slice(0, 60)}`);
    }
}

interface Source { conn: any; userId: string; level: number; }

function connections(): any[] {
    const out: any[] = [];
    try {
        engine()?.eachConnection?.((conn: any) => {
            out.push(conn);
        });
    } catch { }
    return out;
}

function inboundLevels(conn: any, raw: any): Source[] {
    const entries: Entry[] = [];
    walk(normalize(raw), [], entries, 0);
    const out: Source[] = [];
    for (const e of entries) {
        const parts = e.path.split(".");
        const at = parts.indexOf("inbound");
        const userId = at >= 0 ? parts[at + 1] : undefined;
        const level = e.obj.audioLevel;
        if (!userId || userId === String(conn?.userId) || typeof level !== "number" || e.obj.type === "video" || e.obj.kind === "video") continue;
        out.push({ conn, userId, level });
    }
    return out;
}

async function findSound(conns: any[]): Promise<Source[]> {
    const best = new Map<string, Source>();
    for (let i = 0; i < 6; i++) {
        for (const conn of conns) {
            for (const src of inboundLevels(conn, await fromConnection(conn))) {
                const key = `${context(conn)}:${src.userId}`;
                const prev = best.get(key);
                if (!prev || src.level > prev.level) best.set(key, src);
            }
        }
        await sleep(200);
    }
    return [...best.values()].sort((a, b) => b.level - a.level);
}

function nameOf(src: Source): string {
    let name: string | null = null;
    try {
        const u = findByStoreName("UserStore")?.getUser?.(src.userId);
        name = u?.globalName ?? u?.global_name ?? u?.username ?? null;
    } catch { }
    if (context(src.conn) === "stream") return name ? `${name}'s stream` : "their stream";
    return name ?? "them";
}

async function runListen(lines: string[], stop: (text: string, toast: string) => void) {
    const native = nativeModule();
    if (typeof native?.connectionInstanceSetLocalVolume !== "function") return stop("can't reach the audio engine", "can't reach discord's audio engine");
    const conns = connections();
    if (!conns.length) return stop("not in a call", "join a call first");
    showToast("looking for sound...");
    const found = await findSound(conns);
    lines.push(`  sound: ${found.slice(0, 4).map(s => `${context(s.conn)} ${shortId(s.userId)} ${short(s.level)}`).join(", ") || "none"}`);
    const src = found.find(s => context(s.conn) === "default" && s.level >= 0.02) ?? found[0];
    if (!src || src.level < 0.02) return stop("nothing playing", "nobody's making sound, someone has to talk (a music bot works too)");
    const id = connId(src.conn);
    if (id == null) return stop(`connection id ${String(src.conn?.mediaEngineConnectionId)} isn't a number`, "can't reach discord's audio engine");
    const ctx = context(src.conn);
    lines.push(`  testing ${ctx} ${shortId(src.userId)} on connection ${String(src.conn.mediaEngineConnectionId)} (${id})`);
    showToast(`listen to ${nameOf(src)}, flipping 200% and 400% every 2s`);
    const restore = () => {
        let current = 100;
        try {
            current = findByStoreName("MediaEngineStore")?.getLocalVolume?.(src.userId, ctx) ?? 100;
        } catch { }
        try {
            src.conn.setLocalVolume(src.userId, current);
        } catch (e) {
            caught("listen test restore", e);
        }
    };
    let step = 0;
    const tick = safe("listen test", () => {
        if (step >= 6) {
            restore();
            stop("done, flipped 6 times", "listen test done");
            return;
        }
        const v = step % 2 ? 8 : 2;
        try {
            native.connectionInstanceSetLocalVolume(id, src.userId, v);
        } catch (e) {
            restore();
            stop(`couldn't set x${v}: ${String((e as any)?.message ?? e).slice(0, 120)}`, "couldn't change their volume");
            return;
        }
        const at = lines.push(`  ${stamp()} ${v === 8 ? "400%" : "200%"} (x${v})`) - 1;
        fromConnection(src.conn).then(safe("listen test level", (raw: any) => {
            const now = inboundLevels(src.conn, raw).find(x => x.userId === src.userId);
            if (now) lines[at] += `, sound ${short(now.level)}`;
        }));
        step++;
        setTimeout(tick, 2000);
    });
    tick();
}

function startListen() {
    const lines = [`listen test ${stamp()}`];
    const stop = (text: string, toast: string) => {
        lines.push(`  result: ${text}`);
        log.output.splice(0, log.output.length, ...lines);
        log.running = null;
        showToast(toast);
    };
    log.running = "listen";
    readRoute();
    runListen(lines, stop).catch(safe("listen test", (e: any) => {
        caught("listen test", e);
        stop(`stopped: ${String(e?.message ?? e).slice(0, 60)}`, "listen test stopped");
    }));
}

export function startVolumeTest(kind: "boost" | "mic") {
    if (log.running) {
        showToast("a test is already running");
        return;
    }
    if (kind === "boost") {
        startListen();
        return;
    }
    log.running = kind;
    showToast("testing for 15s, keep talking");
    runMicTest().catch(safe("volume test", (e: any) => {
        log.running = null;
        caught("volume test", e);
    }));
}

export const boostTestDebug = () => (log.output.length ? log.output : ["listen test: not run yet (settings > test boost)"]);
export const micTestDebug = () => (log.input.length ? log.input : ["mic test: not run yet (settings > test mic boost)"]);
