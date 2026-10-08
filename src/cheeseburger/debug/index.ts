import { hotStatus } from "@api/hot/status";
import { NativeClientInfoModule, NativeFileModule } from "@api/native/modules";
import { waitForHydration } from "@api/storage";
import { findByStoreName } from "@metro";
import { SelectedChannelStore, UserStore } from "@metro/common/stores";
import { getCurrentTheme } from "@plugins/_core/painter/themes";
import { AppState, Dimensions, PixelRatio, Platform, StatusBar } from "react-native";

import { caught, crashDebug, lastCrashAt, safe, watchdogDebug } from "../crash";
import { useDeafenButtonSettings } from "../deafen/storage";
import { featureTimes } from "../features";
import { loggerDebug } from "../logger";
import { lookDebug } from "../look";
import { rotateDebug } from "../rotate";
import { searchDebug } from "../search";
import { shareDebug } from "../share";
import { useShareSettings } from "../share/storage";
import { factoryDebug } from "../split";
import { isFullscreenSplit, isSplitActive, layoutDebug } from "../split/layout";
import { pipDebug } from "../split/pip";
import { labText, onLabReady, pinControlsDebug, pinIconName } from "../split/PipPin";
import { useSplitViewSettings } from "../split/storage";
import { hasVideo } from "../split/tiles";
import { spotifyDebug } from "../spotify";
import { useCheeseburger } from "../storage";
import { styleDebug } from "../style";
import { accentColor, baseColor } from "../style/colors";
import { useStyleSettings } from "../style/storage";
import { toolbarDebug } from "../toolbar";
import { typoDebug } from "../typo";
import { buildRevision } from "../updates";
import { voiceDebug } from "../voice";
import { useVoiceSettings } from "../voice/storage";
import { volumeDebug } from "../volume";
import { useVolumeBoostSettings } from "../volume/storage";
import { androidDebug, pluginList, refreshAndroid } from "./android";
import { debugLink, debugSettings, useDebugLink, useDebugSettings } from "./storage";

const started = Date.now();
const API = "https://api.github.com";
const REPO = /^[\w.-]+\/[\w.-]+$/;

function attempt(name: string, fn: () => string[] | string): string[] {
    try {
        const out = fn();
        return Array.isArray(out) ? out : [out];
    } catch (e) {
        return [`${name}: failed (${String((e as any)?.message ?? e).slice(0, 100)})`];
    }
}

const plain = (o: any, skip: string[] = []) => {
    try {
        const out: any = {};
        for (const k of Object.keys(o ?? {})) {
            if (skip.includes(k) || typeof o[k] === "function" || k.startsWith("_")) continue;
            out[k] = o[k];
        }
        return JSON.stringify(out).slice(0, 600);
    } catch {
        return "?";
    }
};

const stamp = (t: number) => {
    const d = new Date(t);
    const off = -d.getTimezoneOffset() / 60;
    return `${d.toISOString()} (utc${off >= 0 ? "+" : ""}${off})`;
};

interface Names { people: Map<string, string>; words: Map<string, string>; }

function store(name: string): any {
    try {
        return findByStoreName(name);
    } catch {
        return null;
    }
}

function names(): Names {
    const people = new Map<string, string>();
    const words = new Map<string, string>();
    const me = UserStore?.getCurrentUser?.();
    const tag = (id: any, label: string) => {
        if (id != null && !people.has(String(id))) people.set(String(id), label);
        return people.get(String(id)) ?? label;
    };
    const word = (w: any, label: string) => {
        if (typeof w !== "string") return;
        const t = w.trim();
        if (t.length >= 3 && !words.has(t)) words.set(t, label);
    };
    const rel = store("RelationshipStore");
    const addUser = (u: any, label: string) => {
        if (!u) return;
        const l = tag(u.id, label);
        word(u.username, l);
        word(u.globalName ?? u.global_name, l);
        try {
            word(rel?.getNickname?.(u.id), l);
        } catch { }
    };
    addUser(me, "me");
    try {
        for (const a of store("ConnectedAccountsStore")?.getAccounts?.() ?? []) word(a?.name, "me");
    } catch { }
    const channelId = SelectedChannelStore?.getVoiceChannelId?.();
    if (channelId) {
        const channel = store("ChannelStore")?.getChannel?.(channelId);
        word(channel?.name, "channel");
        if (channel?.guild_id) word(store("GuildStore")?.getGuild?.(channel.guild_id)?.name, "server");
        const members = store("GuildMemberStore");
        let n = 0;
        for (const p of store("ChannelRTCStore")?.getParticipants?.(channelId) ?? []) {
            const u = p?.user;
            if (!u || people.has(String(u.id))) continue;
            addUser(u, `person ${++n}`);
            if (channel?.guild_id) {
                try {
                    word(members?.getMember?.(channel.guild_id, u.id)?.nick, people.get(String(u.id)) ?? "someone");
                } catch { }
            }
        }
    }
    return { people, words };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scrub(text: string, n: Names): string {
    let out = text;
    const list = [...n.words.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [w, label] of list) out = out.replace(new RegExp(escape(w), "gi"), `‹${label}›`);
    const ids = new Map<string, string>();
    out = out.replace(/\b\d{16,21}\b/g, id => {
        const who = n.people.get(id);
        if (who) return `‹${who}›`;
        if (!ids.has(id)) ids.set(id, `#${ids.size + 1}`);
        return `‹id${ids.get(id)}›`;
    });
    out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b(?![:\w.])/gi, m => (/\.(?:bundle|js|jsx|tsx?|hbc)$/i.test(m) ? m : "‹email›"));
    out = out.replace(/\b(?:github_pat|ghp|gho|ghu|ghs)_\w+/g, "‹token›");
    return out;
}

