import { CHEATSHEET, rewriteSearch, rewriteTabs } from "../query";
import { attempt, bd, channelOf, dmWith, myId, quiet, selectedChannel, selectedGuild } from "./discord";
import { closeMenu, menuOpen, openMenu, Preset } from "./Menu";
import { CSS } from "./style";

const NAME = "CheeseburgerSearch";
const ICON = "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M3 6h11M18 6h3M3 12h3M10 12h11M3 18h13M20 18h1\"/><circle cx=\"16\" cy=\"6\" r=\"2\"/><circle cx=\"8\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/></svg>";

const precise = () => attempt(() => bd().Data.load(NAME, "preciseHas"), undefined) !== false;
const options = () => ({ preciseHas: precise(), me: myId() });

function rewriteUrl(url: unknown): unknown {
    if (typeof url !== "string" || !url.includes("/messages/search")) return url;
    return attempt(() => rewriteSearch(url, options())?.url, url);
}

function rewriteBody(url: string, body: unknown): unknown {
    if (typeof body !== "string" || !url.includes("/search/tabs")) return body;
    return attempt(() => rewriteTabs(url, body, options())?.body, body);
}

function here(): Preset {
    const channelId = selectedChannel();
    return { channelId, guildId: channelOf(channelId)?.guild_id ?? selectedGuild() };
}

function Settings() {
    const { useState } = bd().React;
    const [on, setOn] = useState(precise());
    return (
        <div className="cbs-settings">
            <label className="cbs-check">
                <input
                    type="checkbox"
                    checked={on}
                    onChange={e => {
                        setOn(e.target.checked);
                        bd().Data.save(NAME, "preciseHas", e.target.checked);
                    }}
                />
                has: image and has: video only find uploads (no gifs, link previews or website images)
            </label>
            <div>
                {"Open the advanced search with the filter button next to the search bar, "}
                <span className="cbs-kbd">Ctrl</span> + <span className="cbs-kbd">Shift</span> + <span className="cbs-kbd">F</span>
                {", or right click a channel, dm, server or person."}
            </div>
            <div>
                <button type="button" className="cbs-btn cbs-plain" onClick={() => openMenu(here())}>open advanced search</button>
            </div>
            <div className="cbs-label">Extra filters for the normal search bar</div>
            <div className="cbs-cheats">
                {CHEATSHEET.map(([k, v]) => [<code key={k}>{k}</code>, <span key={`${k}-text`}>{v}</span>])}
            </div>
            <div className="cbs-hint">{"mix them with discord's own, like from: me is:photo not:gif sort:old"}</div>
        </div>
    );
}

function button(): HTMLElement {
    const b = document.createElement("div");
    b.className = "cbs-open";
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", "Advanced search");
    b.title = "Advanced search (Ctrl+Shift+F)";
    b.innerHTML = ICON;
    b.addEventListener("click", e => {
        e.stopPropagation();
        openMenu(here());
    });
    return b;
}

function placeButtons() {
    let placed = false;
    for (const bar of document.querySelectorAll("[class*=\"searchBar_\"]")) {
        const box = bar.closest("[class*=\"search_\"]") ?? bar;
        const parent = box.parentElement;
        if (!parent) continue;
        placed = true;
        if (parent.querySelector(":scope > .cbs-open")) continue;
        parent.insertBefore(button(), box);
    }
    if (placed) return;
    for (const bar of document.querySelectorAll("[class*=\"toolbar_\"]")) {
        const search = bar.querySelector("[class*=\"search_\"]");
        if (!search || bar.querySelector(".cbs-open")) continue;
        let child: Element | null = search;
        while (child && child.parentElement !== bar) child = child.parentElement;
        if (child) bar.insertBefore(button(), child);
    }
}

export default class CheeseburgerSearch {
    private undo: (() => void)[] = [];

    start() {
        const later = (fn: () => void) => void this.undo.push(fn);
        quiet(() => {
            bd().DOM.addStyle(NAME, CSS);
            later(() => bd().DOM.removeStyle(NAME));
        });
        quiet(() => this.hookRequests(later));
        quiet(() => this.hookKeys(later));
        quiet(() => this.hookMenus(later));
        quiet(() => this.hookToolbar(later));
    }

    stop() {
        closeMenu();
        for (const u of this.undo.splice(0).reverse()) quiet(u);
    }

    getSettingsPanel() {
        return <Settings />;
    }

