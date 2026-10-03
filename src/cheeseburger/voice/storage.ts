import { createPluginStore } from "@api/storage";

export interface VoiceSettings {
    mic: number;
    drive: boolean;
    driveAmount: number;
    lofi: boolean;
    lofiAmount: number;
}

export const {
    useStore: useVoiceSettings,
    settings: voiceSettings,
} = createPluginStore<VoiceSettings>("cheeseburger-voice", {
    mic: 100,
    drive: false,
    driveAmount: 50,
    lofi: false,
    lofiAmount: 50,
});
