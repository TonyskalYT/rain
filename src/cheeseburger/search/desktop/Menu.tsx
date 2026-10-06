import { AdvancedFilters, blankFilters, buildRequest, clashes, describe, errorText, filesOf, Kind, KINDS, Leave, LEAVES, linkTo, Pinned, PINS, plainText, readResults, ScopeKind, Sort, SORTS, thumbsOf, When, WHENS } from "../filters";
import { attempt, bd, channelOf, mount, myId, nameOf, openPath, people, Person, post, quiet, recipients } from "./discord";

export interface Preset {
    channelId?: string;
    guildId?: string;
    from?: string[];
    scope?: ScopeKind;
    words?: string;
}

interface Memory {
    key: string;
    scope: ScopeKind;
    filters: AdvancedFilters;
    hits: any[];
    total: number;
    cursor: any;
    more: boolean;
    channels: Record<string, any>;
}

type Status = "idle" | "loading" | "more" | "indexing" | "error" | "done";

let memory: Memory | null = null;
let host: HTMLElement | null = null;
let unmount: (() => void) | null = null;

const react = () => bd().React;

function useBox<T>(init: T | (() => T)): [T, (v: T | ((cur: T) => T)) => void] {
    return react().useState(init);
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function request(req: { url: string; body: any; }, indexing: () => void): Promise<any> {
    for (let i = 0; i < 6; i++) {
        const res = await post(req.url, req.body);
        if (res.status === 202 || res.body?.code === 110000) {
            indexing();
            await sleep(Math.min(10, Math.max(1, Number(res.body?.retry_after) || 2)) * 1000);
            continue;
        }
        return res.body;
    }
    throw new Error("discord is still indexing this chat, try again in a bit");
}

function stamp(ts: any): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const h = d.getHours();
    const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
    if (d.toDateString() === new Date().toDateString()) return `today ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${time}`;
}

function avatarOf(a: any): string {
    if (a?.id && a?.avatar) return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.webp?size=80`;
    const n = attempt(() => Number(BigInt(String(a?.id ?? "0")) >> BigInt(22)) % 6, 0);
    return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}

function placeOf(m: any, channels: Record<string, any>): string {
    const ch = channels[m.channel_id] ?? channelOf(m.channel_id);
    if (!ch) return "";
    if (ch.type === 1) {
        const other = recipients(ch)[0];
        return other ? `dm with ${nameOf(other)}` : "dm";
    }
    if (ch.type === 3) return ch.name || "group dm";
    return `#${ch.name ?? "channel"}`;
}

function guildFor(m: any, channels: Record<string, any>, scope: ScopeKind, guildId?: string): string | null {
    const c = channels[m.channel_id] ?? channelOf(m.channel_id);
    return m.guild_id ?? c?.guild_id ?? (scope === "dms" ? null : guildId ?? null);
}

function toast(text: string) {
    quiet(() => bd().UI.showToast(text, { type: "success" }));
}

function Chip({ label, on, dim, onClick }: { label: string; on?: boolean; dim?: boolean; onClick?: () => void; }) {
    return (
        <button type="button" className={`cbs-chip${on ? " cbs-on" : ""}${dim ? " cbs-dim" : ""}`} onClick={onClick}>
            {label}
        </button>
    );
}

function Section({ title, children }: { title: string; children?: any; }) {
    return (
        <div>
            <div className="cbs-label">{title}</div>
            {children}
        </div>
    );
}

function Hit({ m, place, onOpen, onCopy }: { m: any; place: string; onOpen: (m: any) => void; onCopy: (m: any) => void; }) {
    const content = plainText(m, { user: id => nameOf(id), channel: id => channelOf(id)?.name });
    const thumbs = thumbsOf(m, 256);
    const files = filesOf(m);
    const name = m.author?.global_name ?? m.author?.globalName ?? m.author?.username ?? "someone";
    return (
        <div className="cbs-hit" onClick={() => onOpen(m)}>
            <img className="cbs-avatar" src={avatarOf(m.author)} alt="" />
            <div className="cbs-main">
                <div className="cbs-meta">
                    <span className="cbs-name">{name}</span>
                    <span className="cbs-time">{[stamp(m.timestamp), place].filter(Boolean).join(" · ")}</span>
                </div>
                {!!content && <div className="cbs-text">{content}</div>}
                {thumbs.length > 0 && (
                    <div className="cbs-thumbs">
                        {thumbs.map((t, i) => (
                            <div className="cbs-thumb" key={i}>
                                <img src={t.uri} alt="" loading="lazy" />
                                {t.video && <span className="cbs-play">▶</span>}
                            </div>
                        ))}
                    </div>
                )}
                {files.map((f, i) => <div className="cbs-file" key={`f${i}`}>{`📎 ${f}`}</div>)}
            </div>
            <button
                type="button"
                className="cbs-copy"
                onClick={e => {
                    e.stopPropagation();
                    onCopy(m);
                }}
            >
                copy link
            </button>
        </div>
    );
}

