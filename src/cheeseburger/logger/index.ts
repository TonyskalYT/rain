import { before } from "@api/patcher";
import { waitForHydration } from "@api/storage";
import { findByName, findByProps } from "@metro";
import { FluxDispatcher } from "@metro/common";
import { MessageStore, UserStore } from "@metro/common/stores";
import { isPluginEnabled, pluginInstances, startPlugin, stopPlugin } from "@plugins";

import { caught, safe } from "../crash";
import { loggerSettings, useLoggerSettings } from "./storage";

interface Edit { old: string[]; current: string; }

const CORE = "messagelogger";
const SKIP = "CHEESEBURGER_LOGGER_SKIP";
const REPEAT_MS = 15_000;
const HISTORY = /^-# ~~.*~~$/;
const TYPES = new Set(["MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "MESSAGE_UPDATE", "MESSAGE_START_EDIT"]);
const G = globalThis as any;
const ghosts: Map<string, number> = G.__cheeseburgerGhosts ??= new Map();
const edits: Map<string, Edit> = G.__cheeseburgerEdits ??= new Map();
const stats = { deletes: 0, repeats: 0, bulk: 0, edits: 0, editBox: 0 };

const unpatches: (() => unknown)[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
let running = false;
let editBoxFixed = false;
let note = "off";

function cap(m: Map<string, unknown>, n: number) {
    while (m.size > n) m.delete(m.keys().next().value!);
}

function coreOn(): boolean {
    try {
        return pluginInstances.has(CORE) && isPluginEnabled(CORE);
    } catch {
        return false;
    }
}

function clock(t = Date.now()) {
    const d = new Date(t);
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

function myId(): string | undefined {
    try {
        return UserStore.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

function subtext(text: string): string[] {
    return text.split("\n")
        .map(l => l.replace(/```\w*/g, "").replace(/~~/g, "").replace(/^\s*(?:>>>|>|-#|#{1,3}(?=\s)|[*-](?=\s))\s*/, "").trim())
        .filter(Boolean)
        .map(l => `-# ~~${l}~~`);
}

function compose(old: string[], current: string): string {
    const lines = old.flatMap(subtext);
    return lines.length ? `${lines.join("\n")}\n${current}` : current;
}

function split(content: string): Edit {
    const lines = content.split("\n");
    let i = 0;
    while (i < lines.length && HISTORY.test(lines[i])) i++;
    return { old: lines.slice(0, i).map(l => l.slice(5, -2)), current: lines.slice(i).join("\n") };
}

function ghostEvent(channelId: string, id: string) {
    ghosts.set(id, Date.now());
    cap(ghosts, 1000);
    return {
        type: "MESSAGE_EDIT_FAILED_AUTOMOD",
        cheeseburgerLogger: true,
        messageData: { type: 1, message: { channelId, messageId: id } },
        errorResponseBody: { code: 200000, message: `deleted at ${clock()}` },
    };
}

function redraw(message: any) {
    timers.push(setTimeout(safe("logger redraw", () => {
        FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", otherPluginBypass: true, cheeseburgerLogger: true, message: { ...message } });
    }), 0));
}

function onDelete(args: any[], e: any) {
    const { id, channelId } = e;
    if (typeof id !== "string" || !channelId) return;
    const seen = ghosts.get(id);
    if (seen != null) {
        if (Date.now() - seen < REPEAT_MS) {
            stats.repeats++;
            args[0] = { type: SKIP };
            return args;
        }
        ghosts.delete(id);
        return;
    }
    const message = MessageStore.getMessage?.(channelId, id);
    if (!message) return;
    stats.deletes++;
    args[0] = ghostEvent(channelId, id);
    redraw(message);
    return args;
}

function onBulk(args: any[], e: any) {
    const channelId = e.channelId;
    const ids: string[] = Array.isArray(e.ids) ? e.ids : [];
    if (!channelId || !ids.length) return;
    const keep: string[] = [];
    const later: [string, any][] = [];
    for (const id of ids) {
        const seen = ghosts.get(id);
        if (seen != null) {
            if (Date.now() - seen >= REPEAT_MS) {
                ghosts.delete(id);
                keep.push(id);
            }
            continue;
        }
        const message = MessageStore.getMessage?.(channelId, id);
        if (message) later.push([id, message]);
        else keep.push(id);
    }
    if (keep.length === ids.length) return;
    stats.bulk += later.length;
    for (const [id] of later) ghosts.set(id, Date.now());
    args[0] = keep.length ? { ...e, ids: keep } : { type: SKIP };
    timers.push(setTimeout(safe("logger bulk", () => {
        for (const [id, message] of later) {
            FluxDispatcher.dispatch(ghostEvent(channelId, id));
            FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", otherPluginBypass: true, cheeseburgerLogger: true, message: { ...message } });
        }
    }), 0));
    return args;
}

function onUpdate(args: any[], e: any) {
    const m = e.message;
    if (!m || typeof m.id !== "string" || typeof m.content !== "string") return;
    const channelId = m.channel_id ?? m.channelId;
    const prev = channelId ? MessageStore.getMessage?.(channelId, m.id) : null;
    const author = m.author?.id ?? prev?.author?.id;
    if (!editBoxFixed && author && author === myId()) return;
    let rec = edits.get(m.id);
    if (!rec) {
        if (!prev || typeof prev.content !== "string") return;
        const parsed = split(prev.content);
        if (parsed.current === m.content || !parsed.current.trim() && !parsed.old.length) return;
        rec = parsed;
    } else if (rec.current === m.content) {
        args[0] = { ...e, message: { ...m, content: compose(rec.old, m.content) } };
        return args;
    }
    if (rec.current.trim()) rec.old = [...rec.old, rec.current].slice(-5);
    rec.current = m.content;
    edits.set(m.id, rec);
    cap(edits, 500);
    stats.edits++;
    args[0] = { ...e, message: { ...m, content: compose(rec.old, m.content) } };
    return args;
}

const onDispatch = safe("logger", (args: any[]) => {
    const e = args[0];
    if (!e || !TYPES.has(e.type) || e.otherPluginBypass || e.cheeseburgerLogger || coreOn()) return;
    if (e.type === "MESSAGE_UPDATE") return onUpdate(args, e);
    if (e.type === "MESSAGE_DELETE") return onDelete(args, e);
    if (e.type === "MESSAGE_DELETE_BULK") return onBulk(args, e);
    const clean = cleanContent(e.messageId, e.content);
    if (clean == null) return;
    stats.editBox++;
    args[0] = { ...e, content: clean };
    return args;
});

function cleanContent(id: unknown, content: unknown): string | null {
    if (typeof id !== "string" || typeof content !== "string") return null;
    const rec = edits.get(id);
    if (rec && content === compose(rec.old, rec.current)) return rec.current;
    const parsed = split(content);
    return parsed.old.length ? parsed.current : null;
}

function fixEditBox() {
    const actions = findByProps("startEditMessage", "editMessage") ?? findByProps("startEditMessage");
    if (typeof actions?.startEditMessage !== "function") return;
    unpatches.push(before("startEditMessage", actions, safe("logger edit box", (args: any[]) => {
        const clean = cleanContent(args[1], args[2]);
        if (clean == null) return;
        stats.editBox++;
        args[2] = clean;
        return args;
    })));
    if (typeof actions.editMessage === "function") {
        unpatches.push(before("editMessage", actions, safe("logger edit send", (args: any[]) => {
            const body = args[2];
            if (!body || typeof body !== "object") return;
            const clean = cleanContent(args[1], body.content);
            if (clean == null) return;
            args[2] = { ...body, content: clean };
            return args;
        })));
    }
    editBoxFixed = true;
}

function paintGhosts() {
    const RowManager = findByName("RowManager");
    if (typeof RowManager?.prototype?.generate !== "function") return;
    unpatches.push(before("generate", RowManager.prototype, safe("logger row", (args: any[]) => {
        const msg = args[0]?.message;
        if (!msg || !ghosts.has(msg.id) || msg.style || coreOn()) return;
        msg.style = { backgroundColor: "rgba(240, 71, 71, 0.1)", borderLeftWidth: 4, borderLeftColor: "#F04747" };
    })));
}

const takeOver = safe("logger takeover", () => {
    if (!running || !pluginInstances.has(CORE) || !isPluginEnabled(CORE)) return;
    stopPlugin(CORE).then(safe("logger took over", () => {
        loggerSettings.tookOver = true;
        note = "took over from the old MessageLogger plugin";
    }), (e: any) => {
        caught("logger takeover", e);
        note = "couldn't turn off the old MessageLogger plugin";
    });
});

export default {
    async start() {
        await waitForHydration(useLoggerSettings);
        running = true;
        note = "on";
        unpatches.push(before("dispatch", FluxDispatcher, onDispatch));
        try {
            fixEditBox();
        } catch (e) {
            caught("logger edit box", e);
        }
        try {
            paintGhosts();
        } catch (e) {
            caught("logger rows", e);
        }
        takeOver();
        for (const ms of [5000, 20000]) timers.push(setTimeout(takeOver, ms));
    },
    stop() {
        running = false;
        for (const t of timers.splice(0)) clearTimeout(t);
        for (const u of unpatches.splice(0)) {
            try {
                u();
            } catch { }
        }
        editBoxFixed = false;
        note = "off";
        if (!G.__cheeseburgerSwapping && loggerSettings.tookOver && pluginInstances.has(CORE)) {
            loggerSettings.tookOver = false;
            startPlugin(CORE).catch((e: any) => caught("logger give back", e));
        }
    },
};

export function loggerDebug(): string[] {
    return [
        `logger: ${note}, old plugin ${coreOn() ? "on (cheeseburger steps aside)" : "off"}, edit box fix ${editBoxFixed ? "on" : "off (own edits not shown)"}`,
        `kept deleted ${stats.deletes}, repeat deletes swallowed ${stats.repeats}, bulk ${stats.bulk}, edits ${stats.edits}, edit box cleaned ${stats.editBox}, remembered ${ghosts.size} deleted / ${edits.size} edited`,
    ];
}
