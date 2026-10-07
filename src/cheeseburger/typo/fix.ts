export interface Words {
    known(word: string): boolean;
    rank(word: string): number | undefined;
    rare(word: string): number | undefined;
    personal(word: string): string | undefined;
}

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
const CLEAR = 4;

export const nearKeys = (c: string) => NEAR[c] ?? "";

function oneSlip(w: string, out: Map<string, number>, base: number, wide: boolean) {
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
            if (near.includes(ch)) put(w.slice(0, i) + ch + w.slice(i + 1), 1);
            else if (wide && n >= 4) put(w.slice(0, i) + ch + w.slice(i + 1), 0.1);
        }
        if (n > 2) {
            const prev = w[i - 1];
            const next = w[i + 1];
            const cut = w.slice(0, i) + w.slice(i + 1);
            if (prev === c || next === c) put(cut, 0.8);
            else if (prev && nearKeys(prev).includes(c) || next && nearKeys(next).includes(c)) put(cut, 0.5);
            else if (wide && n >= 5) put(cut, 0.1);
        }
        if (i + 1 < n && c !== w[i + 1] && n > 2) put(w.slice(0, i) + w[i + 1] + c + w.slice(i + 2), 1.3);
    }
    if (wide && n >= 3) {
        for (let i = 0; i <= n; i++) {
            for (const ch of LETTERS) put(w.slice(0, i) + ch + w.slice(i), ch === w[i - 1] || ch === w[i] ? 0.6 : 0.3);
        }
    }
}

function pick(word: string, found: Map<string, number>, words: Words): string | null {
    let first: [string, number] | null = null;
    let second = 0;
    const cap = word.length >= 6 ? 30000 : 10000;
    for (const [c, weight] of found) {
        if (c.length !== word.length && c.length < 3) continue;
        const r = words.rank(c);
        if (r === undefined || r > cap || weight < 0.5 && (r > 3000 || word.length < 4)) continue;
        const score = weight / r;
        if (!first || score > first[1]) {
            if (first) second = Math.max(second, first[1]);
            first = [c, score];
        } else {
            second = Math.max(second, score);
        }
    }
    if (!first || first[1] < second * CLEAR) return null;
    return first[0];
}

export function best(word: string, words: Words): string | null {
    const found = new Map<string, number>();
    oneSlip(word, found, 1, true);
    const one = pick(word, found, words);
    if (one || word.length < 6) return one;
    const two = new Map<string, number>();
    for (const [c, weight] of found) if (weight >= 0.5) oneSlip(c, two, weight * 0.5, false);
    two.delete(word);
    for (const [c, weight] of found) if ((two.get(c) ?? 0) < weight) two.set(c, weight);
    return pick(word, two, words);
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

function fixWord(text: string, start: number, w: string, words: Words): string | null {
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
    const rare = words.rare(lower);
    if (rare === undefined && words.known(lower)) return null;
    const fixed = best(lower, words);
    if (fixed && rare !== undefined && !(words.rank(fixed)! <= 2000 && rare >= words.rank(fixed)! * 100)) return null;
    return fixed ? shape(w, fixed) : null;
}

export function fixText(text: string, words: Words): { text: string; changes: Change[]; } {
    const changes: Change[] = [];
    if (!text || /^\s*[/!$]/.test(text)) return { text, changes };
    const spans: [number, number][] = [];
    for (const m of text.matchAll(PROTECT)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    const fixed = text.replace(WORD, (w: string, at: number, all: string) => {
        if (spans.some(([s, e]) => at < e && at + w.length > s)) return w;
        const next = fixWord(all, at, w, words);
        if (!next || next === w) return w;
        changes.push({ from: w, to: next });
        return next;
    });
    return { text: fixed, changes };
}

export function wordsIn(text: string): string[] {
    const out: string[] = [];
    const plain = text.replace(PROTECT, " ");
    for (const m of plain.matchAll(WORD)) out.push(m[0].toLowerCase());
    return out;
}
