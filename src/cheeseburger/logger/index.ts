import { before } from "@api/patcher";
import { waitForHydration } from "@api/storage";
import { findByName, findByProps } from "@metro";
import { FluxDispatcher } from "@metro/common";
import { ChannelStore, GuildStore, MessageStore, UserStore } from "@metro/common/stores";
import { isPluginEnabled, pluginInstances, startPlugin, stopPlugin } from "@plugins";

import { caught, safe } from "../crash";
import { flushSaved, getSaved, loadSaved, putSaved, Saved, savedIn, savedInfo, setSavedLimit } from "./saved";
import { loggerSettings, useLoggerSettings } from "./storage";

interface Edit { old: string[]; current: string; }

const CORE = "messagelogger";
const SKIP = "CHEESEBURGER_LOGGER_SKIP";
const REPEAT_MS = 15_000;
const HISTORY = /^-# (?:~~.*~~|\u200b.*)$/;
const TYPES = new Set(["MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "MESSAGE_UPDATE", "MESSAGE_START_EDIT", "LOAD_MESSAGES_SUCCESS", "LOAD_MESSAGES_AROUND_SUCCESS", "LOAD_MESSAGES_SUCCESS_CACHED", "LOCAL_MESSAGES_LOADED"]);
const loads = new Map<string, string>();
const G = globalThis as any;
const ghosts: Map<string, number> = G.__cheeseburgerGhosts ??= new Map();
const edits: Map<string, Edit> = G.__cheeseburgerEdits ??= new Map();
const stats = { deletes: 0, repeats: 0, bulk: 0, edits: 0, editBox: 0, saved: 0, restored: 0 };

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

function clock(t: number) {
    const d = new Date(t);
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function when(t: number) {
    const d = new Date(t);
    return d.toDateString() === new Date().toDateString() ? clock(t) : `${d.getMonth() + 1}/${d.getDate()} ${clock(t)}`;
}

function myId(): string | undefined {
    try {
        return UserStore.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

const depth = () => {
    const n = Math.round(Number(loggerSettings.depth));
    return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;
};

function subtext(text: string): string[] {
    return text.split("\n")
        .map(l => l.replace(/```\w*/g, "").replace(/~~/g, "").replace(/^\s*(?:>>>|>|-#|#{1,3}(?=\s)|[*-](?=\s))\s*/, "").trim())
        .filter(Boolean)
        .map(l => `-# \u200b${l}`);
}

function compose(old: string[], current: string): string {
    const lines = old.slice(-depth()).flatMap(subtext);
    return lines.length ? `${lines.join("\n")}\n${current}` : current;
}

function split(content: string): Edit {
    const lines = content.split("\n");
    let i = 0;
    while (i < lines.length && HISTORY.test(lines[i])) i++;
    return { old: lines.slice(0, i).map(l => (l.startsWith("-# ~~") ? l.slice(5, -2) : l.slice(4))), current: lines.slice(i).join("\n") };
}

function channelOf(id: string): any {
    try {
        return ChannelStore.getChannel?.(id) ?? null;
    } catch {
        return null;
    }
}

const nameOf = (u: any): string => u?.globalName ?? u?.global_name ?? u?.username ?? "someone";

function whereOf(ch: any): string {
    if (!ch) return "a chat";
    if (ch.type === 1) {
        const rid = ch.recipients?.[0] ?? ch.rawRecipients?.[0]?.id;
        let u: any = null;
        try {
            u = rid ? UserStore.getUser?.(rid) : null;
        } catch { }
        return `dm with ${nameOf(u ?? ch.rawRecipients?.[0])}`;
    }
    if (ch.type === 3) return ch.name ? `group ${ch.name}` : "group dm";
    let g: any = null;
    try {
        g = GuildStore.getGuild?.(ch.guild_id);
    } catch { }
    return `#${ch.name ?? "channel"}${g?.name ? ` in ${g.name}` : ""}`;
}

const isPrivate = (ch: any) => ch?.type === 1 || ch?.type === 3;

function mentionsMe(...ms: any[]): boolean {
    const me = myId();
    if (!me) return false;
    for (const m of ms) {
        if (!m) continue;
        if (Array.isArray(m.mentions) && m.mentions.some((u: any) => (typeof u === "string" ? u : u?.id) === me)) return true;
        if (loggerSettings.everyone && (m.mentionEveryone || m.mention_everyone)) return true;
    }
    return false;
}

function allowed(author: any): boolean {
    if (loggerSettings.ignoreBots !== false && author?.bot) return false;
    if (loggerSettings.mine === false && author?.id && author.id === myId()) return false;
    return true;
}

const shown = (ch: any, ...ms: any[]) => !ch || isPrivate(ch) || loggerSettings.servers !== false || mentionsMe(...ms);

function saving(ch: any, ...ms: any[]): boolean {
    if (loggerSettings.save === false || !ch) return false;
    if (ch.type === 1) return loggerSettings.saveDms !== false;
    if (ch.type === 3) return loggerSettings.saveGroups !== false;
    return !!loggerSettings.saveServers || loggerSettings.saveMentions !== false && mentionsMe(...ms);
}

function timeOf(t: any): number {
    try {
        if (typeof t === "number") return t;
        if (typeof t === "string") return Date.parse(t) || 0;
        const v = Number(t?.valueOf?.());
        if (Number.isFinite(v)) return v;
    } catch { }
    return 0;
}

const iso = (t: any) => {
    const v = timeOf(t);
    return v ? new Date(v).toISOString() : null;
};

function filesOf(m: any): string[] {
    try {
        return (m?.attachments ?? []).map((a: any) => a?.url ?? a?.proxy_url).filter((u: any) => typeof u === "string").slice(0, 10);
    } catch {
        return [];
    }
}

function rawOf(m: any, channelId: string): any {
    const a = m.author ?? {};
    return {
        id: m.id,
        type: 0,
        channel_id: channelId,
        content: typeof m.content === "string" ? m.content : "",
        author: { id: a.id, username: a.username ?? "unknown", discriminator: a.discriminator ?? "0", avatar: a.avatar ?? null, global_name: a.globalName ?? a.global_name ?? null, bot: !!a.bot },
        attachments: (m.attachments ?? []).filter((x: any) => x?.id && x?.url).slice(0, 10).map((x: any) => ({
            id: x.id,
            filename: x.filename ?? "file",
            size: x.size ?? 0,
            url: x.url,
            proxy_url: x.proxy_url ?? x.proxyURL ?? x.url,
            width: x.width ?? undefined,
            height: x.height ?? undefined,
            content_type: x.content_type ?? x.contentType ?? undefined,
        })),
        embeds: [],
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        tts: false,
        timestamp: iso(m.timestamp) ?? new Date().toISOString(),
        edited_timestamp: iso(m.editedTimestamp ?? m.edited_timestamp),
        flags: 0,
        components: [],
    };
}

function saveDeleted(m: any, channelId: string, ch: any) {
    const parsed = typeof m.content === "string" ? split(m.content) : { old: [], current: "" };
    const rec = edits.get(m.id);
    putSaved({
        id: m.id,
        channelId,
        guildId: ch?.guild_id ?? undefined,
        where: whereOf(ch),
        authorId: m.author?.id ?? "",
        author: nameOf(m.author),
        kind: "deleted",
        at: Date.now(),
        sent: timeOf(m.timestamp),
        content: rec?.current ?? parsed.current,
        old: (rec?.old ?? parsed.old).slice(-10),
        files: filesOf(m),
        raw: rawOf(m, channelId),
    });
    stats.saved++;
}

function saveEdited(m: any, prev: any, rec: Edit, channelId: string, ch: any) {
    const author = m.author ?? prev?.author;
    putSaved({
        id: m.id,
        channelId,
        guildId: ch?.guild_id ?? undefined,
        where: whereOf(ch),
        authorId: author?.id ?? "",
        author: nameOf(author),
        kind: "edited",
        at: Date.now(),
        sent: timeOf(prev?.timestamp ?? m.timestamp),
        content: rec.current,
        old: rec.old.slice(-10),
        files: filesOf(prev ?? m),
    });
    stats.saved++;
}

function ghostEvent(channelId: string, id: string, at: number, fresh: boolean) {
    ghosts.set(id, fresh ? Date.now() : 0);
    cap(ghosts, 2000);
    return {
        type: "MESSAGE_EDIT_FAILED_AUTOMOD",
        cheeseburgerLogger: true,
        messageData: { type: 1, message: { channelId, messageId: id } },
        errorResponseBody: { code: 200000, message: `deleted at ${when(at)}` },
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
    if (!message || !allowed(message.author)) return;
    const ch = channelOf(channelId);
    if (saving(ch, message)) saveDeleted(message, channelId, ch);
    if (loggerSettings.keepDeleted === false || !shown(ch, message)) return;
    stats.deletes++;
    args[0] = ghostEvent(channelId, id, Date.now(), true);
    redraw(message);
    return args;
}

function onBulk(args: any[], e: any) {
    const channelId = e.channelId;
    const ids: string[] = Array.isArray(e.ids) ? e.ids : [];
    if (!channelId || !ids.length) return;
    const ch = channelOf(channelId);
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
        if (!message || !allowed(message.author)) {
            keep.push(id);
            continue;
        }
        if (saving(ch, message)) saveDeleted(message, channelId, ch);
        if (loggerSettings.keepDeleted === false || !shown(ch, message)) keep.push(id);
        else later.push([id, message]);
    }
    if (keep.length === ids.length) return;
    stats.bulk += later.length;
    for (const [id] of later) ghosts.set(id, Date.now());
    args[0] = keep.length ? { ...e, ids: keep } : { type: SKIP };
    timers.push(setTimeout(safe("logger bulk", () => {
        for (const [id, message] of later) {
            FluxDispatcher.dispatch(ghostEvent(channelId, id, Date.now(), true));
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
    const author = m.author ?? prev?.author;
    if (!allowed(author)) return;
    if (!editBoxFixed && author?.id && author.id === myId()) return;
    const ch = channelId ? channelOf(channelId) : null;
    const display = loggerSettings.showEdits !== false && shown(ch, m, prev);
    let rec = edits.get(m.id);
    if (!rec) {
        if (!prev || typeof prev.content !== "string") return;
        const parsed = split(prev.content);
        if (parsed.current === m.content || !parsed.current.trim() && !parsed.old.length) return;
        rec = parsed;
    } else if (rec.current === m.content) {
        if (!display || !rec.old.length) return;
        args[0] = { ...e, message: { ...m, content: compose(rec.old, m.content) } };
        return args;
    }
    if (rec.current.trim()) rec.old = [...rec.old, rec.current].slice(-10);
    rec.current = m.content;
    edits.set(m.id, rec);
    cap(edits, 1000);
    stats.edits++;
    if (channelId && saving(ch, m, prev)) saveEdited(m, prev, rec, channelId, ch);
    if (!display) return;
    args[0] = { ...e, message: { ...m, content: compose(rec.old, m.content) } };
    return args;
}

const cmpId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

function onLoad(args: any[], e: any) {
    const channelId = e.channelId;
    const list: any[] | null = Array.isArray(e.messages) ? e.messages : null;
    const flags = ["isBefore", "isAfter", "jump", "cached", "hasMoreBefore", "hasMoreAfter"].filter(k => e[k]).join(" ");
    loads.set(e.type, `${list ? list.length : "no list"} msgs${flags ? ` (${flags})` : ""}`);
    if (!channelId || !list?.length) return;
    let changed = false;
    const out = list.map(m => {
        if (!m || typeof m.id !== "string" || typeof m.content !== "string") return m;
        const s = getSaved(m.id);
        const known = edits.get(m.id);
        if (!known && !s?.old.length) return m;
        const rec: Edit = known ?? { old: [...s!.old], current: s!.content };
        if (rec.current !== m.content) {
            if (rec.current.trim()) rec.old = [...rec.old, rec.current].slice(-10);
            rec.current = m.content;
            if (s) putSaved({ ...s, content: m.content, old: rec.old });
        }
        edits.set(m.id, rec);
        if (loggerSettings.showEdits === false || !rec.old.length || !allowed(m.author)) return m;
        changed = true;
        return { ...m, content: compose(rec.old, m.content) };
    });
    const restored: Saved[] = [];
    if (loggerSettings.restore !== false && loggerSettings.keepDeleted !== false) {
        const ids = list.map(m => m?.id).filter((x: any): x is string => typeof x === "string").sort(cmpId);
        const oldest = ids[0];
        const newest = ids[ids.length - 1];
        const present = new Set(ids);
        for (const s of savedIn(channelId)) {
            if (s.kind !== "deleted" || !s.raw || present.has(s.id)) continue;
            if (cmpId(s.id, oldest) < 0 && e.hasMoreBefore !== false) continue;
            if (cmpId(s.id, newest) > 0 && (e.isBefore || e.hasMoreAfter)) continue;
            restored.push(s);
        }
    }
    if (!changed && !restored.length) return;
    for (const s of restored) ghosts.set(s.id, 0);
    const merged = restored.length ? [...out, ...restored.map(s => ({ ...s.raw }))].sort((a, b) => cmpId(String(b?.id ?? ""), String(a?.id ?? ""))) : out;
    args[0] = { ...e, messages: merged };
    if (restored.length) {
        stats.restored += restored.length;
        timers.push(setTimeout(safe("logger restore", () => {
            for (const s of restored) FluxDispatcher.dispatch(ghostEvent(channelId, s.id, s.at, false));
        }), 0));
    }
    return args;
}

function cleanContent(id: unknown, content: unknown): string | null {
    if (typeof id !== "string" || typeof content !== "string") return null;
    const rec = edits.get(id);
    if (rec && content === compose(rec.old, rec.current)) return rec.current;
    const parsed = split(content);
    return parsed.old.length ? parsed.current : null;
}

const onDispatch = safe("logger", (args: any[]) => {
    const e = args[0];
    if (!e || !TYPES.has(e.type) || e.otherPluginBypass || e.cheeseburgerLogger || coreOn()) return;
    switch (e.type) {
        case "MESSAGE_UPDATE": return onUpdate(args, e);
        case "MESSAGE_DELETE": return onDelete(args, e);
        case "MESSAGE_DELETE_BULK": return onBulk(args, e);
        case "MESSAGE_START_EDIT": break;
        default: return onLoad(args, e);
    }
    const clean = cleanContent(e.messageId, e.content);
    if (clean == null) return;
    stats.editBox++;
    args[0] = { ...e, content: clean };
    return args;
});

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
        setSavedLimit(Number(loggerSettings.maxSaved) || 3000);
        loadSaved().catch((e: any) => caught("logger load", e));
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
        void flushSaved();
        if (!G.__cheeseburgerSwapping && loggerSettings.tookOver && pluginInstances.has(CORE)) {
            loggerSettings.tookOver = false;
            startPlugin(CORE).catch((e: any) => caught("logger give back", e));
        }
    },
};

export function loggerDebug(): string[] {
    const info = savedInfo();
    return [
        `logger: ${note}, old plugin ${coreOn() ? "on (cheeseburger steps aside)" : "off"}, edit box fix ${editBoxFixed ? "on" : "off (own edits not shown)"}`,
        `kept deleted ${stats.deletes}, repeat deletes swallowed ${stats.repeats}, bulk ${stats.bulk}, edits ${stats.edits}, edit box cleaned ${stats.editBox}, remembered ${ghosts.size} deleted / ${edits.size} edited`,
        `saved on phone: ${info.loaded ? `${info.count} messages, ${info.kb}kb` : "loading"}, saved this run ${stats.saved}, put back in chat ${stats.restored}`,
        `loads seen: ${[...loads].map(([t, v]) => `${t} ${v}`).join("; ") || "none yet"}`,
        `settings: ${JSON.stringify(useLoggerSettings.getState())}`.slice(0, 500),
    ];
}
