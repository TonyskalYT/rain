import { showToast } from "@api/ui/toasts";
import { findByStoreName } from "@metro";

import { caught, safe } from "../crash";
import { micPercent, rawInput } from "../voice/mic";
import { volumeBoostSettings } from "./storage";
import { short } from "./trail";

interface Entry { path: string; obj: any; }
interface Sample { value: number; phase: number; fields: Record<string, number>; at: number; }
interface TestLog { running: string | null; output: string[]; input: string[]; }

const G = globalThis as any;
const log: TestLog = G.__cheeseburgerVolumeTest ??= { running: null, output: [], input: [] };
const WANTED = /level|energy|duration|volume|gain|power|rms|peak|speech|voice|loud/i;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(safe("volume test wait", () => resolve()), ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const pct = (v: number) => `${Math.round(v * 100)}%`;
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

function getStats(conn: any): Promise<any> {
    return new Promise(resolve => {
        let done = false;
        const finish = safe("volume test stats", (v: any) => {
            if (done) return;
            done = true;
            resolve(v ?? null);
        });
        try {
            const r = conn.getStats(finish);
            if (r && typeof r.then === "function") r.then(finish, () => finish(null));
            else if (r && typeof r === "object") finish(r);
        } catch {
            finish(null);
        }
        setTimeout(safe("volume test timeout", () => finish(null)), 1500);
    });
}

function walk(v: any, path: string[], out: Entry[], depth: number) {
    if (!v || typeof v !== "object" || depth > 7 || out.length > 40) return;
    if (!Array.isArray(v) && (v.type === "audio" || v.kind === "audio" || "audioLevel" in v || "totalAudioEnergy" in v || "audio_level" in v)) out.push({ path: path.join("."), obj: v });
    for (const k of Object.keys(v).slice(0, 80)) walk(v[k], [...path, k], out, depth + 1);
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
    if (depth > 2) return "{…}";
    return `{${Object.keys(v).slice(0, 10).map(k => `${k.length > 12 ? short(k) : k}:${shape(v[k], depth + 1)}`).join(",")}}`;
}

function pick(entries: Entry[], mode: "inbound" | "outbound", userId: string, ssrc: any): Entry | null {
    const audio = (e: Entry) => e.obj.type === "audio" || e.obj.kind === "audio" || "audioLevel" in e.obj || "totalAudioEnergy" in e.obj;
    const bySsrc = entries.find(e => ssrc != null && String(e.obj.ssrc) === String(ssrc) && audio(e));
    if (bySsrc) return bySsrc;
    if (mode === "inbound") return entries.find(e => e.path.includes(userId) && audio(e)) ?? null;
    return entries.find(e => /outbound|send|local/i.test(e.path) && audio(e)) ?? null;
}

interface Plan { title: string; values: number[]; set: (v: number) => string | null; restore: () => void; mode: "inbound" | "outbound"; userId: string; ssrc: () => any; }

async function measure(conn: any, plan: Plan, lines: string[]): Promise<Sample[]> {
    const samples: Sample[] = [];
    let entry: Entry | null = null;
    let first = true;
    for (const [phase, value] of plan.values.entries()) {
        const err = plan.set(value);
        if (err) {
            lines.push(`  couldn't set ${pct(value)}: ${err}`);
            return samples;
        }
        await sleep(450);
        for (let i = 0; i < 5; i++) {
            const stats = await getStats(conn);
            if (stats && first) {
                first = false;
                lines.push(`  stats shape: ${shape(stats)}`.slice(0, 600));
            }
            const entries: Entry[] = [];
            walk(stats, [], entries, 0);
            const hit = pick(entries, plan.mode, plan.userId, plan.ssrc());
            if (hit) {
                if (!entry) {
                    entry = hit;
                    lines.push(`  audio stats at ${hit.path.split(".").map(p => (p.length > 12 ? short(p) : p)).join(".")}: ${Object.keys(numbers(hit.obj)).join(",").slice(0, 400)}`);
                }
                samples.push({ value, phase, fields: numbers(hit.obj), at: Date.now() });
            } else if (i === 0 && value === plan.values[0]) {
                lines.push(`  no ${plan.mode} audio found among ${entries.length} audio entries: ${entries.slice(0, 6).map(e => e.path).join(" | ") || "none"}`);
            }
            await sleep(220);
        }
    }
    return samples;
}

function summarize(samples: Sample[], values: number[], lines: string[]): { ratioLow: number | null; ratioHigh: number | null; field: string | null; quiet: boolean; } {
    const distinct = [...new Set(values)].sort((a, b) => a - b);
    const fields = [...new Set(samples.flatMap(s => Object.keys(s.fields)))].filter(f => WANTED.test(f));
    const durationField = fields.find(f => /duration/i.test(f));
    const results: Record<string, Record<number, number>> = {};
    for (const f of fields) {
        const cumulative = /total|energy/i.test(f) && !/duration/i.test(f);
        if (/duration/i.test(f)) continue;
        const perValue: Record<number, number[]> = {};
        for (const phase of [...new Set(samples.map(s => s.phase))]) {
            const group = samples.filter(s => s.phase === phase && typeof s.fields[f] === "number");
            if (!group.length) continue;
            let stat: number | null = null;
            if (cumulative) {
                let e = 0;
                let d = 0;
                for (let i = 1; i < group.length; i++) {
                    e += group[i].fields[f] - group[i - 1].fields[f];
                    const dd = durationField ? group[i].fields[durationField] - group[i - 1].fields[durationField] : (group[i].at - group[i - 1].at) / 1000;
                    d += Number.isFinite(dd) ? dd : 0;
                }
                if (d > 0) stat = e / d;
            } else {
                const sorted = group.map(s => s.fields[f]).sort((a, b) => b - a);
                const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
                stat = top.reduce((a, b) => a + b, 0) / top.length;
            }
            if (stat != null && Number.isFinite(stat)) (perValue[group[0].value] ??= []).push(stat);
        }
        const per: Record<number, number> = {};
        for (const v of distinct) if (perValue[v]?.length) per[v] = perValue[v].reduce((a, b) => a + b, 0) / perValue[v].length;
        results[f] = per;
        lines.push(`  ${f}${cumulative ? " (per second)" : ""}: ${distinct.map(v => `${pct(v)} ${per[v] == null ? "-" : short(per[v])}`).join(", ")}`);
    }
    const usable = Object.keys(results);
    const preferred = ["totalAudioEnergy", "audioLevel", "audio_level", "level"].map(p => usable.find(f => f === p || f.endsWith(`.${p}`))).find(Boolean) ?? usable.find(f => /level|energy/i.test(f)) ?? null;
    if (!preferred) return { ratioLow: null, ratioHigh: null, field: null, quiet: false };
    const per = results[preferred];
    const [lo, mid, hi] = [distinct[0], distinct[1], distinct[distinct.length - 1]];
    const energy = /energy/i.test(preferred);
    const amp = (x: number | undefined) => (x == null ? null : energy ? Math.sqrt(Math.max(0, x)) : x);
    const a = amp(per[lo]);
    const b = amp(per[mid]);
    const c = amp(per[hi]);
    const quiet = [a, b, c].every(x => x == null || Math.abs(x) < 1e-4);
    lines.push(`  measured with ${preferred}${energy ? " (as loudness)" : ""}`);
    return {
        ratioLow: a && b && a > 0 ? b / a : null,
        ratioHigh: b && c && b > 0 ? c / b : null,
        field: preferred,
        quiet,
    };
}

function verdict(kind: "boost" | "mic", r: ReturnType<typeof summarize>, high: number, mid: number, low: number): string {
    if (!r.field) return "discord's stats have no audio level to measure with";
    if (r.quiet) return kind === "boost" ? "nobody talked during the test" : "no sound from your mic during the test";
    if (r.ratioLow != null && r.ratioLow < 1.15) return `the level didn't change from ${pct(low)} to ${pct(mid)} either, so these stats can't show volume`;
    if (r.ratioHigh == null) return "not enough samples";
    const want = high / mid;
    if (r.ratioHigh < 1.15) return `capped: ${pct(high)} is as loud as ${pct(mid)} (x${short(r.ratioHigh)}), discord's audio engine stops at ${pct(mid)}`;
    if (r.ratioHigh < want * 0.6) return `partly works: ${pct(high)} is x${short(r.ratioHigh)} of ${pct(mid)} (asked for x${short(want)}), probably clipping at full scale`;
    return `works: ${pct(high)} is x${short(r.ratioHigh)} of ${pct(mid)}`;
}

async function runTest(kind: "boost" | "mic") {
    const lines: string[] = [];
    const conn = defaultConnection();
    const target = kind === "boost" ? log.output : log.input;
    const finish = (text: string) => {
        lines.push(`  result: ${text}`);
        target.splice(0, target.length, ...lines);
        log.running = null;
        showToast(`${kind === "boost" ? "boost" : "mic"} test: ${text}`.slice(0, 120));
    };
    if (!conn) {
        lines.push(`${kind} test ${stamp()}: no call`);
        finish("join a call first");
        return;
    }
    let plan: Plan;
    if (kind === "boost") {
        const boosted = Object.entries(volumeBoostSettings.boosted ?? {}).find(([k]) => k.startsWith("default:"));
        const userId = boosted?.[0].split(":")[1] ?? Object.keys(conn.remoteAudioSSRCs ?? {}).find(id => id !== conn.userId);
        const native = nativeModule();
        if (!userId || typeof native?.connectionInstanceSetLocalVolume !== "function") {
            lines.push(`boost test ${stamp()}: ${userId ? "native volume call missing" : "nobody to test"}`);
            finish(userId ? "can't reach discord's audio engine" : "nobody else in the call");
            return;
        }
        const high = Math.max(4, Number(boosted?.[1] ?? 1000) / 100);
        const id = conn.mediaEngineConnectionId;
        plan = {
            title: `boost test ${stamp()} on ${shortId(userId)}, connection ${String(id)}, ssrc ${String(conn.remoteAudioSSRCs?.[userId] ?? "?")}`,
            values: [1, 2, high, 1, 2, high],
            set: v => {
                try {
                    native.connectionInstanceSetLocalVolume(id, userId, v);
                    return null;
                } catch (e) {
                    return String((e as any)?.message ?? e).slice(0, 80);
                }
            },
            restore: () => {
                const boost = boosted ? Number(boosted[1]) : null;
                let current = boost;
                if (current == null) {
                    try {
                        current = findByStoreName("MediaEngineStore")?.getLocalVolume?.(userId, "default") ?? 100;
                    } catch {
                        current = 100;
                    }
                }
                try {
                    conn.setLocalVolume(userId, current);
                } catch (e) {
                    caught("boost test restore", e);
                }
            },
            mode: "inbound",
            userId,
            ssrc: () => conn.remoteAudioSSRCs?.[userId],
        };
    } else {
        const high = Math.max(4, micPercent() / 100);
        plan = {
            title: `mic test ${stamp()}, connection ${String(conn.mediaEngineConnectionId)}, ssrc ${String(conn.audioSSRC ?? "?")}`,
            values: [1, 2, high, 1, 2, high],
            set: v => rawInput(v),
            restore: () => {
                rawInput(null);
            },
            mode: "outbound",
            userId: String(conn.userId ?? ""),
            ssrc: () => conn.audioSSRC,
        };
    }
    lines.push(plan.title);
    try {
        const samples = await measure(conn, plan, lines);
        plan.restore();
        lines.push(`  samples ${samples.length}`);
        const r = summarize(samples, plan.values, lines);
        const sorted = [...new Set(plan.values)].sort((a, b) => a - b);
        finish(verdict(kind, r, sorted[sorted.length - 1], sorted[1], sorted[0]));
    } catch (e) {
        caught(`${kind} test`, e);
        try {
            plan.restore();
        } catch { }
        finish(`stopped: ${String((e as any)?.message ?? e).slice(0, 60)}`);
    }
}

export function startVolumeTest(kind: "boost" | "mic") {
    if (log.running) {
        showToast("a test is already running");
        return;
    }
    log.running = kind;
    showToast(kind === "boost" ? "testing for 10s, someone has to talk" : "testing for 10s, keep talking");
    runTest(kind).catch(safe("volume test", (e: any) => {
        log.running = null;
        caught("volume test", e);
    }));
}

export const boostTestDebug = () => (log.output.length ? log.output : ["boost test: not run yet (settings > test boost)"]);
export const micTestDebug = () => (log.input.length ? log.input : ["mic test: not run yet (settings > test mic boost)"]);
