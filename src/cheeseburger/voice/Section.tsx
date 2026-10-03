import { findAssetId } from "@api/assets";
import { findByProps } from "@metro";
import { React } from "@metro/common";
import { Slider, TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { StyleSheet, View } from "react-native";

import { caught, safe } from "../crash";
import { accentColor } from "../style/colors";
import { commitLive, maxMic, setDrive, setLive } from "./mic";
import { useVoiceSettings } from "./storage";

type Key = "mic" | "amount";

const Row: any = TableRow;
const DRIVE_ICONS = ["FireIcon", "BoltIcon", "LightningIcon", "MagicWandIcon", "SparklesIcon", "SoundboardIcon"];

let seenSlider: any = null;
let sliderFrom = "";
let menuPath = "";
let menuSpace = "";
let learnedSpace: number | null = null;
let widths: Record<string, number> = {};

const renderable = (c: any) => typeof c === "function" || !!c && typeof c === "object" && !!c.$$typeof;
const nameOf = (type: any): string => typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name ?? "";

export function noteSlider(type: any, props: any) {
    if (seenSlider || !props || typeof type === "string" || !renderable(type)) return;
    if (typeof props.onValueChange !== "function" || typeof props.maximumValue !== "number" || typeof props.minimumValue !== "number") return;
    seenSlider = type;
}

let sliderCache: any = null;
let sliderLooked = 0;

function sliderType(): any {
    if (sliderCache) return sliderCache;
    const now = Date.now();
    if (now - sliderLooked < 3000) return null;
    sliderLooked = now;
    const designed = (() => {
        try {
            return findByProps("Slider")?.Slider;
        } catch {
            return undefined;
        }
    })();
    const candidates: [any, string][] = [[designed, "design system"], [Slider, "rain"], [seenSlider, `seen ${nameOf(seenSlider)}`]];
    for (const [c, from] of candidates) {
        if (!renderable(c)) continue;
        sliderFrom = from;
        sliderCache = c;
        return c;
    }
    sliderFrom = "none";
    return null;
}

const icons = new Map<string, number | null>();

function icon(...names: string[]) {
    const key = names.join(",");
    if (!icons.has(key)) icons.set(key, names.map(n => findAssetId(n)).find(x => x !== undefined) ?? null);
    const id = icons.get(key);
    return id != null ? <TableRow.Icon source={id} /> : undefined;
}

const isFiber = (f: any) => !!f && typeof f === "object" && "return" in f && "memoizedProps" in f && "tag" in f;

function fiberOf(inst: any): any {
    if (!inst || typeof inst !== "object") return null;
    try {
        for (const key of ["__internalInstanceHandle", "_internalInstanceHandle", "_internalFiberInstanceHandleDEV"]) if (isFiber(inst[key])) return inst[key];
        for (const sym of Object.getOwnPropertySymbols(inst)) if (isFiber(inst[sym])) return inst[sym];
        for (const key of Object.keys(inst)) if (/internal|fiber|handle/i.test(key) && isFiber(inst[key])) return inst[key];
        if (isFiber(inst.canonical?.internalInstanceHandle)) return inst.canonical.internalInstanceHandle;
    } catch { }
    return null;
}

function flatStyle(style: any): any {
    try {
        return StyleSheet.flatten(style) ?? {};
    } catch {
        return {};
    }
}

function survey(host: any): number {
    const self = fiberOf(host);
    if (!self) {
        menuPath = "no fiber";
        return 0;
    }
    const names: string[] = [];
    let parentHost: any = null;
    for (let f = self.return, i = 0; f && i < 40; f = f.return, i++) {
        const n = nameOf(f.elementType ?? f.type);
        if (f.tag === 5 && !parentHost) parentHost = f;
        if (n && names.length < 14 && !/^(?:Guard|Shell|Section)$/.test(n)) names.push(n);
    }
    menuPath = names.join(" < ") || "unnamed";
    if (!parentHost) return 0;
    const flat = flatStyle(parentHost.memoizedProps?.style);
    const kids: string[] = [];
    for (let c = parentHost.child; c && kids.length < 12; c = c.sibling) kids.push(nameOf(c.elementType ?? c.type) || "?");
    const gap = Number(flat.rowGap ?? flat.gap) || 0;
    menuSpace = `parent ${nameOf(parentHost.type)} gap ${gap} pad ${flat.paddingTop ?? flat.paddingVertical ?? flat.padding ?? 0}, kids ${kids.join(",")}`;
    return gap;
}

function useSlider(stored: number, key: Key) {
    const [value, setValue] = React.useState(stored);
    const pending = React.useRef<number | null>(null);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        if (pending.current == null) setValue(stored);
    }, [stored]);

    const flush = React.useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const v = pending.current;
        pending.current = null;
        if (v != null) commitLive(key, v);
    }, [key]);

    React.useEffect(() => flush, [flush]);

    const change = React.useMemo(() => safe("voice slider", (raw: number) => {
        if (typeof raw !== "number" || !Number.isFinite(raw)) return;
        const v = Math.round(raw);
        pending.current = v;
        setValue(v);
        setLive({ [key]: v });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(safe("voice slider save", flush), 600);
    }), [key, flush]);

    const done = React.useMemo(() => safe("voice slider done", (raw: number) => {
        if (typeof raw === "number" && Number.isFinite(raw)) {
            const v = Math.round(raw);
            pending.current = v;
            setValue(v);
            setLive({ [key]: v });
        }
        flush();
    }), [key, flush]);

    return { value, change, done };
}

