import { SelectedChannelStore } from "@metro/common/stores";

const PAUSE = /^https?:\/\/api\.spotify\.com\/v1\/me\/player\/pause(?:[/?#]|$)/i;
const HARMLESS = "https://api.spotify.com/v1/me/player";
const G = globalThis as any;
const log: string[] = G.__cheeseburgerSpotifyLog ??= [];

let active = false;
let hook: { proto: any; open: Function; send: Function; myOpen: Function; mySend: Function; } | null = null;
let note = "off";

function remember(line: string) {
    const d = new Date();
    const h = d.getHours();
    log.push(`${d.getMonth() + 1}/${d.getDate()} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"} ${line}`);
    if (log.length > 12) log.shift();
}

function inCall(): boolean {
    try {
        return !!SelectedChannelStore.getVoiceChannelId?.();
    } catch {
        return false;
    }
}

function install(): string {
    const proto = G.XMLHttpRequest?.prototype;
    if (!proto || typeof proto.open !== "function" || typeof proto.send !== "function") return "no XMLHttpRequest";
    const open = proto.open;
    const send = proto.send;
    const myOpen = function (this: any, method: any, url: any, ...rest: any[]) {
        let m = method;
        let u = url;
        try {
            this.__cheeseburgerSpotifyPause = false;
            if (active && typeof url === "string" && PAUSE.test(url) && String(method).toUpperCase() === "PUT") {
                this.__cheeseburgerSpotifyPause = true;
                m = "GET";
                u = HARMLESS;
                remember(`blocked discord pausing spotify${inCall() ? " during a call" : ""}`);
            }
        } catch { }
        return open.call(this, m, u, ...rest);
    };
    const mySend = function (this: any, ...a: any[]) {
        let swapped = false;
        try {
            swapped = this.__cheeseburgerSpotifyPause === true;
        } catch { }
        return swapped ? send.call(this) : send.apply(this, a);
    };
    proto.open = myOpen;
    proto.send = mySend;
    hook = { proto, open, send, myOpen, mySend };
    return "watching discord's spotify requests";
}

export default {
    start() {
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

export function spotifyDebug(): string[] {
    return [`spotify auto-pause blocker: ${note}, blocked ${log.length ? `${log.length} recently` : "none yet"}`, ...log.map(l => `  ${l}`)];
}
