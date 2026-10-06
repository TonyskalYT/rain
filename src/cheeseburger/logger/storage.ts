import { createPluginStore } from "@api/storage";

interface LoggerSettings {
    tookOver: boolean;
}

export const {
    useStore: useLoggerSettings,
    settings: loggerSettings,
} = createPluginStore<LoggerSettings>("cheeseburgerlogger", {
    tookOver: false,
});
