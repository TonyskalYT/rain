import { createPluginStore } from "@api/storage";

interface SearchSettings {
    preciseHas: boolean;
}

export const {
    useStore: useSearchSettings,
    settings: searchSettings,
} = createPluginStore<SearchSettings>("cheeseburgersearch", {
    preciseHas: true,
});
