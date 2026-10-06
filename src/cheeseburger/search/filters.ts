import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "./query";

export type Kind = "any" | "photos" | "videos" | "media" | "audio" | "gifs" | "files" | "links" | "embeds" | "stickers" | "polls" | "forwards";
export type Leave = "gifs" | "links" | "files" | "media" | "bots" | "stickers";
export type When = "any" | "today" | "week" | "month" | "year" | "older" | "custom";
export type Sort = "new" | "old" | "best";
export type Pinned = "any" | "only" | "no";
export type ScopeKind = "chat" | "server" | "dms";

export interface AdvancedFilters {
    words: string;
    exact: boolean;
    fromMe: boolean;
    from: string[];
    kind: Kind;
    leave: Leave[];
    ext: string;
    filename: string;
    site: string;
    mentionsMe: boolean;
    repliesToMe: boolean;
    pinned: Pinned;
    when: When;
    after: string;
    before: string;
    sort: Sort;
}

export interface Scope {
    kind: ScopeKind;
    channelId?: string;
    guildId?: string;
    isPrivate?: boolean;
}

export interface Page {
    cursor?: any;
    offset?: number;
}

export interface SearchRequest {
    url: string;
    body: any;
}

export interface Results {
    hits: any[];
    total: number;
    cursor: any | null;
    channels: Record<string, any>;
    indexing: boolean;
}

export const blankFilters = (): AdvancedFilters => ({
    words: "",
    exact: false,
    fromMe: false,
    from: [],
    kind: "any",
    leave: [],
    ext: "",
    filename: "",
    site: "",
    mentionsMe: false,
    repliesToMe: false,
    pinned: "any",
    when: "any",
    after: "",
    before: "",
    sort: "new",
});

export const KINDS: [Kind, string][] = [
    ["any", "anything"],
    ["photos", "photos"],
    ["videos", "videos"],
    ["media", "photos + videos"],
    ["audio", "audio"],
    ["gifs", "gifs"],
    ["files", "files"],
    ["links", "links"],
    ["embeds", "embeds"],
    ["stickers", "stickers"],
    ["polls", "polls"],
    ["forwards", "forwards"],
];

export const LEAVES: [Leave, string][] = [
    ["gifs", "gifs + embeds"],
    ["links", "links"],
    ["files", "files"],
    ["media", "photos + videos"],
    ["stickers", "stickers"],
    ["bots", "bots"],
];

export const WHENS: [When, string][] = [
    ["any", "any time"],
    ["today", "today"],
    ["week", "past week"],
    ["month", "past month"],
    ["year", "past year"],
    ["older", "over a year ago"],
    ["custom", "pick dates"],
];

export const SORTS: [Sort, string][] = [
    ["new", "newest"],
    ["old", "oldest"],
    ["best", "best match"],
];

export const PINS: [Pinned, string][] = [
    ["any", "any"],
    ["only", "pinned"],
    ["no", "not pinned"],
];

const CLASH: Record<Leave, Kind[]> = {
    gifs: ["gifs", "embeds"],
    links: ["links"],
    files: ["files", "photos", "videos", "media", "audio"],
    media: ["photos", "videos", "media"],
    stickers: ["stickers"],
    bots: [],
};

export const clashes = (leave: Leave, kind: Kind) => CLASH[leave].includes(kind);

const DAY = 86_400_000;
const EPOCH = 1420070400000;

export function snowflakeAt(ms: number): string {
    const t = Math.max(0, Math.floor(ms) - EPOCH);
    try {
        return (BigInt(t) * BigInt(4194304)).toString();
    } catch {
        return String(Math.floor(t * 4194304));
    }
}

export function timeOfSnowflake(id: string): number {
    try {
        return Number(BigInt(id) / BigInt(4194304)) + EPOCH;
    } catch {
        return Math.floor(Number(id) / 4194304) + EPOCH;
    }
}

const startOfDay = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

