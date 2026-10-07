export interface Edit { old: string[]; current: string; }

export const HISTORY = /^-# (?:~~.*~~|​.*)$/;
export const MARK = "⁣";
export const MARKED = /^-# ⁣.*$/;
export const NUDGE = "⁠";
export const NUDGED = /⁠+$/;

const EDGES = /^[\s​⁠⁣]+|[\s​⁠⁣]+$/g;
const PREFIX = /^\s*(?:>>>|>|-#|#{1,3}(?=\s)|[*-](?=\s))\s*/;

export const tidy = (text: string) => text.replace(EDGES, "");

export const lineOf = (line: string) => tidy(tidy(line).replace(/```\w*/g, "").replace(/~~/g, "").replace(PREFIX, ""));

export const linesOf = (text: string) => text.split("\n").map(lineOf).filter(Boolean);

export const hasHistory = (content: string) => HISTORY.test(content.split("\n", 1)[0]);

export const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function split(content: string): Edit {
    const lines = content.split("\n");
    let i = 0;
    while (i < lines.length && HISTORY.test(lines[i])) i++;
    return {
        old: lines.slice(0, i).map(l => tidy(l.startsWith("-# ~~") ? l.slice(5, -2) : l.slice(4))).filter(Boolean),
        current: lines.slice(i).filter(l => !MARKED.test(l)).join("\n").replace(NUDGED, ""),
    };
}

export function cleanHistory(old: unknown, current: string): string[] {
    const list = Array.isArray(old) ? old.filter((x): x is string => typeof x === "string") : [];
    const now = tidy(split(current).current);
    const nowLines = new Set(linesOf(now));
    const parts = list.map(split);
    const dirty = new Set(list).size !== list.length || parts.some((p, i) => p.old.length > 0 || tidy(p.current) !== list[i]);
    const out: string[] = [];
    const covered = new Set<string>();
    const add = (text: string, lines: string[]) => {
        if (!text || out.includes(text)) return;
        if (dirty && (text === now || lines.length > 0 && lines.every(l => covered.has(l)))) return;
        out.push(text);
        for (const l of lines) covered.add(l);
    };
    for (const p of parts) {
        for (const l of p.old) if (!nowLines.has(l)) add(l, [l]);
        const text = tidy(p.current);
        add(text, linesOf(text));
    }
    while (out.length && out[out.length - 1] === now) out.pop();
    return out.slice(-10);
}
