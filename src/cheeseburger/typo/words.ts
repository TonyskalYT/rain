import { NativeFileModule } from "@api/native/modules";

const URL = "https://github.com/TonyskalYT/rain/releases/latest/download/cheeseburger-words.txt";
const FILE = "rain/cheeseburger-words.txt";
const VERSION = "#cheeseburger-words v3";

export interface Dictionary { targets: Map<string, number>; rare: Map<string, number>; slang: Set<string>; }

const G = globalThis as any;
let loading: Promise<Dictionary | null> | null = null;
export let wordStatus = "not loaded";

function parse(text: string): Dictionary | null {
    const lines = text.split("\n");
    if (lines[0]?.trim() !== VERSION) return null;
    const dict: Dictionary = { targets: new Map(), rare: new Map(), slang: new Set() };
    let part = 0;
    let rank = 0;
    for (let i = 1; i < lines.length; i++) {
        const w = lines[i].trim();
        if (!w) continue;
        if (w === "#known") {
            part = 1;
            continue;
        }
        if (w === "#slang") {
            part = 2;
            continue;
        }
        rank++;
        if (part === 0) dict.targets.set(w, rank);
        else if (part === 1) dict.rare.set(w, rank);
        else dict.slang.add(w);
    }
    return dict.targets.size > 1000 ? dict : null;
}

async function load(): Promise<Dictionary | null> {
    const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${FILE}`;
    try {
        if (await NativeFileModule.fileExists(path)) {
            const dict = parse(await NativeFileModule.readFile(path, "utf8"));
            if (dict) {
                wordStatus = `${dict.targets.size + dict.rare.size + dict.slang.size} words`;
                return dict;
            }
        }
    } catch { }
    wordStatus = "downloading the word list";
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`word list ${res.status}`);
    const text = await res.text();
    const dict = parse(text);
    if (!dict) throw new Error("word list looks wrong");
    await NativeFileModule.writeFile("documents", FILE, text, "utf8").catch(() => { });
    wordStatus = `${dict.targets.size + dict.rare.size + dict.slang.size} words`;
    return dict;
}

export function getDictionary(): Dictionary | null {
    return G.__cheeseburgerWords ?? null;
}

export function loadDictionary(): Promise<Dictionary | null> {
    if (G.__cheeseburgerWords) return Promise.resolve(G.__cheeseburgerWords);
    loading ??= load().then(d => {
        G.__cheeseburgerWords = d;
        return d;
    }, e => {
        wordStatus = `couldn't load words: ${String(e?.message ?? e).slice(0, 60)}`;
        loading = null;
        return null;
    });
    return loading;
}