export function parseDay(text: string, end: boolean): number | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    let y: number, m = 0, d = 1, span: "day" | "month" | "year" = "day";
    let hit: RegExpMatchArray | null;
    if ((hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
        y = +hit[1];
        m = +hit[2] - 1;
        d = +hit[3];
    } else if ((hit = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
        y = +hit[3] < 100 ? 2000 + +hit[3] : +hit[3];
        m = +hit[1] - 1;
        d = +hit[2];
    } else if ((hit = t.match(/^(\d{4})-(\d{1,2})$/)) || (hit = t.match(/^(\d{1,2})\/(\d{4})$/))) {
        const [a, b] = [+hit[1], +hit[2]];
        y = a > 999 ? a : b;
        m = (a > 999 ? b : a) - 1;
        span = "month";
    } else if ((hit = t.match(/^(\d{4})$/))) {
        y = +hit[1];
        span = "year";
    } else return null;
    if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2015 || y > 2100) return null;
    const start = new Date(y, m, d).getTime();
    if (!end) return start;
    const next = span === "year" ? new Date(y + 1, 0, 1) : span === "month" ? new Date(y, m + 1, 1) : new Date(y, m, d + 1);
    return next.getTime() - 1;
}

const list = (s: string) => s.split(/[\s,]+/).map(x => x.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);

function hosts(s: string): string[] {
    const out: string[] = [];
    for (const raw of s.split(/[\s,]+/)) {
        const h = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
        if (!h || !h.includes(".")) continue;
        out.push(h);
        if (!h.startsWith("www.") && h.split(".").length === 2) out.push(`www.${h}`);
    }
    return [...new Set(out)];
}

const KIND_FIELDS: Record<Kind, [string, string[]] | null> = {
    any: null,
    photos: ["attachment_extension", IMAGE_EXT],
    videos: ["attachment_extension", VIDEO_EXT],
    media: ["attachment_extension", [...IMAGE_EXT, ...VIDEO_EXT]],
    audio: ["attachment_extension", AUDIO_EXT],
    gifs: ["embed_type", ["gif"]],
    files: ["has", ["file"]],
    links: ["has", ["link"]],
    embeds: ["has", ["embed"]],
    stickers: ["has", ["sticker"]],
    polls: ["has", ["poll"]],
    forwards: ["has", ["snapshot"]],
};

const LEAVE_FIELDS: Record<Leave, [string, string[]]> = {
    gifs: ["has", ["-embed"]],
    links: ["has", ["-link"]],
    files: ["has", ["-file"]],
    media: ["has", ["-image", "-video"]],
    stickers: ["has", ["-sticker"]],
    bots: ["author_type", ["-bot", "-webhook"]],
};

export function buildTab(f: AdvancedFilters, me: string | undefined, now = Date.now()): any {
    const tab: any = {};
    const add = (k: string, values: string[]) => {
        if (!values.length) return;
        tab[k] = [...new Set([...(tab[k] ?? []), ...values])];
    };
    const words = f.words.trim();
    if (words) tab.content = f.exact && !/^".*"$/.test(words) ? `"${words.replace(/"/g, "")}"` : words;
    const authors = [...f.from];
    if (f.fromMe && me) authors.unshift(me);
    add("author_id", [...new Set(authors)]);
    const ext = list(f.ext);
    const kind = KIND_FIELDS[f.kind];
    if (kind && !(ext.length && kind[0] === "attachment_extension")) add(kind[0], kind[1]);
    add("attachment_extension", ext);
    for (const l of f.leave) if (!clashes(l, f.kind)) add(LEAVE_FIELDS[l][0], LEAVE_FIELDS[l][1]);
    if (f.filename.trim()) add("attachment_filename", [f.filename.trim()]);
    add("link_hostname", hosts(f.site));
    if (f.mentionsMe && me) add("mentions", [me]);
    if (f.repliesToMe && me) add("replied_to_user_id", [me]);
    if (f.pinned !== "any") tab.pinned = f.pinned === "only";
    let min: number | null = null;
    let max: number | null = null;
    switch (f.when) {
        case "today": min = startOfDay(now); break;
        case "week": min = now - 7 * DAY; break;
        case "month": min = now - 30 * DAY; break;
        case "year": min = now - 365 * DAY; break;
        case "older": max = now - 365 * DAY; break;
        case "custom":
            min = parseDay(f.after, false);
            max = parseDay(f.before, true);
            break;
    }
    if (min != null) tab.min_id = snowflakeAt(min);
    if (max != null) tab.max_id = snowflakeAt(max);
    if (f.sort === "best") tab.sort_by = "relevance";
    else {
        tab.sort_by = "timestamp";
        tab.sort_order = f.sort === "old" ? "asc" : "desc";
    }
    return tab;
}

