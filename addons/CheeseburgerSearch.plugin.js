/**
 * @name CheeseburgerSearch
 * @author TonyskalYT
 * @description Advanced search menu (button next to the search bar or Ctrl+Shift+F) plus better search: has: image only finds uploads, and filters like is:photo, not:gif, ext:png, site:, sort:old.
 * @version 2.0.0
 * @source https://github.com/TonyskalYT/rain
 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

var plugin_exports = {};
__export(plugin_exports, {
  default: () => CheeseburgerSearch
});
module.exports = __toCommonJS(plugin_exports);

var IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff"];
var VIDEO_EXT = ["mp4", "mov", "webm", "mkv", "m4v", "avi", "3gp"];
var AUDIO_EXT = ["mp3", "m4a", "ogg", "wav", "flac", "aac", "opus"];
var SEARCH_URL = /\/api\/v\d+\/(?:guilds|channels)\/\d+\/messages\/search(?:\?|$)/;
var TABS_URL = /\/api\/v\d+\/(?:(?:guilds|channels)\/\d+|users\/@me)\/messages\/search\/tabs(?:\?|$)/;
var decode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};
function parse(qs) {
  return qs.split("&").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? [decode(p), ""] : [decode(p.slice(0, i)), decode(p.slice(i + 1))];
  });
}
var build = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
var KIND = {
  photo: ["attachment_extension", IMAGE_EXT],
  photos: ["attachment_extension", IMAGE_EXT],
  pic: ["attachment_extension", IMAGE_EXT],
  pics: ["attachment_extension", IMAGE_EXT],
  image: ["attachment_extension", IMAGE_EXT],
  images: ["attachment_extension", IMAGE_EXT],
  video: ["attachment_extension", VIDEO_EXT],
  videos: ["attachment_extension", VIDEO_EXT],
  audio: ["attachment_extension", AUDIO_EXT],
  sound: ["attachment_extension", AUDIO_EXT],
  gif: ["embed_type", ["gif"]],
  gifs: ["embed_type", ["gif"]],
  file: ["has", ["file"]],
  files: ["has", ["file"]],
  link: ["has", ["link"]],
  links: ["has", ["link"]],
  embed: ["has", ["embed"]],
  sticker: ["has", ["sticker"]],
  poll: ["has", ["poll"]],
  forward: ["has", ["snapshot"]],
  pinned: ["pinned", ["true"]],
  bot: ["author_type", ["bot"]],
  bots: ["author_type", ["bot"]]
};
var NOT = {
  link: ["has", ["-link"]],
  links: ["has", ["-link"]],
  embed: ["has", ["-embed"]],
  embeds: ["has", ["-embed"]],
  gif: ["has", ["-embed"]],
  gifs: ["has", ["-embed"]],
  file: ["has", ["-file"]],
  files: ["has", ["-file"]],
  image: ["has", ["-image"]],
  images: ["has", ["-image"]],
  video: ["has", ["-video"]],
  videos: ["has", ["-video"]],
  sticker: ["has", ["-sticker"]],
  bot: ["author_type", ["-bot", "-webhook"]],
  bots: ["author_type", ["-bot", "-webhook"]],
  pinned: ["pinned", ["false"]]
};
function keyword(token2, me) {
  const m = /^([a-z]+):(.+)$/i.exec(token2.trim());
  if (!m) return null;
  const key = m[1].toLowerCase();
  const raw = m[2].trim();
  const value = raw.toLowerCase();
  const list2 = (s) => s.split(",").map((x) => x.trim().replace(/^\./, "")).filter(Boolean);
  switch (key) {
    case "is":
    case "only": {
      const hit = KIND[value];
      return hit ? [hit] : null;
    }
    case "not":
    case "no": {
      const hit = NOT[value];
      return hit ? [hit] : null;
    }
    case "ext":
    case "type":
      return list2(value).length ? [["attachment_extension", list2(value)]] : null;
    case "name":
    case "filename":
      return [["attachment_filename", [raw]]];
    case "site":
    case "domain":
      return list2(value).length ? [["link_hostname", list2(value)]] : null;
    case "via":
    case "provider":
      return [["embed_provider", [raw]]];
    case "sort":
      if (/^(old|oldest|asc|first)$/.test(value)) return [["sort_by", ["timestamp"]], ["sort_order", ["asc"]]];
      if (/^(new|newest|desc|latest)$/.test(value)) return [["sort_by", ["timestamp"]], ["sort_order", ["desc"]]];
      if (/^(relevant|relevance|best)$/.test(value)) return [["sort_by", ["relevance"]]];
      return null;
    case "replyto":
    case "repliesto":
      if (value === "me" && me) return [["replied_to_user_id", [me]]];
      return /^\d{15,21}$/.test(value) ? [["replied_to_user_id", [value]]] : null;
    default:
      return null;
  }
}
function splitTokens(text) {
  return text.match(/"[^"]*"|\S+/g) ?? [];
}
var PRECISE = { image: IMAGE_EXT, video: VIDEO_EXT, sound: AUDIO_EXT };
var SINGLE = /* @__PURE__ */ new Set(["sort_by", "sort_order", "pinned"]);
function takeContent(text, me, scan) {
  const keep = [];
  for (const t of splitTokens(text)) {
    const hit = t.startsWith('"') ? null : keyword(t, me);
    if (hit) {
      scan.add.push(...hit);
      scan.changes.push(t);
    } else keep.push(t);
  }
  return keep.join(" ").trim();
}
function takeTerm(value, me, scan) {
  const bar = value.indexOf("|");
  const term = bar >= 0 ? value.slice(bar + 1) : value;
  const hit = term.startsWith('"') ? null : keyword(term, me);
  if (!hit) return false;
  scan.add.push(...hit);
  scan.changes.push(term);
  return true;
}
function takeHas(value, scan) {
  const ext = PRECISE[value];
  if (!ext) return false;
  scan.add.push(["attachment_extension", ext]);
  scan.changes.push(`has:${value} -> uploads only`);
  return true;
}
var unique = (list2) => [...new Set(list2)];
function rewriteSearch(url, opts) {
  if (!SEARCH_URL.test(url)) return null;
  const q = url.indexOf("?");
  const base = q < 0 ? url : url.slice(0, q);
  const pairs = q < 0 ? [] : parse(url.slice(q + 1));
  const scan = { add: [], changes: [] };
  const out = [];
  for (const [k, v] of pairs) {
    if (k === "content") {
      const before = scan.changes.length;
      const rest = takeContent(v, opts.me, scan);
      if (scan.changes.length === before) out.push([k, v]);
      else if (rest) out.push([k, rest]);
      continue;
    }
    if (k === "contents" && takeTerm(v, opts.me, scan)) continue;
    if (k === "has" && opts.preciseHas && takeHas(v, scan)) continue;
    out.push([k, v]);
  }
  if (!scan.changes.length) return null;
  const seen = new Set(out.map(([k, v]) => `${k}=${v}`));
  for (const [k, values] of scan.add) {
    if (SINGLE.has(k)) {
      for (let i = out.length - 1; i >= 0; i--) if (out[i][0] === k) out.splice(i, 1);
      for (const s of [...seen]) if (s.startsWith(`${k}=`)) seen.delete(s);
    }
    for (const v of values) {
      const key = `${k}=${v}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([k, v]);
    }
  }
  return { url: out.length ? `${base}?${build(out)}` : base, changes: unique(scan.changes) };
}
function rewriteTab(tab, opts) {
  const scan = { add: [], changes: [] };
  if (typeof tab.content === "string") {
    const rest = takeContent(tab.content, opts.me, scan);
    if (scan.changes.length) {
      if (rest) tab.content = rest;
      else delete tab.content;
    }
  }
  if (Array.isArray(tab.contents)) {
    const keep = tab.contents.filter((v) => typeof v !== "string" || !takeTerm(v, opts.me, scan));
    if (keep.length !== tab.contents.length) {
      if (keep.length) tab.contents = keep;
      else delete tab.contents;
    }
  }
  if (opts.preciseHas && Array.isArray(tab.has)) {
    const keep = tab.has.filter((v) => typeof v !== "string" || !takeHas(v, scan));
    if (keep.length !== tab.has.length) {
      if (keep.length) tab.has = keep;
      else delete tab.has;
    }
  }
  for (const [k, values] of scan.add) {
    if (k === "pinned") tab.pinned = values[0] === "true";
    else if (SINGLE.has(k)) tab[k] = values[0];
    else {
      const cur = Array.isArray(tab[k]) ? tab[k] : tab[k] == null ? [] : [tab[k]];
      tab[k] = unique([...cur, ...values]);
    }
  }
  return scan.changes;
}
function rewriteTabs(url, body, opts) {
  if (!TABS_URL.test(url)) return null;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  const tabs = data?.tabs;
  if (!tabs || typeof tabs !== "object") return null;
  const changes = [];
  for (const name of Object.keys(tabs)) {
    const tab = tabs[name];
    if (tab && typeof tab === "object") changes.push(...rewriteTab(tab, opts));
  }
  return changes.length ? { body: JSON.stringify(data), changes: unique(changes) } : null;
}
var CHEATSHEET = [
  ["is:photo", "only photos you uploaded (no gifs, no link previews)"],
  ["is:video", "only uploaded videos"],
  ["is:audio", "only uploaded audio files"],
  ["is:gif", "only gifs from the gif picker"],
  ["is:file / is:link / is:sticker / is:poll", "has that thing"],
  ["is:pinned", "pinned messages"],
  ["is:bot", "messages from bots"],
  ["not:gif / not:link / not:embed / not:file", "leave those out"],
  ["not:bot", "leave out bots and webhooks"],
  ["ext:png,jpg", "files with these extensions"],
  ["name:resume", "files with this in the name"],
  ["site:youtube.com", "links to this site"],
  ["via:Tenor", "embeds from this provider"],
  ["replyto:me", "replies to you"],
  ["sort:old / sort:relevant", "oldest first or best match"]
];

var bd = () => globalThis.BdApi;
var stores = /* @__PURE__ */ new Map();
function store(name) {
  const hit = stores.get(name);
  if (hit) return hit;
  let s = null;
  try {
    s = bd().Webpack.getStore(name) ?? null;
  } catch {
  }
  if (s) stores.set(name, s);
  return s;
}
function quiet(fn) {
  try {
    fn();
  } catch {
  }
}
function attempt(fn, fallback) {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}
var myId = () => attempt(() => store("UserStore")?.getCurrentUser?.()?.id, void 0);
var channelOf = (id) => id ? attempt(() => store("ChannelStore")?.getChannel?.(id), null) : null;
var userOf = (id) => attempt(() => store("UserStore")?.getUser?.(id), null);
var selectedChannel = () => attempt(() => store("SelectedChannelStore")?.getChannelId?.(), void 0);
var selectedGuild = () => attempt(() => store("SelectedGuildStore")?.getGuildId?.(), void 0);
var dmWith = (userId) => attempt(() => store("ChannelStore")?.getDMFromUserId?.(userId), void 0);
function recipients(ch) {
  if (!ch) return [];
  if (Array.isArray(ch.recipients)) return ch.recipients.map((r) => typeof r === "string" ? r : r?.id).filter(Boolean);
  if (Array.isArray(ch.rawRecipients)) return ch.rawRecipients.map((r) => r?.id).filter(Boolean);
  return [];
}
function nameOf(id, guildId) {
  if (id === myId()) return "me";
  const nick = guildId ? attempt(() => store("GuildMemberStore")?.getNick?.(guildId, id), void 0) : void 0;
  const u = userOf(id);
  return nick ?? u?.globalName ?? u?.global_name ?? u?.username ?? "someone";
}
function people(query, channelId, guildId, skip = []) {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return [];
  const ids = /* @__PURE__ */ new Set();
  for (const id of recipients(channelOf(channelId))) ids.add(id);
  attempt(() => {
    const msgs = store("MessageStore")?.getMessages?.(channelId);
    const arr = msgs?.toArray?.() ?? msgs?._array ?? [];
    for (const m of arr) if (m?.author?.id) ids.add(m.author.id);
    return null;
  }, null);
  if (guildId) attempt(() => {
    for (const id of store("GuildMemberStore")?.getMemberIds?.(guildId) ?? []) ids.add(id);
    return null;
  }, null);
  attempt(() => {
    for (const id of store("RelationshipStore")?.getFriendIDs?.() ?? []) ids.add(id);
    return null;
  }, null);
  attempt(() => {
    const all = store("UserStore")?.getUsers?.();
    const values = all instanceof Map ? [...all.values()] : all ? Object.values(all) : [];
    for (const u of values.slice(0, 8e3)) if (u?.id) ids.add(u.id);
    return null;
  }, null);
  const me = myId();
  const out = [];
  for (const id of ids) {
    if (id === me || skip.includes(id)) continue;
    const u = userOf(id);
    if (!u || u.bot && !q.includes("bot")) continue;
    const name = nameOf(id, guildId);
    const username = String(u.username ?? "").toLowerCase();
    const lower = name.toLowerCase();
    const score = lower.startsWith(q) || username.startsWith(q) ? 0 : lower.includes(q) || username.includes(q) ? 1 : -1;
    if (score < 0) continue;
    out.push({ id, name, sub: u.username ?? "", score });
    if (out.length > 80) break;
  }
  return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, 8);
}
var http;
function api() {
  if (http) return http;
  const fits = (m) => !!m && typeof m === "object" && ["get", "post", "put", "patch", "del"].every((k) => typeof m[k] === "function");
  http = attempt(() => bd().Webpack.getModule(fits, { searchExports: true }), null);
  return http;
}
function token() {
  return attempt(() => store("AuthenticationStore")?.getToken?.(), void 0);
}
async function post(url, body) {
  const a = api();
  if (a) {
    const res2 = await a.post({ url, body, oldFormErrors: true });
    return { status: res2?.status ?? 200, body: res2?.body };
  }
  const t = token();
  const res = await fetch(`${location.origin}/api/v9${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...t ? { Authorization: t } : {} },
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
  }
  if (!res.ok) throw { status: res.status, body: data };
  return { status: res.status, body: data };
}
var parser;
var markupClass;
function markdown() {
  if (!parser) parser = attempt(() => bd().Webpack.getByKeys("parse", "parseTopic", { searchExports: true }), null);
  return typeof parser?.parse === "function" ? parser.parse : null;
}
function markupClassName() {
  if (markupClass === void 0) {
    const fits = (m) => typeof m?.markup === "string" && typeof m?.inlineFormat === "string";
    markupClass = attempt(() => bd().Webpack.getModule(fits, { searchExports: true })?.markup, "") ?? "";
  }
  return markupClass ?? "";
}
var go;
function openPath(path) {
  if (go === void 0) go = attempt(() => bd().Webpack.getByStrings("transitionTo - Transitioning to", { searchExports: true }), null);
  if (typeof go === "function") {
    go(path);
    return;
  }
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate", { state: null }));
}
function mount(el, node) {
  const dom = bd().ReactDOM;
  let create = dom?.createRoot;
  if (typeof create !== "function") create = attempt(() => bd().Webpack.getByKeys("createRoot", "hydrateRoot")?.createRoot, void 0);
  if (typeof create === "function") {
    const root = create(el);
    root.render(node);
    return () => root.unmount();
  }
  dom.render(node, el);
  return () => dom.unmountComponentAtNode?.(el);
}

var blankFilters = () => ({
  words: "",
  exact: false,
  fromMe: false,
  from: [],
  kind: "any",
  leave: [],
  ext: "",
  filename: "",
  site: "",
  mentionsMe: false,
  repliesToMe: false,
  pinned: "any",
  when: "any",
  after: "",
  before: "",
  sort: "new"
});
var KINDS = [
  ["any", "anything"],
  ["photos", "photos"],
  ["videos", "videos"],
  ["media", "photos + videos"],
  ["audio", "audio"],
  ["gifs", "gifs"],
  ["files", "files"],
  ["links", "links"],
  ["embeds", "embeds"],
  ["stickers", "stickers"],
  ["polls", "polls"],
  ["forwards", "forwards"]
];
var LEAVES = [
  ["gifs", "gifs + embeds"],
  ["links", "links"],
  ["files", "files"],
  ["media", "photos + videos"],
  ["stickers", "stickers"],
  ["bots", "bots"]
];
var WHENS = [
  ["any", "any time"],
  ["today", "today"],
  ["week", "past week"],
  ["month", "past month"],
  ["year", "past year"],
  ["older", "over a year ago"],
  ["custom", "pick dates"]
];
var SORTS = [
  ["new", "newest"],
  ["old", "oldest"],
  ["best", "best match"]
];
var PINS = [
  ["any", "any"],
  ["only", "pinned"],
  ["no", "not pinned"]
];
var CLASH = {
  gifs: ["gifs", "embeds"],
  links: ["links"],
  files: ["files", "photos", "videos", "media", "audio"],
  media: ["photos", "videos", "media"],
  stickers: ["stickers"],
  bots: []
};
var clashes = (leave, kind) => CLASH[leave].includes(kind);
var DAY = 864e5;
var EPOCH = 14200704e5;
function snowflakeAt(ms) {
  const t = Math.max(0, Math.floor(ms) - EPOCH);
  try {
    return (BigInt(t) * BigInt(4194304)).toString();
  } catch {
    return String(Math.floor(t * 4194304));
  }
}
var startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
function parseDay(text, end) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  let y, m = 0, d = 1, span = "day";
  let hit;
  if (hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) {
    y = +hit[1];
    m = +hit[2] - 1;
    d = +hit[3];
  } else if (hit = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)) {
    y = +hit[3] < 100 ? 2e3 + +hit[3] : +hit[3];
    m = +hit[1] - 1;
    d = +hit[2];
  } else if ((hit = t.match(/^(\d{4})-(\d{1,2})$/)) || (hit = t.match(/^(\d{1,2})\/(\d{4})$/))) {
    const [a, b] = [+hit[1], +hit[2]];
    y = a > 999 ? a : b;
    m = (a > 999 ? b : a) - 1;
    span = "month";
  } else if (hit = t.match(/^(\d{4})$/)) {
    y = +hit[1];
    span = "year";
  } else return null;
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2015 || y > 2100) return null;
  const start = new Date(y, m, d).getTime();
  if (!end) return start;
  const next = span === "year" ? new Date(y + 1, 0, 1) : span === "month" ? new Date(y, m + 1, 1) : new Date(y, m, d + 1);
  return next.getTime() - 1;
}
var list = (s) => s.split(/[\s,]+/).map((x) => x.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
function hosts(s) {
  const out = [];
  for (const raw of s.split(/[\s,]+/)) {
    const h = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
    if (!h || !h.includes(".")) continue;
    out.push(h);
    if (!h.startsWith("www.") && h.split(".").length === 2) out.push(`www.${h}`);
  }
  return [...new Set(out)];
}
var KIND_FIELDS = {
  any: null,
  photos: ["attachment_extension", IMAGE_EXT],
  videos: ["attachment_extension", VIDEO_EXT],
  media: ["attachment_extension", [...IMAGE_EXT, ...VIDEO_EXT]],
  audio: ["attachment_extension", AUDIO_EXT],
  gifs: ["embed_type", ["gif"]],
  files: ["has", ["file"]],
  links: ["has", ["link"]],
  embeds: ["has", ["embed"]],
  stickers: ["has", ["sticker"]],
  polls: ["has", ["poll"]],
  forwards: ["has", ["snapshot"]]
};
var LEAVE_FIELDS = {
  gifs: ["has", ["-embed"]],
  links: ["has", ["-link"]],
  files: ["has", ["-file"]],
  media: ["has", ["-image", "-video"]],
  stickers: ["has", ["-sticker"]],
  bots: ["author_type", ["-bot", "-webhook"]]
};
function buildTab(f, me, now = Date.now()) {
  const tab = {};
  const add = (k, values) => {
    if (!values.length) return;
    tab[k] = [.../* @__PURE__ */ new Set([...tab[k] ?? [], ...values])];
  };
  const words = f.words.trim();
  if (words) tab.content = f.exact && !/^".*"$/.test(words) ? `"${words.replace(/"/g, "")}"` : words;
  const authors = [...f.from];
  if (f.fromMe && me) authors.unshift(me);
  add("author_id", [...new Set(authors)]);
  const ext = list(f.ext);
  const kind = KIND_FIELDS[f.kind];
  if (kind && !(ext.length && kind[0] === "attachment_extension")) add(kind[0], kind[1]);
  add("attachment_extension", ext);
  for (const l of f.leave) if (!clashes(l, f.kind)) add(LEAVE_FIELDS[l][0], LEAVE_FIELDS[l][1]);
  if (f.filename.trim()) add("attachment_filename", [f.filename.trim()]);
  add("link_hostname", hosts(f.site));
  if (f.mentionsMe && me) add("mentions", [me]);
  if (f.repliesToMe && me) add("replied_to_user_id", [me]);
  if (f.pinned !== "any") tab.pinned = f.pinned === "only";
  let min = null;
  let max = null;
  switch (f.when) {
    case "today":
      min = startOfDay(now);
      break;
    case "week":
      min = now - 7 * DAY;
      break;
    case "month":
      min = now - 30 * DAY;
      break;
    case "year":
      min = now - 365 * DAY;
      break;
    case "older":
      max = now - 365 * DAY;
      break;
    case "custom":
      min = parseDay(f.after, false);
      max = parseDay(f.before, true);
      break;
  }
  if (min != null) tab.min_id = snowflakeAt(min);
  if (max != null) tab.max_id = snowflakeAt(max);
  if (f.sort === "best") tab.sort_by = "relevance";
  else {
    tab.sort_by = "timestamp";
    tab.sort_order = f.sort === "old" ? "asc" : "desc";
  }
  return tab;
}
function buildRequest(f, scope, me, page = {}, now = Date.now()) {
  const tab = buildTab(f, me, now);
  tab.limit = 25;
  if (page.cursor) tab.cursor = page.cursor;
  else if (page.offset) tab.offset = Math.min(9975, page.offset);
  const body = { tabs: { messages: tab }, track_exact_total_hits: true };
  if (scope.kind === "dms") return { url: "/users/@me/messages/search/tabs", body };
  if (scope.kind === "server") {
    if (!scope.guildId) return null;
    body.include_nsfw = true;
    return { url: `/guilds/${scope.guildId}/messages/search/tabs`, body };
  }
  if (!scope.channelId) return null;
  if (scope.isPrivate || !scope.guildId) return { url: `/channels/${scope.channelId}/messages/search/tabs`, body };
  body.include_nsfw = true;
  body.channel_ids = [scope.channelId];
  return { url: `/guilds/${scope.guildId}/messages/search/tabs`, body };
}
function readResults(body) {
  const tab = body?.tabs?.messages ?? body;
  const groups = Array.isArray(tab?.messages) ? tab.messages : [];
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const g of groups) {
    const m = Array.isArray(g) ? g.find((x) => x?.hit) ?? g[0] : g;
    if (!m || typeof m.id !== "string" || seen.has(m.id)) continue;
    seen.add(m.id);
    hits.push(m);
  }
  const channels = {};
  for (const c of [...Array.isArray(tab?.channels) ? tab.channels : [], ...Array.isArray(tab?.threads) ? tab.threads : []]) {
    if (c?.id) channels[c.id] = c;
  }
  const cursor = tab?.cursor && typeof tab.cursor === "object" && Object.keys(tab.cursor).length ? tab.cursor : null;
  return { hits, total: Number(tab?.total_results) || 0, cursor, channels, indexing: !!body?.doing_deep_historical_index };
}
function describe(f, names = (id) => id) {
  const parts = [];
  if (f.words.trim()) parts.push(f.exact ? `"${f.words.trim()}"` : f.words.trim());
  const who = [...f.fromMe ? ["me"] : [], ...f.from.map(names)];
  if (who.length) parts.push(`from ${who.join(", ")}`);
  if (f.kind !== "any") parts.push(KINDS.find((k) => k[0] === f.kind)[1]);
  const leave = f.leave.filter((l) => !clashes(l, f.kind));
  if (leave.length) parts.push(`no ${leave.map((l) => LEAVES.find((x) => x[0] === l)[1]).join(", ")}`);
  if (f.ext.trim()) parts.push(`.${list(f.ext).join(" .")}`);
  if (f.filename.trim()) parts.push(`named ${f.filename.trim()}`);
  if (f.site.trim()) parts.push(`links to ${hosts(f.site).filter((h) => !h.startsWith("www.") || hosts(f.site).length === 1).join(", ")}`);
  if (f.mentionsMe) parts.push("mentions me");
  if (f.repliesToMe) parts.push("replies to me");
  if (f.pinned !== "any") parts.push(f.pinned === "only" ? "pinned" : "not pinned");
  if (f.when === "custom") {
    if (f.after.trim()) parts.push(`since ${f.after.trim()}`);
    if (f.before.trim()) parts.push(`until ${f.before.trim()}`);
  } else if (f.when !== "any") parts.push(WHENS.find((w) => w[0] === f.when)[1]);
  parts.push(SORTS.find((s) => s[0] === f.sort)[1]);
  return parts.join(" \xB7 ");
}
function plainText(m, names = {}) {
  const users = {};
  for (const u of Array.isArray(m?.mentions) ? m.mentions : []) {
    if (u?.id) users[u.id] = u.global_name ?? u.globalName ?? u.username ?? "someone";
  }
  let text = typeof m?.content === "string" ? m.content : "";
  if (!text && Array.isArray(m?.message_snapshots) && m.message_snapshots[0]?.message?.content) text = `forwarded: ${m.message_snapshots[0].message.content}`;
  return text.replace(/<@!?(\d+)>/g, (_, id) => `@${users[id] ?? names.user?.(id) ?? "someone"}`).replace(/<#(\d+)>/g, (_, id) => `#${names.channel?.(id) ?? "channel"}`).replace(/<@&\d+>/g, "@role").replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/<t:(\d+)(?::\w)?>/g, (_, s) => new Date(+s * 1e3).toLocaleString()).trim();
}
function thumbsOf(m, size = 192) {
  const out = [];
  const sized = (u, video) => {
    const sep = u.includes("?") ? "&" : "?";
    return video ? `${u}${sep}format=jpeg&width=${size}&height=${size}` : u.includes("media.discordapp.net") ? `${u}${sep}width=${size}&height=${size}` : u;
  };
  for (const a of Array.isArray(m?.attachments) ? m.attachments : []) {
    const name = String(a?.filename ?? "").toLowerCase();
    const ext = name.split(".").pop() ?? "";
    const type = String(a?.content_type ?? "");
    const u = a?.proxy_url ?? a?.url;
    if (typeof u !== "string") continue;
    if (type.startsWith("image/") || IMAGE_EXT.includes(ext) || ext === "gif") out.push({ uri: sized(u, false), video: false });
    else if (type.startsWith("video/") || VIDEO_EXT.includes(ext)) out.push({ uri: sized(u, true), video: true });
  }
  for (const e of Array.isArray(m?.embeds) ? m.embeds : []) {
    const pic = e?.thumbnail?.proxy_url ?? e?.image?.proxy_url ?? e?.thumbnail?.url ?? e?.image?.url;
    if (typeof pic === "string") out.push({ uri: sized(pic, false), video: e?.type === "gifv" || e?.type === "video" });
  }
  for (const s of Array.isArray(m?.sticker_items) ? m.sticker_items : []) {
    if (s?.id && s.format_type !== 3) out.push({ uri: `https://media.discordapp.net/stickers/${s.id}.png?size=160`, video: false });
  }
  return out.slice(0, 6);
}
function filesOf(m) {
  const out = [];
  for (const a of Array.isArray(m?.attachments) ? m.attachments : []) {
    const name = String(a?.filename ?? "");
    const ext = name.toLowerCase().split(".").pop() ?? "";
    const type = String(a?.content_type ?? "");
    if (type.startsWith("image/") || type.startsWith("video/") || IMAGE_EXT.includes(ext) || VIDEO_EXT.includes(ext) || ext === "gif") continue;
    if (name) out.push(name);
  }
  return out;
}
function linkTo(m, guildId) {
  return `https://discord.com/channels/${guildId ?? "@me"}/${m.channel_id}/${m.id}`;
}
function errorText(e) {
  const status = e?.status ?? e?.statusCode;
  const body = e?.body ?? e?.response?.body;
  if (status === 429) return `slow down, try again in ${Math.ceil(Number(body?.retry_after) || 5)}s`;
  if (status === 403) return "can't search there";
  if (status === 401) return "not logged in?";
  if (typeof body?.message === "string") return body.message.toLowerCase();
  if (typeof e?.message === "string") return e.message.toLowerCase().slice(0, 120);
  return "search failed";
}

var react = () => globalThis.BdApi.React;
function jsx(type, props, key) {
  return react().createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;
var Fragment = globalThis.BdApi?.React?.Fragment;

var memory = null;
var host = null;
var unmount = null;
var react2 = () => bd().React;
function useBox(init) {
  return react2().useState(init);
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(req, indexing) {
  for (let i = 0; i < 6; i++) {
    const res = await post(req.url, req.body);
    if (res.status === 202 || res.body?.code === 11e4) {
      indexing();
      await sleep(Math.min(10, Math.max(1, Number(res.body?.retry_after) || 2)) * 1e3);
      continue;
    }
    return res.body;
  }
  throw new Error("discord is still indexing this chat, try again in a bit");
}
function stamp(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  if (d.toDateString() === (/* @__PURE__ */ new Date()).toDateString()) return `today ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${time}`;
}
function avatarOf(a) {
  if (a?.id && a?.avatar) return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.webp?size=80`;
  const n = attempt(() => Number(BigInt(String(a?.id ?? "0")) >> BigInt(22)) % 6, 0);
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}
function placeOf(m, channels) {
  const ch = channels[m.channel_id] ?? channelOf(m.channel_id);
  if (!ch) return "";
  if (ch.type === 1) {
    const other = recipients(ch)[0];
    return other ? `dm with ${nameOf(other)}` : "dm";
  }
  if (ch.type === 3) return ch.name || "group dm";
  return `#${ch.name ?? "channel"}`;
}
function guildFor(m, channels, scope, guildId) {
  const c = channels[m.channel_id] ?? channelOf(m.channel_id);
  return m.guild_id ?? c?.guild_id ?? (scope === "dms" ? null : guildId ?? null);
}
function toast(text) {
  quiet(() => bd().UI.showToast(text, { type: "success" }));
}
function Chip({ label, on, dim, onClick }) {
  return /* @__PURE__ */ jsx("button", { type: "button", className: `cbs-chip${on ? " cbs-on" : ""}${dim ? " cbs-dim" : ""}`, onClick, children: label });
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("div", { className: "cbs-label", children: title }),
    children
  ] });
}
var GuardClass;
function Guard(props) {
  if (!GuardClass) {
    GuardClass = class extends react2().Component {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        const self = this;
        return self.state.failed ? self.props.fallback : self.props.children;
      }
    };
  }
  return /* @__PURE__ */ jsx(GuardClass, { ...props });
}
function Content({ m, onOpen }) {
  const plain = plainText(m, { user: (id) => nameOf(id), channel: (id) => channelOf(id)?.name });
  const raw = typeof m.content === "string" && m.content ? m.content : "";
  const forwarded = !raw && typeof m.message_snapshots?.[0]?.message?.content === "string" ? m.message_snapshots[0].message.content : "";
  const parse2 = markdown();
  const source = raw || forwarded;
  let nodes = null;
  if (parse2 && source) {
    nodes = attempt(() => parse2(source, true, { channelId: m.channel_id, messageId: m.id, allowLinks: true, allowHeading: true, allowList: true, allowEmojiLinks: false }), null);
  }
  const fallback = plain ? /* @__PURE__ */ jsx("div", { className: "cbs-text", children: plain }) : null;
  if (!nodes) return fallback;
  const block = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(m);
  };
  return /* @__PURE__ */ jsx(Guard, { fallback, children: /* @__PURE__ */ jsxs("div", { className: `cbs-text cbs-markup ${markupClassName()}`, onClickCapture: block, children: [
    forwarded && /* @__PURE__ */ jsx("span", { className: "cbs-forward", children: "forwarded " }),
    nodes
  ] }) });
}
function Hit({ m, place, onOpen, onCopy }) {
  const thumbs = thumbsOf(m, 256);
  const files = filesOf(m);
  const name = m.author?.global_name ?? m.author?.globalName ?? m.author?.username ?? "someone";
  return /* @__PURE__ */ jsxs("div", { className: "cbs-hit", onClick: () => onOpen(m), children: [
    /* @__PURE__ */ jsx("img", { className: "cbs-avatar", src: avatarOf(m.author), alt: "" }),
    /* @__PURE__ */ jsxs("div", { className: "cbs-main", children: [
      /* @__PURE__ */ jsxs("div", { className: "cbs-meta", children: [
        /* @__PURE__ */ jsx("span", { className: "cbs-name", children: name }),
        /* @__PURE__ */ jsx("span", { className: "cbs-time", children: [stamp(m.timestamp), place].filter(Boolean).join(" \xB7 ") })
      ] }),
      /* @__PURE__ */ jsx(Content, { m, onOpen }),
      thumbs.length > 0 && /* @__PURE__ */ jsx("div", { className: "cbs-thumbs", children: thumbs.map((t, i) => /* @__PURE__ */ jsxs("div", { className: "cbs-thumb", children: [
        /* @__PURE__ */ jsx("img", { src: t.uri, alt: "", loading: "lazy" }),
        t.video && /* @__PURE__ */ jsx("span", { className: "cbs-play", children: "\u25B6" })
      ] }, i)) }),
      files.map((f, i) => /* @__PURE__ */ jsx("div", { className: "cbs-file", children: `\u{1F4CE} ${f}` }, `f${i}`))
    ] }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "cbs-copy",
        onClick: (e) => {
          e.stopPropagation();
          onCopy(m);
        },
        children: "copy link"
      }
    )
  ] });
}
function Menu({ preset, close }) {
  const { useEffect, useMemo, useRef } = react2();
  const channelId = preset.channelId;
  const ch = channelOf(channelId);
  const guildId = preset.guildId ?? ch?.guild_id ?? void 0;
  const isPrivate = ch?.type === 1 || ch?.type === 3;
  const them = ch?.type === 1 ? recipients(ch)[0] : void 0;
  const key = `${channelId ?? ""}|${guildId ?? ""}`;
  const prev = memory && memory.key === key && !preset.from && !preset.words ? memory : null;
  const scopes = [
    ...channelId ? [["chat", isPrivate ? "this chat" : `#${ch?.name ?? "this channel"}`]] : [],
    ...guildId ? [["server", "whole server"]] : [],
    ["dms", "all my dms"]
  ];
  const pick = (s) => s && scopes.some((x) => x[0] === s) ? s : void 0;
  const [f, setF] = useBox(() => ({
    ...prev?.filters ?? blankFilters(),
    ...preset.from ? { from: preset.from, fromMe: false } : {},
    ...preset.words ? { words: preset.words } : {}
  }));
  const [scope, setScope] = useBox(() => pick(prev?.scope) ?? pick(preset.scope) ?? scopes[0][0]);
  const [hits, setHits] = useBox(() => prev?.hits ?? []);
  const [total, setTotal] = useBox(() => prev?.total ?? 0);
  const [cursor, setCursor] = useBox(() => prev?.cursor ?? null);
  const [more, setMore] = useBox(() => prev?.more ?? false);
  const [channels, setChannels] = useBox(() => prev?.channels ?? {});
  const [status, setStatus] = useBox(() => prev?.hits.length ? "done" : "idle");
  const [error, setError] = useBox("");
  const [who, setWho] = useBox("");
  const [extra, setExtra] = useBox(false);
  const run = useRef(0);
  const alive = useRef(true);
  const list2 = useRef(null);
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }));
  const flip = (arr, v) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  const found = useMemo(() => people(who, channelId, guildId, f.from), [who, channelId, guildId, f.from]);
  const go2 = (next) => {
    const id = ++run.current;
    const page = next ? cursor ? { cursor } : { offset: hits.length } : {};
    const req = buildRequest(f, { kind: scope, channelId, guildId, isPrivate }, myId(), page);
    if (!req) {
      setError("pick where to search");
      setStatus("error");
      return;
    }
    setError("");
    setStatus(next ? "more" : "loading");
    if (!next) list2.current?.scrollTo?.({ top: 0 });
    request(req, () => {
      if (alive.current && run.current === id) setStatus("indexing");
    }).then((body) => {
      if (!alive.current || run.current !== id) return;
      const r = readResults(body);
      const known = new Set(next ? hits.map((h) => h.id) : []);
      const all = next ? [...hits, ...r.hits.filter((h) => !known.has(h.id))] : r.hits;
      const merged = next ? { ...channels, ...r.channels } : r.channels;
      const hasMore = r.hits.length > 0 && all.length < r.total && (!!r.cursor || all.length < 9975);
      setHits(all);
      setTotal(r.total);
      setCursor(r.cursor);
      setMore(hasMore);
      setChannels(merged);
      setStatus("done");
      memory = { key, scope, filters: f, hits: all, total: r.total, cursor: r.cursor, more: hasMore, channels: merged };
    }, (e) => {
      if (!alive.current || run.current !== id) return;
      setError(errorText(e));
      setStatus("error");
    });
  };
  const reset = () => {
    run.current++;
    setF(blankFilters());
    setHits([]);
    setTotal(0);
    setCursor(null);
    setMore(false);
    setStatus("idle");
    setError("");
    setWho("");
    memory = null;
  };
  useEffect(() => {
    if (preset.from || preset.words) go2(false);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      alive.current = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  const openHit = (m) => {
    const gid = guildFor(m, channels, scope, guildId);
    close();
    setTimeout(() => quiet(() => openPath(`/channels/${gid ?? "@me"}/${m.channel_id}/${m.id}`)), 0);
  };
  const copyHit = (m) => {
    const link = linkTo(m, guildFor(m, channels, scope, guildId));
    quiet(() => navigator.clipboard.writeText(link));
    toast("copied link");
  };
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (more && status === "done" && hits.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) go2(true);
  };
  const enter = (e) => {
    if (e.key === "Enter") go2(false);
  };
  const extraCount = [f.pinned !== "any", f.mentionsMe, f.repliesToMe, !!f.ext.trim(), !!f.filename.trim(), !!f.site.trim()].filter(Boolean).length;
  const where = scopes.find((s) => s[0] === scope)?.[1] ?? "";
  const busy = status === "loading" || status === "indexing";
  return /* @__PURE__ */ jsx("div", { className: "cbs-backdrop", onMouseDown: (e) => e.target === e.currentTarget && close(), children: /* @__PURE__ */ jsxs("div", { className: "cbs-panel", role: "dialog", "aria-label": "Advanced search", children: [
    /* @__PURE__ */ jsxs("div", { className: "cbs-head", children: [
      /* @__PURE__ */ jsx("div", { className: "cbs-title", children: "Advanced search" }),
      /* @__PURE__ */ jsx("div", { className: "cbs-where", children: scopes.map(([k, label]) => /* @__PURE__ */ jsx(Chip, { label, on: scope === k, onClick: () => setScope(k) }, k)) }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "cbs-x", "aria-label": "close", onClick: close, children: "\xD7" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "cbs-body", children: [
      /* @__PURE__ */ jsxs("div", { className: "cbs-filters", children: [
        /* @__PURE__ */ jsxs(Section, { title: "words", children: [
          /* @__PURE__ */ jsx("input", { className: "cbs-input", value: f.words, placeholder: "what to look for, or leave empty", autoFocus: true, onChange: (e) => set({ words: e.target.value }), onKeyDown: enter }),
          /* @__PURE__ */ jsx("div", { className: "cbs-chips cbs-gap", children: /* @__PURE__ */ jsx(Chip, { label: "exact phrase", on: f.exact, onClick: () => set({ exact: !f.exact }) }) })
        ] }),
        /* @__PURE__ */ jsxs(Section, { title: "from", children: [
          /* @__PURE__ */ jsxs("div", { className: "cbs-chips", children: [
            /* @__PURE__ */ jsx(Chip, { label: "me", on: f.fromMe, onClick: () => set({ fromMe: !f.fromMe }) }),
            them && /* @__PURE__ */ jsx(Chip, { label: nameOf(them, guildId), on: f.from.includes(them), onClick: () => set({ from: flip(f.from, them) }) }),
            f.from.filter((id) => id !== them).map((id) => /* @__PURE__ */ jsx(Chip, { label: `${nameOf(id, guildId)}  \u2715`, on: true, onClick: () => set({ from: f.from.filter((x) => x !== id) }) }, id))
          ] }),
          /* @__PURE__ */ jsx("input", { className: "cbs-input cbs-gap", value: who, placeholder: "add someone by name", onChange: (e) => setWho(e.target.value), onKeyDown: (e) => {
            if (e.key === "Enter" && found[0]) {
              set({ from: [...f.from, found[0].id] });
              setWho("");
            }
          } }),
          found.length > 0 && /* @__PURE__ */ jsx("div", { className: "cbs-chips cbs-gap", children: found.map((u) => /* @__PURE__ */ jsx(Chip, { label: u.sub && u.sub.toLowerCase() !== u.name.toLowerCase() ? `${u.name} (${u.sub})` : u.name, onClick: () => {
            set({ from: [...f.from, u.id] });
            setWho("");
          } }, u.id)) }),
          !!who.trim() && !found.length && /* @__PURE__ */ jsx("div", { className: "cbs-hint", children: "nobody by that name loaded yet" })
        ] }),
        /* @__PURE__ */ jsx(Section, { title: "has", children: /* @__PURE__ */ jsx("div", { className: "cbs-chips", children: KINDS.map(([k, label]) => /* @__PURE__ */ jsx(Chip, { label, on: f.kind === k, onClick: () => set({ kind: k }) }, k)) }) }),
        /* @__PURE__ */ jsx(Section, { title: "leave out", children: /* @__PURE__ */ jsx("div", { className: "cbs-chips", children: LEAVES.map(([k, label]) => /* @__PURE__ */ jsx(Chip, { label, on: f.leave.includes(k) && !clashes(k, f.kind), dim: clashes(k, f.kind), onClick: () => set({ leave: flip(f.leave, k) }) }, k)) }) }),
        /* @__PURE__ */ jsxs(Section, { title: "when", children: [
          /* @__PURE__ */ jsx("div", { className: "cbs-chips", children: WHENS.map(([k, label]) => /* @__PURE__ */ jsx(Chip, { label, on: f.when === k, onClick: () => set({ when: k }) }, k)) }),
          f.when === "custom" && /* @__PURE__ */ jsxs("div", { className: "cbs-row cbs-gap", children: [
            /* @__PURE__ */ jsx("input", { className: "cbs-input", type: "date", value: f.after, title: "from", onChange: (e) => set({ after: e.target.value }) }),
            /* @__PURE__ */ jsx("input", { className: "cbs-input", type: "date", value: f.before, title: "until", onChange: (e) => set({ before: e.target.value }) })
          ] })
        ] }),
        /* @__PURE__ */ jsx(Section, { title: "sort", children: /* @__PURE__ */ jsx("div", { className: "cbs-chips", children: SORTS.map(([k, label]) => /* @__PURE__ */ jsx(Chip, { label, on: f.sort === k, onClick: () => set({ sort: k }) }, k)) }) }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "cbs-more", onClick: () => setExtra(!extra), children: extra ? "fewer filters" : `more filters${extraCount ? ` (${extraCount} on)` : ""}` }),
        extra && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Section, { title: "pinned", children: /* @__PURE__ */ jsx("div", { className: "cbs-chips", children: PINS.map(([k, label]) => /* @__PURE__ */ jsx(Chip, { label, on: f.pinned === k, onClick: () => set({ pinned: k }) }, k)) }) }),
          /* @__PURE__ */ jsx(Section, { title: "about me", children: /* @__PURE__ */ jsxs("div", { className: "cbs-chips", children: [
            /* @__PURE__ */ jsx(Chip, { label: "mentions me", on: f.mentionsMe, onClick: () => set({ mentionsMe: !f.mentionsMe }) }),
            /* @__PURE__ */ jsx(Chip, { label: "replies to me", on: f.repliesToMe, onClick: () => set({ repliesToMe: !f.repliesToMe }) })
          ] }) }),
          /* @__PURE__ */ jsx(Section, { title: "file type", children: /* @__PURE__ */ jsx("input", { className: "cbs-input", value: f.ext, placeholder: "png, pdf, mp3", onChange: (e) => set({ ext: e.target.value }), onKeyDown: enter }) }),
          /* @__PURE__ */ jsx(Section, { title: "file name has", children: /* @__PURE__ */ jsx("input", { className: "cbs-input", value: f.filename, placeholder: "resume", onChange: (e) => set({ filename: e.target.value }), onKeyDown: enter }) }),
          /* @__PURE__ */ jsx(Section, { title: "links to", children: /* @__PURE__ */ jsx("input", { className: "cbs-input", value: f.site, placeholder: "youtube.com, x.com", onChange: (e) => set({ site: e.target.value }), onKeyDown: enter }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "cbs-actions", children: [
          /* @__PURE__ */ jsx("button", { type: "button", className: "cbs-btn", disabled: busy, onClick: () => go2(false), children: busy ? "searching..." : "search" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "cbs-btn cbs-plain", onClick: reset, children: "reset" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "cbs-results", ref: list2, onScroll, children: status === "idle" ? /* @__PURE__ */ jsxs("div", { className: "cbs-empty", children: [
        /* @__PURE__ */ jsx("b", { children: "pick some filters" }),
        'then hit search. "photos" only finds pictures people actually uploaded, no gifs or link previews.'
      ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("div", { className: "cbs-summary", children: `${where} \xB7 ${describe(f, (id) => nameOf(id, guildId))}` }),
        /* @__PURE__ */ jsx("div", { className: `cbs-count${status === "error" ? " cbs-error" : ""}`, children: status === "loading" ? "searching..." : status === "indexing" ? "discord is indexing this chat, hang on..." : status === "error" ? error : hits.length ? `${total} result${total === 1 ? "" : "s"}` : "nothing found" }),
        hits.map((m) => /* @__PURE__ */ jsx(Hit, { m, place: scope === "chat" ? "" : placeOf(m, channels), onOpen: openHit, onCopy: copyHit }, m.id)),
        hits.length > 0 && /* @__PURE__ */ jsx("div", { className: "cbs-foot", children: more ? /* @__PURE__ */ jsx("button", { type: "button", className: "cbs-btn cbs-plain", disabled: status === "more", onClick: () => go2(true), children: status === "more" ? "loading..." : "load more" }) : "that's all" })
      ] }) })
    ] })
  ] }) });
}
function closeMenu() {
  const u = unmount;
  const h = host;
  unmount = null;
  host = null;
  if (!u && !h) return;
  setTimeout(() => {
    quiet(() => u?.());
    h?.remove();
  }, 0);
}
function openMenu(preset) {
  closeMenu();
  host = document.createElement("div");
  host.id = "cheeseburger-search";
  document.body.appendChild(host);
  unmount = mount(host, /* @__PURE__ */ jsx(Menu, { preset, close: closeMenu }));
}
var menuOpen = () => !!host;

var CSS = `
.cbs-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    animation: cbs-fade 0.12s ease-out;
}
@keyframes cbs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cbs-rise { from { transform: translateY(8px) scale(0.99); opacity: 0; } to { transform: none; opacity: 1; } }
.cbs-panel {
    width: min(1080px, 94vw);
    height: min(800px, 90vh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 12px;
    background: var(--modal-background, var(--background-primary, #313338));
    color: var(--text-normal, var(--text-default, #dbdee1));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    font-family: var(--font-primary, inherit);
    animation: cbs-rise 0.16s ease-out;
}
.cbs-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}
.cbs-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--header-primary, var(--text-strong, #f2f3f5));
    white-space: nowrap;
}
.cbs-where { display: flex; flex-wrap: wrap; gap: 6px; margin-left: 8px; }
.cbs-x {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--interactive-normal, #b5bac1);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
.cbs-x:hover { background: var(--background-modifier-hover, rgba(78, 80, 88, 0.3)); color: var(--interactive-hover, #dbdee1); }
.cbs-body { flex: 1; display: flex; min-height: 0; }
.cbs-filters {
    width: 370px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    padding: 14px 16px 0;
    background: var(--background-secondary, var(--background-base-lower, #2b2d31));
    border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
}
.cbs-results { flex: 1; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 14px 16px 18px; }
.cbs-label {
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--header-secondary, var(--text-muted, #b5bac1));
}
.cbs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cbs-chip {
    padding: 5px 11px;
    border: none;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    user-select: none;
    background: var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
    color: var(--interactive-normal, #b5bac1);
    transition: background 0.1s, color 0.1s;
}
.cbs-chip:hover { color: var(--interactive-hover, #dbdee1); background: var(--background-modifier-selected, rgba(78, 80, 88, 0.6)); }
.cbs-chip.cbs-on { background: var(--brand-500, var(--brand-experiment, #5865f2)); color: #fff; }
.cbs-chip.cbs-dim { opacity: 0.35; pointer-events: none; }
.cbs-input {
    width: 100%;
    box-sizing: border-box;
    padding: 9px 10px;
    border: none;
    border-radius: 8px;
    outline: none;
    font-size: 14px;
    font-family: inherit;
    background: var(--input-background, var(--background-tertiary, #1e1f22));
    color: var(--text-normal, #dbdee1);
    color-scheme: dark;
}
.cbs-input::placeholder { color: var(--text-muted, #949ba4); }
.cbs-input:focus { box-shadow: inset 0 0 0 2px var(--brand-500, #5865f2); }
.cbs-row { display: flex; gap: 8px; }
.cbs-row > * { flex: 1; }
.cbs-gap { margin-top: 8px; }
.cbs-hint { margin-top: 6px; font-size: 12px; color: var(--text-muted, #949ba4); }
.cbs-more {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    color: var(--text-link, #00a8fc);
}
.cbs-actions {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 8px;
    margin-top: auto;
    padding: 12px 0 14px;
    background: var(--background-secondary, var(--background-base-lower, #2b2d31));
}
.cbs-btn {
    flex: 1;
    padding: 9px 14px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    background: var(--brand-500, #5865f2);
    color: #fff;
}
.cbs-btn:hover { filter: brightness(1.1); }
.cbs-btn.cbs-plain { flex: 0 0 auto; background: var(--button-secondary-background, #4e5058); }
.cbs-btn:disabled { opacity: 0.5; cursor: default; }
.cbs-summary { font-size: 13px; color: var(--text-muted, #949ba4); line-height: 1.4; }
.cbs-count { font-size: 14px; font-weight: 600; color: var(--header-primary, #f2f3f5); }
.cbs-error { color: var(--text-danger, #f23f43); }
.cbs-hit {
    position: relative;
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    background: var(--background-secondary, var(--background-base-lower, #2b2d31));
    border: 1px solid transparent;
}
.cbs-hit:hover { border-color: var(--background-modifier-accent, rgba(78, 80, 88, 0.48)); background: var(--background-modifier-hover, rgba(78, 80, 88, 0.3)); }
.cbs-avatar { width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; object-fit: cover; }
.cbs-main { flex: 1; min-width: 0; }
.cbs-meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.cbs-name { font-weight: 600; color: var(--header-primary, #f2f3f5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbs-time { font-size: 12px; color: var(--text-muted, #949ba4); white-space: nowrap; }
.cbs-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 8;
    -webkit-box-orient: vertical;
    font-size: 14px;
    line-height: 1.375;
    white-space: pre-wrap;
    word-break: break-word;
}
.cbs-markup { color: var(--text-normal, #dbdee1); }
.cbs-markup img.emoji, .cbs-markup img[class*="emoji"] { width: 1.375em; height: 1.375em; object-fit: contain; vertical-align: bottom; }
.cbs-markup a { color: var(--text-link, #00a8fc); }
.cbs-forward { font-size: 12px; font-style: italic; color: var(--text-muted, #949ba4); }
.cbs-thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.cbs-thumb { position: relative; }
.cbs-thumb img { display: block; width: 128px; height: 128px; object-fit: cover; border-radius: 8px; background: rgba(0, 0, 0, 0.25); }
.cbs-play {
    position: absolute;
    right: 5px;
    bottom: 5px;
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
}
.cbs-file { margin-top: 4px; font-size: 13px; color: var(--text-link, #00a8fc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbs-copy {
    position: absolute;
    top: 8px;
    right: 10px;
    padding: 3px 8px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    opacity: 0;
    background: var(--background-tertiary, #1e1f22);
    color: var(--interactive-normal, #b5bac1);
}
.cbs-hit:hover .cbs-copy { opacity: 1; }
.cbs-copy:hover { color: var(--interactive-hover, #dbdee1); }
.cbs-empty { margin: auto; max-width: 340px; text-align: center; font-size: 14px; line-height: 1.5; color: var(--text-muted, #949ba4); }
.cbs-empty b { display: block; margin-bottom: 4px; font-size: 16px; color: var(--header-primary, #f2f3f5); }
.cbs-foot { padding: 6px 0 2px; text-align: center; font-size: 12px; color: var(--text-muted, #949ba4); }
.cbs-open {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    margin: 0 8px;
    cursor: pointer;
    color: var(--interactive-normal, #b5bac1);
}
.cbs-open:hover { color: var(--interactive-hover, #dbdee1); }
.cbs-kbd { padding: 1px 5px; border-radius: 4px; font-size: 12px; background: var(--background-tertiary, #1e1f22); }
.cbs-settings { display: flex; flex-direction: column; gap: 12px; color: var(--text-normal, #dbdee1); font-size: 14px; line-height: 1.5; }
.cbs-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.cbs-cheats { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 13px; }
.cbs-cheats code { color: var(--header-primary, #f2f3f5); }
@media (max-width: 760px) {
    .cbs-body { flex-direction: column; overflow-y: auto; }
    .cbs-filters { width: auto; border-right: none; overflow: visible; }
    .cbs-results { overflow: visible; }
}
`;

var NAME = "CheeseburgerSearch";
var ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h11M18 6h3M3 12h3M10 12h11M3 18h13M20 18h1"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
var precise = () => attempt(() => bd().Data.load(NAME, "preciseHas"), void 0) !== false;
var options = () => ({ preciseHas: precise(), me: myId() });
function rewriteUrl(url) {
  if (typeof url !== "string" || !url.includes("/messages/search")) return url;
  return attempt(() => rewriteSearch(url, options())?.url, url);
}
function rewriteBody(url, body) {
  if (typeof body !== "string" || !url.includes("/search/tabs")) return body;
  return attempt(() => rewriteTabs(url, body, options())?.body, body);
}
function here() {
  const channelId = selectedChannel();
  return { channelId, guildId: channelOf(channelId)?.guild_id ?? selectedGuild() };
}
function Settings() {
  const { useState } = bd().React;
  const [on, setOn] = useState(precise());
  return /* @__PURE__ */ jsxs("div", { className: "cbs-settings", children: [
    /* @__PURE__ */ jsxs("label", { className: "cbs-check", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: on,
          onChange: (e) => {
            setOn(e.target.checked);
            bd().Data.save(NAME, "preciseHas", e.target.checked);
          }
        }
      ),
      "has: image and has: video only find uploads (no gifs, link previews or website images)"
    ] }),
    /* @__PURE__ */ jsxs("div", { children: [
      "Open the advanced search with the filter button next to the search bar, ",
      /* @__PURE__ */ jsx("span", { className: "cbs-kbd", children: "Ctrl" }),
      " + ",
      /* @__PURE__ */ jsx("span", { className: "cbs-kbd", children: "Shift" }),
      " + ",
      /* @__PURE__ */ jsx("span", { className: "cbs-kbd", children: "F" }),
      ", or right click a channel, dm, server or person."
    ] }),
    /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("button", { type: "button", className: "cbs-btn cbs-plain", onClick: () => openMenu(here()), children: "open advanced search" }) }),
    /* @__PURE__ */ jsx("div", { className: "cbs-label", children: "Extra filters for the normal search bar" }),
    /* @__PURE__ */ jsx("div", { className: "cbs-cheats", children: CHEATSHEET.map(([k, v]) => [/* @__PURE__ */ jsx("code", { children: k }, k), /* @__PURE__ */ jsx("span", { children: v }, `${k}-text`)]) }),
    /* @__PURE__ */ jsx("div", { className: "cbs-hint", children: "mix them with discord's own, like from: me is:photo not:gif sort:old" })
  ] });
}
function button() {
  const b = document.createElement("div");
  b.className = "cbs-open";
  b.setAttribute("role", "button");
  b.setAttribute("aria-label", "Advanced search");
  b.title = "Advanced search (Ctrl+Shift+F)";
  b.innerHTML = ICON;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu(here());
  });
  return b;
}
function placeButtons() {
  let placed = false;
  for (const bar of document.querySelectorAll('[class*="searchBar_"]')) {
    const box = bar.closest('[class*="search_"]') ?? bar;
    const parent = box.parentElement;
    if (!parent) continue;
    placed = true;
    if (parent.querySelector(":scope > .cbs-open")) continue;
    parent.insertBefore(button(), box);
  }
  if (placed) return;
  for (const bar of document.querySelectorAll('[class*="toolbar_"]')) {
    const search = bar.querySelector('[class*="search_"]');
    if (!search || bar.querySelector(".cbs-open")) continue;
    let child = search;
    while (child && child.parentElement !== bar) child = child.parentElement;
    if (child) bar.insertBefore(button(), child);
  }
}
var CheeseburgerSearch = class {
  undo = [];
  start() {
    const later = (fn) => void this.undo.push(fn);
    quiet(() => {
      bd().DOM.addStyle(NAME, CSS);
      later(() => bd().DOM.removeStyle(NAME));
    });
    quiet(() => this.hookRequests(later));
    quiet(() => this.hookKeys(later));
    quiet(() => this.hookMenus(later));
    quiet(() => this.hookToolbar(later));
  }
  stop() {
    closeMenu();
    for (const u of this.undo.splice(0).reverse()) quiet(u);
  }
  getSettingsPanel() {
    return /* @__PURE__ */ jsx(Settings, {});
  }
  hookRequests(later) {
    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    const send = proto.send;
    const tabs = /* @__PURE__ */ new WeakMap();
    const myOpen = function(method, url, ...rest) {
      const m = String(method).toUpperCase();
      tabs.delete(this);
      if (m === "POST" && typeof url === "string" && url.includes("/search/tabs")) tabs.set(this, url);
      return open.call(this, method, m === "GET" ? rewriteUrl(url) : url, ...rest);
    };
    const mySend = function(body, ...rest) {
      const url = tabs.get(this);
      if (url) tabs.delete(this);
      return send.call(this, url ? rewriteBody(url, body) : body, ...rest);
    };
    proto.open = myOpen;
    proto.send = mySend;
    const fetchFn = window.fetch;
    const myFetch = function(input, init) {
      if (typeof input === "string") {
        const m = String(init?.method ?? "GET").toUpperCase();
        if (m === "GET") input = rewriteUrl(input);
        else if (m === "POST" && init && typeof init.body === "string") init = { ...init, body: rewriteBody(input, init.body) };
      }
      return fetchFn.call(this, input, init);
    };
    window.fetch = myFetch;
    later(() => {
      if (proto.open === myOpen) proto.open = open;
      if (proto.send === mySend) proto.send = send;
      if (window.fetch === myFetch) window.fetch = fetchFn;
    });
  }
  hookKeys(later) {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== "KeyF") return;
      e.preventDefault();
      e.stopPropagation();
      if (menuOpen()) closeMenu();
      else openMenu(here());
    };
    window.addEventListener("keydown", onKey, true);
    later(() => window.removeEventListener("keydown", onKey, true));
  }
  hookMenus(later) {
    const menu = bd().ContextMenu;
    const add = (tree, label, preset) => {
      const kids = tree?.props?.children;
      if (!kids) return;
      const items = [menu.buildItem({ type: "separator" }), menu.buildItem({ type: "text", id: "cheeseburger-search", label, action: () => openMenu(preset()) })];
      if (Array.isArray(kids)) kids.push(...items);
      else tree.props.children = [kids, ...items];
    };
    const chat = (_, props) => {
      const ch = props?.channel;
      if (!ch?.id) return;
      return { channelId: ch.id, guildId: ch.guild_id ?? void 0, scope: "chat" };
    };
    const patches = [
      ["user-context", (tree, props) => {
        const user = props?.user;
        if (!user?.id) return;
        const guildId = props?.guildId ?? props?.channel?.guild_id ?? void 0;
        add(tree, guildId ? "Search their messages here" : "Search their messages", () => {
          const channelId = props?.channel?.id ?? (guildId ? selectedChannel() : dmWith(user.id)) ?? selectedChannel();
          return { channelId, guildId, from: [user.id], scope: guildId ? "server" : "chat" };
        });
      }],
      ["channel-context", (tree, props) => {
        const preset = chat(tree, props);
        if (preset) add(tree, "Advanced search here", () => preset);
      }],
      ["thread-context", (tree, props) => {
        const preset = chat(tree, props);
        if (preset) add(tree, "Advanced search here", () => preset);
      }],
      ["gdm-context", (tree, props) => {
        const preset = chat(tree, props);
        if (preset) add(tree, "Advanced search here", () => preset);
      }],
      ["guild-context", (tree, props) => {
        const guildId = props?.guild?.id;
        if (!guildId) return;
        add(tree, "Advanced search in this server", () => {
          const current = selectedChannel();
          return { guildId, channelId: channelOf(current)?.guild_id === guildId ? current : void 0, scope: "server" };
        });
      }]
    ];
    for (const [id, fn] of patches) {
      const undo = menu.patch(id, (tree, props) => quiet(() => fn(tree, props)));
      later(() => undo?.());
    }
  }
  hookToolbar(later) {
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        quiet(placeButtons);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    quiet(placeButtons);
    later(() => {
      observer.disconnect();
      document.querySelectorAll(".cbs-open").forEach((n) => n.remove());
    });
  }
};
module.exports = module.exports.default;
