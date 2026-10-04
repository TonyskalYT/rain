interface Log { start: number; events: string[]; fights: string[][]; resets: { js: number; hidden: number; }; writers: Map<string, number>; lastFightAt: number; fightCount: number; }

const log: Log = (globalThis as any).__cheeseburgerTileLog ??= {
    start: Date.now(), events: [], fights: [], resets: { js: 0, hidden: 0 }, writers: new Map(), lastFightAt: 0, fightCount: 0,
};

const stamp = (t = Date.now()) => {
    const d = new Date(t);
    return `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

export function ev(line: string) {
    log.events.push(`${stamp()} ${line}`);
    if (log.events.length > 160) log.events.splice(0, log.events.length - 160);
}

export function noteReset(js: boolean) {
    if (js) log.resets.js++;
    else log.resets.hidden++;
}

export function noteFight(line: string) {
    const now = Date.now();
    log.fightCount++;
    if (now - log.lastFightAt < 4000 && log.fights.length) {
        log.fights[log.fights.length - 1].push(`${stamp(now)} ${line}`);
        return;
    }
    log.lastFightAt = now;
    log.fights.push([`fight at ${stamp(now)}: ${line}`, ...log.events.slice(-30).map(e => `  ${e}`)]);
    if (log.fights.length > 3) log.fights.shift();
}

export function noteWriter(how: string) {
    let stack = "";
    try {
        stack = String(new Error("w").stack ?? "");
    } catch { }
    const frames: string[] = [];
    for (const raw of stack.split("\n").slice(1)) {
        const line = raw.trim().replace(/^at\s+/, "");
        if (!/index\.android\.bundle/.test(line)) continue;
        const m = line.match(/^(.*?)\s*\((?:address at\s+)?(.*)\)$/);
        const name = (m ? m[1] : line).trim() || "?";
        const loc = m?.[2].match(/:(\d+):(\d+)$/);
        frames.push(loc ? `${name}@${loc[1]}:${loc[2]}` : name);
        if (frames.length >= 5) break;
    }
    const key = `${how}: ${frames.join(" < ") || "no discord frames"}`;
    log.writers.set(key, (log.writers.get(key) ?? 0) + 1);
    if (log.writers.size > 12) log.writers.delete(log.writers.keys().next().value!);
}

export function fightDebug(): string[] {
    return [
        `tile fights: ${log.fightCount} (discord moved a tile we had placed), resets caught in js ${log.resets.js}, resets we never saw being written ${log.resets.hidden}`,
        ...(log.writers.size ? ["discord writers:", ...[...log.writers].map(([k, n]) => `  ${n}x ${k}`)] : ["discord writers: none caught"]),
        ...log.fights.flatMap((f, i) => [`fight ${i + 1}:`, ...f.map(l => `  ${l}`)]),
        `tile timeline (last ${Math.min(80, log.events.length)}):`,
        ...log.events.slice(-80).map(e => `  ${e}`),
    ];
}
