import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { clipboard, NavigationNative, React, url as links } from "@metro/common";
import { Button, Text, TextInput } from "@metro/common/components";
import { ChannelStore, GuildMemberStore, MessageStore, SelectedChannelStore, UserStore } from "@metro/common/stores";
import { FlatList, Image, Pressable, View } from "react-native";

import { safe } from "../crash";
import { accentColor, themeColor } from "../style/colors";
import { AdvancedFilters, blankFilters, buildRequest, clashes, describe, errorText, filesOf, Kind, KINDS, Leave, LEAVES, linkTo, Pinned, PINS, plainText, readResults, ScopeKind, Sort, SORTS, thumbsOf, When, WHENS } from "./filters";

interface Memory {
    channelId?: string;
    scope: ScopeKind;
    filters: AdvancedFilters;
    hits: any[];
    total: number;
    cursor: any;
    more: boolean;
    channels: Record<string, any>;
}

interface Person { id: string; name: string; sub: string; }

const G = globalThis as any;
export const advancedStats: { opened: number; searches: number; errors: number; lastError: string; jumps: number; jumpVia: string; openVia: string; lastResults: string; } = G.__cheeseburgerAdvancedStats ??= { opened: 0, searches: 0, errors: 0, lastError: "", jumps: 0, jumpVia: "", openVia: "", lastResults: "" };

const textColor = () => themeColor("TEXT_DEFAULT") ?? themeColor("TEXT_NORMAL") ?? themeColor("TEXT_PRIMARY");
const mutedColor = () => themeColor("TEXT_MUTED") ?? themeColor("TEXT_SECONDARY");
const cardColor = () => themeColor("CARD_SECONDARY_BG") ?? themeColor("BACKGROUND_SECONDARY") ?? themeColor("BACKGROUND_BASE_LOWER") ?? "#ffffff12";
const chipColor = () => themeColor("BACKGROUND_MODIFIER_ACCENT") ?? themeColor("BACKGROUND_TERTIARY") ?? themeColor("BACKGROUND_BASE_LOWEST") ?? "#ffffff1f";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function myId(): string | undefined {
    try {
        return UserStore.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

function channelOf(id?: string): any {
    if (!id) return null;
    try {
        return ChannelStore.getChannel?.(id) ?? null;
    } catch {
        return null;
    }
}

function userOf(id: string): any {
    try {
        return UserStore.getUser?.(id) ?? null;
    } catch {
        return null;
    }
}

function nameOf(id: string, guildId?: string): string {
    if (id === myId()) return "me";
    let nick: string | undefined;
    try {
        nick = guildId ? GuildMemberStore.getNick?.(guildId, id) ?? undefined : undefined;
    } catch { }
    const u = userOf(id);
    return nick ?? u?.globalName ?? u?.global_name ?? u?.username ?? "someone";
}

function recipients(ch: any): string[] {
    if (!ch) return [];
    if (Array.isArray(ch.recipients)) return ch.recipients.map((r: any) => (typeof r === "string" ? r : r?.id)).filter(Boolean);
    if (Array.isArray(ch.rawRecipients)) return ch.rawRecipients.map((r: any) => r?.id).filter(Boolean);
    return [];
}

function people(query: string, channelId?: string, guildId?: string, skip: string[] = []): Person[] {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return [];
    const ids = new Set<string>();
    for (const id of recipients(channelOf(channelId))) ids.add(id);
    try {
        const msgs = MessageStore.getMessages?.(channelId);
        const arr: any[] = msgs?.toArray?.() ?? msgs?._array ?? [];
        for (const m of arr) if (m?.author?.id) ids.add(m.author.id);
    } catch { }
    try {
        if (guildId) for (const id of GuildMemberStore.getMemberIds?.(guildId) ?? []) ids.add(id);
    } catch { }
    try {
        const all = UserStore.getUsers?.();
        const values: any[] = all instanceof Map ? [...all.values()] : all ? Object.values(all) : [];
        for (const u of values.slice(0, 5000)) if (u?.id) ids.add(u.id);
    } catch { }
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
        if (out.length > 60) break;
    }
    return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, 8);
}

