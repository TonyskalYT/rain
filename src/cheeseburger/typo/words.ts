import { NativeFileModule } from "@api/native/modules";

const BASE = "https://github.com/TonyskalYT/rain/releases/latest/download/";
const WORDS = { url: `${BASE}cheeseburger-words.txt`, file: "rain/cheeseburger-words.txt", version: "#cheeseburger-words v6" };
const CONTEXT = { url: `${BASE}cheeseburger-context.txt`, file: "rain/cheeseburger-context.txt", version: "#cheeseburger-context v1" };

export interface Row { total: number; next: Map<string, number>; }
export interface Dictionary { targets: Map<string, number>; rare: Map<string, number>; names: Set<string>; slang: Set<string>; chat: Set<string>; context: Map<string, Row>; }

const G = globalThis as any;
let loading: Promise<Dictionary | null> | null = null;
export let wordStatus = "not loaded";

async function fetchCached(src: { url: string; file: string; version: string; }): Promise<string> {
    const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${src.file}`;
    try {
        if (await NativeFileModule.fileExists(path)) {
            const text = await NativeFileModule.readFile(path, "utf8");
            if (typeof text === "string" && text.startsWith(src.version)) return text;
        }
    } catch { }
    wordStatus = "downloading the word lists";
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`${src.file.split("/").pop()} ${res.status}`);
    const text = await res.text();
    if (!text.startsWith(src.version)) throw new Error("word list looks wrong");
    await NativeFileModule.writeFile("documents", src.file, text, "utf8").catch(() => { });
    return text;
}

function parseWords(text: string, dict: Dictionary) {
    let part = 0;
    let rank = 0;
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
        const w = lines[i].trim();
        if (!w) continue;
        if (w === "#known") part = 1;
        else if (w === "#names") part = 2;
        else if (w === "#slang") part = 3;
        else if (w === "#chat") part = 4;
        else if (part === 4) dict.chat.add(w);
        else {
            rank++;
            if (part === 0) dict.targets.set(w, rank);
            else if (part === 3) dict.slang.add(w);
            else {
                dict.rare.set(w, rank);
                if (part === 2) dict.names.add(w);
            }
        }
    }
}

function parseContext(text: string, dict: Dictionary) {
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(" ");
        if (parts.length < 3) continue;
        const next = new Map<string, number>();
        for (let j = 2; j < parts.length; j++) {
            const k = parts[j].lastIndexOf(":");
            if (k > 0) next.set(parts[j].slice(0, k), Number(parts[j].slice(k + 1)) || 0);
        }
        dict.context.set(parts[0], { total: Number(parts[1]) || 0, next });
    }
}

async function load(): Promise<Dictionary | null> {
    const dict: Dictionary = { targets: new Map(), rare: new Map(), names: new Set(), slang: new Set(), chat: new Set(), context: new Map() };
    parseWords(await fetchCached(WORDS), dict);
    if (dict.targets.size < 1000) throw new Error("word list looks wrong");
    try {
        parseContext(await fetchCached(CONTEXT), dict);
    } catch { }
    wordStatus = `${dict.targets.size + dict.rare.size + dict.slang.size} words, ${dict.context.size ? "context on" : "no context"}`;
    return dict;
}

export function getDictionary(): Dictionary | null {
    return G.__cheeseburgerWords2 ?? null;
}

export function loadDictionary(): Promise<Dictionary | null> {
    if (G.__cheeseburgerWords2) return Promise.resolve(G.__cheeseburgerWords2);
    loading ??= load().then(d => {
        G.__cheeseburgerWords2 = d;
        delete G.__cheeseburgerWords;
        return d;
    }, e => {
        wordStatus = `couldn't load words: ${String(e?.message ?? e).slice(0, 60)}`;
        loading = null;
        return null;
    });
    return loading;
}