function Menu({ preset, close }: { preset: Preset; close: () => void; }) {
    const { useEffect, useMemo, useRef } = react();
    const channelId = preset.channelId;
    const ch = channelOf(channelId);
    const guildId: string | undefined = preset.guildId ?? ch?.guild_id ?? undefined;
    const isPrivate = ch?.type === 1 || ch?.type === 3;
    const them: string | undefined = ch?.type === 1 ? recipients(ch)[0] : undefined;
    const key = `${channelId ?? ""}|${guildId ?? ""}`;
    const prev = memory && memory.key === key && !preset.from && !preset.words ? memory : null;
    const scopes: [ScopeKind, string][] = [
        ...(channelId ? [["chat", isPrivate ? "this chat" : `#${ch?.name ?? "this channel"}`] as [ScopeKind, string]] : []),
        ...(guildId ? [["server", "whole server"] as [ScopeKind, string]] : []),
        ["dms", "all my dms"],
    ];
    const pick = (s?: ScopeKind) => (s && scopes.some(x => x[0] === s) ? s : undefined);

    const [f, setF] = useBox<AdvancedFilters>(() => ({
        ...(prev?.filters ?? blankFilters()),
        ...(preset.from ? { from: preset.from, fromMe: false } : {}),
        ...(preset.words ? { words: preset.words } : {}),
    }));
    const [scope, setScope] = useBox<ScopeKind>(() => pick(prev?.scope) ?? pick(preset.scope) ?? scopes[0][0]);
    const [hits, setHits] = useBox<any[]>(() => prev?.hits ?? []);
    const [total, setTotal] = useBox<number>(() => prev?.total ?? 0);
    const [cursor, setCursor] = useBox<any>(() => prev?.cursor ?? null);
    const [more, setMore] = useBox<boolean>(() => prev?.more ?? false);
    const [channels, setChannels] = useBox<Record<string, any>>(() => prev?.channels ?? {});
    const [status, setStatus] = useBox<Status>(() => (prev?.hits.length ? "done" : "idle"));
    const [error, setError] = useBox("");
    const [who, setWho] = useBox("");
    const [extra, setExtra] = useBox(false);
    const run = useRef(0);
    const alive = useRef(true);
    const list = useRef(null as HTMLDivElement | null);

    const set = (patch: Partial<AdvancedFilters>) => setF(cur => ({ ...cur, ...patch }));
    const flip = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
    const found: Person[] = useMemo(() => people(who, channelId, guildId, f.from), [who, channelId, guildId, f.from]);

    const go = (next: boolean) => {
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
        if (!next) list.current?.scrollTo?.({ top: 0 });
        request(req, () => {
            if (alive.current && run.current === id) setStatus("indexing");
        }).then(body => {
            if (!alive.current || run.current !== id) return;
            const r = readResults(body);
            const known = new Set(next ? hits.map((h: any) => h.id) : []);
            const all = next ? [...hits, ...r.hits.filter(h => !known.has(h.id))] : r.hits;
            const merged = next ? { ...channels, ...r.channels } : r.channels;
            const hasMore = r.hits.length > 0 && all.length < r.total && (!!r.cursor || all.length < 9975);
            setHits(all);
            setTotal(r.total);
            setCursor(r.cursor);
            setMore(hasMore);
            setChannels(merged);
            setStatus("done");
            memory = { key, scope, filters: f, hits: all, total: r.total, cursor: r.cursor, more: hasMore, channels: merged };
        }, (e: any) => {
            if (!alive.current || run.current !== id) return;
            setError(errorText(e));
            setStatus("error");
        });
    };

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
        memory = null;
    };

    useEffect(() => {
        if (preset.from || preset.words) go(false);
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            e.preventDefault();
            close();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            alive.current = false;
            window.removeEventListener("keydown", onKey, true);
        };
    }, []);

    const openHit = (m: any) => {
        const gid = guildFor(m, channels, scope, guildId);
        close();
        setTimeout(() => quiet(() => openPath(`/channels/${gid ?? "@me"}/${m.channel_id}/${m.id}`)), 0);
    };

    const copyHit = (m: any) => {
        const link = linkTo(m, guildFor(m, channels, scope, guildId));
        quiet(() => navigator.clipboard.writeText(link));
        toast("copied link");
    };

    const onScroll = (e: any) => {
        const el = e.currentTarget as HTMLDivElement;
        if (more && status === "done" && hits.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) go(true);
    };

    const enter = (e: any) => {
        if (e.key === "Enter") go(false);
    };

    const extraCount = [f.pinned !== "any", f.mentionsMe, f.repliesToMe, !!f.ext.trim(), !!f.filename.trim(), !!f.site.trim()].filter(Boolean).length;
    const where = scopes.find(s => s[0] === scope)?.[1] ?? "";
    const busy = status === "loading" || status === "indexing";

    return (
        <div className="cbs-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
            <div className="cbs-panel" role="dialog" aria-label="Advanced search">
                <div className="cbs-head">
                    <div className="cbs-title">Advanced search</div>
                    <div className="cbs-where">
                        {scopes.map(([k, label]) => <Chip key={k} label={label} on={scope === k} onClick={() => setScope(k)} />)}
                    </div>
                    <button type="button" className="cbs-x" aria-label="close" onClick={close}>×</button>
                </div>
                <div className="cbs-body">
                    <div className="cbs-filters">
                        <Section title="words">
                            <input className="cbs-input" value={f.words} placeholder="what to look for, or leave empty" autoFocus onChange={e => set({ words: e.target.value })} onKeyDown={enter} />
                            <div className="cbs-chips cbs-gap"><Chip label="exact phrase" on={f.exact} onClick={() => set({ exact: !f.exact })} /></div>
                        </Section>
                        <Section title="from">
                            <div className="cbs-chips">
                                <Chip label="me" on={f.fromMe} onClick={() => set({ fromMe: !f.fromMe })} />
                                {them && <Chip label={nameOf(them, guildId)} on={f.from.includes(them)} onClick={() => set({ from: flip(f.from, them) })} />}
                                {f.from.filter(id => id !== them).map(id => <Chip key={id} label={`${nameOf(id, guildId)}  ✕`} on onClick={() => set({ from: f.from.filter(x => x !== id) })} />)}
                            </div>
                            <input className="cbs-input cbs-gap" value={who} placeholder="add someone by name" onChange={e => setWho(e.target.value)} onKeyDown={e => {
                                if (e.key === "Enter" && found[0]) {
                                    set({ from: [...f.from, found[0].id] });
                                    setWho("");
                                }
                            }} />
                            {found.length > 0 && (
                                <div className="cbs-chips cbs-gap">
                                    {found.map(u => (
                                        <Chip key={u.id} label={u.sub && u.sub.toLowerCase() !== u.name.toLowerCase() ? `${u.name} (${u.sub})` : u.name} onClick={() => {
                                            set({ from: [...f.from, u.id] });
                                            setWho("");
                                        }} />
                                    ))}
                                </div>
                            )}
                            {!!who.trim() && !found.length && <div className="cbs-hint">nobody by that name loaded yet</div>}
                        </Section>
                        <Section title="has">
                            <div className="cbs-chips">{KINDS.map(([k, label]) => <Chip key={k} label={label} on={f.kind === k} onClick={() => set({ kind: k as Kind })} />)}</div>
                        </Section>
                        <Section title="leave out">
                            <div className="cbs-chips">{LEAVES.map(([k, label]) => <Chip key={k} label={label} on={f.leave.includes(k) && !clashes(k, f.kind)} dim={clashes(k, f.kind)} onClick={() => set({ leave: flip<Leave>(f.leave, k) })} />)}</div>
                        </Section>
                        <Section title="when">
                            <div className="cbs-chips">{WHENS.map(([k, label]) => <Chip key={k} label={label} on={f.when === k} onClick={() => set({ when: k as When })} />)}</div>
                            {f.when === "custom" && (
                                <div className="cbs-row cbs-gap">
                                    <input className="cbs-input" type="date" value={f.after} title="from" onChange={e => set({ after: e.target.value })} />
                                    <input className="cbs-input" type="date" value={f.before} title="until" onChange={e => set({ before: e.target.value })} />
                                </div>
                            )}
                        </Section>
                        <Section title="sort">
                            <div className="cbs-chips">{SORTS.map(([k, label]) => <Chip key={k} label={label} on={f.sort === k} onClick={() => set({ sort: k as Sort })} />)}</div>
                        </Section>
                        <button type="button" className="cbs-more" onClick={() => setExtra(!extra)}>
                            {extra ? "fewer filters" : `more filters${extraCount ? ` (${extraCount} on)` : ""}`}
                        </button>
                        {extra && (
                            <>
                                <Section title="pinned">
                                    <div className="cbs-chips">{PINS.map(([k, label]) => <Chip key={k} label={label} on={f.pinned === k} onClick={() => set({ pinned: k as Pinned })} />)}</div>
                                </Section>
                                <Section title="about me">
                                    <div className="cbs-chips">
                                        <Chip label="mentions me" on={f.mentionsMe} onClick={() => set({ mentionsMe: !f.mentionsMe })} />
                                        <Chip label="replies to me" on={f.repliesToMe} onClick={() => set({ repliesToMe: !f.repliesToMe })} />
                                    </div>
                                </Section>
                                <Section title="file type">
                                    <input className="cbs-input" value={f.ext} placeholder="png, pdf, mp3" onChange={e => set({ ext: e.target.value })} onKeyDown={enter} />
                                </Section>
                                <Section title="file name has">
                                    <input className="cbs-input" value={f.filename} placeholder="resume" onChange={e => set({ filename: e.target.value })} onKeyDown={enter} />
                                </Section>
                                <Section title="links to">
                                    <input className="cbs-input" value={f.site} placeholder="youtube.com, x.com" onChange={e => set({ site: e.target.value })} onKeyDown={enter} />
                                </Section>
                            </>
                        )}
                        <div className="cbs-actions">
                            <button type="button" className="cbs-btn" disabled={busy} onClick={() => go(false)}>{busy ? "searching..." : "search"}</button>
                            <button type="button" className="cbs-btn cbs-plain" onClick={reset}>reset</button>
                        </div>
                    </div>
                    <div className="cbs-results" ref={list} onScroll={onScroll}>
                        {status === "idle" ? (
                            <div className="cbs-empty">
                                <b>pick some filters</b>
                                {"then hit search. \"photos\" only finds pictures people actually uploaded, no gifs or link previews."}
                            </div>
                        ) : (
                            <>
                                <div className="cbs-summary">{`${where} · ${describe(f, id => nameOf(id, guildId))}`}</div>
                                <div className={`cbs-count${status === "error" ? " cbs-error" : ""}`}>
                                    {status === "loading" ? "searching..."
                                        : status === "indexing" ? "discord is indexing this chat, hang on..."
                                            : status === "error" ? error
                                                : hits.length ? `${total} result${total === 1 ? "" : "s"}` : "nothing found"}
                                </div>
                                {hits.map((m: any) => <Hit key={m.id} m={m} place={scope === "chat" ? "" : placeOf(m, channels)} onOpen={openHit} onCopy={copyHit} />)}
                                {hits.length > 0 && (
                                    <div className="cbs-foot">
                                        {more
                                            ? <button type="button" className="cbs-btn cbs-plain" disabled={status === "more"} onClick={() => go(true)}>{status === "more" ? "loading..." : "load more"}</button>
                                            : "that's all"}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function closeMenu() {
    const u = unmount;
    const h = host;
    unmount = null;
    host = null;
    if (!u && !h) return;
    setTimeout(() => {
        quiet(() => u?.());
        h?.remove();
    }, 0);
}

export function openMenu(preset: Preset) {
    closeMenu();
    host = document.createElement("div");
    host.id = "cheeseburger-search";
    document.body.appendChild(host);
    unmount = mount(host, <Menu preset={preset} close={closeMenu} />);
}

export const menuOpen = () => !!host;
