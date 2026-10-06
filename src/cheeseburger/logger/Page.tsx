import { showConfirmationAlert } from "@api/ui/alerts";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { clipboard, NavigationNative, React } from "@metro/common";
import { Button, TableRow, TableRowGroup, TableSwitchRow, Text, TextInput } from "@metro/common/components";
import { FlatList, Pressable, ScrollView, View } from "react-native";

import { safe } from "../crash";
import { accentColor, themeColor } from "../style/colors";
import { when } from ".";
import { allSaved, clearSaved, Saved, savedInfo, setSavedLimit, useSaved } from "./saved";
import { LoggerSettings, useLoggerSettings } from "./storage";

const textColor = () => themeColor("TEXT_DEFAULT") ?? themeColor("TEXT_NORMAL") ?? themeColor("TEXT_PRIMARY");
const mutedColor = () => themeColor("TEXT_MUTED") ?? themeColor("TEXT_SECONDARY");
const cardColor = () => themeColor("CARD_SECONDARY_BG") ?? themeColor("BACKGROUND_SECONDARY") ?? themeColor("BACKGROUND_BASE_LOWER") ?? "#ffffff12";

function Num({ value, onCommit }: { value: number; onCommit: (n: number) => void; }) {
    const [text, setText] = React.useState(String(value));
    React.useEffect(() => setText(String(value)), [value]);
    return (
        <View style={{ width: 88 }}>
            <TextInput
                size="sm"
                value={text}
                keyboardType="number-pad"
                maxLength={5}
                isClearable={false}
                onChange={(v: string) => {
                    const t = v.replace(/\D/g, "");
                    setText(t);
                    const n = parseInt(t, 10);
                    if (Number.isFinite(n)) onCommit(n);
                }}
            />
        </View>
    );
}

function textOf(e: Saved): string {
    const lines = [`${e.kind} ${when(e.at)} · ${e.author} · ${e.where}`];
    for (const o of e.old) lines.push(`  was: ${o}`);
    lines.push(`  ${e.kind === "deleted" ? "said" : "now"}: ${e.content || "(no text)"}`);
    for (const f of e.files) lines.push(`  file: ${f}`);
    return lines.join("\n");
}

const copy = (text: string, what: string) => {
    try {
        clipboard.setString(text);
        showToast(`copied ${what}`);
    } catch { }
};

export function openPage(navigation: any, title: string, render: React.ComponentType<any>) {
    try {
        if (typeof navigation?.push === "function") {
            navigation.push("RAIN_CUSTOM_PAGE", { title, render });
            return;
        }
        const root = findByProps("getRootNavigationRef")?.getRootNavigationRef?.();
        const push = NavigationNative.StackActions?.push?.("RAIN_CUSTOM_PAGE", { title, render });
        if (root && push) root.dispatch(push);
        else root?.navigate?.("RAIN_CUSTOM_PAGE", { title, render });
    } catch (e) {
        showToast(`couldn't open: ${String((e as any)?.message ?? e).slice(0, 60)}`);
    }
}