function device(): string[] {
    const c: any = (Platform as any).constants ?? {};
    let info: any = {};
    try {
        info = NativeClientInfoModule?.getConstants?.() ?? {};
    } catch { }
    const win = Dimensions.get("window");
    const scr = Dimensions.get("screen");
    return [
        `discord ${info.Version ?? "?"} (${info.Build ?? "?"}) ${info.ReleaseChannel ?? ""}`.trim(),
        `rain ${buildRevision}, cheeseburger ${hotStatus.source} ${hotStatus.revision}${hotStatus.error ? `, hot error: ${hotStatus.error}` : ""}`,
        `phone ${c.Brand ?? ""} ${c.Model ?? ""}, android ${c.Release ?? "?"} (sdk ${c.Version ?? Platform.Version}), hermes ${!!(globalThis as any).HermesInternal}`,
        `window ${Math.round(win.width)}x${Math.round(win.height)}, screen ${Math.round(scr.width)}x${Math.round(scr.height)}, density ${PixelRatio.get()}, font ${PixelRatio.getFontScale()}, status bar ${StatusBar?.currentHeight ?? "?"}`,
        `app ${AppState.currentState}, this copy loaded ${Math.round((Date.now() - started) / 60000)}m ago`,
        `feature start times: ${[...featureTimes].map(([k, v]) => `${k} ${v}ms`).join(", ") || "none yet"}`,
    ];
}

function call(n: Names): string[] {
    const channelId = SelectedChannelStore?.getVoiceChannelId?.();
    if (!channelId) return ["not in a call"];
    const channel = store("ChannelStore")?.getChannel?.(channelId);
    const parts: any[] = store("ChannelRTCStore")?.getParticipants?.(channelId) ?? [];
    const lines = parts.slice(0, 16).map(p => {
        const who = n.people.get(String(p?.user?.id)) ?? "someone";
        const screen = p?.type === 0 || String(p?.id ?? "").startsWith("call:");
        const flags = [!screen && hasVideo(p) ? "camera" : "", p?.speaking ? "talking" : "", p?.streamId != null ? `stream ${p.streamId}` : ""].filter(Boolean).join(", ");
        const kind = screen ? "screen" : "user";
        return `  ${kind} ${who}${flags ? ` (${flags})` : ""}`;
    });
    return [
        `${channel?.guild_id ? "server" : "dm/group"} call, ${parts.length} tiles, split ${isSplitActive() ? "on" : "off"}${isFullscreenSplit() ? ", full screen" : ""}`,
        ...lines,
    ];
}

function setup(): string[] {
    const theme: any = getCurrentTheme?.();
    const state = (h: any) => {
        try {
            return h.getState();
        } catch {
            return {};
        }
    };
    const volume = state(useVolumeBoostSettings);
    return [
        `features ${plain(state(useCheeseburger))}`,
        `split ${plain(state(useSplitViewSettings))}`,
        `deafen ${plain(state(useDeafenButtonSettings))}`,
        `volume ${plain(volume, ["boosted"])}, boosted ${Object.keys(volume.boosted ?? {}).length}`,
        `style ${plain(state(useStyleSettings))}`,
        `share ${plain(state(useShareSettings))}`,
        `voice ${plain(state(useVoiceSettings))}`,
        `theme ${theme?.id ?? "none"} ${theme?.data?.name ?? ""}, base ${baseColor() ?? "?"}, accent ${accentColor("?")}`,
        ...pluginList(),
    ];
}

