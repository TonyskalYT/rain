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
const DOMINANT = 30;

export const nearKeys = (c: string) => NEAR[c] ?? "";

function candidates(w: string): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (let i = 0; i < w.length; i++) {
        for (const n of nearKeys(w[i])) out.set(w.slice(0, i) + n + w.slice(i + 1), false);
        if (w.length > 3) {
            const prev = w[i - 1];
            const next = w[i + 1];
            const c = w[i];
            if (prev === c || next === c || prev && nearKeys(prev).includes(c) || next && nearKeys(next).includes(c)) out.set(w.slice(0, i) + w.slice(i + 1), false);
        }
    }
    for (let i = 0; i + 1 < w.length; i++) {
        if (w[i] !== w[i + 1] && w.length > 2) out.set(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), true);
    }
    out.delete(w);
    return out;
}

export function best(word: string, words: Words): string | null {
    const found: { w: string; r: number; swap: boolean; }[] = [];
    for (const [c, swap] of candidates(word)) {
        if (c.length !== word.length && c.length < 3) continue;
        const r = words.rank(c);
        if (r !== undefined && r <= (word.length >= 6 ? 30000 : 10000)) found.push({ w: c, r, swap });
    }
    if (!found.length) return null;
    found.sort((a, b) => a.r - b.r);
    const [first, second] = found;
    if (!second || first.r * DOMINANT <= second.r) return first.w;
    const swaps = found.filter(f => f.swap);
    if (swaps.length === 1 && swaps[0].r <= first.r * 10) return swaps[0].w;
    return null;
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
