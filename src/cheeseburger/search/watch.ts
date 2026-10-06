import { after } from "@api/patcher";

import { safe } from "../crash";

const G = globalThis as any;
const renders: string[] = G.__cheeseburgerSearchRenders ??= [];
const lastAt = new Map<string, number>();
const watching = new Set<string>();
const names = new Map<string, string>();
const unpatches: (() => unknown)[] = [];
let candidates: { id: string; path: string; }[] | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

function typeName(t: any): string {
    if (typeof t === "string") return t;
    return t?.displayName ?? t?.name ?? t?.type?.displayName ?? t?.type?.name ?? t?.render?.displayName ?? t?.render?.name ?? "?";
}

function scan(node: any, out: string[], depth: number) {
    if (!node || depth > 8 || out.length >= 14) return;
    if (Array.isArray(node)) {
        for (const n of node) scan(n, out, depth + 1);
        return;
    }
    if (typeof node !== "object" || !("props" in node)) return;
    const p = node.props ?? {};
    const label = p.accessibilityLabel ?? p.label ?? p.placeholder;
    const icon = p.icon ?? p.IconComponent ?? p.source;
    if (typeof label === "string" || icon) out.push(`${typeName(node.type)}${typeof label === "string" ? ` "${label.slice(0, 24)}"` : ""}${icon ? " +icon" : ""}`);
    scan(p.children, out, depth + 1);
}

const isClass = (fn: any) => !!fn?.prototype?.isReactComponent || !!fn?.prototype && Object.getOwnPropertyNames(fn.prototype).length > 1;

function watchSearch() {
    const mods = G.modules;
    if (!mods) return;
    candidates ??= Object.keys(mods)
        .map(id => ({ id, path: mods[id]?.__filePath }))
        .filter((c): c is { id: string; path: string; } => typeof c.path === "string" && c.path.startsWith("modules/search/native/") && c.path.endsWith(".tsx"));
    for (const c of candidates) {
        if (watching.has(c.path)) continue;
        const m = mods[c.id];
        if (!m?.isInitialized) continue;
        watching.add(c.path);
        const exp = m.publicModule?.exports;
        const fn = exp?.default;
        if (typeof fn !== "function" || !/^[A-Z]/.test(fn.name ?? "") || isClass(fn)) continue;
        names.set(c.path, fn.name);
        try {
            unpatches.push(after("default", exp, safe("search watch", (args: any[], ret: any) => {
                if (!ret || typeof ret !== "object" || !("props" in ret)) return;
                const now = Date.now();
                if (now - (lastAt.get(c.path) ?? 0) < 3000) return;
                lastAt.set(c.path, now);
                const out: string[] = [];
                scan(ret, out, 0);
                const props = Object.keys(args[0] ?? {}).slice(0, 10).join(",");
                renders.push(`${c.path.replace("modules/search/native/", "")} ${fn.name} {${props}} -> ${out.join(", ") || typeName(ret.type)}`.slice(0, 400));
                if (renders.length > 30) renders.shift();
            })));
        } catch { }
    }
}

export function startWatch() {
    if (poll) return;
    safe("search watch start", watchSearch)();
    poll = setInterval(safe("search watch poll", watchSearch), 4000);
}

export function stopWatch() {
    if (poll) clearInterval(poll);
    poll = null;
    for (const u of unpatches.splice(0)) {
        try {
            u();
        } catch { }
    }
    watching.clear();
}

export function watchDebug(): string[] {
    const mods = G.modules ?? {};
    const lines: string[] = [];
    let total = 0;
    let loaded = 0;
    for (const id of Object.keys(mods)) {
        const path = mods[id]?.__filePath;
        if (typeof path !== "string" || !path.startsWith("modules/search/")) continue;
        total++;
        const m = mods[id];
        if (!m.isInitialized) continue;
        loaded++;
        if (lines.length >= 70) continue;
        const exp = m.publicModule?.exports ?? {};
        const keys = Object.keys(exp).filter(k => k !== "default" && k !== "__esModule").slice(0, 6);
        const def = exp.default;
        const defName = names.has(path) ? `default ${names.get(path)} (watched)` : typeof def === "function" ? `default ${def.name || "fn"}` : def && typeof def === "object" ? `default {${Object.keys(def).slice(0, 5).join(",")}}` : "";
        lines.push(`  ${path.replace("modules/search/", "")}: ${[defName, ...keys].filter(Boolean).join(", ")}`.slice(0, 220));
    }
    return [
        `discord search modules: ${total} (${loaded} loaded), checked ${watching.size}`,
        ...lines,
        ...(renders.length ? ["search screen renders:", ...renders.map(r => `  ${r}`)] : ["search screen renders: none yet (open discord's search, then send a debug)"]),
    ];
}
