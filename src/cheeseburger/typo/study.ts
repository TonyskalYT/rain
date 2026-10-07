import { NativeFileModule } from "@api/native/modules";
import { findByProps } from "@metro";
import { AppState } from "react-native";

import { blankFilters, buildRequest, readResults } from "../search/filters";

export interface Mine { at: number; texts: [string, string, number][]; }

const FILE = "rain/cheeseburger-typo-mine.json";
const PAGES = 40;
const DAY = 24 * 60 * 60 * 1000;
const G = globalThis as any;

export const studyState = { status: "not started", pages: 0, running: false };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function getMine(): Mine | null {
    return G.__cheeseburgerTypoMine ?? null;
}

export async function loadMine(): Promise<Mine | null> {
    if (G.__cheeseburgerTypoMine) return G.__cheeseburgerTypoMine;
    try {
        const path = `${NativeFileModule.getConstants().DocumentsDirPath}/${FILE}`;
        if (!(await NativeFileModule.fileExists(path))) return null;
        const data = JSON.parse(await NativeFileModule.readFile(path, "utf8"));
        if (data && Array.isArray(data.texts) && typeof data.at === "number") {
            G.__cheeseburgerTypoMine = data;
            return data;
        }
    } catch { }
    return null;
}

async function page(me: string, cursor: any): Promise<any> {
    const api = findByProps("getAPIBaseURL", "post") ?? findByProps("getAPIBaseURL", "del");
    if (typeof api?.post !== "function") throw new Error("no api");
    const req = buildRequest({ ...blankFilters(), fromMe: true, sort: "new" }, { kind: "dms" }, me, cursor ? { cursor } : {});
    if (!req) throw new Error("no request");
    for (let i = 0; i < 5; i++) {
        const res = await api.post({ url: req.url, body: req.body, oldFormErrors: true });
        const body = res?.body;
        if (res?.status === 202 || body?.code === 110000) {
            await sleep(Math.min(15, Math.max(2, Number(body?.retry_after) || 3)) * 1000);
            continue;
        }
        return body;
    }
    throw new Error("still indexing");
}

export async function study(me: string, alive: () => boolean, force = false): Promise<Mine | null> {
    const old = await loadMine();
    if (studyState.running || !force && old && Date.now() - old.at < DAY) return old;
    studyState.running = true;
    studyState.pages = 0;
    studyState.status = "reading your dms";
    const texts: [string, string, number][] = [];
    const seen = new Set<string>();
    let cursor: any = null;
    try {
        for (let i = 0; i < PAGES && alive(); i++) {
            while (AppState.currentState !== "active" && alive()) await sleep(5000);
            const results = readResults(await page(me, cursor));
            for (const m of results.hits) {
                if (seen.has(m.id) || typeof m.content !== "string" || !m.content.trim()) continue;
                seen.add(m.id);
                texts.push([String(m.channel_id ?? ""), m.content.slice(0, 500), Date.parse(m.timestamp) || 0]);
            }
            studyState.pages = i + 1;
            if (!results.cursor || !results.hits.length) break;
            cursor = results.cursor;
            await sleep(3500);
        }
        studyState.status = `read ${texts.length} of your messages`;
    } catch (e: any) {
        studyState.status = `stopped: ${String(e?.message ?? e).slice(0, 60)}`;
    } finally {
        studyState.running = false;
    }
    if (!texts.length) return old;
    const mine: Mine = { at: Date.now(), texts };
    G.__cheeseburgerTypoMine = mine;
    await NativeFileModule.writeFile("documents", FILE, JSON.stringify(mine), "utf8").catch(() => { });
    return mine;
}
