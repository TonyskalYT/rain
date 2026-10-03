import { showSheet } from "@api/ui/sheets";
import { React } from "@metro/common";
import { TableRowGroup } from "@metro/common/components";

import { safe } from "../crash";
import { summary } from "./mic";
import { SHEET, VoiceSheet } from "./Sheet";
import { useVoiceSettings } from "./storage";
import { icon, Row } from "./ui";

export let opened = 0;

export function MenuRow(props: any) {
    const s = useVoiceSettings();
    const open = React.useMemo(() => safe("voice open", () => {
        opened++;
        showSheet(SHEET, VoiceSheet);
    }), []);
    return (
        <Row
            {...props}
            icon={icon("MicrophoneIcon")}
            label="voice effects"
            subLabel={summary(s)}
            arrow
            onPress={open}
        />
    );
}

const Group: any = TableRowGroup;

export function MenuGroup() {
    return (
        <Group hasIcons>
            <MenuRow />
        </Group>
    );
}
