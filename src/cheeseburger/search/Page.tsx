import { React } from "@metro/common";
import { TableRow, TableRowGroup, TableSwitchRow, Text } from "@metro/common/components";
import { ScrollView, View } from "react-native";

import { themeColor } from "../style/colors";
import { CHEATSHEET } from "./query";
import { useSearchSettings } from "./storage";

export function SearchPage() {
    const s = useSearchSettings();
    const muted = themeColor("TEXT_MUTED") ?? themeColor("TEXT_SECONDARY");
    return (
        <ScrollView contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 12, gap: 20 }}>
            <TableRowGroup title="Discord's filters">
                <TableSwitchRow
                    label="has: image and has: video mean uploads"
                    subLabel="no gifs, link previews or website images"
                    value={s.preciseHas !== false}
                    onValueChange={(v: boolean) => s.updateSettings({ preciseHas: v })}
                />
            </TableRowGroup>
            <TableRowGroup title="Extra filters, type them in search">
                {CHEATSHEET.map(([k, v]) => <TableRow key={k} label={k} subLabel={v} />)}
            </TableRowGroup>
            <View style={{ paddingHorizontal: 8 }}>
                <Text variant="text-sm/medium" color="text-muted" style={muted ? { color: muted } : undefined}>
                    {"mix them with discord's own, like  from: me is:photo not:gif sort:old"}
                </Text>
            </View>
        </ScrollView>
    );
}
