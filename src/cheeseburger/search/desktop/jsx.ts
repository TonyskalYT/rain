const react = () => (globalThis as any).BdApi.React;

export function jsx(type: any, props: any, key?: any) {
    return react().createElement(type, key === undefined ? props : { ...props, key });
}

export const jsxs = jsx;

export const Fragment = (globalThis as any).BdApi?.React?.Fragment;
