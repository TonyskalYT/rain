import { findByProps } from "@metro";
import { React } from "@metro/common";
import { Dimensions, View } from "react-native";

import { caught, safe } from "../crash";

export interface Box { x: number; y: number; width: number; height: number; at: number; viewport: string; }
export interface ContainerSample { x: number; y: number; at: number; viewport: string; validated: boolean; }

export const viewportKey = () => {
    const win = Dimensions.get("window");
    return `${Math.round(win.width)}x${Math.round(win.height)}`;
};

interface TileRef { current: any; native?: boolean; }

const shared: { tileRefs: Map<object, Set<TileRef>>; probed: WeakSet<object>; toolbarRef: { current: any; } | null; toolbarSeen: boolean; } = (globalThis as any).__cheeseburgerProbes ??= {
    tileRefs: new Map(), probed: new WeakSet(), toolbarRef: null, toolbarSeen: false,
};
const { tileRefs, probed } = shared;
const pending = new WeakMap<object, { at: number; }>();
const lastMeasured = new WeakMap<object, number>();
const counts = { inside: 0, sibling: 0, toolbar: 0, stale: 0 };
let generation = 0;

export const measured: { toolbar?: Box; } = {};

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

function hostOf(f: any): any {
    const sn = f?.stateNode;
    for (const c of [sn?.canonical?.publicInstance, sn?.canonical, sn]) if (c && typeof c.measureInWindow === "function") return c;
    const node = sn?.node;
    const ui = (globalThis as any).nativeFabricUIManager;
    if (!node || typeof node !== "object" || typeof ui?.measureInWindow !== "function") return null;
    return { measureInWindow: (done: (...a: number[]) => void) => ui.measureInWindow(node, done) };
}

function hostsAbove(node: any, max: number): any[] {
    const out: any[] = [];
    let f = fiberOf(node)?.return;
    for (let i = 0; f && out.length < max && i < 80; f = f.return, i++) {
        if (f.tag !== 5) continue;
        const h = hostOf(f);
        if (h) out.push(h);
    }
    return out;
}

