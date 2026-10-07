import { before } from "@api/patcher";
import { waitForHydration } from "@api/storage";
import { findByProps } from "@metro";
import { UserStore } from "@metro/common/stores";

import { caught, safe } from "../crash";
import { allSaved, loadSaved } from "../logger/saved";
import { fixText, Words, wordsIn } from "./fix";
import { learnPairs, Pair } from "./learn";
import { typoSettings, useTypoSettings } from "./storage";
import { getDictionary, loadDictionary, wordStatus } from "./words";

const G = globalThis as any;
const unpatches: (() => unknown)[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
let pairs: Map<string, Pair> = G.__cheeseburgerTypoPairs ??= new Map();
let hooked = "not yet";
const stats = { sent: 0, fixed: 0, words: 0, undone: 0 };

function myId(): string | undefined {
    try {
        return UserStore.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

const never = () => new Set(typoSettings.never ?? []);

function words(): Words | null {
    const d = getDictionary();
    if (!d) return null;
    const blocked = never();
    const sent = typoSettings.sent ?? {};
    return {
        known: w => d.targets.has(w) || d.slang.has(w) || blocked.has(w) || (sent[w] ?? 0) >= 2,
        rank: w => d.targets.get(w),
        rare: w => blocked.has(w) || d.slang.has(w) || (sent[w] ?? 0) >= 2 ? undefined : d.rare.get(w),
        personal: w => blocked.has(w) ? undefined : pairs.get(w)?.to,
    };
}

export function relearn(): number {
    const d = getDictionary();
    const me = myId();
    if (!d || !me) return pairs.size;
    const blocked = never();
    const histories = allSaved().filter(e => e.authorId === me && Array.isArray(e.old) && e.old.length).map(e => [...e.old, e.content]);
    const found = learnPairs(
        histories,
        w => !blocked.has(w) && !d.targets.has(w) && !d.slang.has(w) && ((typoSettings.sent ?? {})[w] ?? 0) < 2,
        w => d.targets.has(w) || d.slang.has(w),
    );
    pairs = new Map(found.map(p => [p.from, p]));
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

const onSend = safe("typo send", (args: any[]) => {
    const msg = args[1];
    if (!msg || typeof msg.content !== "string" || !msg.content.trim()) return;
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
        loadDictionary().then(safe("typo words", () => {
            loadSaved().then(safe("typo learn", () => {
                stats.words = relearn();
            }), (e: any) => caught("typo saved", e));
        }), (e: any) => caught("typo words", e));
    },
    stop() {
        for (const t of timers.splice(0)) clearTimeout(t);
        for (const u of unpatches.splice(0)) {
            try {
                u();
            } catch { }
        }
        hooked = "off";
    },
};

export function typoPairs(): Pair[] {
    return [...pairs.values()];
}

export function typoDebug(): string[] {
    const log = typoSettings.log ?? [];
    return [
        `typo fix: ${hooked}, ${wordStatus}, messages checked ${stats.sent}, words fixed ${stats.fixed}, undone by editing back ${stats.undone}`,
        `learned from your edits: ${pairs.size}${pairs.size ? ` (${[...pairs.values()].slice(0, 12).map(p => `${p.from}>${p.to}`).join(", ")})` : ""}, never fix ${(typoSettings.never ?? []).length}`,
        ...log.slice(-8).map(l => `  ${new Date(l.at).toTimeString().slice(0, 5)} ${l.from} > ${l.to} (${l.how})`),
    ];
}
