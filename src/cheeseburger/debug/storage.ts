import { createPluginStore } from "@api/storage";

interface DebugSettings {
    repo: string;
    token: string;
    lastSent: number;
    lastCrashSent: number;
    status: string;
    verified: boolean;
}

export const {
    useStore: useDebugSettings,
    settings: debugSettings,
} = createPluginStore<DebugSettings>("cheeseburger-debug", {
    repo: "",
    token: "",
    lastSent: 0,
    lastCrashSent: 0,
    status: "",
    verified: false,
});

export const {
    useStore: useDebugLink,
    settings: debugLink,
} = createPluginStore<{ repo: string; token: string; }>("cheeseburger-debug-link", {
    repo: "",
    token: "",
});