function firstHostDown(root: any): any {
    const stack = [root];
    for (let n = 0; stack.length && n < 80; n++) {
        const f = stack.pop();
        if (!f) continue;
        if (f.tag === 5) {
            const h = hostOf(f);
            if (h) return h;
        }
        if (f !== root && f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
    }
    return null;
}

export function tileHostNear(node: any, sv: object): any {
    let f = fiberOf(node);
    for (let i = 0; f && i < 10; f = f.return, i++) {
        const parent = f.return;
        if (!parent) return null;
        for (let c = parent.child, j = 0; c && j < 24; c = c.sibling, j++) {
            if (c !== f && c.memoizedProps?.sharedCoords === sv) return firstHostDown(c);
        }
        if (parent.tag === 5) return parent.memoizedProps?.sharedCoords === sv ? hostOf(parent) : null;
    }
    return null;
}

const finite = (...n: any[]) => n.every(v => typeof v === "number" && Number.isFinite(v));
const fmtBox = (b: { x: number; y: number; width: number; height: number; }) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;

interface Job { coords: { x: number; y: number; width: number; height: number; }; tile: any; chain: any[]; tileBox: Box | null; boxes: (Box | null)[]; }

const sampling = { rounds: 0, exact: 0, guessed: 0, empty: 0, disagree: 0, lost: 0, resting: 0 };
let samplingNote = "not measured yet";
let round = 0;
let roundAt = 0;
let roundOpen = false;

function settle(jobs: Job[], viewport: string, done: (s: ContainerSample) => void) {
    const results = jobs.flatMap(j => {
        const t = j.tileBox;
        if (!t) return [];
        const c = j.coords;
        const x = t.x - c.x - (c.width - t.width) / 2;
        const y = t.y - c.y - (c.height - t.height) / 2;
        const level = j.boxes.findIndex(b => !!b && Math.abs(b.x - x) <= 1.5 && Math.abs(b.y - y) <= 1.5);
        return [{ x, y, level, sized: Math.abs(t.width - c.width) <= 3 && Math.abs(t.height - c.height) <= 3, job: j }];
    });
    const exact = results.filter(r => r.level >= 0);
    if (exact.length) {
        if (exact.some(r => Math.abs(r.x - exact[0].x) > 1.5 || Math.abs(r.y - exact[0].y) > 1.5)) {
            sampling.disagree++;
            samplingNote = `tiles disagree: ${exact.map(r => `${Math.round(r.x)},${Math.round(r.y)}`).join(" vs ")}`;
            return;
        }
        const x = exact.reduce((s, r) => s + r.x, 0) / exact.length;
        const y = exact.reduce((s, r) => s + r.y, 0) / exact.length;
        const box = exact[0].job.boxes[exact[0].level]!;
        sampling.exact++;
        samplingNote = `exact ${Math.round(x)},${Math.round(y)} from ${exact.length} of ${results.length} tiles, view ${exact.map(r => r.level).join("/")} up ${Math.round(box.width)}x${Math.round(box.height)}`;
        done({ x, y, at: Date.now(), viewport, validated: true });
        return;
    }
    const sized = results.find(r => r.sized);
    if (!sized) {
        sampling.resting++;
        const r = results[0];
        samplingNote = r ? `tile not at its spot: ${fmtBox(r.job.tileBox!)} vs coords ${fmtBox(r.job.coords)}` : "nothing measured";
        return;
    }
    sampling.guessed++;
    samplingNote = `guessed ${Math.round(sized.x)},${Math.round(sized.y)}, tile ${fmtBox(sized.job.tileBox!)}, views up ${sized.job.boxes.map(b => (b ? fmtBox(b) : "-")).join(" | ")}`;
    done({ x: sized.x, y: sized.y, at: Date.now(), viewport, validated: false });
}

export function sampleContainer(svs: object[], read: (sv: any) => any, done: (s: ContainerSample) => void) {
    const now = Date.now();
    if (now - roundAt < 200 || roundOpen && now - roundAt < 800) return;
    if (roundOpen) sampling.lost++;
    roundAt = now;
    roundOpen = false;
    const jobs: Job[] = [];
    for (const sv of svs) {
        const refs = tileRefs.get(sv);
        if (!refs?.size) continue;
        const c = read(sv);
        if (!c || !finite(c.x, c.y, c.width, c.height) || c.width <= 0 || c.height <= 0) continue;
        for (const ref of refs) {
            if (ref.native || !ref.current) continue;
            const tile = tileHostNear(ref.current, sv);
            const chain = tile ? hostsAbove(ref.current, 6) : [];
            if (!tile || !chain.length) continue;
            jobs.push({ coords: { x: c.x, y: c.y, width: c.width, height: c.height }, tile, chain, tileBox: null, boxes: chain.map(() => null) });
            break;
        }
        if (jobs.length >= 4) break;
    }
    if (!jobs.length) {
        sampling.empty++;
        samplingNote = svs.length ? "tiles not reachable from the probes" : "no tiles";
        return;
    }
    const id = ++round;
    const viewport = viewportKey();
    const version = generation;
    roundOpen = true;
    sampling.rounds++;
    let left = jobs.reduce((n, j) => n + 1 + j.chain.length, 0);
    const finish = () => {
        if (id !== round) return;
        roundOpen = false;
        if (version !== generation || viewport !== viewportKey() || Date.now() - now > 800) return;
        settle(jobs, viewport, done);
    };
    const one = (inst: any, put: (b: Box) => void) => {
        try {
            inst.measureInWindow(safe("split container", (x: number, y: number, width: number, height: number) => {
                if (finite(x, y, width, height)) put({ x, y, width, height, at: Date.now(), viewport });
                if (--left === 0) finish();
            }));
        } catch {
            if (--left === 0) finish();
        }
    };
    for (const j of jobs) {
        one(j.tile, b => { j.tileBox = b; });
        j.chain.forEach((inst, i) => one(inst, b => { j.boxes[i] = b; }));
    }
}

let insetsSink: ((v: any) => void) | null = null;
export function onInsets(sink: (v: any) => void) {
    insetsSink = sink;
}

let insetsSource: { context: any; hook: any; } | null | undefined;
function useInsets(): any {
    if (insetsSource === undefined) {
        insetsSource = null;
        try {
            const m = findByProps("SafeAreaInsetsContext") ?? findByProps("useSafeAreaInsets");
            if (m?.SafeAreaInsetsContext) insetsSource = { context: m.SafeAreaInsetsContext, hook: null };
            else if (typeof m?.useSafeAreaInsets === "function") insetsSource = { context: null, hook: m.useSafeAreaInsets };
        } catch { }
    }
    if (!insetsSource) return null;
    if (insetsSource.context) return React.useContext(insetsSource.context);
    try {
        return insetsSource.hook();
    } catch {
        return null;
    }
}

const FILL = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, opacity: 0 } as const;