export function buildRequest(f: AdvancedFilters, scope: Scope, me: string | undefined, page: Page = {}, now = Date.now()): SearchRequest | null {
    const tab = buildTab(f, me, now);
    tab.limit = 25;
    if (page.cursor) tab.cursor = page.cursor;
    else if (page.offset) tab.offset = Math.min(9975, page.offset);
    const body: any = { tabs: { messages: tab }, track_exact_total_hits: true };
    if (scope.kind === "dms") return { url: "/users/@me/messages/search/tabs", body };
    if (scope.kind === "server") {
        if (!scope.guildId) return null;
        body.include_nsfw = true;
        return { url: `/guilds/${scope.guildId}/messages/search/tabs`, body };
    }
    if (!scope.channelId) return null;
    if (scope.isPrivate || !scope.guildId) return { url: `/channels/${scope.channelId}/messages/search/tabs`, body };
    body.include_nsfw = true;
    body.channel_ids = [scope.channelId];
    return { url: `/guilds/${scope.guildId}/messages/search/tabs`, body };
}

export function readResults(body: any): Results {
    const tab = body?.tabs?.messages ?? body;
    const groups: any[] = Array.isArray(tab?.messages) ? tab.messages : [];
    const hits: any[] = [];
    const seen = new Set<string>();
    for (const g of groups) {
        const m = Array.isArray(g) ? g.find((x: any) => x?.hit) ?? g[0] : g;
        if (!m || typeof m.id !== "string" || seen.has(m.id)) continue;
        seen.add(m.id);
        hits.push(m);
    }
    const channels: Record<string, any> = {};
    for (const c of [...(Array.isArray(tab?.channels) ? tab.channels : []), ...(Array.isArray(tab?.threads) ? tab.threads : [])]) {
        if (c?.id) channels[c.id] = c;
    }
    const cursor = tab?.cursor && typeof tab.cursor === "object" && Object.keys(tab.cursor).length ? tab.cursor : null;
    return { hits, total: Number(tab?.total_results) || 0, cursor, channels, indexing: !!body?.doing_deep_historical_index };
}

export function describe(f: AdvancedFilters, names: (id: string) => string = id => id): string {
    const parts: string[] = [];
    if (f.words.trim()) parts.push(f.exact ? `"${f.words.trim()}"` : f.words.trim());
    const who = [...(f.fromMe ? ["me"] : []), ...f.from.map(names)];
    if (who.length) parts.push(`from ${who.join(", ")}`);
    if (f.kind !== "any") parts.push(KINDS.find(k => k[0] === f.kind)![1]);
    const leave = f.leave.filter(l => !clashes(l, f.kind));
    if (leave.length) parts.push(`no ${leave.map(l => LEAVES.find(x => x[0] === l)![1]).join(", ")}`);
    if (f.ext.trim()) parts.push(`.${list(f.ext).join(" .")}`);
    if (f.filename.trim()) parts.push(`named ${f.filename.trim()}`);
    if (f.site.trim()) parts.push(`links to ${hosts(f.site).filter(h => !h.startsWith("www.") || hosts(f.site).length === 1).join(", ")}`);
    if (f.mentionsMe) parts.push("mentions me");
    if (f.repliesToMe) parts.push("replies to me");
    if (f.pinned !== "any") parts.push(f.pinned === "only" ? "pinned" : "not pinned");
    if (f.when === "custom") {
        if (f.after.trim()) parts.push(`since ${f.after.trim()}`);
        if (f.before.trim()) parts.push(`until ${f.before.trim()}`);
    } else if (f.when !== "any") parts.push(WHENS.find(w => w[0] === f.when)![1]);
    parts.push(SORTS.find(s => s[0] === f.sort)![1]);
    return parts.join(" · ");
}

