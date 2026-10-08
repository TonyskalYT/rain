import { before } from "@api/patcher";
import { waitForHydration } from "@api/storage";
import { findByProps } from "@metro";
import { MessageStore, SelectedChannelStore, UserStore } from "@metro/common/stores";

import { caught, safe } from "../crash";
import { hasHistory, split } from "../logger/history";
import { allSaved, loadSaved } from "../logger/saved";
import { fixText, prob, Words, wordsIn } from "./fix";
import { choosePairs, collectSwaps, distance, Pair } from "./learn";
import { typoSettings, useTypoSettings } from "./storage";
import { getMine, loadMine, study, studyState } from "./study";
import { Dictionary, getDictionary, loadDictionary, Row, wordStatus } from "./words";

const G = globalThis as any;
const unpatches: (() => unknown)[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
let pairs: Map<string, Pair> = G.__cheeseburgerTypoPairs ??= new Map();
let personal: Map<string, Row> = new Map();
let hooked = "not yet";
const stats = { sent: 0, fixed: 0, undone: 0, taught: 0, histories: 0, versions: 0, swaps: 0, candidates: 0, mine: 0, words: 0, history: 0, stars: 0 };
let alive = false;
const lastSent = new Map<string, { text: string; at: number; }>();
const KNOWN_AFTER = 3;
const K = 20;
const MINE = 10;
const BREAK = /[.!?\n]+/;

function myId(): string | undefined {
    try {
        return UserStore.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

const never = () => new Set(typoSettings.never ?? []);
const clamp = (v: number) => Math.min(20, Math.max(0.05, v));

function chance(d: Dictionary, w: string): number {
    if (w === "$") return 0.08;
    const r = d.targets.get(w) ?? d.rare.get(w);
    return r ? prob(r) : 1e-6;
}

const inVocab = (d: Dictionary, w: string) => w === "^" || w === "$" || d.targets.has(w) || d.rare.has(w) || d.slang.has(w);

function side(d: Dictionary, a: string, b: string): number {
    if (!inVocab(d, a) || !inVocab(d, b)) return 1;
    const row = d.context.get(a);
    const mine = personal.get(a);
    const total = (row?.total ?? 0) + MINE * (mine?.total ?? 0);
    if (!total) return 1;
    const count = (row?.next.get(b) ?? 0) + MINE * (mine?.next.get(b) ?? 0);
    const p = chance(d, b);
    return clamp((count + K * p) / (total + K) / p);
}

function words(): Words | null {
    const d = getDictionary();
    if (!d) return null;
    const blocked = never();
    const sent = typoSettings.sent ?? {};
    return {
        known: w => d.targets.has(w) || d.slang.has(w) || d.rare.has(w),
        rank: w => d.targets.get(w),
        rare: w => d.rare.get(w),
        name: w => d.names.has(w),
        skip: w => blocked.has(w) || (sent[w] ?? 0) >= KNOWN_AFTER && !d.targets.has(w),
        personal: w => blocked.has(w) ? undefined : pairs.get(w)?.to,
        lift: d.context.size || personal.size ? (prev, w, next) => Math.pow((prev ? side(d, prev, w) : 1) * (next ? side(d, w, next) : 1), 0.75) : undefined,
    };
}

function sentences(text: string): string[][] {
    const out: string[][] = [];
    for (const part of text.split(BREAK)) {
        const ws = wordsIn(part).map(w => w.replace(/'/g, ""));
        if (ws.length) out.push(ws);
    }
    return out;
}

function addText(map: Map<string, Row>, text: string) {
    for (const ws of sentences(text)) {
        const seq = ["^", ...ws, "$"];
        for (let i = 0; i + 1 < seq.length; i++) {
            let row = map.get(seq[i]);
            if (!row) map.set(seq[i], row = { total: 0, next: new Map() });
            row.total++;
            row.next.set(seq[i + 1], (row.next.get(seq[i + 1]) ?? 0) + 1);
        }
    }
}

function loadedMessages(): any[] {
    const out: any[] = [];
    try {
        const sample = MessageStore.getMessages?.(SelectedChannelStore.getChannelId?.() ?? SelectedChannelStore.getLastSelectedChannelId?.() ?? "0");
        const all = sample?.constructor?._channelMessages;
        if (!all) return out;
        for (const id of Object.keys(all)) {
            const list = all[id]?._array;
            if (Array.isArray(list)) out.push(...list);
        }
    } catch { }
    return out;
}

function versionsOf(content: string, id: string): string[] {
    const known = G.__cheeseburgerEdits?.get?.(id);
    if (known && Array.isArray(known.old) && known.old.length) return [...known.old, split(String(known.current ?? content)).current];
    if (hasHistory(content)) {
        const parts = split(content);
        return [...parts.old, parts.current];
    }
    return [split(content).current];
}

export function relearn(): number {
    const d = getDictionary();
    const me = myId();
    if (!d || !me) return pairs.size;
    const blocked = never();
    const histories = new Map<string, string[]>();
    const corpus = new Map<string, Row>();
    for (const e of allSaved()) {
        if (e.authorId !== me) continue;
        const list = [...(Array.isArray(e.old) ? e.old : []), e.content].filter(t => typeof t === "string" && t);
        if (list.length > 1) histories.set(e.id, list);
        addText(corpus, list[list.length - 1] ?? "");
    }
    let mine = 0;
    for (const m of loadedMessages()) {
        if (m?.author?.id !== me || typeof m.content !== "string" || !m.content) continue;
        mine++;
        const list = versionsOf(m.content, m.id);
        if (list.length > 1 && !histories.has(m.id)) histories.set(m.id, list);
        addText(corpus, list[list.length - 1]);
    }
    for (const t of typoSettings.recent ?? []) addText(corpus, t);
    const stars = new Map<string, Map<string, number>>();
    const history = getMine()?.texts ?? [];
    stats.history = history.length;
    for (const [, text] of history) addText(corpus, text);
    const ordered = [...history].sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[2] - y[2]);
    for (let i = 1; i < ordered.length; i++) {
        const [ch, text, at] = ordered[i];
        const [pch, ptext, pat] = ordered[i - 1];
        if (ch !== pch || at - pat > 300_000) continue;
        const m = text.match(STAR);
        if (!m) continue;
        const to = (m[1] ?? m[2]).toLowerCase();
        const from = starPair(d, ptext, to);
        if (!from || blocked.has(from)) continue;
        const row = stars.get(from) ?? new Map<string, number>();
        row.set(to, (row.get(to) ?? 0) + 1);
        stars.set(from, row);
    }
    stats.stars = stars.size;
    personal = corpus;
    const found = collectSwaps([...histories.values()]);
    stats.histories = histories.size;
    stats.versions = found.versions;
    stats.swaps = found.swaps;
    stats.candidates = found.counts.size;
    stats.mine = mine;
    const chosen = choosePairs(found, (from, to, n) => {
        if (blocked.has(from) || d.slang.has(from) || !(d.targets.has(to) || d.slang.has(to))) return false;
        if (d.targets.has(from)) return n >= 2;
        return true;
    });
    pairs = new Map(chosen.map(p => [p.from, p]));
    for (const [from, row] of stars) {
        const [to, n] = [...row].sort((x, y) => y[1] - x[1])[0];
        if (!pairs.has(from)) pairs.set(from, { from, to, n, star: true });
    }
    for (const [from, to] of Object.entries(typoSettings.taught ?? {})) {
        if (!blocked.has(from)) pairs.set(from, { from, to, n: pairs.get(from)?.n ?? 1, star: true });
    }
    G.__cheeseburgerTypoPairs = pairs;
    return pairs.size;
}

function remember(from: string, to: string, how: string) {
    const log = [...(typoSettings.log ?? []), { from, to, at: Date.now(), how }];
    typoSettings.log = log.slice(-60);
}

function countSent(text: string) {
    const d = getDictionary();
    if (!d) return;
    typoSettings.recent = [...(typoSettings.recent ?? []), text.slice(0, 300)].slice(-400);
    addText(personal, text);
    const sent = { ...(typoSettings.sent ?? {}) };
    let changed = false;
    for (const w of wordsIn(text)) {
        if (w.length < 2 || w.includes("'") || d.targets.has(w) || d.slang.has(w)) continue;
        sent[w] = (sent[w] ?? 0) + 1;
        changed = true;
    }
    if (!changed) return;
    const keys = Object.keys(sent);
    if (keys.length > 1000) for (const k of keys.slice(0, keys.length - 1000)) delete sent[k];
    typoSettings.sent = sent;
}

function starPair(d: Dictionary, prev: string, fix: string): string | null {
    const to = fix.toLowerCase();
    if (!(d.targets.has(to) || d.slang.has(to))) return null;
    const close = [...new Set(wordsIn(prev))].filter(w => w !== to && !w.includes("'") && !d.targets.has(w) && !d.slang.has(w) && distance(w, to) <= 2);
    return close.length === 1 ? close[0] : null;
}

function learnStar(prev: string, fix: string) {
    const d = getDictionary();
    if (!d) return;
    const from = starPair(d, prev, fix);
    if (!from) return;
    typoSettings.taught = { ...(typoSettings.taught ?? {}), [from]: fix.toLowerCase() };
    stats.taught++;
    relearn();
}

const STAR = /^\s*\*\s*([A-Za-z]+)\s*\*?\s*$|^\s*([A-Za-z]+)\s*\*\s*$/;

const onSend = safe("typo send", (args: any[]) => {
    const msg = args[1];
    if (!msg || typeof msg.content !== "string" || !msg.content.trim()) return;
    const channel = typeof args[0] === "string" ? args[0] : "";
    const star = msg.content.match(STAR);
    const prev = lastSent.get(channel);
    if (star && prev && Date.now() - prev.at < 180_000) learnStar(prev.text, star[1] ?? star[2]);
    if (channel) {
        lastSent.set(channel, { text: msg.content, at: Date.now() });
        if (lastSent.size > 50) lastSent.delete(lastSent.keys().next().value!);
    }
    const w = words();
    if (!w) return;
    stats.sent++;
    const r = fixText(msg.content, w);
    if (r.changes.length) {
        stats.fixed += r.changes.length;
        for (const c of r.changes) remember(c.from, c.to, pairs.has(c.from.toLowerCase()) ? "your edits" : "keyboard");
        args[1] = { ...msg, content: r.text };
    }
    timers.push(setTimeout(safe("typo count", () => countSent(r.text)), 0));
    return r.changes.length ? args : undefined;
});

const onEdit = safe("typo edit", (args: any[]) => {
    const body = args[2];
    const text = typeof body?.content === "string" ? body.content.toLowerCase() : "";
    if (!text) return;
    const recent = (typoSettings.log ?? []).filter(l => Date.now() - l.at < 15 * 60_000);
    const have = new Set(wordsIn(text));
    const back = recent.map(l => l.from.toLowerCase()).filter(f => have.has(f));
    if (back.length) {
        typoSettings.never = [...new Set([...(typoSettings.never ?? []), ...back])].slice(-500);
        stats.undone += back.length;
        for (const f of back) pairs.delete(f);
    }
    timers.push(setTimeout(safe("typo relearn", () => relearn()), 5000));
});

export default {
    async start() {
        await waitForHydration(useTypoSettings);
        const actions = findByProps("sendMessage", "editMessage") ?? findByProps("sendMessage", "receiveMessage");
        if (typeof actions?.sendMessage !== "function") {
            hooked = "send function not found";
            return;
        }
        unpatches.push(before("sendMessage", actions, onSend));
        if (typeof actions.editMessage === "function") unpatches.push(before("editMessage", actions, onEdit));
        hooked = "on";
        alive = true;
        timers.push(setTimeout(safe("typo load", () => loadDictionary().then(safe("typo words", () => {
            loadMine().then(safe("typo mine", () => relearn()), () => { });
            timers.push(setTimeout(safe("typo study", () => {
                const me = myId();
                if (!me || !alive) return;
                study(me, () => alive).then(safe("typo studied", () => relearn()), (e: any) => caught("typo study", e));
            }), 20_000));
            loadSaved().then(safe("typo learn", () => {
                stats.words = relearn();
            }), (e: any) => caught("typo saved", e));
            timers.push(setTimeout(safe("typo relearn later", () => relearn()), 60_000));
        }), (e: any) => caught("typo words", e))), G.__cheeseburgerWords2 ? 0 : 8000));
    },
    stop() {
        for (const t of timers.splice(0)) clearTimeout(t);
        for (const u of unpatches.splice(0)) {
            try {
                u();
            } catch { }
        }
        hooked = "off";
        alive = false;
    },
};

export function typoPairs(): Pair[] {
    return [...pairs.values()];
}

export function typoDebug(): string[] {
    const log = typoSettings.log ?? [];
    return [
        `typo fix: ${hooked}, ${wordStatus}, messages checked ${stats.sent}, words fixed ${stats.fixed}, undone by editing back ${stats.undone}, taught with *word ${stats.taught}`,
        `learned from your edits: ${pairs.size} pairs from ${stats.histories} edited messages (${stats.versions} edits, ${stats.swaps} word swaps, ${stats.candidates} close ones), never fix ${(typoSettings.never ?? []).length}`,
        `your writing: ${stats.mine} loaded messages of yours, ${stats.history} from your dm history (${studyState.status}, ${studyState.pages} pages), ${(typoSettings.recent ?? []).length} sent kept, ${personal.size} words with context, ${stats.stars} typos from your *corrections`,
        `  pairs: ${[...pairs.values()].slice(0, 60).map(p => `${p.from}>${p.to}${p.n > 1 ? `x${p.n}` : ""}`).join(", ")}`.slice(0, 1500),
        ...log.slice(-8).map(l => `  ${new Date(l.at).toTimeString().slice(0, 5)} ${l.from} > ${l.to} (${l.how})`),
    ];
}