function http(): any {
    return findByProps("getAPIBaseURL", "post") ?? findByProps("getAPIBaseURL", "del");
}

async function post(req: { url: string; body: any; }, indexing: () => void): Promise<any> {
    const api = http();
    if (typeof api?.post !== "function") throw new Error("couldn't find discord's api");
    for (let i = 0; i < 6; i++) {
        const res = await api.post({ url: req.url, body: req.body, oldFormErrors: true });
        const body = res?.body;
        if (res?.status === 202 || body?.code === 110000) {
            indexing();
            await sleep(Math.min(10, Math.max(1, Number(body?.retry_after) || 2)) * 1000);
            continue;
        }
        return body;
    }
    throw new Error("discord is still indexing this chat, try again in a bit");
}

function stamp(ts: any): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const h = d.getHours();
    const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `today ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${time}`;
}

function avatarOf(a: any): string {
    if (a?.id && a?.avatar) return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64`;
    return `https://cdn.discordapp.com/embed/avatars/${Number(String(a?.id ?? "0").slice(-2)) % 6}.png`;
}

function placeOf(m: any, channels: Record<string, any>): string {
    const ch = channels[m.channel_id] ?? channelOf(m.channel_id);
    if (!ch) return "";
    if (ch.type === 1) {
        const other = recipients(ch)[0] ?? ch.recipients?.[0]?.id;
        return other ? `dm with ${nameOf(other)}` : "dm";
    }
    if (ch.type === 3) return ch.name ? ch.name : "group dm";
    return `#${ch.name ?? "channel"}`;
}

function openLink(link: string, channelId: string, messageId: string) {
    let here: string | undefined;
    try {
        here = SelectedChannelStore.getChannelId?.() ?? undefined;
    } catch { }
    const jumper = findByProps("jumpToMessage");
    if (here === channelId && typeof jumper?.jumpToMessage === "function") {
        jumper.jumpToMessage({ channelId, messageId, flash: true, jumpType: "ANIMATED" });
        advancedStats.jumpVia = "jumpToMessage";
        return;
    }
    const opener = findByProps("openUrl");
    if (typeof opener?.openUrl === "function") {
        opener.openUrl(link);
        advancedStats.jumpVia = "openUrl";
        return;
    }
    links.openURL(link);
    advancedStats.jumpVia = "linking";
}

function Chip({ label, on, onPress, disabled }: { label: string; on?: boolean; onPress?: () => void; disabled?: boolean; }) {
    const text = textColor();
    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? accentColor() : chipColor(), opacity: disabled ? 0.35 : 1 }}
        >
            <Text variant="text-sm/semibold" color="text-default" style={{ color: on ? "#ffffff" : text ?? undefined }}>{label}</Text>
        </Pressable>
    );
}

const Row = ({ children }: { children: React.ReactNode; }) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;

function Section({ title, children }: { title: string; children: React.ReactNode; }) {
    const muted = mutedColor();
    return (
        <View style={{ gap: 8 }}>
            <Text variant="text-xs/semibold" color="text-muted" style={muted ? { color: muted } : undefined}>{title.toUpperCase()}</Text>
            {children}
        </View>
    );
}

interface FormProps {
    f: AdvancedFilters;
    set: (patch: Partial<AdvancedFilters>) => void;
    scope: ScopeKind;
    setScope: (s: ScopeKind) => void;
    scopes: [ScopeKind, string][];
    them?: string;
    guildId?: string;
    who: string;
    setWho: (s: string) => void;
    found: Person[];
    extra: boolean;
    setExtra: (v: boolean) => void;
    onSearch: () => void;
    onReset: () => void;
}

