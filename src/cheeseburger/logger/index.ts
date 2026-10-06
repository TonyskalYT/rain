import { after, before } from "@api/patcher";
import { waitForHydration } from "@api/storage";
import { findByName, findByProps, findByStoreName } from "@metro";
import { FluxDispatcher } from "@metro/common";
import { ChannelStore, GuildStore, MessageStore, SelectedChannelStore, UserStore } from "@metro/common/stores";
import { isPluginEnabled, pluginInstances, startPlugin, stopPlugin } from "@plugins";
import { AppState } from "react-native";

import { caught, safe } from "../crash";
import { flushSaved, getSaved, loadSaved, putSaved, savedIn, savedInfo, setSavedLimit } from "./saved";
import { loggerSettings, useLoggerSettings } from "./storage";

interface Edit { old: string[]; current: string; }

const CORE = "messagelogger";
const SKIP = "CHEESEBURGER_LOGGER_SKIP";
const REPEAT_MS = 15_000;
const HISTORY = /^-# (?:~~.*~~|\u200b.*)$/;
const MARK = "\u2063";
const MARKED = /^-# \u2063.*$/;
const NUDGE = "\u2060";
const NUDGED = /\u2060+$/;
const RED_BG = 0x26F04747 | 0;
const RED_GUTTER = 0xFFF04747 | 0;
const TYPES = new Set(["MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "MESSAGE_UPDATE", "MESSAGE_START_EDIT", "MESSAGE_END_EDIT", "CONNECTION_OPEN", "LOAD_MESSAGES_SUCCESS", "LOAD_MESSAGES_AROUND_SUCCESS", "LOAD_MESSAGES_SUCCESS_CACHED", "LOCAL_MESSAGES_LOADED"]);
const loads = new Map<string, string>();
const G = globalThis as any;
const ghosts: Map<string, number> = G.__cheeseburgerGhosts ??= new Map();
const ghostInfo: Map<string, { channelId: string; at: number; }> = G.__cheeseburgerGhostInfo ??= new Map();
const deletedRaw: Map<string, { channelId: string; at: number; raw: any; }> = G.__cheeseburgerDeletedRaw ??= new Map();
const edits: Map<string, Edit> = G.__cheeseburgerEdits ??= new Map();
const trail: string[] = G.__cheeseburgerLoggerTrail ??= [];
const stats = { deletes: 0, repeats: 0, bulk: 0, edits: 0, editBox: 0, saved: 0, restored: 0 };
const probe = { rows: 0, noteInRow: 0, noteInStore: 0, noteMissing: 0, red: 0, renotes: 0, marks: 0, opens: 0, hlCalls: 0, hlMsg: 0, hlNum: false, hlGhost: 0, hl: "not tried", hlShape: "", rowShape: "", notePath: "", rowTypes: new Set<string>() };
const tags = new Map<string, number>();
const lastTry = new Map<string, number>();
const renoted = new Map<string, number>();
const noteSeen = new Map<string, number>();
const drawn = new Map<string, number>();
const firstDraw = new Set<string>();
let automod: any;
let highlightOn = false;

const unpatches: (() => unknown)[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
let running = false;
let editBoxFixed = false;
let status = "off";

function cap(m: Map<string, unknown>, n: number) {
    while (m.size > n) m.delete(m.keys().next().value!);
}

function tag(id: string) {
    if (!tags.has(id)) tags.set(id, tags.size + 1);
    return `#${tags.get(id)}`;
}

function note(line: string) {
    trail.push(`${clock(Date.now())} ${line}`);
    if (trail.length > 30) trail.shift();
}

function automodStore(): any {
    if (automod === undefined) {
        try {
            automod = findByStoreName("GuildAutomodMessageStore") ?? null;
        } catch {
            automod = null;
        }
    }
    return automod;
}

function noteKept(id: string): boolean | null {
    try {
        const store = automodStore();
        if (typeof store?.getMessage !== "function") return null;
        return store.getMessage(id) != null;
    } catch {
        return null;
    }
}

function shape(v: any): string {
    if (!v || typeof v !== "object") return typeof v;
    return Object.keys(v).slice(0, 24).map(k => `${k}:${Array.isArray(v[k]) ? "array" : typeof v[k]}`).join(",");
}

function pathOf(v: any, text: string, path = "", depth = 0): string | null {
    if (depth > 6 || v == null) return null;
    if (typeof v === "string") return v.split(`${MARK}${text}`).join("").includes(text) ? path || "." : null;
    if (typeof v !== "object") return null;
    for (const k of Object.keys(v)) {
        const hit = pathOf(v[k], text, path ? `${path}.${k}` : k, depth + 1);
        if (hit) return hit.replace(/\.\d+(?=\.|$)/g, "[]");
    }
    return null;
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
    return { old: lines.slice(0, i).map(l => (l.startsWith("-# ~~") ? l.slice(5, -2) : l.slice(4))), current: lines.slice(i).filter(l => !MARKED.test(l)).join("\n").replace(NUDGED, "") };
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

function remember(id: string, channelId: string, at: number, raw?: any) {
    ghostInfo.set(id, { channelId, at });
    cap(ghostInfo, 2000);
    if (raw) {
        deletedRaw.set(id, { channelId, at, raw });
        cap(deletedRaw, 500);
    }
}

function noteEvent(channelId: string, id: string, at: number) {
    return {
        type: "MESSAGE_EDIT_FAILED_AUTOMOD",
        cheeseburgerLogger: true,
        messageData: { type: 1, message: { channelId, messageId: id } },
        errorResponseBody: { code: 200000, message: `deleted at ${when(at)}` },
    };
}

function ghostEvent(channelId: string, id: string, at: number, fresh: boolean) {
    if (fresh || !ghosts.has(id)) ghosts.set(id, fresh ? Date.now() : 0);
    cap(ghosts, 2000);
    remember(id, channelId, at);
    return noteEvent(channelId, id, at);
}

const emojiOnly = (text: string) => !/[A-Za-z0-9]/.test(text.replace(/<a?:\w+:\d+>/g, ""));

function redraw(id: string, channelId: string, force = false) {
    timers.push(setTimeout(safe("logger redraw", () => {
        const cur = MessageStore.getMessage?.(channelId, id);
        if (!cur) return;
        const text: string = typeof cur.content === "string" ? cur.content : "";
        const message: any = { id, channel_id: channelId, attachments: Array.isArray(cur.attachments) ? [...cur.attachments] : [], pinned: cur.pinned, flags: cur.flags };
        if (force || text && !emojiOnly(text)) message.content = `${text}${NUDGE}`;
        FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", otherPluginBypass: true, cheeseburgerLogger: true, message });
    }), 0));
}

function checkNote(id: string) {
    timers.push(setTimeout(safe("logger note check", () => {
        const kept = noteKept(id);
        note(`note for ${tag(id)} ${kept === null ? "unknown" : kept ? "set" : "missing"}`);
    }), 50));
}

const throttled = (key: string, ms: number) => {
    const now = Date.now();
    if (now - (lastTry.get(key) ?? 0) < ms) return true;
    lastTry.set(key, now);
    cap(lastTry, 500);
    return false;
};

function renote(id: string, why: string) {
    const info = ghostInfo.get(id);
    if (!info || !ghosts.has(id) || (renoted.get(id) ?? 0) >= 3 || throttled(`n${id}`, 3000)) return;
    timers.push(setTimeout(safe("logger renote", () => {
        if (!running || coreOn() || noteKept(id) === true) return;
        if (!MessageStore.getMessage?.(info.channelId, id)) return;
        renoted.set(id, (renoted.get(id) ?? 0) + 1);
        cap(renoted, 500);
        FluxDispatcher.dispatch(noteEvent(info.channelId, id, info.at));
        probe.renotes++;
        note(`note put back on ${tag(id)} (${why})`);
    }), 0));
}

function renoteAll(why: string) {
    timers.push(setTimeout(safe("logger renote all", () => {
        if (!running || coreOn()) return;
        let n = 0;
        for (const [id, info] of ghostInfo) {
            if (!ghosts.has(id) || noteKept(id) === true || !MessageStore.getMessage?.(info.channelId, id)) continue;
            FluxDispatcher.dispatch(noteEvent(info.channelId, id, info.at));
            if (++n >= 300) break;
        }
        probe.renotes += n;
        note(`${why}: put back ${n} notes`);
    }), 1500));
}

function nudge(id: string, channelId: string, at: number, round = 1) {
    timers.push(setTimeout(safe("logger nudge", () => {
        if (!running || coreOn() || !ghosts.has(id)) return;
        if ((drawn.get(id) ?? 0) >= at) return;
        let open = true;
        try {
            open = SelectedChannelStore.getChannelId?.() === channelId && AppState.currentState === "active";
        } catch { }
        if (!open) {
            note(`${tag(id)} not on screen, it'll show when the chat opens`);
            return;
        }
        note(`${tag(id)} not redrawn after ${round === 1 ? "1.5s" : "4s"}, nudging again`);
        redraw(id, channelId, true);
        if (round === 1) nudge(id, channelId, at, 2);
    }), round === 1 ? 1500 : 2500));
}

function isEdited(m: any): boolean {
    return m?.editedTimestamp != null || m?.edited_timestamp != null || !!edits.get(m?.id)?.old.length || typeof m?.content === "string" && split(m.content).old.length > 0;
}

function mark(id: string) {
    const info = ghostInfo.get(id);
    if (!info || throttled(`m${id}`, 2000)) return;
    timers.push(setTimeout(safe("logger mark", () => {
        if (!running || coreOn() || !ghosts.has(id) || Date.now() - (noteSeen.get(id) ?? 0) < 1500) return;
        const cur = MessageStore.getMessage?.(info.channelId, id);
        if (!cur || typeof cur.content !== "string" || cur.content.includes(MARK)) return;
        const line = `-# ${MARK}deleted at ${when(info.at)}`;
        FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            otherPluginBypass: true,
            cheeseburgerLogger: true,
            message: { id, channel_id: info.channelId, content: cur.content ? `${cur.content}\n${line}` : line, pinned: cur.pinned },
        });
        probe.marks++;
        note(`marked ${tag(id)} as deleted in its text`);
    }), 400));
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
    const at = Date.now();
    args[0] = ghostEvent(channelId, id, at, true);
    remember(id, channelId, at, rawOf({ ...message, content: typeof message.content === "string" ? message.content.split("\n").filter((l: string) => !MARKED.test(l)).join("\n").replace(NUDGED, "") : "" }, channelId));
    let where = "";
    try {
        where = SelectedChannelStore.getChannelId?.() === channelId ? AppState.currentState === "active" ? " (on screen)" : " (app in background)" : " (other chat)";
    } catch { }
    note(`deleted ${tag(id)}${isEdited(message) ? " (edited)" : ""}${message.author?.id && message.author.id === myId() ? " (mine)" : ""}${where}`);
    redraw(id, channelId);
    checkNote(id);
    nudge(id, channelId, at);
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
    const at = Date.now();
    for (const [id, message] of later) {
        ghosts.set(id, at);
        remember(id, channelId, at, rawOf(message, channelId));
    }
    note(`bulk deleted ${later.length}`);
    args[0] = keep.length ? { ...e, ids: keep } : { type: SKIP };
    timers.push(setTimeout(safe("logger bulk", () => {
        for (const [id] of later) {
            FluxDispatcher.dispatch(ghostEvent(channelId, id, at, true));
            redraw(id, channelId);
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
    const restored: { id: string; at: number; raw: any; }[] = [];
    if (loggerSettings.restore !== false && loggerSettings.keepDeleted !== false) {
        const ids = list.map(m => m?.id).filter((x: any): x is string => typeof x === "string").sort(cmpId);
        const oldest = ids[0];
        const newest = ids[ids.length - 1];
        const present = new Set(ids);
        const pool = new Map<string, { id: string; at: number; raw: any; }>();
        for (const s of savedIn(channelId)) if (s.kind === "deleted" && s.raw) pool.set(s.id, { id: s.id, at: s.at, raw: s.raw });
        for (const [id, d] of deletedRaw) if (d.channelId === channelId && !pool.has(id)) pool.set(id, { id, at: d.at, raw: d.raw });
        for (const s of pool.values()) {
            if (present.has(s.id)) continue;
            if (cmpId(s.id, oldest) < 0 && e.hasMoreBefore !== false) continue;
            if (cmpId(s.id, newest) > 0 && (e.isBefore || e.hasMoreAfter)) continue;
            restored.push(s);
        }
    }
    if (!changed && !restored.length) return;
    for (const s of restored) {
        if (!ghosts.has(s.id)) ghosts.set(s.id, 0);
        remember(s.id, channelId, s.at);
    }
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
        case "MESSAGE_END_EDIT": {
            const id = e.response?.body?.id;
            if (typeof id === "string" && ghosts.has(id)) renote(id, "edit ended");
            return;
        }
        case "CONNECTION_OPEN":
            probe.opens++;
            renoted.clear();
            if (ghosts.size) renoteAll("reconnected");
            return;
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
        const data = args[0];
        const msg = data?.message;
        if (!msg || !ghosts.has(msg.id) || coreOn()) return;
        if (loggerSettings.red === false) return;
        if (!msg.style) msg.style = { backgroundColor: "rgba(240, 71, 71, 0.1)", borderLeftWidth: 4, borderLeftColor: "#F04747" };
        if (highlightOn && probe.hlMsg > 0 && !msg.mentioned && typeof msg.set === "function") {
            const copy = msg.set("mentioned", true);
            if (copy && copy !== msg) data.message = copy;
        }
    })));
    unpatches.push(after("generate", RowManager.prototype, safe("logger row after", (args: any[], row: any) => {
        const data = args[0];
        const msg = data?.message;
        if (!msg || !row || typeof row !== "object" || coreOn()) return;
        const isRow = data?.rowType == null || data.rowType === 1;
        if (!probe.rowShape && isRow) probe.rowShape = `row {${shape(row)}} message {${shape(row.message)}}`;
        if (!ghosts.has(msg.id)) return;
        drawn.set(msg.id, Date.now());
        cap(drawn, 500);
        const info = ghostInfo.get(msg.id);
        const logFirst = !!info && Date.now() - info.at < 60_000 && !firstDraw.has(msg.id);
        if (logFirst) {
            if (firstDraw.size > 500) firstDraw.clear();
            firstDraw.add(msg.id);
        }
        if (probe.rowTypes.size < 6) probe.rowTypes.add(String(data?.rowType));
        let json = "";
        try {
            json = JSON.stringify(row);
        } catch { }
        const shown = json.split(`${MARK}deleted at`).join("").includes("deleted at");
        if (logFirst) note(`${tag(msg.id)} redrawn ${Date.now() - info!.at}ms after the delete, ${shown ? "with" : "without"} its note`);
        if (shown) {
            noteSeen.set(msg.id, Date.now());
            cap(noteSeen, 500);
            if (!probe.notePath) probe.notePath = `${isRow ? "" : `row type ${String(data?.rowType)} `}${pathOf(row, "deleted at") ?? "?"}`;
        }
        if (!isRow) return;
        probe.rows++;
        if (shown) probe.noteInRow++;
        const kept = noteKept(msg.id);
        if (kept === true) probe.noteInStore++;
        if (kept === false) {
            probe.noteMissing++;
            renote(msg.id, "row without note");
        }
        if (!shown && loggerSettings.markText !== false && (probe.notePath || isEdited(msg)) && !(typeof msg.content === "string" && msg.content.includes(MARK))) mark(msg.id);
    })));
}

function paintRed() {
    const utils = findByProps("createBackgroundHighlight");
    if (typeof utils?.createBackgroundHighlight !== "function") {
        probe.hl = "not found";
        return;
    }
    unpatches.push(after("createBackgroundHighlight", utils, safe("logger red", (args: any[], ret: any) => {
        probe.hlCalls++;
        if (ret && typeof ret === "object" && !probe.hlShape) probe.hlShape = shape(ret);
        const id = args[0]?.message?.id;
        if (typeof id === "string") probe.hlMsg++;
        if (typeof ret?.backgroundColor === "number") probe.hlNum = true;
        if (typeof id !== "string" || !ghosts.has(id) || coreOn() || loggerSettings.red === false || !ret || typeof ret !== "object") return;
        probe.hlGhost++;
        const next = { ...ret };
        if (typeof ret.backgroundColor === "number") next.backgroundColor = RED_BG;
        if (typeof ret.gutterColor === "number") next.gutterColor = RED_GUTTER;
        probe.red++;
        return next;
    })));
    highlightOn = true;
    probe.hl = "on";
}

const takeOver = safe("logger takeover", () => {
    if (!running || !pluginInstances.has(CORE) || !isPluginEnabled(CORE)) return;
    stopPlugin(CORE).then(safe("logger took over", () => {
        loggerSettings.tookOver = true;
        status = "took over from the old MessageLogger plugin";
    }), (e: any) => {
        caught("logger takeover", e);
        status = "couldn't turn off the old MessageLogger plugin";
    });
});

export default {
    async start() {
        await waitForHydration(useLoggerSettings);
        running = true;
        status = "on";
        setSavedLimit(Number(loggerSettings.maxSaved) || 3000);
        loadSaved().catch((e: any) => caught("logger load", e));
        unpatches.push(before("dispatch", FluxDispatcher, onDispatch));
        try {
            fixEditBox();
        } catch (e) {
            caught("logger edit box", e);
        }
        try {
            paintRed();
        } catch (e) {
            probe.hl = "failed";
            caught("logger red", e);
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
        highlightOn = false;
        status = "off";
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
        `logger: ${status}, old plugin ${coreOn() ? "on (cheeseburger steps aside)" : "off"}, edit box fix ${editBoxFixed ? "on" : "off (own edits not shown)"}`,
        `kept deleted ${stats.deletes}, repeat deletes swallowed ${stats.repeats}, bulk ${stats.bulk}, edits ${stats.edits}, edit box cleaned ${stats.editBox}, remembered ${ghosts.size} deleted / ${edits.size} edited`,
        `saved on phone: ${info.loaded ? `${info.count} messages, ${info.kb}kb` : "loading"}, saved this run ${stats.saved}, put back in chat ${stats.restored}`,
        `loads seen: ${[...loads].map(([t, v]) => `${t} ${v}`).join("; ") || "none yet"}`,
        `deleted rows drawn ${probe.rows}: note in row ${probe.noteInRow}, note in store ${probe.noteInStore}, note missing ${probe.noteMissing}, red ${probe.red}, notes put back ${probe.renotes}, marked in text ${probe.marks}, reconnects ${probe.opens}`,
        `automod note store ${automodStore() ? "found" : "not found"}, note found at ${probe.notePath || "?"}`,
        `red highlight ${probe.hl}, calls ${probe.hlCalls} (with a message ${probe.hlMsg}), on deleted ${probe.hlGhost}, shape {${probe.hlShape || "?"}}, deleted row types ${[...probe.rowTypes].join(",") || "?"}`,
        `row shape: ${probe.rowShape || "none yet"}`.slice(0, 600),
        ...(trail.length ? ["trail:", ...trail.map(l => `  ${l}`)] : []),
        `settings: ${JSON.stringify(useLoggerSettings.getState())}`.slice(0, 500),
    ];
}
