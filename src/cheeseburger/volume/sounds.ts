import { ReactNative } from "@metro/common";

const BROKEN = ["stream_started"];
const NAMES = ["DCDSoundManager", "NativeSoundManager", "NativeSoundManagerModule", "RTNSoundManager", "SoundManager", "RNSound", "DCDSound", "NativeSoundModule", "NativeSoundPlayerModule", "NativeSoundboardModule"];
const SKIP_METHODS = new Set(["constructor", "getConstants", "addListener", "removeListeners"]);

interface Hook { obj: any; name: string; orig: Function; wrapped: Function; }

let hooks: Hook[] = [];
let found: string[] = [];
const names = new Map<string, number>();
const skipped = new Map<string, number>();
const methods = new Map<string, number>();
const dead = new Set<number>();

const bump = (m: Map<string, number>, k: string) => {
    m.set(k, (m.get(k) ?? 0) + 1);
    if (m.size > 40) m.delete(m.keys().next().value!);
};

function candidates(): [string, any][] {
    const out: [string, any][] = [];
    const seen = new Set<any>();
    const add = (label: string, m: any) => {
        if (!m || typeof m !== "object" && typeof m !== "function" || seen.has(m)) return;
        seen.add(m);
        out.push([label, m]);
    };
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const p = mods[id]?.__filePath;
        if (typeof p === "string" && /rtn-codegen\/js\/Native\w*Sound\w*\.tsx$/i.test(p) && mods[id].isInitialized) add(p.split("/").pop()!, mods[id].publicModule?.exports?.default);
    }
    for (const n of NAMES) {
        try {
            add(n, ReactNative?.TurboModuleRegistry?.get?.(n));
        } catch { }
        try {
            add(n, ReactNative?.NativeModules?.[n]);
        } catch { }
    }
    return out;
}

function methodNames(obj: any): string[] {
    const out = new Set<string>();
    try {
        for (let o = obj, d = 0; o && o !== Object.prototype && d < 3; o = Object.getPrototypeOf(o), d++) {
            for (const n of Object.getOwnPropertyNames(o)) out.add(n);
        }
    } catch { }
    return [...out].filter(n => {
        try {
            return !SKIP_METHODS.has(n) && typeof obj[n] === "function";
        } catch {
            return false;
        }
    });
}

function shouldSkip(a: any[]): string | null {
    const broken = a.find(x => typeof x === "string" && BROKEN.some(b => x.includes(b)));
    if (broken) {
        for (const x of a) if (typeof x === "number" && Number.isInteger(x) && x >= 0) dead.add(x);
        return broken;
    }
    if (typeof a[0] === "number" && dead.has(a[0])) return `key ${a[0]}`;
    return null;
}

export function hookSounds() {
    for (const [label, obj] of candidates()) {
        const list = methodNames(obj);
        if (!found.some(f => f.startsWith(`${label} `))) found.push(`${label} [${list.join(",").slice(0, 200)}]`);
        if (!list.includes("prepare")) continue;
        for (const name of list) {
            if (hooks.some(h => h.obj === obj && h.name === name)) continue;
            const orig = obj[name];
            const wrapped = function (this: any, ...a: any[]) {
                let skip: string | null = null;
                try {
                    bump(methods, `${label}.${name}`);
                    for (const x of a) if (typeof x === "string" && /^[\w.-]{2,48}$/.test(x)) bump(names, x);
                    skip = shouldSkip(a);
                    if (skip) bump(skipped, skip);
                } catch { }
                if (skip) return undefined;
                return orig.apply(this, a);
            };
            try {
                obj[name] = wrapped;
            } catch { }
            if (obj[name] === wrapped) hooks.push({ obj, name, orig, wrapped });
        }
    }
}

export function unhookSounds() {
    for (const h of hooks) {
        try {
            if (h.obj[h.name] === h.wrapped) h.obj[h.name] = h.orig;
        } catch { }
    }
    hooks = [];
    found = [];
    names.clear();
    skipped.clear();
    methods.clear();
    dead.clear();
}

const list = (m: Map<string, number>) => [...m].map(([k, n]) => `${k} x${n}`).join(", ") || "none";

export function soundsDebug(): string[] {
    return [
        `sound players: ${found.join(" | ") || "none found"}, hooked ${hooks.length}`,
        `sound calls: ${list(methods)}`,
        `sound names: ${list(names)}`,
        `broken sounds skipped: ${list(skipped)}`,
    ];
}
