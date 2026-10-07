import { React } from "@metro/common";
import { Text } from "@metro/common/components";
import { Pressable, ScrollView, View } from "react-native";

import { safe } from "../crash";
import { accentColor, themeColor } from "../style/colors";
import { relearn, typoPairs } from ".";
import { typoSettings, useTypoSettings } from "./storage";
import { wordStatus } from "./words";

type Tab = "fixes" | "learned" | "never";

const textColor = () => themeColor("TEXT_DEFAULT") ?? themeColor("TEXT_NORMAL") ?? themeColor("TEXT_PRIMARY");
const mutedColor = () => themeColor("TEXT_MUTED") ?? themeColor("TEXT_SECONDARY");
const chipColor = () => themeColor("BACKGROUND_MODIFIER_ACCENT") ?? themeColor("BACKGROUND_TERTIARY") ?? "#ffffff1f";
const cardColor = () => themeColor("CARD_SECONDARY_BG") ?? themeColor("BACKGROUND_SECONDARY") ?? "#ffffff12";

const time = (t: number) => {
    const d = new Date(t);
    const h = d.getHours();
    const day = d.toDateString() === new Date().toDateString() ? "" : `${d.getMonth() + 1}/${d.getDate()} `;
    return `${day}${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function toggle(word: string) {
    const w = word.toLowerCase();
    const list = typoSettings.never ?? [];
    typoSettings.never = list.includes(w) ? list.filter(x => x !== w) : [...list, w];
    relearn();
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void; }) {
    return (
        <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: on ? accentColor() : chipColor() }}>
            <Text variant="text-sm/semibold" color="text-default" style={{ color: on ? "#ffffff" : textColor() ?? undefined }}>{label}</Text>
        </Pressable>
    );
}

function Line({ left, right, off, onPress }: { left: string; right: string; off: boolean; onPress: () => void; }) {
    const muted = mutedColor();
    return (
        <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, gap: 8 }}>
            <Text variant="text-sm/medium" color="text-default" style={{ flex: 1, color: textColor() ?? undefined, opacity: off ? 0.45 : 1, textDecorationLine: off ? "line-through" : "none" }} numberOfLines={1}>{left}</Text>
            <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>{right}</Text>
        </Pressable>
    );
}

export function TypoPage() {
    const s = useTypoSettings();
    const [tab, setTab] = React.useState<Tab>("fixes");
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    const muted = mutedColor();
    const never = new Set(s.never ?? []);
    const log = [...(s.log ?? [])].reverse();
    const pairs = typoPairs();
    const tap = (w: string) => safe("typo toggle", () => {
        toggle(w);
        force();
    });
    const rows = tab === "fixes"
        ? log.map((l, i) => <Line key={`${l.at}-${i}`} left={`${l.from} → ${l.to}`} right={`${time(l.at)}${l.how === "your edits" ? " · yours" : ""}`} off={never.has(l.from.toLowerCase())} onPress={tap(l.from)} />)
        : tab === "learned"
            ? pairs.map(p => <Line key={p.from} left={`${p.from} → ${p.to}`} right={p.star ? "from *fix" : `${p.n}x`} off={never.has(p.from)} onPress={tap(p.from)} />)
            : [...never].map(w => <Line key={w} left={w} right="blocked" off={false} onPress={tap(w)} />);
    const empty = tab === "fixes" ? "nothing fixed yet" : tab === "learned" ? "nothing yet, comes from the logger's saved edits of your messages" : "nothing blocked";
    return (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
            <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>
                {`${wordStatus} · ${log.length} fixes · ${pairs.length} learned · tap one to block or unblock it`}
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
                <Chip label={`fixes ${log.length}`} on={tab === "fixes"} onPress={() => setTab("fixes")} />
                <Chip label={`learned ${pairs.length}`} on={tab === "learned"} onPress={() => setTab("learned")} />
                <Chip label={`blocked ${never.size}`} on={tab === "never"} onPress={() => setTab("never")} />
            </View>
            <View style={{ borderRadius: 12, overflow: "hidden", backgroundColor: cardColor(), paddingVertical: 4 }}>
                {rows.length ? rows : <Line left={empty} right="" off={false} onPress={() => { }} />}
            </View>
        </ScrollView>
    );
}