function Form(p: FormProps) {
    const { f, set } = p;
    const muted = mutedColor();
    const flip = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
    const extraCount = [f.pinned !== "any", f.mentionsMe, f.repliesToMe, !!f.ext.trim(), !!f.filename.trim(), !!f.site.trim()].filter(Boolean).length;
    return (
        <View style={{ gap: 18, padding: 14, borderRadius: 14, backgroundColor: cardColor() }}>
            {p.scopes.length > 1 && (
                <Section title="where">
                    <Row>{p.scopes.map(([k, label]) => <Chip key={k} label={label} on={p.scope === k} onPress={() => p.setScope(k)} />)}</Row>
                </Section>
            )}
            <Section title="words">
                <TextInput size="md" value={f.words} placeholder="what to look for, or leave empty" isClearable onChange={(v: string) => set({ words: v })} returnKeyType="search" onSubmitEditing={p.onSearch} />
                <Row><Chip label="exact phrase" on={f.exact} onPress={() => set({ exact: !f.exact })} /></Row>
            </Section>
            <Section title="from">
                <Row>
                    <Chip label="me" on={f.fromMe} onPress={() => set({ fromMe: !f.fromMe })} />
                    {p.them && <Chip label={nameOf(p.them, p.guildId)} on={f.from.includes(p.them)} onPress={() => set({ from: flip(f.from, p.them!) })} />}
                    {f.from.filter(id => id !== p.them).map(id => <Chip key={id} label={`${nameOf(id, p.guildId)}  ✕`} on onPress={() => set({ from: f.from.filter(x => x !== id) })} />)}
                </Row>
                <TextInput size="sm" value={p.who} placeholder="add someone by name" isClearable onChange={(v: string) => p.setWho(v)} />
                {p.found.length > 0 && (
                    <Row>
                        {p.found.map(u => (
                            <Chip key={u.id} label={u.sub && u.sub.toLowerCase() !== u.name.toLowerCase() ? `${u.name} (${u.sub})` : u.name} onPress={() => {
                                set({ from: [...f.from, u.id] });
                                p.setWho("");
                            }} />
                        ))}
                    </Row>
                )}
                {!!p.who.trim() && !p.found.length && <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>nobody by that name loaded yet</Text>}
            </Section>
            <Section title="has">
                <Row>{KINDS.map(([k, label]) => <Chip key={k} label={label} on={f.kind === k} onPress={() => set({ kind: k as Kind })} />)}</Row>
            </Section>
            <Section title="leave out">
                <Row>{LEAVES.map(([k, label]) => <Chip key={k} label={label} on={f.leave.includes(k) && !clashes(k, f.kind)} disabled={clashes(k, f.kind)} onPress={() => set({ leave: flip<Leave>(f.leave, k) })} />)}</Row>
            </Section>
            <Section title="when">
                <Row>{WHENS.map(([k, label]) => <Chip key={k} label={label} on={f.when === k} onPress={() => set({ when: k as When })} />)}</Row>
                {f.when === "custom" && (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                        <View style={{ flex: 1 }}><TextInput size="sm" value={f.after} placeholder="from 2024-05-01" isClearable onChange={(v: string) => set({ after: v })} /></View>
                        <View style={{ flex: 1 }}><TextInput size="sm" value={f.before} placeholder="until 6/1/2024" isClearable onChange={(v: string) => set({ before: v })} /></View>
                    </View>
                )}
            </Section>
            <Section title="sort">
                <Row>{SORTS.map(([k, label]) => <Chip key={k} label={label} on={f.sort === k} onPress={() => set({ sort: k as Sort })} />)}</Row>
            </Section>
            <Pressable onPress={() => p.setExtra(!p.extra)} style={{ paddingVertical: 2 }}>
                <Text variant="text-sm/semibold" color="text-default" style={{ color: accentColor() }}>{p.extra ? "fewer filters" : `more filters${extraCount ? ` (${extraCount} on)` : ""}`}</Text>
            </Pressable>
            {p.extra && (
                <>
                    <Section title="pinned">
                        <Row>{PINS.map(([k, label]) => <Chip key={k} label={label} on={f.pinned === k} onPress={() => set({ pinned: k as Pinned })} />)}</Row>
                    </Section>
                    <Section title="about me">
                        <Row>
                            <Chip label="mentions me" on={f.mentionsMe} onPress={() => set({ mentionsMe: !f.mentionsMe })} />
                            <Chip label="replies to me" on={f.repliesToMe} onPress={() => set({ repliesToMe: !f.repliesToMe })} />
                        </Row>
                    </Section>
                    <Section title="file type">
                        <TextInput size="sm" value={f.ext} placeholder="png, pdf, mp3" isClearable onChange={(v: string) => set({ ext: v })} />
                    </Section>
                    <Section title="file name has">
                        <TextInput size="sm" value={f.filename} placeholder="resume" isClearable onChange={(v: string) => set({ filename: v })} />
                    </Section>
                    <Section title="links to">
                        <TextInput size="sm" value={f.site} placeholder="youtube.com, x.com" isClearable onChange={(v: string) => set({ site: v })} />
                    </Section>
                </>
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Button size="md" variant="primary" text="search" onPress={p.onSearch} /></View>
                <Button size="md" variant="secondary" text="reset" onPress={p.onReset} />
            </View>
        </View>
    );
}

const HitRow = React.memo(({ m, place, onPress, onLongPress }: { m: any; place: string; onPress: (m: any) => void; onLongPress: (m: any) => void; }) => {
    const text = textColor();
    const muted = mutedColor();
    const content = plainText(m, { user: id => nameOf(id), channel: id => channelOf(id)?.name });
    const thumbs = thumbsOf(m);
    const files = filesOf(m);
    const name = m.author?.global_name ?? m.author?.globalName ?? m.author?.username ?? "someone";
    return (
        <Pressable onPress={() => onPress(m)} onLongPress={() => onLongPress(m)} style={{ backgroundColor: cardColor(), borderRadius: 12, padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Image source={{ uri: avatarOf(m.author) }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                <View style={{ flex: 1 }}>
                    <Text variant="text-sm/semibold" color="text-default" numberOfLines={1} style={text ? { color: text } : undefined}>{name}</Text>
                    <Text variant="text-xs/medium" color="text-muted" numberOfLines={1} style={muted ? { color: muted } : undefined}>{[stamp(m.timestamp), place].filter(Boolean).join(" · ")}</Text>
                </View>
            </View>
            {!!content && <Text variant="text-md/normal" color="text-default" numberOfLines={10} style={text ? { color: text } : undefined}>{content}</Text>}
            {thumbs.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {thumbs.map((t, i) => (
                        <View key={i}>
                            <Image source={{ uri: t.uri }} style={{ width: 96, height: 96, borderRadius: 8, backgroundColor: "#00000033" }} />
                            {t.video && <View style={{ position: "absolute", right: 4, bottom: 4, paddingHorizontal: 5, borderRadius: 6, backgroundColor: "#000000aa" }}><Text variant="text-xs/semibold" style={{ color: "#ffffff" }}>▶</Text></View>}
                        </View>
                    ))}
                </View>
            )}
            {files.map((f, i) => <Text key={`f${i}`} variant="text-sm/medium" color="text-link" numberOfLines={1} style={{ color: accentColor() }}>{`📎 ${f}`}</Text>)}
        </Pressable>
    );
});

export function AdvancedSearch({ channelId, words }: { channelId?: string; words?: string; }) {
    let navigation: any = null;
    try {
        navigation = NavigationNative.useNavigation();
    } catch { }
    const ch = channelOf(channelId);
    const guildId: string | undefined = ch?.guild_id ?? undefined;
    const isPrivate = ch?.type === 1 || ch?.type === 3;
    const them = ch?.type === 1 ? recipients(ch)[0] : undefined;
    const prev: Memory | null = G.__cheeseburgerAdvanced ?? null;
    const same = !!prev && prev.channelId === channelId && !words;
    const scopes: [ScopeKind, string][] = [
        ...(channelId ? [["chat", isPrivate ? "this chat" : `#${ch?.name ?? "this channel"}`] as [ScopeKind, string]] : []),
        ...(guildId ? [["server", "whole server"] as [ScopeKind, string]] : []),
        ["dms", "all my dms"],
    ];
    const [f, setF] = React.useState<AdvancedFilters>(() => ({ ...(prev?.filters ?? blankFilters()), ...(words ? { words } : {}) }));
    const [scope, setScope] = React.useState<ScopeKind>(() => (same && scopes.some(s => s[0] === prev!.scope) ? prev!.scope : scopes[0][0]));
    const [hits, setHits] = React.useState<any[]>(() => (same ? prev!.hits : []));
    const [total, setTotal] = React.useState(() => (same ? prev!.total : 0));
    const [cursor, setCursor] = React.useState<any>(() => (same ? prev!.cursor : null));
    const [more, setMore] = React.useState(() => (same ? prev!.more : false));
    const [channels, setChannels] = React.useState<Record<string, any>>(() => (same ? prev!.channels : {}));
    const [status, setStatus] = React.useState<"idle" | "loading" | "more" | "indexing" | "error" | "done">(() => (same && prev!.hits.length ? "done" : "idle"));
    const [error, setError] = React.useState("");
    const [editing, setEditing] = React.useState(() => !(same && prev!.hits.length));
    const [who, setWho] = React.useState("");
    const [extra, setExtra] = React.useState(false);
    const run = React.useRef(0);
    const alive = React.useRef(true);
    React.useEffect(() => () => void (alive.current = false), []);

    const set = React.useCallback((patch: Partial<AdvancedFilters>) => setF(cur => ({ ...cur, ...patch })), []);
    const found = React.useMemo(() => people(who, channelId, guildId, f.from), [who, channelId, guildId, f.from]);

    const search = safe("advanced search", (next: boolean) => {
        const id = ++run.current;
        const page = next ? cursor ? { cursor } : { offset: hits.length } : {};
        const req = buildRequest(f, { kind: scope, channelId, guildId, isPrivate }, myId(), page);
        if (!req) {
            setError("pick where to search");
            setStatus("error");
            return;
        }
        setError("");
        setStatus(next ? "more" : "loading");
        if (!next) setEditing(false);
        advancedStats.searches++;
        post(req, () => {
            if (alive.current && run.current === id) setStatus("indexing");
        }).then(safe("advanced results", (body: any) => {
            if (!alive.current || run.current !== id) return;
            const r = readResults(body);
            const known = new Set(next ? hits.map(h => h.id) : []);
            const list = next ? [...hits, ...r.hits.filter(h => !known.has(h.id))] : r.hits;
            const merged = next ? { ...channels, ...r.channels } : r.channels;
            const hasMore = r.hits.length > 0 && list.length < r.total && (!!r.cursor || list.length < 9975);
            setHits(list);
            setTotal(r.total);
            setCursor(r.cursor);
            setMore(hasMore);
            setChannels(merged);
            setStatus("done");
            advancedStats.lastResults = `${r.total} total, ${list.length} loaded, cursor ${r.cursor ? r.cursor.type ?? "yes" : "none"}`;
            G.__cheeseburgerAdvanced = { channelId, scope, filters: f, hits: list, total: r.total, cursor: r.cursor, more: hasMore, channels: merged } as Memory;
        }), safe("advanced error", (e: any) => {
            if (!alive.current || run.current !== id) return;
            advancedStats.errors++;
            advancedStats.lastError = errorText(e);
            setError(errorText(e));
            setStatus("error");
        }));
    });

    const reset = () => {
        run.current++;
        setF(blankFilters());
        setHits([]);
        setTotal(0);
        setCursor(null);
        setMore(false);
        setStatus("idle");
        setError("");
        setWho("");
        G.__cheeseburgerAdvanced = null;
    };

    React.useEffect(() => {
        if (words) search(false);
    }, []);

    const jump = React.useCallback(safe("advanced jump", (m: any) => {
        advancedStats.jumps++;
        const c = channels[m.channel_id] ?? channelOf(m.channel_id);
        const gid = m.guild_id ?? c?.guild_id ?? (scope === "dms" ? null : guildId ?? null);
        const link = linkTo(m, gid);
        try {
            navigation?.goBack?.();
        } catch { }
        setTimeout(safe("advanced open", () => openLink(link, m.channel_id, m.id)), 300);
    }), [channels, scope, guildId, navigation]);

    const copy = React.useCallback(safe("advanced copy", (m: any) => {
        const c = channels[m.channel_id] ?? channelOf(m.channel_id);
        clipboard.setString(linkTo(m, m.guild_id ?? c?.guild_id ?? (scope === "dms" ? null : guildId ?? null)));
        showToast("copied link");
    }), [channels, scope, guildId]);

    const muted = mutedColor();
    const text = textColor();
    const label = describe(f, id => nameOf(id, guildId));
    const statusLine = status === "loading" ? "searching..."
        : status === "indexing" ? "discord is indexing this chat, hang on..."
            : status === "error" ? error
                : status === "done" || status === "more" ? hits.length ? `${total} result${total === 1 ? "" : "s"}` : "nothing found"
                    : "";

    const header = (
        <View style={{ gap: 12, marginBottom: 4 }}>
            {editing ? (
                <Form
                    f={f}
                    set={set}
                    scope={scope}
                    setScope={setScope}
                    scopes={scopes}
                    them={them}
                    guildId={guildId}
                    who={who}
                    setWho={setWho}
                    found={found}
                    extra={extra}
                    setExtra={setExtra}
                    onSearch={() => search(false)}
                    onReset={reset}
                />
            ) : (
                <Pressable onPress={() => setEditing(true)} style={{ padding: 14, borderRadius: 14, backgroundColor: cardColor(), gap: 4 }}>
                    <Text variant="text-sm/semibold" color="text-default" style={text ? { color: text } : undefined}>{`${scopes.find(s => s[0] === scope)?.[1] ?? ""} · ${label}`}</Text>
                    <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>tap to change filters</Text>
                </Pressable>
            )}
            {!!statusLine && <Text variant="text-sm/medium" color="text-muted" style={{ color: status === "error" ? "#F04747" : muted ?? undefined, paddingHorizontal: 4 }}>{statusLine}</Text>}
        </View>
    );

    const footer = hits.length ? (
        <View style={{ paddingVertical: 12, alignItems: "center" }}>
            {more
                ? <Button size="md" variant="secondary" text={status === "more" ? "loading..." : "load more"} disabled={status === "more"} onPress={() => search(true)} />
                : <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>{"that's all"}</Text>}
        </View>
    ) : null;

    return (
        <FlatList
            data={hits}
            keyExtractor={(m: any) => m.id}
            renderItem={({ item }: { item: any; }) => <HitRow m={item} place={scope === "chat" ? "" : placeOf(item, channels)} onPress={jump} onLongPress={copy} />}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            windowSize={7}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
                if (more && status === "done" && hits.length) search(true);
            }}
        />
    );
}

export function openAdvanced(navigation: any, channelId?: string, words?: string) {
    let id = channelId;
    if (!id) {
        try {
            id = SelectedChannelStore.getChannelId?.() ?? undefined;
        } catch { }
    }
    advancedStats.opened++;
    const render = () => <AdvancedSearch channelId={id} words={words} />;
    try {
        if (typeof navigation?.push === "function") {
            navigation.push("RAIN_CUSTOM_PAGE", { title: "Advanced search", render });
            advancedStats.openVia = "page";
            return;
        }
        const root = findByProps("getRootNavigationRef")?.getRootNavigationRef?.();
        if (typeof root?.navigate !== "function") throw new Error("no navigation");
        root.navigate("RAIN_CUSTOM_PAGE", { title: "Advanced search", render });
        advancedStats.openVia = "root";
    } catch (e: any) {
        advancedStats.openVia = `failed: ${String(e?.message ?? e).slice(0, 60)}`;
        showToast("couldn't open search");
    }
}
