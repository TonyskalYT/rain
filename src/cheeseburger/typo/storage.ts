import { createPluginStore } from "@api/storage";

export interface FixLog { from: string; to: string; at: number; how: string; }

export interface TypoSettings {
    never: string[];
    sent: Record<string, number>;
    log: FixLog[];
}

export const {
    useStore: useTypoSettings,
    settings: typoSettings,
} = createPluginStore<TypoSettings>("cheeseburgertypo", {
    never: [],
    sent: {},
    log: [],
});
