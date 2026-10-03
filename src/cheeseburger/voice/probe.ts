import { findByStoreName } from "@metro";
import { ReactNative } from "@metro/common";

const ENGINE_FILES: [RegExp, string, string][] = [
    [/media-engine\/native\/ios\/VoiceEngine\.tsx$/, "default", "engine js"],
    [/VoiceEngineModule\.android\.tsx$/, "VoiceEngine", "engine module"],
    [/NativeMediaEngineModule\.tsx$/, "default", "native module"],
];
const TURBO = ["NativeMediaEngineModule", "RTNMediaEngine", "MediaEngine", "DCDMediaEngine", "VoiceEngine", "NativeVoiceEngineModule", "DiscordVoiceEngine", "NativeAudioManagerModule", "RTNAudioManager", "DCDAudioManager", "NativeKrispModule", "KrispModule", "NativeSoundboardModule", "NativeVoiceFiltersModule", "VoiceFilters"];
const AUDIO_FILES = /voice_?filter|VoiceFilter|krisp|audio_?effect|AudioEffect|VoiceEffect|voice_?effect|media_engine\/|MediaEngine|noise_?(?:suppression|cancellation)|AudioSettings|VoiceSettings|InputMode|audio_settings|voice_settings/i;
const ACTIONS = /^(?:set|toggle|update|apply|enable|disable)\w*(?:Volume|Gain|Noise|Echo|Krisp|Filter|Effect|Mode|Threshold|BitRate|Bitrate|Attenuation|Pitch|Ducking|Sidechain|Compression|Loopback|Subsystem|Processing|Voice)\w*$/;

const short = (v: any): string => {
    if (v == null) return String(v);
    if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
    if (typeof v === "string") return JSON.stringify(v.slice(0, 40));
    if (typeof v === "boolean") return String(v);
    if (typeof v === "function") return "fn";
    if (Array.isArray(v)) return `[${v.slice(0, 4).map(short).join(",")}${v.length > 4 ? ",…" : ""}]`;
    try {
        return `{${Object.entries(v).slice(0, 6).map(([k, x]) => `${k}:${typeof x === "object" && x ? "{..}" : short(x)}`).join(",")}}`;
    } catch {
        return "{?}";
    }
};

function methodNames(obj: any): string[] {
    const names = new Set<string>();
    try {
        for (let o = obj, d = 0; o && o !== Object.prototype && o !== Function.prototype && d < 4; o = Object.getPrototypeOf(o), d++) {
            for (const n of Object.getOwnPropertyNames(o)) names.add(n);
        }
    } catch { }
    return [...names].filter(n => {
        if (n === "constructor") return false;
        try {
            return typeof obj[n] === "function";
        } catch {
            return false;
        }
    }).sort();
}

function eachModule(fn: (path: string, exp: any) => void) {
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const m = mods[id];
        if (!m?.isInitialized) continue;
        const exp = m.publicModule?.exports;
        if (!exp || typeof exp !== "object" && typeof exp !== "function") continue;
        try {
            fn(String(m.__filePath ?? id), exp);
        } catch { }
    }
}

function exportOf(re: RegExp, key: string): any {
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const p = mods[id]?.__filePath;
        if (typeof p === "string" && re.test(p)) return mods[id].isInitialized ? mods[id].publicModule?.exports?.[key] : undefined;
    }
}

const list = (names: string[]) => (names.length ? names.join(",") : "-");

export function voiceProbeDebug(): string[] {
    const lines: string[] = [];
    const store = findByStoreName("MediaEngineStore");
    const engine = (() => {
        try {
            return store?.getMediaEngine?.();
        } catch {
            return undefined;
        }
    })();
    lines.push(`media engine: ${engine ? engine.constructor?.name ?? "object" : "missing"}`);
    if (engine) lines.push(`  methods: ${list(methodNames(engine))}`);
    let conns = 0;
    try {
        engine?.eachConnection?.((conn: any) => {
            conns++;
            if (conns > 2) return;
            lines.push(`connection ${conns} (${String(conn?.context ?? "?")}): ${list(methodNames(conn))}`);
            lines.push(`  fields: ${Object.keys(conn ?? {}).slice(0, 40).join(",")}`);
        });
    } catch { }
    if (!conns) lines.push("connections: none (not in a call)");
    for (const [re, key, label] of ENGINE_FILES) {
        const obj = exportOf(re, key);
        lines.push(`${label}: ${obj ? list(methodNames(obj)) : "missing"}`);
    }
    const turbo: string[] = [];
    for (const name of TURBO) {
        let mod: any = null;
        try {
            mod = ReactNative?.TurboModuleRegistry?.get?.(name) ?? ReactNative?.NativeModules?.[name] ?? null;
        } catch { }
        if (mod) turbo.push(`${name}: ${list(methodNames(mod))}`);
    }
    lines.push(`native modules found: ${turbo.length ? "" : "none of the guessed names"}`, ...turbo.map(t => `  ${t}`));
    if (store) {
        const getters = methodNames(store).filter(n => /^(?:get|is|has|supports)/.test(n));
        const values: string[] = [];
        for (const n of getters) {
            try {
                if (store[n].length > 0) continue;
                values.push(`${n}=${short(store[n]())}`);
            } catch {
                values.push(`${n}=err`);
            }
        }
        lines.push(`media store: ${values.join(" ").slice(0, 2400)}`);
    }
    const actions: string[] = [];
    const files: string[] = [];
    eachModule((path, exp) => {
        if (AUDIO_FILES.test(path) && files.length < 60) files.push(`${path.replace(/^.*?modules\//, "")} [${Object.keys(exp).slice(0, 8).join(",")}]`);
        let keys: string[] = [];
        try {
            keys = Object.keys(exp);
        } catch { }
        const hits = keys.filter(k => {
            try {
                return ACTIONS.test(k) && typeof exp[k] === "function";
            } catch {
                return false;
            }
        });
        if (hits.length && actions.length < 30) actions.push(`${path.split("/").slice(-2).join("/")}: ${hits.slice(0, 16).join(",")}`);
    });
    lines.push("audio actions:", ...(actions.length ? actions.map(a => `  ${a}`) : ["  none found"]));
    lines.push("audio files:", ...(files.length ? files.map(f => `  ${f}`) : ["  none found"]));
    return lines;
}
