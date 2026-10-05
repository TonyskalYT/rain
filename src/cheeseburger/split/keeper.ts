import { findByProps } from "@metro";

import { caught, safe } from "../crash";
import { ev } from "./fight";
import { splitViewSettings } from "./storage";

export interface KeeperRect { x: number; y: number; width: number; height: number; z?: number; }

const HASH = 4815162342071;
const LISTENER = 4815162342;

const CODE = `function cheeseburgerTileKeeper() {
  try {
    var c = this.__closure;
    var targets = c.targets;
    var wanted = c.wanted;
    var hits = c.hits;
    var id = c.id;
    for (var i = 0; i < c.drop.length; i++) {
      try { c.drop[i].removeListener(id); } catch (e) {}
    }
    var make = function (sv, key) {
      var busy = false;
      var fix = function (v) {
        var all = targets.value;
        var t = all ? all[key] : null;
        if (!t || !v || typeof v !== "object" || typeof v.x !== "number") return;
        var z = t.z == null ? 1 : t.z;
        var vz = v.zIndex == null ? 1 : v.zIndex;
        if (Math.abs(v.x - t.x) < 0.5 && Math.abs(v.y - t.y) < 0.5 && Math.abs(v.width - t.width) < 0.5 && Math.abs(v.height - t.height) < 0.5 && vz === z) return;
        var a = sv._animation;
        var want = a && a.toValue && typeof a.toValue === "object" && typeof a.toValue.x === "number" ? a.toValue : v;
        var w = wanted.value || {};
        var nw = {};
        for (var q in w) nw[q] = w[q];
        nw[key] = { x: want.x, y: want.y, width: want.width, height: want.height, zIndex: want.zIndex };
        wanted.value = nw;
        var next = {};
        for (var k in v) next[k] = v[k];
        next.x = t.x;
        next.y = t.y;
        next.width = t.width;
        next.height = t.height;
        next.zIndex = z;
        hits.value = hits.value + 1;
        sv.value = next;
      };
      return function (v) {
        if (busy) return;
        busy = true;
        try { fix(v); } catch (e) {} finally { busy = false; }
      };
    };
    var bad = 0;
    for (var j = 0; j < c.pairs.length; j++) {
      try { c.pairs[j][0].addListener(id, make(c.pairs[j][0], c.pairs[j][1])); } catch (e) { bad++; }
    }
    c.ok.value = bad ? -1000 : c.ok.value + 1;
  } catch (e) {}
}`;

interface Api { runOnUI: (fn: any) => (...a: any[]) => void; makeMutable: (v: any) => any; clone: (v: any) => any; initData: any; }

let api: Api | null | undefined;
let state: "idle" | "waiting" | "trying" | "on" | "off" = "idle";
let note = "not needed yet";
let targetsSV: any = null;
let wantedSV: any = null;
let hitsSV: any = null;
let okSV: any = null;
const ids = new WeakMap<object, number>();
let nextId = 1;
const installed = new Map<object, number>();
let lastTargets = "";
let latest: [any, KeeperRect][] = [];
let installs = 0;

function findApi(): Api | null {
    const rea = findByProps("useAnimatedStyle", "withTiming");
    const worklets = findByProps("runOnUI", "makeShareableCloneRecursive") ?? findByProps("createSerializable", "isWorkletFunction") ?? findByProps("scheduleOnUI", "isWorkletFunction");
    const schedule = typeof worklets?.scheduleOnUI === "function" ? worklets.scheduleOnUI : null;
    const runOnUI = worklets?.runOnUI ?? rea?.runOnUI ?? (schedule ? (fn: any) => () => schedule(fn) : undefined);
    const clone = worklets?.makeShareableCloneRecursive ?? worklets?.createSerializable ?? rea?.makeShareableCloneRecursive;
    const makeMutable = rea?.makeMutable ?? worklets?.makeMutable;
    if (typeof runOnUI !== "function" || typeof clone !== "function" || typeof makeMutable !== "function") {
        note = `missing ${[typeof runOnUI !== "function" && "runOnUI", typeof clone !== "function" && "cloning", typeof makeMutable !== "function" && "makeMutable"].filter(Boolean).join(", ")}`;
        return null;
    }
    const compiled = [rea?.withTiming, rea?.withSpring, rea?.withDecay, rea?.withDelay, rea?.withRepeat, rea?.withSequence, rea?.interpolate, rea?.clamp].filter(f => typeof f === "function" && f.__workletHash != null && f.__initData && typeof f.__initData.code === "string");
    const sample = compiled.find(f => f.__initData.code.includes("this.__closure"));
    if (!sample) {
        note = compiled.length ? "discord's worklets read their closure some other way" : "discord's worklets have no code to copy (bundle mode)";
        return null;
    }
    const initData: any = {};
    for (const key of Object.keys(sample.__initData)) {
        if (key === "code") initData.code = CODE;
        else if (typeof sample.__initData[key] === "string" || typeof sample.__initData[key] === "number") initData[key] = sample.__initData[key];
    }
    initData.code = CODE;
    return { runOnUI, makeMutable, clone, initData };
}

function worklet(closure: any) {
    const fn: any = function () { };
    fn.__closure = closure;
    fn.__workletHash = HASH;
    fn.__initData = api!.initData;
    return fn;
}

