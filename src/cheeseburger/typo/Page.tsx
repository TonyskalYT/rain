import { React } from "@metro/common";
import { TableRow, TableRowGroup, Text } from "@metro/common/components";
import { ScrollView, View } from "react-native";

import { safe } from "../crash";
import { themeColor } from "../style/colors";
import { relearn, typoPairs } from ".";
import { typoSettings, useTypoSettings } from "./storage";
import { wordStatus } from "./words";

const time = (t: number) => {
    const d = new Date(t);
    const h = d.getHours();
    const sameDay = d.toDateString() === new Date().toDateString();
    return `${sameDay ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

function block(word: string) {
    const w = word.toLowerCase();
    typoSettings.never = [...new Set([...(typoSettings.never ?? []), w])];
    relearn();
}

function unblock(word: string) {
    typoSettings.never = (typoSettings.never ?? []).filter(w => w !== word);
    relearn();
}

export function TypoPage() {
    const s = useTypoSettings();
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    const muted = themeColor("TEXT_MUTED") ?? themeColor("TEXT_SECONDARY");
    const log = [...(s.log ?? [])].reverse();
    const pairs = typoPairs();
    const never = s.never ?? [];
    return (
        <ScrollView contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 12, gap: 20 }}>
            <View style={{ paddingHorizontal: 8 }}>
                <Text variant="text-sm/medium" color="text-muted" style={muted ? { color: muted } : undefined}>
                    {`fixes neighbor key slips when you hit send, only when there's one clear word. ${wordStatus}. tap a fix to never fix that word again`}
                </Text>
            </View>
            <TableRowGroup title={`Recent fixes (${log.length})`}>
                {log.length
                    ? log.slice(0, 40).map((l, i) => (
                        <TableRow
                            key={`${l.at}-${i}`}
                            label={`${l.from} → ${l.to}`}
                            subLabel={`${time(l.at)}, ${l.how}${never.includes(l.from.toLowerCase()) ? ", won't fix again" : ""}`}
                            onPress={safe("typo block", () => {
                                block(l.from);
                                force();
                            })}
                        />
                    ))
                    : <TableRow label="nothing fixed yet" />}
            </TableRowGroup>
            <TableRowGroup title={`Learned from your edits (${pairs.length})`}>
                {pairs.length
                    ? pairs.slice(0, 60).map(p => (
                        <TableRow
                            key={p.from}
                            label={`${p.from} → ${p.to}`}
                            subLabel={`you fixed it ${p.n}x`}
                            onPress={safe("typo block pair", () => {
                                block(p.from);
                                force();
                            })}
                        />
                    ))
                    : <TableRow label="nothing yet" subLabel="comes from the message logger's saved edits of your messages" />}
            </TableRowGroup>
            <TableRowGroup title={`Never fix (${never.length})`}>
                {never.length
                    ? never.map(w => (
                        <TableRow
                            key={w}
                            label={w}
                            subLabel="tap to allow fixing again"
                            onPress={safe("typo unblock", () => {
                                unblock(w);
                                force();
                            })}
                        />
                    ))
                    : <TableRow label="nothing" subLabel="words you change back by editing land here" />}
            </TableRowGroup>
        </ScrollView>
    );
}