export function debugReport(): string {
    const n = names();
    const sections: [string, () => string[] | string][] = [
        ["device", device],
        ["setup", setup],
        ["call", () => call(n)],
        ["crashes", () => [...crashDebug(), ...watchdogDebug()]],
        ["android", androidDebug],
        ["split", () => [...layoutDebug(), ...factoryDebug(), ...pipDebug(), ...pinControlsDebug(), `pin icon: ${pinIconName || "none found"}`]],
        ["style", () => [...styleDebug(), lookDebug(), toolbarDebug()]],
        ["share", shareDebug],
        ["volume", volumeDebug],
        ["voice", voiceDebug],
        ["rotate", rotateDebug],
        ["logger", loggerDebug],
        ["spotify", spotifyDebug],
        ["search", searchDebug],
        ["typo", typoDebug],
    ];
    const out = [`cheeseburger debug ${stamp(Date.now())}`];
    for (const [name, fn] of sections) out.push("", `== ${name}`, ...attempt(name, fn));
    return scrub(out.join("\n"), n);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64(text: string): string {
    const bytes: number[] = [];
    for (const ch of text) {
        let c = ch.codePointAt(0)!;
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else {
            c = Math.min(c, 0x10ffff);
            bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
    }
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        const v = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
        out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (b === undefined ? "=" : B64[(v >> 6) & 63]) + (c === undefined ? "=" : B64[v & 63]);
    }
    return out;
}

const headers = (token: string) => ({
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
});

const why = (status: number) => (status === 401 ? "token not accepted" : status === 403 ? "token can't write there" : status === 404 ? "repo not found for this token" : `github said ${status}`);

async function put(repo: string, token: string, path: string, text: string, message: string) {
    const url = `${API}/repos/${repo}/contents/${path}`;
    let sha: string | undefined;
    const head = await fetch(url, { headers: headers(token) });
    if (head.ok) sha = (await head.json())?.sha;
    else if (head.status !== 404) throw new Error(why(head.status));
    const res = await fetch(url, { method: "PUT", headers: headers(token), body: JSON.stringify({ message, content: base64(text), ...(sha ? { sha } : {}) }) });
    if (!res.ok) throw new Error(why(res.status));
}

export async function connectDebug(repo: string, token: string): Promise<string> {
    let r = repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
    const t = token.trim();
    if (!t) return "paste the token";
    if (!r) return "type the repo name";
    try {
        if (!r.includes("/")) {
            const me = await fetch(`${API}/user`, { headers: headers(t) });
            if (!me.ok) return why(me.status);
            const login = (await me.json())?.login;
            if (typeof login !== "string" || !login) return "couldn't tell whose token this is";
            r = `${login}/${r}`;
        }
        if (!REPO.test(r)) return "that repo name looks off";
        const res = await fetch(`${API}/repos/${r}`, { headers: headers(t) });
        if (!res.ok) return why(res.status);
        const info = await res.json();
        if (info?.private !== true) return "that repo is public, make it private first";
        if (info?.permissions && info.permissions.push === false) return "token can't write there";
    } catch (e) {
        return `couldn't reach github (${String((e as any)?.message ?? e).slice(0, 40)})`;
    }
    debugSettings.repo = r;
    debugSettings.token = t;
    debugSettings.verified = true;
    debugLink.repo = r;
    debugLink.token = t;
    debugSettings.status = "";
    return "";
}

export function disconnectDebug() {
    debugLink.repo = "";
    debugLink.token = "";
    debugSettings.repo = "";
    debugSettings.token = "";
    debugSettings.verified = false;
    debugSettings.status = "";
}

const two = (n: number) => String(n).padStart(2, "0");
let sending: Promise<string> | null = null;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(safe("debug timeout", () => reject(new Error("github didn't answer"))), ms);
        p.then(v => {
            clearTimeout(timer);
            resolve(v);
        }, e => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

export function sendDebug(reason = "sent"): Promise<string> {
    if (sending) return sending;
    sending = (async () => {
        restoreLink();
        const repo = debugSettings.repo;
        const token = debugSettings.token;
        if (!token || !REPO.test(repo) || !debugSettings.verified) return "connect it first";
        const d = new Date();
        const name = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
        let status: string;
        try {
            await refreshAndroid();
            const text = debugReport();
            await within(put(repo, token, `debug/${name}-${reason}.txt`, text, `${reason} ${name}`), 25000);
            await within(put(repo, token, "latest.txt", text, `latest ${name}`), 25000);
            debugSettings.lastSent = Date.now();
            status = `${reason} ${d.getHours() % 12 || 12}:${two(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
        } catch (e) {
            status = `failed: ${String((e as any)?.message ?? e).slice(0, 60)}, will retry`;
            savePending(name, reason);
        }
        debugSettings.status = status;
        return status;
    })().finally(() => {
        sending = null;
    });
    return sending;
}

let crashTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let retries = 0;
const PENDING = "rain/cheeseburger-debug-pending.json";

function savePending(name: string, reason: string) {
    let text = "";
    try {
        text = debugReport();
    } catch {
        return;
    }
    void NativeFileModule.writeFile("documents", PENDING, JSON.stringify({ name, reason, text }), "utf8").catch(() => { });
}

async function retryPending() {
    if (sending || retries >= 10) return;
    const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${PENDING}`;
    let data: any = null;
    try {
        if (!(await NativeFileModule.fileExists(path))) return;
        data = JSON.parse(await NativeFileModule.readFile(path, "utf8"));
    } catch {
        return;
    }
    if (!data?.text || !data?.name) return;
    restoreLink();
    if (!debugSettings.token || !REPO.test(debugSettings.repo) || !debugSettings.verified) return;
    retries++;
    try {
        await within(put(debugSettings.repo, debugSettings.token, `debug/${data.name}-${data.reason ?? "sent"}-late.txt`, data.text, `late ${data.name}`), 25000);
        await NativeFileModule.writeFile("documents", PENDING, "{}", "utf8");
        debugSettings.status = `sent late ${data.name.slice(11, 15)}`;
    } catch { }
}

function restoreLink() {
    if (debugSettings.verified && debugSettings.token && debugSettings.repo) {
        if (debugLink.token !== debugSettings.token || debugLink.repo !== debugSettings.repo) {
            debugLink.repo = debugSettings.repo;
            debugLink.token = debugSettings.token;
        }
        return;
    }
    if (!debugLink.token || !REPO.test(debugLink.repo)) return;
    debugSettings.repo = debugLink.repo;
    debugSettings.token = debugLink.token;
    debugSettings.verified = true;
}

let labTimer: ReturnType<typeof setTimeout> | null = null;
let labOff: (() => void) | null = null;
let labSentAt = 0;
let labSending = false;
let labUploads = 0;

const sendLab = safe("debug lab", () => {
    labTimer = null;
    restoreLink();
    const repo = debugSettings.repo;
    const token = debugSettings.token;
    if (!token || !REPO.test(repo) || !debugSettings.verified || labSending || labUploads >= 12) return;
    const wait = 15000 - (Date.now() - labSentAt);
    if (wait > 0) {
        labTimer = setTimeout(sendLab, wait);
        return;
    }
    const d = new Date();
    const name = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const n = names();
    const text = scrub([`cheeseburger pin lab ${d.toISOString()}`, ...device(), ...call(n), "", ...labText()].join("\n"), n);
    labSending = true;
    labSentAt = Date.now();
    labUploads++;
    void put(repo, token, `lab/${name}.txt`, text, `lab ${name}`)
        .then(() => put(repo, token, "lab-latest.txt", text, `lab latest ${name}`))
        .catch(e => caught("debug lab upload", e))
        .finally(() => {
            labSending = false;
        });
});

export function startDebug() {
    labOff?.();
    labOff = onLabReady(() => {
        if (labTimer) clearTimeout(labTimer);
        labTimer = setTimeout(sendLab, 4000);
    });
    void Promise.all([waitForHydration(useDebugSettings), waitForHydration(useDebugLink)]).then(safe("debug restore", restoreLink), () => { });
    if (retryTimer) clearInterval(retryTimer);
    retries = 0;
    retryTimer = setInterval(safe("debug retry", () => void retryPending()), 120_000);
    setTimeout(safe("debug retry first", () => void retryPending()), 30_000);
    if (crashTimer) clearTimeout(crashTimer);
    crashTimer = setTimeout(() => {
        crashTimer = null;
        try {
            const t = lastCrashAt();
            if (!t || t <= (debugSettings.lastCrashSent || 0) || !debugSettings.verified) return;
            debugSettings.lastCrashSent = t;
            void sendDebug("crash");
        } catch (e) {
            caught("debug crash send", e);
        }
    }, 20000);
}

export function stopDebug() {
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = null;
    if (crashTimer) clearTimeout(crashTimer);
    crashTimer = null;
    labOff?.();
    labOff = null;
    if (labTimer) clearTimeout(labTimer);
    labTimer = null;
}
