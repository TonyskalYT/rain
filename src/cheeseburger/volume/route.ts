import { findByStoreName } from "@metro";
import { ReactNative } from "@metro/common";

import { safe } from "../crash";

const G = globalThis as any;
const calls: string[] = G.__cheeseburgerAudioRoute ??= [];
let hooks: [any, string, Function, Function][] = [];
let device = "not read yet";
let devices = "not read yet";

const stamp = () => new Date().toISOString().slice(11, 19);

function text(v: any): string {
    try {
        return String(JSON.stringify(v) ?? v).slice(0, 300);
    } catch {
        return String(v).slice(0, 300);
    }
}

function manager(): any {
    try {
        return ReactNative?.TurboModuleRegistry?.get?.("NativeAudioManagerModule") ?? ReactNative?.NativeModules?.NativeAudioManagerModule ?? null;
    } catch {
        return null;
    }
}

function exportsOf(re: RegExp): any {
    const mods: any = (window as any).modules ?? {};
    for (const id of Object.keys(mods)) {
        const p = mods[id]?.__filePath;
        if (typeof p === "string" && re.test(p)) return mods[id].isInitialized ? mods[id].publicModule?.exports : undefined;
    }
}

export function hookRoute() {
    const am = manager();
    if (!am) return;
    for (const name of ["setCommunicationModeOn", "setActiveAudioDevice"]) {
        const orig = am[name];
        if (typeof orig !== "function" || hooks.some(h => h[0] === am && h[1] === name)) continue;
        const wrapped = function (this: any, ...a: any[]) {
            try {
                calls.push(`${stamp()} ${name}(${a.map(x => text(x).slice(0, 60)).join(",")})`);
                if (calls.length > 12) calls.shift();
            } catch { }
            return orig.apply(this, a);
        };
        try {
            am[name] = wrapped;
        } catch { }
        if (am[name] === wrapped) hooks.push([am, name, orig, wrapped]);
    }
}

export function unhookRoute() {
    for (const [am, name, orig, wrapped] of hooks) {
        try {
            if (am[name] === wrapped) am[name] = orig;
        } catch { }
    }
    hooks = [];
}

function ask(am: any, name: string): Promise<string> {
    return new Promise(resolve => {
        let done = false;
        const finish = safe("audio route read", (v: any) => {
            if (done) return;
            done = true;
            resolve(typeof v === "string" ? v : text(v));
        });
        setTimeout(safe("audio route timeout", () => finish("no answer")), 1500);
        const fn = am?.[name];
        if (typeof fn !== "function") {
            finish("missing");
            return;
        }
        let r: any;
        try {
            r = fn.call(am);
        } catch {
            try {
                r = fn.call(am, finish);
            } catch (e) {
                finish(`err ${String((e as any)?.message ?? e).slice(0, 80)}`);
                return;
            }
        }
        if (r && typeof r.then === "function") r.then(finish, (e: any) => finish(`rejected ${String(e?.message ?? e).slice(0, 80)}`));
        else if (r !== undefined) finish(r);
    });
}

export const readRoute = safe("audio route", () => {
    const am = manager();
    if (!am) {
        device = devices = "no audio manager";
        return;
    }
    ask(am, "getActiveAudioDevice").then(safe("audio route device", (v: string) => {
        device = v;
    }));
    ask(am, "getAudioDevices").then(safe("audio route devices", (v: string) => {
        devices = v;
    }));
});

function spatial(): string {
    let conn: any = null;
    try {
        findByStoreName("MediaEngineStore")?.getMediaEngine?.()?.eachConnection?.((c: any) => {
            if (!conn && (c?.context ?? "default") === "default") conn = c;
        });
    } catch { }
    if (!conn) return "spatial audio: not in a call";
    let on: any = conn.spatialAudioEnabled;
    try {
        if (typeof conn.getSpatialAudioEnabled === "function") on = conn.getSpatialAudioEnabled();
    } catch { }
    return `spatial audio on the call: ${String(on)}`;
}

function experiment(): string {
    const exp = exportsOf(/MobileAudioOutputExperiment\.tsx$/)?.default;
    if (!exp) return "mobile audio output experiment: not loaded";
    let config: any;
    try {
        config = typeof exp.getCurrentConfig === "function" ? exp.getCurrentConfig({ location: "cheeseburger" }, { autoTrackExposure: false }) : `no getCurrentConfig, keys ${Object.keys(exp).join(",")}`;
    } catch (e) {
        config = `err ${String((e as any)?.message ?? e).slice(0, 80)}`;
    }
    return `mobile audio output experiment: ${typeof config === "string" ? config : text(config)}`;
}

export function routeDebug(): string[] {
    return [
        `audio device: ${device}`,
        `audio devices: ${devices}`,
        `audio mode calls (${hooks.map(h => h[1]).join(",") || "not hooked"}): ${calls.length ? "" : "none seen"}`,
        ...calls.map(c => `  ${c}`),
        spatial(),
        experiment(),
    ];
}
