import { createPluginStore } from "@api/storage";

interface SearchSettings {
    preciseHas: boolean;
    screenButton: boolean;
}

export const {
    useStore: useSearchSettings,
    settings: searchSettings,
} = createPluginStore<SearchSettings>("cheeseburgersearch", {
    preciseHas: true,
    screenButton: true,
});
