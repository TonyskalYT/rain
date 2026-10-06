import { NativeFileModule } from "@api/native/modules";
import { React } from "@metro/common";

import { safe } from "../crash";

export interface Saved {
    id: string;
    channelId: string;
    guildId?: string;
    where: string;
    authorId: string;
    author: string;
    kind: "deleted" | "edited";
    at: number;
    sent: number;
    content: string;
    old: string[];
    files: string[];
    raw?: any;
}

interface State { map: Map<string, Saved>; loaded: boolean; dirty: boolean; bytes: number; }

const FILE = "rain/cheeseburger-messagelog.json";
const G = globalThis as any;
const state: State = G.__cheeseburgerSaved ??= { map: new Map(), loaded: false, dirty: false, bytes: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<unknown> = Promise.resolve();
let limit = 3000;
let version = 0;

const valid = (e: any): e is Saved => !!e && typeof e.id === "string" && typeof e.channelId === "string" && (e.kind === "deleted" || e.kind === "edited") && typeof e.at === "number";

function notify() {
    version++;
    listeners.forEach(l => {
        try {
            l();
        } catch { }
    });
}

function prune() {
    if (state.map.size <= limit) return;
    const sorted = [...state.map.values()].sort((a, b) => a.at - b.at);
    for (const e of sorted.slice(0, state.map.size - limit)) state.map.delete(e.id);
}

function write(): Promise<unknown> {
    if (!state.loaded || !state.dirty) return writing;
    state.dirty = false;
    prune();
    let data = "";
    try {
        data = JSON.stringify({ v: 1, entries: [...state.map.values()] });
    } catch {
        return writing;
    }
    state.bytes = data.length;
    writing = writing
        .then(() => NativeFileModule.writeFile("documents", FILE, data, "utf8"))
        .then(() => { }, () => {
            state.dirty = true;
        });
    return writing;
}

function schedule() {
    state.dirty = true;
    if (!state.loaded || timer) return;
    timer = setTimeout(safe("logger save", () => {
        timer = null;
        void write();
    }), 4000);
}

export async function loadSaved() {
    if (state.loaded) return;
    try {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${FILE}`;
        if (await NativeFileModule.fileExists(path)) {
            const text = await NativeFileModule.readFile(path, "utf8");
            state.bytes = text.length;
            const data = JSON.parse(text);
            for (const e of Array.isArray(data?.entries) ? data.entries : []) {
                if (valid(e) && !state.map.has(e.id)) state.map.set(e.id, e);
            }
        }
    } catch { }
    state.loaded = true;
    if (state.dirty) schedule();
    notify();
}

export function flushSaved() {
    if (timer) clearTimeout(timer);
    timer = null;
    return write();
}

export function setSavedLimit(n: number) {
    limit = Math.max(100, Math.min(20000, Math.round(n) || 3000));
}

export function putSaved(entry: Saved) {
    const prev = state.map.get(entry.id);
    const next: Saved = prev
        ? {
            ...prev,
            ...entry,
            kind: prev.kind === "deleted" || entry.kind === "deleted" ? "deleted" : "edited",
            old: entry.old.length ? entry.old : prev.old,
            raw: entry.raw ?? prev.raw,
            files: entry.files.length ? entry.files : prev.files,
        }
        : entry;
    state.map.delete(entry.id);
    state.map.set(entry.id, next);
    schedule();
    notify();
}

export const getSaved = (id: string) => state.map.get(id);

export const savedIn = (channelId: string) => [...state.map.values()].filter(e => e.channelId === channelId);

export const allSaved = () => [...state.map.values()].sort((a, b) => b.at - a.at);

export function clearSaved() {
    state.map.clear();
    state.dirty = true;
    if (timer) clearTimeout(timer);
    timer = null;
    void write();
    notify();
}

export const savedInfo = () => ({ count: state.map.size, kb: Math.round(state.bytes / 1024), loaded: state.loaded });

export function useSaved(): number {
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => {
        listeners.add(force);
        return () => void listeners.delete(force);
    }, []);
    return version;
}
