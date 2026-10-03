import { React } from "@metro/common";
import { ActionSheet, BottomSheetTitleHeader, Button, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { ScrollView, View } from "react-native";

import { safe } from "../crash";
import { applyPreset, maxMic, Preset, presetOf, PRESETS, resetVoice, setSwitch } from "./mic";
import { useVoiceSettings } from "./storage";
import { icon, Row, SliderBody, useSlider } from "./ui";

export const SHEET = "CheeseburgerVoice";

const num = (v: any, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function VoiceSheet() {
    const s = useVoiceSettings();
    const mic = useSlider(num(s.mic, 100), "mic");
    const drive = useSlider(num(s.driveAmount, 50), "driveAmount");
    const lofi = useSlider(num(s.lofiAmount, 50), "lofiAmount");
    const current = presetOf(s);
    const pick = React.useMemo(() => safe("voice preset", (p: Preset) => applyPreset(p.values)), []);
    const toggleDrive = React.useMemo(() => safe("voice distortion", (v: boolean) => setSwitch("drive", !!v)), []);
    const toggleLofi = React.useMemo(() => safe("voice lofi", (v: boolean) => setSwitch("lofi", !!v)), []);
    const reset = React.useMemo(() => safe("voice reset", () => resetVoice()), []);

    return (
        <ActionSheet>
            <BottomSheetTitleHeader title="voice effects" />
            <View style={{ paddingVertical: 12, gap: 16 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                    {PRESETS.map(p => (
                        <Button
                            key={p.name}
                            text={p.name}
                            size="sm"
                            variant={current === p.name ? "primary" : "secondary"}
                            onPress={() => pick(p)}
                        />
                    ))}
                </ScrollView>
                <View style={{ paddingHorizontal: 16, gap: 16 }}>
                    <TableRowGroup title="mic">
                        <Row
                            icon={icon("MicrophoneIcon")}
                            accessibilityLabel="mic volume"
                            label={<SliderBody title="volume" value={mic.value} max={maxMic()} step={10} onChange={mic.change} onDone={mic.done} />}
                        />
                    </TableRowGroup>
                    <TableRowGroup title="effects">
                        <TableSwitchRow
                            icon={icon("FireIcon", "SoundboardIcon")}
                            label="distortion"
                            subLabel="pushes your mic past clipping"
                            value={!!s.drive}
                            onValueChange={toggleDrive}
                        />
                        {!!s.drive && (
                            <Row
                                accessibilityLabel="distortion strength"
                                label={<SliderBody title="strength" value={drive.value} max={100} step={5} onChange={drive.change} onDone={drive.done} />}
                            />
                        )}
                        <TableSwitchRow
                            icon={icon("PhoneCallIcon", "PhoneIcon", "SoundboardIcon")}
                            label="lo-fi"
                            subLabel="drops your quality like a bad phone"
                            value={!!s.lofi}
                            onValueChange={toggleLofi}
                        />
                        {!!s.lofi && (
                            <Row
                                accessibilityLabel="lo-fi strength"
                                label={<SliderBody title="strength" value={lofi.value} max={100} step={5} onChange={lofi.change} onDone={lofi.done} />}
                            />
                        )}
                    </TableRowGroup>
                    <Button text="reset" variant="secondary" size="md" onPress={reset} />
                </View>
            </View>
        </ActionSheet>
    );
}
