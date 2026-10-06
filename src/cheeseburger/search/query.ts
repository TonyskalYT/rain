export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff"];
export const VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "m4v", "avi", "3gp"];
export const AUDIO_EXT = ["mp3", "m4a", "ogg", "wav", "flac", "aac", "opus"];

export const SEARCH_URL = /\/api\/v\d+\/(?:guilds|channels)\/\d+\/messages\/search(?:\?|$)/;
export const TABS_URL = /\/api\/v\d+\/(?:(?:guilds|channels)\/\d+|users\/@me)\/messages\/search\/tabs(?:\?|$)/;

export interface SearchOptions { preciseHas: boolean; me?: string; }
export interface Rewritten { url: string; changes: string[]; }

type Pair = [string, string];

const decode = (s: string) => {
    try {
        return decodeURIComponent(s.replace(/\+/g, " "));
    } catch {
        return s;
    }
};

function parse(qs: string): Pair[] {
    return qs.split("&").filter(Boolean).map(p => {
        const i = p.indexOf("=");
        return i < 0 ? [decode(p), ""] : [decode(p.slice(0, i)), decode(p.slice(i + 1))];
    });
}

const build = (pairs: Pair[]) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

const KIND: Record<string, [string, string[]]> = {
    photo: ["attachment_extension", IMAGE_EXT],
    photos: ["attachment_extension", IMAGE_EXT],
    pic: ["attachment_extension", IMAGE_EXT],
    pics: ["attachment_extension", IMAGE_EXT],
    image: ["attachment_extension", IMAGE_EXT],
    images: ["attachment_extension", IMAGE_EXT],
    video: ["attachment_extension", VIDEO_EXT],
    videos: ["attachment_extension", VIDEO_EXT],
    audio: ["attachment_extension", AUDIO_EXT],
    sound: ["attachment_extension", AUDIO_EXT],
    gif: ["embed_type", ["gif"]],
    gifs: ["embed_type", ["gif"]],
    file: ["has", ["file"]],
    files: ["has", ["file"]],
    link: ["has", ["link"]],
    links: ["has", ["link"]],
    embed: ["has", ["embed"]],
    sticker: ["has", ["sticker"]],
    poll: ["has", ["poll"]],
    forward: ["has", ["snapshot"]],
    pinned: ["pinned", ["true"]],
    bot: ["author_type", ["bot"]],
    bots: ["author_type", ["bot"]],
};

const NOT: Record<string, [string, string[]]> = {
    link: ["has", ["-link"]],
    links: ["has", ["-link"]],
    embed: ["has", ["-embed"]],
    embeds: ["has", ["-embed"]],
    gif: ["has", ["-embed"]],
    gifs: ["has", ["-embed"]],
    file: ["has", ["-file"]],
    files: ["has", ["-file"]],
    image: ["has", ["-image"]],
    images: ["has", ["-image"]],
    video: ["has", ["-video"]],
    videos: ["has", ["-video"]],
    sticker: ["has", ["-sticker"]],
    bot: ["author_type", ["-bot", "-webhook"]],
    bots: ["author_type", ["-bot", "-webhook"]],
    pinned: ["pinned", ["false"]],
};

function keyword(token: string, me: string | undefined): [string, string[]][] | null {
    const m = /^([a-z]+):(.+)$/i.exec(token.trim());
    if (!m) return null;
    const key = m[1].toLowerCase();
    const raw = m[2].trim();
    const value = raw.toLowerCase();
    const list = (s: string) => s.split(",").map(x => x.trim().replace(/^\./, "")).filter(Boolean);
    switch (key) {
        case "is":
        case "only": {
            const hit = KIND[value];
            return hit ? [hit] : null;
        }
        case "not":
        case "no": {
            const hit = NOT[value];
            return hit ? [hit] : null;
        }
        case "ext":
        case "type":
            return list(value).length ? [["attachment_extension", list(value)]] : null;
        case "name":
        case "filename":
            return [["attachment_filename", [raw]]];
        case "site":
        case "domain":
            return list(value).length ? [["link_hostname", list(value)]] : null;
        case "via":
        case "provider":
            return [["embed_provider", [raw]]];
        case "sort":
            if (/^(old|oldest|asc|first)$/.test(value)) return [["sort_by", ["timestamp"]], ["sort_order", ["asc"]]];
            if (/^(new|newest|desc|latest)$/.test(value)) return [["sort_by", ["timestamp"]], ["sort_order", ["desc"]]];
            if (/^(relevant|relevance|best)$/.test(value)) return [["sort_by", ["relevance"]]];
            return null;
        case "replyto":
        case "repliesto":
            if (value === "me" && me) return [["replied_to_user_id", [me]]];
            return /^\d{15,21}$/.test(value) ? [["replied_to_user_id", [value]]] : null;
        default:
            return null;
    }
}

function splitTokens(text: string): string[] {
    return text.match(/"[^"]*"|\S+/g) ?? [];
}

interface Scan { add: [string, string[]][]; changes: string[]; }

const PRECISE: Record<string, string[]> = { image: IMAGE_EXT, video: VIDEO_EXT, sound: AUDIO_EXT };
const SINGLE = new Set(["sort_by", "sort_order", "pinned"]);

