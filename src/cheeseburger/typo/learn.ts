import { wordsIn } from "./fix";

export interface Pair { from: string; to: string; n: number; star?: boolean; }

export function distance(a: string, b: string): number {
    const d: number[][] = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

function swaps(a: string[], b: string[]): [string, string][] {
    if (a.length > 300 || b.length > 300) return [];
    const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const out: [string, string][] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            i++;
            j++;
            continue;
        }
        const si = i;
        const sj = j;
        while (i < a.length || j < b.length) {
            if (i < a.length && j < b.length && a[i] === b[j]) break;
            if (j >= b.length || i < a.length && L[i + 1][j] >= L[i][j + 1]) i++;
            else j++;
        }
        if (i - si === 1 && j - sj === 1) out.push([a[si], b[sj]]);
    }
    return out;
}

export interface Swaps { counts: Map<string, Map<string, number>>; versions: number; swaps: number; }

export function collectSwaps(histories: string[][]): Swaps {
    const counts = new Map<string, Map<string, number>>();
    let versions = 0;
    let swapsSeen = 0;
    for (const list of histories) {
        for (let k = 0; k + 1 < list.length; k++) {
            versions++;
            for (const [from, to] of swaps(wordsIn(list[k]), wordsIn(list[k + 1]))) {
                swapsSeen++;
                if (from.includes("'") || to.includes("'") || to.length < 2 || from.length < 2 || /(.)\1\1/.test(from)) continue;
                if (distance(from, to) > 2 || Math.abs(from.length - to.length) > 1) continue;
                const m = counts.get(from) ?? new Map<string, number>();
                m.set(to, (m.get(to) ?? 0) + 1);
                counts.set(from, m);
            }
        }
    }
    return { counts, versions, swaps: swapsSeen };
}

export function choosePairs(found: Swaps, ok: (from: string, to: string, n: number) => boolean): Pair[] {
    const out: Pair[] = [];
    for (const [from, m] of found.counts) {
        const ranked = [...m].sort((x, y) => y[1] - x[1]);
        if (ranked.length > 1 && ranked[1][1] * 2 > ranked[0][1]) continue;
        if (ok(from, ranked[0][0], ranked[0][1])) out.push({ from, to: ranked[0][0], n: ranked[0][1] });
    }
    return out.sort((x, y) => y.n - x.n);
}
