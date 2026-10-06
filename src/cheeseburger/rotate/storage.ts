import { createPluginStore } from "@api/storage";

interface RotateLog {
    lines: string[];
}

export const {
    useStore: useRotateLog,
    settings: rotateLog,
} = createPluginStore<RotateLog>("cheeseburger-rotate-log", {
    lines: [],
});