export function plainText(m: any, names: { user?: (id: string) => string | undefined; channel?: (id: string) => string | undefined; } = {}): string {
    const users: Record<string, string> = {};
    for (const u of Array.isArray(m?.mentions) ? m.mentions : []) {
        if (u?.id) users[u.id] = u.global_name ?? u.globalName ?? u.username ?? "someone";
    }
    let text = typeof m?.content === "string" ? m.content : "";
    if (!text && Array.isArray(m?.message_snapshots) && m.message_snapshots[0]?.message?.content) text = `forwarded: ${m.message_snapshots[0].message.content}`;
    return text
        .replace(/<@!?(\d+)>/g, (_: string, id: string) => `@${users[id] ?? names.user?.(id) ?? "someone"}`)
        .replace(/<#(\d+)>/g, (_: string, id: string) => `#${names.channel?.(id) ?? "channel"}`)
        .replace(/<@&\d+>/g, "@role")
        .replace(/<a?:(\w+):\d+>/g, ":$1:")
        .replace(/<t:(\d+)(?::\w)?>/g, (_: string, s: string) => new Date(+s * 1000).toLocaleString())
        .trim();
}

export interface Thumb { uri: string; video: boolean; }

export function thumbsOf(m: any, size = 192): Thumb[] {
    const out: Thumb[] = [];
    const sized = (u: string, video: boolean) => {
        const sep = u.includes("?") ? "&" : "?";
        return video ? `${u}${sep}format=jpeg&width=${size}&height=${size}` : u.includes("media.discordapp.net") ? `${u}${sep}width=${size}&height=${size}` : u;
    };
    for (const a of Array.isArray(m?.attachments) ? m.attachments : []) {
        const name = String(a?.filename ?? "").toLowerCase();
        const ext = name.split(".").pop() ?? "";
        const type = String(a?.content_type ?? "");
        const u = a?.proxy_url ?? a?.url;
        if (typeof u !== "string") continue;
        if (type.startsWith("image/") || IMAGE_EXT.includes(ext) || ext === "gif") out.push({ uri: sized(u, false), video: false });
        else if (type.startsWith("video/") || VIDEO_EXT.includes(ext)) out.push({ uri: sized(u, true), video: true });
    }
    for (const e of Array.isArray(m?.embeds) ? m.embeds : []) {
        const pic = e?.thumbnail?.proxy_url ?? e?.image?.proxy_url ?? e?.thumbnail?.url ?? e?.image?.url;
        if (typeof pic === "string") out.push({ uri: sized(pic, false), video: e?.type === "gifv" || e?.type === "video" });
    }
    for (const s of Array.isArray(m?.sticker_items) ? m.sticker_items : []) {
        if (s?.id && s.format_type !== 3) out.push({ uri: `https://media.discordapp.net/stickers/${s.id}.png?size=160`, video: false });
    }
    return out.slice(0, 6);
}

export function filesOf(m: any): string[] {
    const out: string[] = [];
    for (const a of Array.isArray(m?.attachments) ? m.attachments : []) {
        const name = String(a?.filename ?? "");
        const ext = name.toLowerCase().split(".").pop() ?? "";
        const type = String(a?.content_type ?? "");
        if (type.startsWith("image/") || type.startsWith("video/") || IMAGE_EXT.includes(ext) || VIDEO_EXT.includes(ext) || ext === "gif") continue;
        if (name) out.push(name);
    }
    return out;
}

export function linkTo(m: any, guildId?: string | null): string {
    return `https://discord.com/channels/${guildId ?? "@me"}/${m.channel_id}/${m.id}`;
}

export function errorText(e: any): string {
    const status = e?.status ?? e?.statusCode;
    const body = e?.body ?? e?.response?.body;
    if (status === 429) return `slow down, try again in ${Math.ceil(Number(body?.retry_after) || 5)}s`;
    if (status === 403) return "can't search there";
    if (status === 401) return "not logged in?";
    if (typeof body?.message === "string") return body.message.toLowerCase();
    if (typeof e?.message === "string") return e.message.toLowerCase().slice(0, 120);
    return "search failed";
}