    private hookRequests(later: (fn: () => void) => void) {
        const proto = XMLHttpRequest.prototype as any;
        const open = proto.open;
        const send = proto.send;
        const tabs = new WeakMap<object, string>();
        const myOpen = function (this: any, method: any, url: any, ...rest: any[]) {
            const m = String(method).toUpperCase();
            tabs.delete(this);
            if (m === "POST" && typeof url === "string" && url.includes("/search/tabs")) tabs.set(this, url);
            return open.call(this, method, m === "GET" ? rewriteUrl(url) : url, ...rest);
        };
        const mySend = function (this: any, body: any, ...rest: any[]) {
            const url = tabs.get(this);
            if (url) tabs.delete(this);
            return send.call(this, url ? rewriteBody(url, body) : body, ...rest);
        };
        proto.open = myOpen;
        proto.send = mySend;
        const fetchFn = window.fetch;
        const myFetch = function (this: any, input: any, init?: any) {
            if (typeof input === "string") {
                const m = String(init?.method ?? "GET").toUpperCase();
                if (m === "GET") input = rewriteUrl(input);
                else if (m === "POST" && init && typeof init.body === "string") init = { ...init, body: rewriteBody(input, init.body) };
            }
            return fetchFn.call(this, input, init);
        };
        window.fetch = myFetch as typeof fetch;
        later(() => {
            if (proto.open === myOpen) proto.open = open;
            if (proto.send === mySend) proto.send = send;
            if (window.fetch === myFetch) window.fetch = fetchFn;
        });
    }

    private hookKeys(later: (fn: () => void) => void) {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== "KeyF") return;
            e.preventDefault();
            e.stopPropagation();
            if (menuOpen()) closeMenu();
            else openMenu(here());
        };
        window.addEventListener("keydown", onKey, true);
        later(() => window.removeEventListener("keydown", onKey, true));
    }

    private hookMenus(later: (fn: () => void) => void) {
        const menu = bd().ContextMenu;
        const add = (tree: any, label: string, preset: () => Preset) => {
            const kids = tree?.props?.children;
            if (!kids) return;
            const items = [menu.buildItem({ type: "separator" }), menu.buildItem({ type: "text", id: "cheeseburger-search", label, action: () => openMenu(preset()) })];
            if (Array.isArray(kids)) kids.push(...items);
            else tree.props.children = [kids, ...items];
        };
        const chat = (_: any, props: any) => {
            const ch = props?.channel;
            if (!ch?.id) return;
            return { channelId: ch.id, guildId: ch.guild_id ?? undefined, scope: "chat" } as Preset;
        };
        const patches: [string, (tree: any, props: any) => void][] = [
            ["user-context", (tree, props) => {
                const user = props?.user;
                if (!user?.id) return;
                const guildId = props?.guildId ?? props?.channel?.guild_id ?? undefined;
                add(tree, guildId ? "Search their messages here" : "Search their messages", () => {
                    const channelId = props?.channel?.id ?? (guildId ? selectedChannel() : dmWith(user.id)) ?? selectedChannel();
                    return { channelId, guildId, from: [user.id], scope: guildId ? "server" : "chat" };
                });
            }],
            ["channel-context", (tree, props) => {
                const preset = chat(tree, props);
                if (preset) add(tree, "Advanced search here", () => preset);
            }],
            ["thread-context", (tree, props) => {
                const preset = chat(tree, props);
                if (preset) add(tree, "Advanced search here", () => preset);
            }],
            ["gdm-context", (tree, props) => {
                const preset = chat(tree, props);
                if (preset) add(tree, "Advanced search here", () => preset);
            }],
            ["guild-context", (tree, props) => {
                const guildId = props?.guild?.id;
                if (!guildId) return;
                add(tree, "Advanced search in this server", () => {
                    const current = selectedChannel();
                    return { guildId, channelId: channelOf(current)?.guild_id === guildId ? current : undefined, scope: "server" };
                });
            }],
        ];
        for (const [id, fn] of patches) {
            const undo = menu.patch(id, (tree: any, props: any) => quiet(() => fn(tree, props)));
            later(() => undo?.());
        }
    }

    private hookToolbar(later: (fn: () => void) => void) {
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                quiet(placeButtons);
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
        quiet(placeButtons);
        later(() => {
            observer.disconnect();
            document.querySelectorAll(".cbs-open").forEach(n => n.remove());
        });
    }
}
