import { waitForHydration } from "@api/storage";
import { UserStore } from "@metro/common/stores";

import { rewriteSearch, rewriteTabs } from "./query";
import { searchSettings, useSearchSettings } from "./storage";

const G = globalThis as any;
const log: string[] = G.__cheeseburgerSearchLog ??= [];
const seen = { get: 0, tabs: 0, other: 0, last: "" };

let active = false;
let hook: { proto: any; open: Function; send: Function; myOpen: Function; mySend: Function; } | null = null;
let note = "off";

function myId(): string | undefined {
    try {
        return UserStore.getCurrentUser?.()?.id;
    } catch {
        return undefined;
    }
}

const options = () => ({ preciseHas: searchSettings.preciseHas !== false, me: myId() });

function remember(line: string) {
    const d = new Date();
    const h = d.getHours();
    log.push(`${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"} ${line}`);
    if (log.length > 10) log.shift();
}

const shape = (url: string) => url.split("?")[0].replace(/^https?:\/\/[^/]+/, "").replace(/\d{5,}/g, "#");

function install(): string {
    const proto = G.XMLHttpRequest?.prototype;
    if (!proto || typeof proto.open !== "function" || typeof proto.send !== "function") return "no XMLHttpRequest";
    const open = proto.open;
    const send = proto.send;
    const tabs = new WeakMap<object, string>();
    const myOpen = function (this: any, method: any, url: any, ...rest: any[]) {
        let u = url;
        try {
            if (this) tabs.delete(this);
            if (active && typeof url === "string" && url.includes("/messages/search")) {
                const m = String(method).toUpperCase();
                if (m === "POST" && url.includes("/search/tabs")) {
                    seen.tabs++;
                    if (this) tabs.set(this, url);
                } else if (m === "GET") {
                    seen.get++;
                    const r = rewriteSearch(url, options());
                    if (r) {
                        u = r.url;
                        remember(`get: ${r.changes.join(", ")}`);
                    }
                } else {
                    seen.other++;
                    seen.last = `${m} ${shape(url)}`;
                }
            }
        } catch { }
        return open.call(this, method, u, ...rest);
    };
    const mySend = function (this: any, body: any, ...rest: any[]) {
        let b = body;
        try {
            const url = this ? tabs.get(this) : undefined;
            if (url) {
                tabs.delete(this);
                if (active && typeof body === "string") {
                    const r = rewriteTabs(url, body, options());
                    if (r) {
                        b = r.body;
                        remember(`tabs: ${r.changes.join(", ")}`);
                    }
                }
            }
        } catch { }
        return send.call(this, b, ...rest);
    };
    proto.open = myOpen;
    proto.send = mySend;
    hook = { proto, open, send, myOpen, mySend };
    return "rewriting discord searches";
}

export default {
    async start() {
        await waitForHydration(useSearchSettings);
        active = true;
        if (!hook) note = install();
    },
    stop() {
        active = false;
        if (hook) {
            try {
                if (hook.proto.open === hook.myOpen) hook.proto.open = hook.open;
                if (hook.proto.send === hook.mySend) hook.proto.send = hook.send;
            } catch { }
            hook = null;
        }
        note = "off";
    },
};

export function searchDebug(): string[] {
    return [
        `search: ${note}, precise has ${searchSettings.preciseHas !== false ? "on" : "off"}, searches seen ${seen.tabs} tabs / ${seen.get} get / ${seen.other} other${seen.last ? ` (last other ${seen.last})` : ""}, rewrote ${log.length ? `${log.length} recently` : "none yet"}`,
        ...log.map(l => `  ${l}`),
    ];
}
