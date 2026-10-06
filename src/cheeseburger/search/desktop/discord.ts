export const bd = () => (globalThis as any).BdApi;

const stores = new Map<string, any>();

export function store(name: string): any {
    const hit = stores.get(name);
    if (hit) return hit;
    let s: any = null;
    try {
        s = bd().Webpack.getStore(name) ?? null;
    } catch { }
    if (s) stores.set(name, s);
    return s;
}

export function quiet(fn: () => unknown) {
    try {
        fn();
    } catch { }
}

export function attempt<T>(fn: () => T, fallback: T): T {
    try {
        return fn() ?? fallback;
    } catch {
        return fallback;
    }
}

export const myId = (): string | undefined => attempt(() => store("UserStore")?.getCurrentUser?.()?.id, undefined);
export const channelOf = (id?: string | null): any => (id ? attempt(() => store("ChannelStore")?.getChannel?.(id), null) : null);
export const userOf = (id: string): any => attempt(() => store("UserStore")?.getUser?.(id), null);
export const guildOf = (id?: string | null): any => (id ? attempt(() => store("GuildStore")?.getGuild?.(id), null) : null);
export const selectedChannel = (): string | undefined => attempt(() => store("SelectedChannelStore")?.getChannelId?.(), undefined);
export const selectedGuild = (): string | undefined => attempt(() => store("SelectedGuildStore")?.getGuildId?.(), undefined);
export const dmWith = (userId: string): string | undefined => attempt(() => store("ChannelStore")?.getDMFromUserId?.(userId), undefined);

export function recipients(ch: any): string[] {
    if (!ch) return [];
    if (Array.isArray(ch.recipients)) return ch.recipients.map((r: any) => (typeof r === "string" ? r : r?.id)).filter(Boolean);
    if (Array.isArray(ch.rawRecipients)) return ch.rawRecipients.map((r: any) => r?.id).filter(Boolean);
    return [];
}

export function nameOf(id: string, guildId?: string): string {
    if (id === myId()) return "me";
    const nick = guildId ? attempt(() => store("GuildMemberStore")?.getNick?.(guildId, id), undefined) : undefined;
    const u = userOf(id);
    return nick ?? u?.globalName ?? u?.global_name ?? u?.username ?? "someone";
}

export interface Person { id: string; name: string; sub: string; }

export function people(query: string, channelId?: string, guildId?: string, skip: string[] = []): Person[] {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return [];
    const ids = new Set<string>();
    for (const id of recipients(channelOf(channelId))) ids.add(id);
    attempt(() => {
        const msgs = store("MessageStore")?.getMessages?.(channelId);
        const arr: any[] = msgs?.toArray?.() ?? msgs?._array ?? [];
        for (const m of arr) if (m?.author?.id) ids.add(m.author.id);
        return null;
    }, null);
    if (guildId) attempt(() => {
        for (const id of store("GuildMemberStore")?.getMemberIds?.(guildId) ?? []) ids.add(id);
        return null;
    }, null);
    attempt(() => {
        for (const id of store("RelationshipStore")?.getFriendIDs?.() ?? []) ids.add(id);
        return null;
    }, null);
    attempt(() => {
        const all = store("UserStore")?.getUsers?.();
        const values: any[] = all instanceof Map ? [...all.values()] : all ? Object.values(all) : [];
        for (const u of values.slice(0, 8000)) if (u?.id) ids.add(u.id);
        return null;
    }, null);
    const me = myId();
    const out: (Person & { score: number; })[] = [];
    for (const id of ids) {
        if (id === me || skip.includes(id)) continue;
        const u = userOf(id);
        if (!u || u.bot && !q.includes("bot")) continue;
        const name = nameOf(id, guildId);
        const username = String(u.username ?? "").toLowerCase();
        const lower = name.toLowerCase();
        const score = lower.startsWith(q) || username.startsWith(q) ? 0 : lower.includes(q) || username.includes(q) ? 1 : -1;
        if (score < 0) continue;
        out.push({ id, name, sub: u.username ?? "", score });
        if (out.length > 80) break;
    }
    return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, 8);
}

let http: any;

function api(): any {
    if (http) return http;
    const fits = (m: any) => !!m && typeof m === "object" && ["get", "post", "put", "patch", "del"].every(k => typeof m[k] === "function");
    http = attempt(() => bd().Webpack.getModule(fits, { searchExports: true }), null);
    return http;
}

function token(): string | undefined {
    return attempt(() => store("AuthenticationStore")?.getToken?.(), undefined);
}

export async function post(url: string, body: any): Promise<{ status: number; body: any; }> {
    const a = api();
    if (a) {
        const res = await a.post({ url, body, oldFormErrors: true });
        return { status: res?.status ?? 200, body: res?.body };
    }
    const t = token();
    const res = await fetch(`${location.origin}/api/v9${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: t } : {}) },
        body: JSON.stringify(body),
    });
    let data: any = null;
    try {
        data = await res.json();
    } catch { }
    if (!res.ok) throw { status: res.status, body: data };
    return { status: res.status, body: data };
}

let parser: any;
let markupClass: string | undefined;

export function markdown(): ((text: string, inline: boolean, state: any) => any) | null {
    if (!parser) parser = attempt(() => bd().Webpack.getByKeys("parse", "parseTopic", { searchExports: true }), null);
    return typeof parser?.parse === "function" ? parser.parse : null;
}

export function markupClassName(): string {
    if (markupClass === undefined) {
        const fits = (m: any) => typeof m?.markup === "string" && typeof m?.inlineFormat === "string";
        markupClass = attempt(() => bd().Webpack.getModule(fits, { searchExports: true })?.markup, "") ?? "";
    }
    return markupClass ?? "";
}

let go: any;

export function openPath(path: string) {
    if (go === undefined) go = attempt(() => bd().Webpack.getByStrings("transitionTo - Transitioning to", { searchExports: true }), null);
    if (typeof go === "function") {
        go(path);
        return;
    }
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

export function mount(el: HTMLElement, node: any): () => void {
    const dom = bd().ReactDOM;
    let create = dom?.createRoot;
    if (typeof create !== "function") create = attempt(() => bd().Webpack.getByKeys("createRoot", "hydrateRoot")?.createRoot, undefined);
    if (typeof create === "function") {
        const root = create(el);
        root.render(node);
        return () => root.unmount();
    }
    dom.render(node, el);
    return () => dom.unmountComponentAtNode?.(el);
}
