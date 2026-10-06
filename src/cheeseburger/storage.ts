import { createPluginStore } from "@api/storage";

export type FeatureId = "volume" | "deafen" | "split" | "rotate" | "style" | "share" | "updates" | "voice" | "logger" | "spotify";

export const {
    useStore: useCheeseburger,
    settings: cheeseburger,
} = createPluginStore<Record<FeatureId, boolean>>("cheeseburger", {
    volume: true,
    deafen: true,
    split: true,
    rotate: true,
    style: true,
    share: true,
    updates: true,
    voice: true,
    logger: true,
    spotify: true,
});
