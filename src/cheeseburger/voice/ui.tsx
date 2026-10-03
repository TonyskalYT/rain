import { findAssetId } from "@api/assets";
import { findByProps } from "@metro";
import { React } from "@metro/common";
import { Slider, TableRow, Text } from "@metro/common/components";
import { View } from "react-native";

import { safe } from "../crash";
import { accentColor, themeColor } from "../style/colors";
import { commitLive, LiveKey, setLive } from "./mic";

export const Row: any = TableRow;

let seenSlider: any = null;
let sliderCache: any = null;
let sliderLooked = 0;
export let sliderFrom = "";
export const widths: Record<string, number> = {};

const renderable = (c: any) => typeof c === "function" || !!c && typeof c === "object" && !!c.$$typeof;
const nameOf = (type: any): string => typeof type === "string" ? type : type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name ?? "";

export function noteSlider(type: any, props: any) {
    if (seenSlider || !props || typeof type === "string" || !renderable(type)) return;
    if (typeof props.onValueChange !== "function" || typeof props.maximumValue !== "number" || typeof props.minimumValue !== "number") return;
    seenSlider = type;
}

export function sliderType(retry = false): any {
    if (sliderCache) return sliderCache;
    const now = Date.now();
    if (!retry && now - sliderLooked < 3000) return null;
    sliderLooked = now;
    let designed: any;
    try {
        designed = findByProps("Slider")?.Slider;
    } catch { }
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

export function resetUi() {
    sliderCache = null;
    sliderLooked = 0;
}

const icons = new Map<string, number | null>();

export function icon(...names: string[]) {
    const key = names.join(",");
    if (!icons.has(key)) {
        let id: number | null = null;
        for (const n of names) {
            const found = findAssetId(n);
            if (found !== undefined) {
                id = found;
                break;
            }
        }
        icons.set(key, id);
    }
    const id = icons.get(key);
    return id != null ? <TableRow.Icon source={id} /> : undefined;
}

export const textColor = () => themeColor("TEXT_DEFAULT") ?? themeColor("TEXT_NORMAL") ?? themeColor("TEXT_PRIMARY");

export function useSlider(stored: number, key: LiveKey) {
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

interface BodyProps { title: string; value: number; max: number; step: number; unit?: string; onChange: (v: number) => void; onDone: (v: number) => void; }

export function SliderBody({ title, value, max, step, unit = "%", onChange, onDone }: BodyProps) {
    const S = sliderType();
    const accent = accentColor();
    const color = textColor();
    return (
        <View
            style={{ flexGrow: 1, alignSelf: "stretch", paddingVertical: 2 }}
            onLayout={e => {
                widths[title] = Math.round(e.nativeEvent.layout.width);
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text variant="text-md/semibold" color="text-default" style={color ? { color } : undefined}>{title}</Text>
                <Text variant="text-sm/medium" color="text-muted">{`${Math.round(value)}${unit}`}</Text>
            </View>
            {S && (
                <View style={{ marginTop: 6 }}>
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
