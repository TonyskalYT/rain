export interface Words {
    known(word: string): boolean;
    rank(word: string): number | undefined;
    rare(word: string): number | undefined;
    name(word: string): boolean;
    skip(word: string): boolean;
    personal(word: string): string | undefined;
    lift?(prev: string, word: string, next: string): number;
}

export interface Around { prev: string; next: string; }

export interface Change { from: string; to: string; }

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const NEAR: Record<string, string> = {};

for (let r = 0; r < ROWS.length; r++) {
    for (let i = 0; i < ROWS[r].length; i++) {
        const out = new Set<string>();
        const add = (row: number, at: number) => {
            const c = ROWS[row]?.[at];
            if (c) out.add(c);
        };
        add(r, i - 1);
        add(r, i + 1);
        if (r > 0) {
            add(r - 1, i);
            add(r - 1, i + 1);
        }
        if (r < ROWS.length - 1) {
            add(r + 1, i - 1);
            add(r + 1, i);
        }
        NEAR[ROWS[r][i]] = [...out].join("");
    }
}

const PROTECT = /```[\s\S]*?```|`[^`\n]*`|<[^<>\s]*>|https?:\/\/\S+|\bwww\.\S+|:[\w~-]+:|[@#]\S+|\\\S/g;
const WORD = /[A-Za-z]+(?:'[A-Za-z]+)*/g;
const EDGE_BEFORE = /[\w:;=<>^'\\/.]/;
const EDGE_AFTER = /[\w:;=<>^'\\/]/;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const TUNE = { clear: 5, clearShort: 8, keepName: 3, second: 0.02, keepRare: 3, near: 1, far: 0.05, double: 0.8, extraNear: 0.5, extraFar: 0.1, swap: 1.3, missing: 0.3, missingDouble: 0.6 };

export const nearKeys = (c: string) => NEAR[c] ?? "";

function oneSlip(w: string, out: Map<string, number>, base: number, wide: boolean, inserts = wide) {
    const n = w.length;
    const put = (c: string, weight: number) => {
        const v = weight * base;
        if (c !== w && v > 0 && v > (out.get(c) ?? 0)) out.set(c, v);
    };
    for (let i = 0; i < n; i++) {
        const c = w[i];
        const near = nearKeys(c);
        for (const ch of LETTERS) {
            if (ch === c) continue;
            if (near.includes(ch)) put(w.slice(0, i) + ch + w.slice(i + 1), TUNE.near);
            else if (wide && n >= 4) put(w.slice(0, i) + ch + w.slice(i + 1), TUNE.far);
        }
        if (n > 2) {
            const prev = w[i - 1];
            const next = w[i + 1];
            const cut = w.slice(0, i) + w.slice(i + 1);
            if (prev === c || next === c) put(cut, TUNE.double);
            else if (prev && nearKeys(prev).includes(c) || next && nearKeys(next).includes(c)) put(cut, TUNE.extraNear);
            else if (wide && n >= 5) put(cut, TUNE.extraFar);
        }
        if (i + 1 < n && c !== w[i + 1] && n > 2) put(w.slice(0, i) + w[i + 1] + c + w.slice(i + 2), TUNE.swap);
    }
    if (inserts && n >= 3) {
        for (let i = 0; i <= n; i++) {
            for (const ch of LETTERS) put(w.slice(0, i) + ch + w.slice(i), ch === w[i - 1] || ch === w[i] ? TUNE.missingDouble : TUNE.missing);
        }
    }
}

export const prob = (rank: number) => 1 / (11 * rank);

const liftOf = (words: Words, at: Around, w: string) => words.lift ? words.lift(at.prev, w, at.next) : 1;

export function scored(word: string, found: Map<string, number>, words: Words, at: Around, keyboardOnly = false): [string, number][] {
    const out: [string, number][] = [];
    const cap = word.length >= 6 ? 30000 : word.length >= 4 ? 20000 : 10000;
    for (const [c, weight] of found) {
        if (c.length !== word.length && c.length < 3) continue;
        if (keyboardOnly && weight < 0.5) continue;
        const r = words.rank(c);
        if (r === undefined || r > cap || weight < 0.5 && word.length < 7 && (r > 3000 || word.length < 4 && (weight < 0.3 || r > 1500))) continue;
        out.push([c, weight * prob(r) * liftOf(words, at, c)]);
    }
    return out.sort((x, y) => y[1] - x[1]);
}

function pick(word: string, found: Map<string, number>, words: Words, at: Around, keep: number, keyboardOnly: boolean): string | null {
    const [first, second] = scored(word, found, words, at, keyboardOnly);
    if (!first || second && first[1] < second[1] * (word.length <= 3 ? TUNE.clearShort : TUNE.clear) || first[1] <= keep) return null;
    return first[0];
}

export function slips(word: string, wide = true): Map<string, number> {
    const found = new Map<string, number>();
    oneSlip(word, found, 1, wide);
    if (word.length < 4 || !wide) return found;
    const all = new Map(found);
    for (const [c, weight] of found) {
        if (weight >= 0.5) oneSlip(c, all, weight * TUNE.second, false, word.length >= 5);
        else if (weight >= 0.3 && word.length >= 5) oneSlip(c, all, weight * TUNE.second, false);
    }
    all.delete(word);
    for (const [c, weight] of found) if ((all.get(c) ?? 0) < weight) all.set(c, weight);
    return all;
}

export function best(word: string, words: Words, at: Around = { prev: "", next: "" }, keep = 0, keyboardOnly = false): string | null {
    return pick(word, slips(word, !keyboardOnly), words, at, keep, keyboardOnly);
}

function shape(original: string, fixed: string): string {
    if (original.length > 1 && original === original.toUpperCase()) return fixed.toUpperCase();
    if (original[0] === original[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
    return fixed;
}

function startsSentence(text: string, at: number): boolean {
    for (let i = at - 1; i >= 0; i--) {
        const c = text[i];
        if (c === " " || c === "\t" || c === "*" || c === "_" || c === "\"" || c === "(") continue;
        return c === "\n" || c === "." || c === "!" || c === "?";
    }
    return true;
}

function fixWord(text: string, start: number, w: string, words: Words, at: Around): string | null {
    if (w.length < 2 || w.includes("'") || /(.)\1\1/i.test(w)) return null;
    const before = text[start - 1];
    const after = text[start + w.length];
    if (before && EDGE_BEFORE.test(before) || after && EDGE_AFTER.test(after)) return null;
    const lower = w.toLowerCase();
    const upper = w.toUpperCase();
    const capital = w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase();
    if (w !== lower && w !== upper && !capital) return null;
    if (capital && w !== upper && lower !== "i" && !startsSentence(text, start)) return null;
    if (w === upper && w.length > 1 && w.length < 4) return null;
    const mine = words.personal(lower);
    if (mine) return shape(w, mine);
    if (words.skip(lower) || words.name(lower) && w !== lower) return null;
    const rare = words.rare(lower);
    const real = words.rank(lower);
    let fixed: string | null = null;
    if (rare !== undefined) {
        fixed = best(lower, words, at, (words.name(lower) ? TUNE.keepName : TUNE.keepRare) * TUNE.clear * prob(rare) * liftOf(words, at, lower));
    } else if (real !== undefined) {
        return null;
    } else if (!words.known(lower)) {
        fixed = best(lower, words, at);
    }
    return fixed ? shape(w, fixed) : null;
}

const BREAK = /[.!?\n]/;

export function fixText(text: string, words: Words): { text: string; changes: Change[]; } {
    const changes: Change[] = [];
    if (!text || /^\s*[/!$]/.test(text)) return { text, changes };
    const spans: [number, number][] = [];
    for (const m of text.matchAll(PROTECT)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    const toks = [...text.matchAll(WORD)].map(m => ({ w: m[0], at: m.index ?? 0 }));
    let out = "";
    let last = 0;
    let prev = "^";
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        const end = t.at + t.w.length;
        if (i === 0 || BREAK.test(text.slice(toks[i - 1].at + toks[i - 1].w.length, t.at))) prev = "^";
        const n = toks[i + 1];
        const next = !n || BREAK.test(text.slice(end, n.at)) ? "$" : n.w.toLowerCase().replace(/'/g, "");
        let rep = t.w;
        if (!spans.some(([a, b]) => t.at < b && end > a)) {
            const f = fixWord(text, t.at, t.w, words, { prev, next });
            if (f && f !== t.w) {
                changes.push({ from: t.w, to: f });
                rep = f;
            }
        }
        out += text.slice(last, t.at) + rep;
        last = end;
        prev = rep.toLowerCase().replace(/'/g, "");
    }
    return { text: out + text.slice(last), changes };
}

export function wordsIn(text: string): string[] {
    const out: string[] = [];
    const plain = text.replace(PROTECT, " ");
    for (const m of plain.matchAll(WORD)) out.push(m[0].toLowerCase());
    return out;
}