interface BodyProps { title: string; value: number; max: number; step: number; dim?: boolean; onChange: (v: number) => void; onDone: (v: number) => void; }

function SliderBody({ title, value, max, step, dim, onChange, onDone }: BodyProps) {
    const S = sliderType();
    const accent = accentColor();
    return (
        <View
            style={{ flexGrow: 1, alignSelf: "stretch", paddingVertical: 2 }}
            onLayout={e => {
                widths[title] = Math.round(e.nativeEvent.layout.width);
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text variant="text-md/semibold" color="text-normal">{title}</Text>
                <Text variant="text-sm/medium" color="text-muted">{`${Math.round(value)}%`}</Text>
            </View>
            {S && (
                <View style={{ marginTop: 6, opacity: dim ? 0.5 : 1 }}>
                    {React.createElement(S, {
                        value,
                        minimumValue: 0,
                        maximumValue: max,
                        step,
                        onValueChange: onChange,
                        onSlidingComplete: onDone,
                        minimumTrackTintColor: accent,
                        thumbTintColor: accent,
                        accessibilityLabel: title,
                    })}
                </View>
            )}
        </View>
    );
}

export function Section() {
    const s = useVoiceSettings();
    const storedMic = Number.isFinite(Number(s.mic)) ? Number(s.mic) : 100;
    const storedAmount = Number.isFinite(Number(s.driveAmount)) ? Number(s.driveAmount) : 50;
    const mic = useSlider(storedMic, "mic");
    const amount = useSlider(storedAmount, "amount");
    const drive = !!s.drive;
    const ref = React.useRef<any>(null);
    const [space, setSpace] = React.useState(learnedSpace ?? 0);

    React.useEffect(() => {
        const t = setTimeout(safe("voice survey", () => {
            learnedSpace = survey(ref.current) ? 0 : 16;
            setSpace(learnedSpace);
        }), 60);
        return () => clearTimeout(t);
    }, []);

    const toggle = React.useMemo(() => safe("voice distortion", (v: boolean) => setDrive(!!v)), []);

    return (
        <View ref={ref} collapsable={false} style={space ? { marginTop: space } : undefined}>
            <TableRowGroup title="voice">
                <Row
                    icon={icon("MicrophoneIcon")}
                    accessibilityLabel="mic volume"
                    label={<SliderBody title="mic volume" value={mic.value} max={maxMic()} step={10} onChange={mic.change} onDone={mic.done} />}
                />
                <TableSwitchRow
                    icon={icon(...DRIVE_ICONS)}
                    label="distortion"
                    value={drive}
                    onValueChange={toggle}
                />
                {drive && (
                    <Row
                        accessibilityLabel="distortion strength"
                        label={<SliderBody title="strength" value={amount.value} max={100} step={5} onChange={amount.change} onDone={amount.done} />}
                    />
                )}
            </TableRowGroup>
        </View>
    );
}

export function sectionDebug(): string[] {
    try {
        if (!sliderCache) sliderLooked = 0;
        sliderType();
    } catch (e) {
        caught("voice slider type", e);
    }
    return [
        `slider: ${sliderFrom || "not rendered yet"}, widths ${Object.entries(widths).map(([k, v]) => `${k}=${v}`).join(" ") || "-"}`,
        `section in: ${menuPath || "not shown yet"}`,
        `spacing: ${menuSpace || "-"}`,
    ];
}

export function resetSection() {
    widths = {};
    sliderCache = null;
    sliderLooked = 0;
}