function Probe({ coords, native }: { coords: any; native?: boolean; }) {
    const ref: TileRef = React.useRef<any>(null);
    ref.native = !!native;
    const insets = useInsets();
    React.useEffect(() => {
        if (insets && insetsSink) insetsSink(insets);
    }, [insets?.top, insets?.right, insets?.bottom, insets?.left]);
    React.useEffect(() => {
        let refs = tileRefs.get(coords);
        if (!refs) tileRefs.set(coords, refs = new Set());
        refs.add(ref);
        return () => {
            refs!.delete(ref);
            if (!refs!.size && tileRefs.get(coords) === refs) tileRefs.delete(coords);
        };
    }, [coords]);
    return <View ref={ref} collapsable={false} pointerEvents="none" style={FILL} />;
}

class Guard extends React.Component<{ children?: any; }, { failed: boolean; }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(e: any) { caught("split probe", e); }
    render() { return this.state.failed ? null : this.props.children; }
}

export function TileProbe(props: { coords: any; native?: boolean; }) { return <Guard><Probe {...props} /></Guard>; }

export function withTileProbe(ret: any, coords: any, extra?: any): any {
    if (probed.has(ret)) return ret;
    if (ret.props?.isPip === true || ret.props?.inPip === true || ret.props?.isPictureInPicture === true) return ret;
    const name = typeof ret.type === "string" ? ret.type : ret.type?.displayName ?? ret.type?.name ?? "";
    const native = ret.type === View || /^(?:RCTView|View|REAWorkaroundView|AnimatedView|AnimatedComponent\(View\)|Animated\(View\))$/.test(name);
    const probe = <TileProbe key="cheeseburger-probe" coords={coords} native={native} />;
    const added = extra ? [probe, extra] : [probe];
    const children = ret.props?.children;
    const out = native
        ? React.cloneElement(ret, undefined, ...(Array.isArray(children) ? children : children == null ? [] : [children]), ...added)
        : React.createElement(React.Fragment, { key: ret.key ?? undefined }, ret, ...added);
    if (native) counts.inside++;
    else counts.sibling++;
    probed.add(out);
    return out;
}

export const hasTileProbe = (coords: object) => !!tileRefs.get(coords)?.size;
export const anyTileProbes = () => tileRefs.size > 0;

export function useToolbarRef() {
    const ref = React.useRef<any>(null);
    React.useEffect(() => {
        shared.toolbarRef = ref;
        shared.toolbarSeen = true;
        return () => {
            if (shared.toolbarRef === ref) {
                shared.toolbarRef = null;
                delete measured.toolbar;
            }
        };
    }, []);
    return ref;
}

export const toolbarKnown = () => shared.toolbarSeen;

function measure(ref: { current: any; }, gap: number, done: (b: Box) => void) {
    const node = ref.current;
    if (typeof node?.measureInWindow !== "function") return;
    const now = Date.now();
    if (now - (lastMeasured.get(ref) ?? 0) < gap) return;
    const previous = pending.get(ref);
    if (previous && now - previous.at < 600) return;
    const request = { at: now };
    const version = generation;
    const viewport = viewportKey();
    pending.set(ref, request);
    lastMeasured.set(ref, now);
    try {
        node.measureInWindow(safe("split measure", (x: number, y: number, width: number, height: number) => {
            if (pending.get(ref) !== request) return;
            pending.delete(ref);
            if (version !== generation || ref.current !== node || viewport !== viewportKey() || Date.now() - request.at > 600) {
                counts.stale++;
                return;
            }
            if (finite(x, y, width, height) && width > 0 && height > 0) done({ x, y, width, height, at: Date.now(), viewport });
        }));
    } catch (e) {
        pending.delete(ref);
        caught("split measure", e);
    }
}

export function resetTileMeasurements() {
    generation++;
    roundOpen = false;
}

export const hasToolbarRef = () => !!shared.toolbarRef?.current;

export function measureToolbarNow() {
    const ref = shared.toolbarRef;
    if (ref?.current) measure(ref, 80, b => {
        counts.toolbar++;
        if (shared.toolbarRef === ref) measured.toolbar = b;
    });
}

export const probeDebug = () => [
    `probes: ${tileRefs.size} tiles, inside ${counts.inside}, sibling ${counts.sibling}, toolbar reads ${counts.toolbar}, stale ${counts.stale}`,
    `container: ${samplingNote} (rounds ${sampling.rounds}, exact ${sampling.exact}, guessed ${sampling.guessed}, moving ${sampling.resting}, disagree ${sampling.disagree}, empty ${sampling.empty}, lost ${sampling.lost})`,
];