function takeContent(text: string, me: string | undefined, scan: Scan): string {
    const keep: string[] = [];
    for (const t of splitTokens(text)) {
        const hit = t.startsWith("\"") ? null : keyword(t, me);
        if (hit) {
            scan.add.push(...hit);
            scan.changes.push(t);
        } else keep.push(t);
    }
    return keep.join(" ").trim();
}

function takeTerm(value: string, me: string | undefined, scan: Scan): boolean {
    const bar = value.indexOf("|");
    const term = bar >= 0 ? value.slice(bar + 1) : value;
    const hit = term.startsWith("\"") ? null : keyword(term, me);
    if (!hit) return false;
    scan.add.push(...hit);
    scan.changes.push(term);
    return true;
}

function takeHas(value: string, scan: Scan): boolean {
    const ext = PRECISE[value];
    if (!ext) return false;
    scan.add.push(["attachment_extension", ext]);
    scan.changes.push(`has:${value} -> uploads only`);
    return true;
}

const unique = (list: string[]) => [...new Set(list)];

export function rewriteSearch(url: string, opts: SearchOptions): Rewritten | null {
    if (!SEARCH_URL.test(url)) return null;
    const q = url.indexOf("?");
    const base = q < 0 ? url : url.slice(0, q);
    const pairs = q < 0 ? [] : parse(url.slice(q + 1));
    const scan: Scan = { add: [], changes: [] };
    const out: Pair[] = [];
    for (const [k, v] of pairs) {
        if (k === "content") {
            const before = scan.changes.length;
            const rest = takeContent(v, opts.me, scan);
            if (scan.changes.length === before) out.push([k, v]);
            else if (rest) out.push([k, rest]);
            continue;
        }
        if (k === "contents" && takeTerm(v, opts.me, scan)) continue;
        if (k === "has" && opts.preciseHas && takeHas(v, scan)) continue;
        out.push([k, v]);
    }
    if (!scan.changes.length) return null;
    const seen = new Set(out.map(([k, v]) => `${k}=${v}`));
    for (const [k, values] of scan.add) {
        if (SINGLE.has(k)) {
            for (let i = out.length - 1; i >= 0; i--) if (out[i][0] === k) out.splice(i, 1);
            for (const s of [...seen]) if (s.startsWith(`${k}=`)) seen.delete(s);
        }
        for (const v of values) {
            const key = `${k}=${v}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push([k, v]);
        }
    }
    return { url: out.length ? `${base}?${build(out)}` : base, changes: unique(scan.changes) };
}

function rewriteTab(tab: any, opts: SearchOptions): string[] {
    const scan: Scan = { add: [], changes: [] };
    if (typeof tab.content === "string") {
        const rest = takeContent(tab.content, opts.me, scan);
        if (scan.changes.length) {
            if (rest) tab.content = rest;
            else delete tab.content;
        }
    }
    if (Array.isArray(tab.contents)) {
        const keep = tab.contents.filter((v: unknown) => typeof v !== "string" || !takeTerm(v, opts.me, scan));
        if (keep.length !== tab.contents.length) {
            if (keep.length) tab.contents = keep;
            else delete tab.contents;
        }
    }
    if (opts.preciseHas && Array.isArray(tab.has)) {
        const keep = tab.has.filter((v: unknown) => typeof v !== "string" || !takeHas(v, scan));
        if (keep.length !== tab.has.length) {
            if (keep.length) tab.has = keep;
            else delete tab.has;
        }
    }
    for (const [k, values] of scan.add) {
        if (k === "pinned") tab.pinned = values[0] === "true";
        else if (SINGLE.has(k)) tab[k] = values[0];
        else {
            const cur = Array.isArray(tab[k]) ? tab[k] : tab[k] == null ? [] : [tab[k]];
            tab[k] = unique([...cur, ...values]);
        }
    }
    return scan.changes;
}

export interface RewrittenBody { body: string; changes: string[]; }

export function rewriteTabs(url: string, body: string, opts: SearchOptions): RewrittenBody | null {
    if (!TABS_URL.test(url)) return null;
    let data: any;
    try {
        data = JSON.parse(body);
    } catch {
        return null;
    }
    const tabs = data?.tabs;
    if (!tabs || typeof tabs !== "object") return null;
    const changes: string[] = [];
    for (const name of Object.keys(tabs)) {
        const tab = tabs[name];
        if (tab && typeof tab === "object") changes.push(...rewriteTab(tab, opts));
    }
    return changes.length ? { body: JSON.stringify(data), changes: unique(changes) } : null;
}

export const CHEATSHEET: [string, string][] = [
    ["is:photo", "only photos you uploaded (no gifs, no link previews)"],
    ["is:video", "only uploaded videos"],
    ["is:audio", "only uploaded audio files"],
    ["is:gif", "only gifs from the gif picker"],
    ["is:file / is:link / is:sticker / is:poll", "has that thing"],
    ["is:pinned", "pinned messages"],
    ["is:bot", "messages from bots"],
    ["not:gif / not:link / not:embed / not:file", "leave those out"],
    ["not:bot", "leave out bots and webhooks"],
    ["ext:png,jpg", "files with these extensions"],
    ["name:resume", "files with this in the name"],
    ["site:youtube.com", "links to this site"],
    ["via:Tenor", "embeds from this provider"],
    ["replyto:me", "replies to you"],
    ["sort:old / sort:relevant", "oldest first or best match"],
];