function run(pairs: [any, number][], drop: any[]): boolean {
    try {
        const fn = worklet({ targets: targetsSV, wanted: wantedSV, hits: hitsSV, ok: okSV, id: LISTENER, pairs, drop });
        api!.clone(fn);
        api!.runOnUI(fn)();
        installs++;
        return true;
    } catch (e) {
        caught("split keeper", e);
        note = `couldn't start: ${String((e as any)?.message ?? e).slice(0, 80)}`;
        return false;
    }
}

function rectsOf(entries: [any, KeeperRect][]) {
    const out: Record<number, KeeperRect> = {};
    for (const [sv, r] of entries) {
        if (![r.x, r.y, r.width, r.height].every(n => typeof n === "number" && Number.isFinite(n))) continue;
        let id = ids.get(sv);
        if (id == null) ids.set(sv, id = nextId++);
        out[id] = { x: r.x, y: r.y, width: r.width, height: r.height, z: r.z ?? 1 };
    }
    return out;
}

function push(entries: [any, KeeperRect][]) {
    const rects = rectsOf(entries);
    const sig = JSON.stringify(rects);
    if (sig !== lastTargets) {
        lastTargets = sig;
        targetsSV.value = rects;
    }
    const now = new Set(entries.map(([sv]) => sv));
    const added = entries.filter(([sv]) => !installed.has(sv));
    const drop = [...installed.keys()].filter(sv => !now.has(sv));
    if (!added.length && !drop.length) return;
    for (const sv of drop) installed.delete(sv);
    for (const [sv] of added) installed.set(sv, ids.get(sv)!);
    if (!run(added.map(([sv]) => [sv, ids.get(sv)!]), drop)) off("couldn't install");
}

function off(why: string) {
    state = "off";
    note = why;
    try {
        if (targetsSV) targetsSV.value = {};
        if (installed.size && api) run([], [...installed.keys()]);
    } catch { }
    installed.clear();
    lastTargets = "";
}

const finishTrial = safe("split keeper trial", () => {
    if (state !== "trying") return;
    let ok = 0;
    try {
        ok = Number(okSV.value) || 0;
    } catch { }
    if (ok > 0) {
        state = "on";
        note = "holding tiles on discord's animation thread";
        splitViewSettings.uiKeeper = "works";
        ev("tile keeper works");
        push(latest);
    } else {
        splitViewSettings.uiKeeper = null;
        off("discord's animation thread didn't answer, using the fast check instead");
        ev("tile keeper didn't answer");
    }
});

const startTrial = safe("split keeper start", () => {
    if (state !== "waiting") return;
    state = "trying";
    push(latest);
    if (!installs) run([], []);
    setTimeout(finishTrial, 1500);
});

export function keeperSync(entries: [any, KeeperRect][]) {
    try {
        sync(entries);
    } catch (e) {
        caught("split keeper", e);
        state = "off";
        note = `stopped: ${String((e as any)?.message ?? e).slice(0, 80)}`;
    }
}

function sync(entries: [any, KeeperRect][]) {
    latest = entries;
    if (state === "on" || state === "trying") {
        push(entries);
        return;
    }
    if (state !== "idle" || !entries.length) return;
    const saved = splitViewSettings.uiKeeper;
    if (saved === "failed") {
        state = "off";
        note = "turned off after a failed try";
        return;
    }
    if (saved === "trying") {
        splitViewSettings.uiKeeper = "failed";
        state = "off";
        note = "discord closed while it was being tried, so it stays off";
        ev("tile keeper off: closed during its try");
        return;
    }
    api = findApi();
    if (!api) {
        state = "off";
        return;
    }
    try {
        targetsSV = api.makeMutable({});
        wantedSV = api.makeMutable({});
        hitsSV = api.makeMutable(0);
        okSV = api.makeMutable(0);
    } catch (e) {
        caught("split keeper values", e);
        state = "off";
        note = "couldn't make shared values";
        return;
    }
    splitViewSettings.uiKeeper = "trying";
    state = "waiting";
    note = "about to try";
    setTimeout(startTrial, 1500);
}

export function keeperClear() {
    latest = [];
    if (state !== "on" && state !== "trying") return;
    try {
        if (targetsSV && lastTargets !== "{}") {
            lastTargets = "{}";
            targetsSV.value = {};
        }
        if (installed.size) {
            const drop = [...installed.keys()];
            installed.clear();
            run([], drop);
        }
    } catch (e) {
        caught("split keeper clear", e);
    }
}

export function keeperStop() {
    if (state === "waiting" || state === "trying") splitViewSettings.uiKeeper = null;
    keeperClear();
    state = "off";
    note = "stopped for an update";
}

export function keeperWanted(sv: any): any {
    if (!wantedSV || state !== "on") return null;
    const id = ids.get(sv);
    if (id == null) return null;
    try {
        const w = wantedSV.value?.[id];
        return w && typeof w.x === "number" ? w : null;
    } catch {
        return null;
    }
}

export const keeperOn = () => state === "on";

export function keeperDebug(): string {
    let hits: any = "?";
    try {
        if (hitsSV) hits = hitsSV.value;
    } catch { }
    let ok: any = "?";
    try {
        if (okSV) ok = okSV.value;
    } catch { }
    return `tile keeper: ${state}, ${note}, saved ${splitViewSettings.uiKeeper ?? "never tried"}, holding ${installed.size} tiles, installs ${installs} (answered ${ok}), discord moves undone ${hits}`;
}
