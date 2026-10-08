import { logger } from "@lib/utils/logger";

import { caught, guardLevel, setGuard } from "./crash";
import deafen from "./deafen";
import messageLogger from "./logger";
import rotate from "./rotate";
import search from "./search";
import share from "./share";
import split from "./split";
import spotify from "./spotify";
import { cheeseburger, FeatureId } from "./storage";
import style from "./style";
import typo from "./typo";
import updates from "./updates";
import voice from "./voice";
import volume from "./volume";

interface Feature {
    start(): unknown;
    stop(): unknown;
}

export const FEATURES: Record<FeatureId, Feature> = { volume, deafen, split, rotate, style, share, updates, voice, logger: messageLogger, spotify, search, typo };

const running = new Set<FeatureId>();
const chains = new Map<FeatureId, Promise<unknown>>();
let pluginRunning = false;

function enqueue(id: FeatureId, fn: () => unknown): Promise<unknown> {
    const next = (chains.get(id) ?? Promise.resolve()).then(fn);
    chains.set(id, next.catch(() => { }));
    return next;
}

export const featureTimes = new Map<string, number>();

const startFeature = (id: FeatureId) => enqueue(id, async () => {
    if (running.has(id)) return;
    try {
        const t = Date.now();
        await FEATURES[id].start();
        featureTimes.set(id, Date.now() - t);
        running.add(id);
    } catch (e) {
        logger.error(`[Cheeseburger] ${id}`, e);
        caught(`${id} start`, e);
        try {
            FEATURES[id].stop();
        } catch { }
    }
});

const stopFeature = (id: FeatureId) => enqueue(id, () => {
    if (!running.has(id)) return;
    running.delete(id);
    try {
        FEATURES[id].stop();
    } catch (e) {
        logger.error(`[Cheeseburger] ${id}`, e);
        caught(`${id} stop`, e);
    }
});

const HEAVY = new Set<FeatureId>(["split", "volume", "voice", "rotate", "deafen", "share", "style", "typo"]);

export function allowed(id: FeatureId, level = guardLevel()): boolean {
    if (level >= 2) return id === "updates";
    if (level >= 1) return !HEAVY.has(id);
    return true;
}

export async function startAll() {
    pluginRunning = true;
    cheeseburger.share = true;
    for (const id of Object.keys(FEATURES) as FeatureId[]) {
        if (!allowed(id)) continue;
        if (id === "share" || cheeseburger[id] !== false) await startFeature(id);
    }
}

export async function leaveSafeMode() {
    setGuard(0);
    if (pluginRunning) await startAll();
}

export async function stopAll() {
    pluginRunning = false;
    await Promise.all((Object.keys(FEATURES) as FeatureId[]).map(stopFeature));
}

export function setFeature(id: FeatureId, on: boolean) {
    if (id === "share") on = true;
    cheeseburger[id] = on;
    if (!pluginRunning || on && !allowed(id)) return;
    void (on ? startFeature(id) : stopFeature(id));
}
