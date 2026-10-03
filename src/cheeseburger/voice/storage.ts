import { createPluginStore } from "@api/storage";

interface VoiceSettings {
    mic: number;
    drive: boolean;
    driveAmount: number;
}

export const {
    useStore: useVoiceSettings,
    settings: voiceSettings,
} = createPluginStore<VoiceSettings>("cheeseburger-voice", {
    mic: 100,
    drive: false,
    driveAmount: 50,
});
