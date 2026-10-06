import { createPluginStore } from "@api/storage";

export interface LoggerSettings {
    tookOver: boolean;
    keepDeleted: boolean;
    showEdits: boolean;
    depth: number;
    servers: boolean;
    ignoreBots: boolean;
    mine: boolean;
    save: boolean;
    saveDms: boolean;
    saveGroups: boolean;
    saveMentions: boolean;
    everyone: boolean;
    saveServers: boolean;
    restore: boolean;
    maxSaved: number;
}

export const {
    useStore: useLoggerSettings,
    settings: loggerSettings,
} = createPluginStore<LoggerSettings>("cheeseburgerlogger", {
    tookOver: false,
    keepDeleted: true,
    showEdits: true,
    depth: 5,
    servers: true,
    ignoreBots: true,
    mine: true,
    save: true,
    saveDms: true,
    saveGroups: true,
    saveMentions: true,
    everyone: false,
    saveServers: false,
    restore: true,
    maxSaved: 3000,
});