export function LoggerPage() {
    const s = useLoggerSettings();
    useSaved();
    let navigation: any = null;
    try {
        navigation = NavigationNative.useNavigation();
    } catch { }
    const info = savedInfo();
    const set = (patch: Partial<LoggerSettings>) => s.updateSettings(patch);
    const switchRow = (label: string, key: keyof LoggerSettings, on: boolean, subLabel?: string) => (
        <TableSwitchRow label={label} subLabel={subLabel} value={on} onValueChange={(v: boolean) => set({ [key]: v } as Partial<LoggerSettings>)} />
    );

    return (
        <ScrollView contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 12, gap: 20 }}>
            <TableRowGroup title="In chat">
                {switchRow("Keep deleted messages", "keepDeleted", s.keepDeleted !== false)}
                {switchRow("Show edit history", "showEdits", s.showEdits !== false)}
                <TableRow label="Old versions shown" subLabel="per message, 1 to 10" trailing={<Num value={s.depth} onCommit={n => set({ depth: n })} />} />
                {switchRow("Servers too", "servers", s.servers !== false, "off = only dms and messages that mention you")}
                {switchRow("Ignore bots", "ignoreBots", s.ignoreBots !== false)}
                {switchRow("My own messages", "mine", s.mine !== false)}
            </TableRowGroup>
            <TableRowGroup title="Save on this phone">
                {switchRow("Save", "save", s.save !== false, "kept after discord closes")}
                {s.save !== false && (
                    <>
                        {switchRow("DMs", "saveDms", s.saveDms !== false)}
                        {switchRow("Group DMs", "saveGroups", s.saveGroups !== false)}
                        {switchRow("Servers when they mention me", "saveMentions", s.saveMentions !== false)}
                        {switchRow("@everyone and @here count", "everyone", !!s.everyone)}
                        {switchRow("Every server message", "saveServers", !!s.saveServers, "saves a lot more")}
                        {switchRow("Put deleted ones back in chat", "restore", s.restore !== false, "after discord restarts")}
                        <TableRow
                            label="Keep up to"
                            subLabel="messages, oldest go first"
                            trailing={<Num value={s.maxSaved} onCommit={n => {
                                set({ maxSaved: n });
                                setSavedLimit(n);
                            }} />}
                        />
                    </>
                )}
            </TableRowGroup>
            <TableRowGroup title="Saved">
                <TableRow
                    label="Saved messages"
                    subLabel={info.loaded ? `${info.count} saved${info.kb ? `, ${info.kb}kb` : ""}` : "loading"}
                    arrow
                    onPress={safe("logger open saved", () => openPage(navigation, "Saved messages", SavedPage))}
                />
                <TableRow label="Copy all" onPress={safe("logger copy all", () => copy(allSaved().map(textOf).join("\n\n") || "nothing saved", "everything"))} />
                <TableRow
                    label="Clear saved"
                    onPress={safe("logger clear", () => showConfirmationAlert({
                        title: "clear saved messages?",
                        content: "they're gone for good after this",
                        confirmText: "clear",
                        cancelText: "nah",
                        onConfirm: safe("logger cleared", () => clearSaved()),
                    }))}
                />
            </TableRowGroup>
        </ScrollView>
    );
}

const KINDS = ["all", "deleted", "edited"] as const;

function Entry({ e }: { e: Saved; }) {
    const text = textColor();
    const muted = mutedColor();
    return (
        <Pressable
            onLongPress={safe("logger copy one", () => copy(textOf(e), "message"))}
            style={{ backgroundColor: cardColor(), borderRadius: 10, padding: 12, gap: 4, borderLeftWidth: 3, borderLeftColor: e.kind === "deleted" ? "#F04747" : accentColor() }}
        >
            <Text variant="text-sm/semibold" color="text-default" style={text ? { color: text } : undefined}>{e.author}</Text>
            <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>{`${e.kind} ${when(e.at)} · ${e.where}`}</Text>
            {e.old.map((o, i) => (
                <Text key={i} variant="text-sm/normal" color="text-muted" style={muted ? { color: muted } : undefined}>{o}</Text>
            ))}
            {!!e.content && <Text variant="text-md/normal" color="text-default" style={text ? { color: text } : undefined}>{e.content}</Text>}
            {e.files.map((f, i) => (
                <Text key={`f${i}`} variant="text-xs/medium" color="text-link" numberOfLines={1} style={{ color: accentColor() }}>{f.split("?")[0].split("/").pop() ?? f}</Text>
            ))}
        </Pressable>
    );
}

export function SavedPage() {
    useSaved();
    const [query, setQuery] = React.useState("");
    const [kind, setKind] = React.useState<typeof KINDS[number]>("all");
    const q = query.trim().toLowerCase();
    const list = allSaved().filter(e => (kind === "all" || e.kind === kind) && (!q || `${e.author} ${e.where} ${e.content} ${e.old.join(" ")}`.toLowerCase().includes(q)));
    const muted = mutedColor();

    return (
        <FlatList
            data={list}
            keyExtractor={(e: Saved) => e.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            initialNumToRender={12}
            windowSize={7}
            ListHeaderComponent={
                <View style={{ gap: 10, marginBottom: 6 }}>
                    <TextInput size="md" value={query} placeholder="search" isClearable onChange={(v: string) => setQuery(v)} />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                        {KINDS.map(k => (
                            <Button key={k} size="sm" text={k} variant={kind === k ? "primary" : "secondary"} onPress={() => setKind(k)} />
                        ))}
                    </View>
                    <Text variant="text-xs/medium" color="text-muted" style={muted ? { color: muted } : undefined}>{`${list.length} shown, hold one to copy it`}</Text>
                </View>
            }
            ListEmptyComponent={<Text variant="text-md/medium" color="text-muted" style={muted ? { color: muted } : undefined}>{q ? "nothing matches" : "nothing saved yet"}</Text>}
            renderItem={({ item }: { item: Saved; }) => <Entry e={item} />}
        />
    );
}
