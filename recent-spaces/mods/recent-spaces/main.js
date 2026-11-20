// Open recent: VS Code's Ctrl+R for Herdr's spaces. Every space that closes is
// remembered: where it was (its first terminal's folder), on which machine, its
// name if someone gave it one, and when it was last shown. Ctrl+R lists the ones
// that aren't open now, most recently used first. Type to filter; ↑/↓ and Enter
// open a new space there, with a terminal. Ctrl+R again moves down (Ctrl+Shift+R
// up), and letting go of Ctrl then opens the pick, as in VS Code.
//
// One mod, two kinds of copy, told apart by props.role:
//   "controller"  a floating block on the layout root that draws nothing. It is
//                 always shown, so it gets recent-spaces.open from keys.json,
//                 and on every render it notes the open spaces, the shown one,
//                 and the ones that have gone (its localStorage keeps them).
//   "picker"      the popup at the top of the window, opened by the controller
//                 with the closed spaces in its props.
//
// While the picker is open, the controller hands it later presses through
// `bus`, as the terminal switcher does. Herdr's own list of closed spaces
// (view.json's "recent") fills in the ones closed before this was installed,
// after the ones the controller saw close.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, home, machines, nextCommand, notify, openOverlay, panes,
  props, readTextFile, run, spaces, theme, window,
} from "herdr";

const MOD = "recent-spaces";
const ROW = 32;
const MAX_LIST = 384;
const KEEP = 100; // closed spaces remembered
const ICON = {
  folder: "mods/workspace-chrome/folder.svg",
  server: "mods/workspace-chrome/server.svg",
  search: "mods/workspace-chrome/search.svg",
  close: "mods/pane/close.svg",
};

// Shared by both copies (same module): the open picker's inbox, or a stand-in
// that queues presses made before the picker has started; and the spaces taken
// off the list in the picker, for the controller to save. Each copy has its own
// localStorage, so only the controller's own tasks may save its list: the
// picker leaves keys here and sends recent-spaces.sync.
const bus = { inbox: null, forgets: [] };

class Inbox {
  constructor() { this.items = []; this.wake = null; this.picker = false; this.seen = 0; }
  send(item) {
    this.items.push(item);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
  async next() {
    while (!this.items.length) await new Promise((resolve) => (this.wake = resolve));
    return this.items.shift();
  }
}

// Paths with slashes and no trailing one; Windows drive paths ignore case.
const slashes = (p) => (p ?? "").replace(/\\/g, "/");
function norm(p) {
  const s = slashes(p).replace(/\/+$/, "");
  return /^[a-z]:/i.test(s) ? s.toLowerCase() : s;
}

// One entry per named space, and one per folder for the rest, on each machine.
const keyOf = (e) => `${e.machine ?? ""}|${e.named ? `n:${e.name}` : `f:${norm(e.folder)}`}`;

function baseName(p) {
  const s = slashes(p).replace(/\/+$/, "");
  if (!s || norm(s) === norm(home())) return "~";
  return s.slice(s.lastIndexOf("/") + 1) || s;
}

// Where a space is now: its first terminal's live folder, or null while none says.
function liveFolder(s, list) {
  const tabs = new Set(s.tabs.map((t) => t.id));
  return list.find((p) => tabs.has(p.tab) && p.cwd)?.cwd ?? null;
}

// The folder as people read it: your home as ~ on this computer.
function folderLabel(e) {
  if (!e.folder) return "~";
  const f = slashes(e.folder);
  if (e.machine) return f;
  const h = slashes(home());
  if (norm(f) === norm(h)) return "~";
  return norm(f).startsWith(norm(h) + "/") ? "~" + f.slice(h.length) : f;
}

const ago = (ms) => {
  if (!ms) return "";
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${Math.round(d / 3600)}h`;
  if (d < 86400 * 60) return `${Math.round(d / 86400)}d`;
  return d < 86400 * 730 ? `${Math.round(d / 86400 / 30)}mo` : `${Math.round(d / 86400 / 365)}y`;
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem("spaces") ?? "{}");
    return {
      known: raw.known && typeof raw.known === "object" ? raw.known : {},
      closed: Array.isArray(raw.closed) ? raw.closed.filter((e) => e && typeof e.key === "string") : [],
      forgotten: raw.forgotten && typeof raw.forgotten === "object" ? raw.forgotten : {},
    };
  } catch {
    return { known: {}, closed: [], forgotten: {} };
  }
}

// Herdr's own list of closed spaces: { name, folder }, newest first, with no
// machine and no time. Only folders that can be this computer's are kept.
async function herdrRecent() {
  const windows = window()?.platform === "windows";
  let list;
  try { list = JSON.parse((await readTextFile(`${appHome()}/view.json`)) ?? "{}").recent; } catch { return []; }
  if (!Array.isArray(list)) return [];
  const local = (f) => (windows ? /^([a-z]:[\\/]|\\\\)/i.test(f) : f.startsWith("/"));
  return list.flatMap((r) => {
    const folder = typeof r?.folder === "string" ? r.folder : "";
    const name = typeof r?.name === "string" ? r.name.trim() : "";
    if (!folder || !local(folder)) return [];
    const e = { name: name || baseName(folder), named: Boolean(name), folder, machine: null, at: null };
    return [{ ...e, key: keyOf(e) }];
  });
}

// A folder that isn't there anymore (a removed worktree, say). Here, read as a
// file, a missing path is null while a folder that's there throws. Another
// machine answers null for both, so it asks `test -d` there. Anything unclear
// counts as there, and Herdr says what went wrong.
async function missing(e) {
  if (!e.folder) return false;
  try {
    if (!e.machine) return (await readTextFile(e.folder)) === null;
    return (await exec("test", ["-d", e.folder], { on: e.machine, timeout: 10000 })).code === 1;
  } catch {
    return false;
  }
}

export default class RecentSpaces extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "controller";
    if (this.role === "picker") return this.initPicker(cx);
    const saved = load();
    this.known = saved.known; // open spaces by id: { name, named, folder, machine, at }
    this.closed = saved.closed; // { key, name, named, folder, machine, at, closed }, newest close first
    this.forgotten = saved.forgotten; // key → when it was taken off the list
    this.shown = null;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        // A replaced build's loop ends here, at its next use of cx.
        cx.notify();
        try {
          if (command === "open" || command === "next") this.press(1);
          else if (command === "prev") this.press(-1);
          else if (command === "sync") this.sync();
        } catch (e) {
          notify({ title: "Open recent", body: String(e?.message ?? e), level: "error" });
        }
      }
    });
  }

  async close() {
    if (this.role === "picker" && bus.inbox === this.inbox) bus.inbox = null;
  }

  // ── controller ──────────────────────────────────────────────────────────

  press(step) {
    // Open already, or opening: the picker takes the press. A stand-in nobody
    // took up, or a picker that stopped saying it's there, is gone.
    const inbox = bus.inbox;
    if (inbox && Date.now() - inbox.seen < 3000) return inbox.send({ step, from: "command" });
    this.note();
    bus.inbox = new Inbox();
    bus.inbox.seen = Date.now();
    openOverlay({
      mod: MOD, kind: "popup", at: "top", offset: 40, width: 620, height: 0.8,
      props: { role: "picker", closed: this.closed, forgotten: Object.keys(this.forgotten) },
    });
  }

  // Runs on every render: Herdr redraws mods when spaces, panes or focus change.
  note() {
    this.sync(); // in case recent-spaces.sync didn't reach this copy
    const now = Date.now();
    const all = spaces();
    const list = panes();
    const loaded = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
    let dirty = false;
    // The space you leave and the one you go to were both in use until now.
    const shown = all.find((s) => s.active)?.id ?? null;
    if (shown !== this.shown) {
      for (const id of [this.shown, shown]) if (id && this.known[id]) this.known[id].at = now;
      this.shown = shown;
      dirty = true;
    }
    const here = new Set();
    for (const s of all) {
      here.add(s.id);
      const was = this.known[s.id];
      // While its last terminal ends, a space may report no folder: keep the last one seen.
      const folder = liveFolder(s, list) ?? was?.folder ?? s.folder ?? "";
      const machine = s.machine ?? null;
      if (was && was.name === s.name && was.named === s.named && was.folder === folder && was.machine === machine) {
        if (s.active) was.at = now; // in use right now; saved with the next change
        continue;
      }
      this.known[s.id] = { name: s.name, named: s.named, folder, machine, at: s.active || !was ? now : was.at };
      dirty = true;
    }
    // Gone from a machine that's loaded: closed. A machine that isn't loaded now
    // (offline, still connecting) only hides its spaces.
    for (const [id, rec] of Object.entries(this.known)) {
      if (here.has(id) || !loaded.has(rec.machine ?? null)) continue;
      delete this.known[id];
      this.remember(rec, now);
      dirty = true;
    }
    if (dirty) this.save();
  }

  remember(rec, now) {
    const e = { name: rec.name, named: Boolean(rec.named), folder: rec.folder ?? "", machine: rec.machine ?? null, at: rec.at ?? now, closed: now };
    const key = keyOf(e);
    this.closed = [{ ...e, key }, ...this.closed.filter((x) => x.key !== key)].slice(0, KEEP);
  }

  // Spaces taken off the list in the picker. Herdr's own list can't be changed,
  // so its entries stay hidden by key.
  sync() {
    if (!bus.forgets.length) return;
    const now = Date.now();
    for (const key of bus.forgets.splice(0)) {
      this.closed = this.closed.filter((x) => x.key !== key);
      this.forgotten[key] = now;
    }
    this.forgotten = Object.fromEntries(Object.entries(this.forgotten).sort((a, b) => b[1] - a[1]).slice(0, 200));
    this.save();
  }

  save() {
    if (checking()) return;
    try { localStorage.setItem("spaces", JSON.stringify({ known: this.known, closed: this.closed, forgotten: this.forgotten })); } catch {}
  }

  // ── picker ──────────────────────────────────────────────────────────────

  initPicker(cx) {
    const p = props() ?? {};
    // Kept now: after an await (the folder check), props() isn't this copy's anymore.
    this.overlay = p.overlay ?? null;
    this.closed = Array.isArray(p.closed) ? p.closed : [];
    this.forgotten = new Set(Array.isArray(p.forgotten) ? p.forgotten : []);
    this.fromHerdr = [];
    this.filter = "";
    this.at = 0;
    this.error = "";
    this.hovered = null;
    this.busy = false;
    this.done = false;
    // Ctrl+R pressed again while open: letting go of Ctrl opens the pick.
    this.quick = false;
    this.last = { from: null, step: 0, time: 0 };
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Reopen a closed space: type to filter" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      this.error = "";
      this.scroll.scroll_to_item(0);
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input.focus();
    // The input mounts on the next frame; focus it again once it's there.
    cx.timer.after(100, () => this.input.focus());

    // Presses made while it was opening, then the ones after.
    const inbox = bus.inbox && !bus.inbox.picker ? bus.inbox : new Inbox();
    inbox.picker = true;
    inbox.seen = Date.now();
    bus.inbox = inbox;
    this.inbox = inbox;
    cx.spawn(async (cx) => {
      for (;;) {
        const { step, from } = await inbox.next();
        if (this.done) return;
        try { this.move(step, from); } catch {}
        cx.notify();
      }
    });
    cx.timer.every(1000, () => { if (!this.done) inbox.seen = Date.now(); });
    cx.spawn(async (cx) => {
      this.fromHerdr = await herdrRecent();
      if (!this.done) cx.notify();
    });
  }

  // The closed spaces to list: the controller's, last used first, then Herdr's
  // own; not the ones open now, and every typed word must match.
  rows() {
    const list = panes();
    const open = spaces().map((s) => ({ name: s.name, named: s.named, machine: s.machine ?? null, folder: norm(liveFolder(s, list) ?? s.folder ?? "") }));
    // A named space is open when a space of that name is; any other, when a space is in its folder.
    const isOpen = (e) => open.some((o) => o.machine === (e.machine ?? null) && (e.named ? o.named && o.name === e.name : o.folder === norm(e.folder)));
    const terms = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (e) => {
      const text = `${e.name} ${folderLabel(e)} ${e.machine ?? ""}`.toLowerCase();
      return terms.every((t) => text.includes(t));
    };
    const tracked = [...this.closed].sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || (b.closed ?? 0) - (a.closed ?? 0));
    const seen = new Set();
    const out = [];
    for (const e of [...tracked, ...this.fromHerdr.filter((x) => !this.forgotten.has(x.key))]) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      if (!isOpen(e) && match(e)) out.push(e);
    }
    return out;
  }

  // Ctrl+R (as a key here, or as the controller's command) and the arrows wrap;
  // PgUp/PgDn stop at the ends. One Ctrl+R can arrive both ways, so the same
  // step from the other route right after is that press.
  move(step, from) {
    const now = Date.now();
    const routes = new Set([from, this.last.from]);
    const twice = routes.has("key") && routes.has("command") && step === this.last.step && now - this.last.time < 120;
    this.last = { from, step, time: now };
    if (twice) return;
    if (from !== "arrow") this.quick = true;
    const n = this.rows().length;
    if (!n) return;
    const at = this.at + step;
    this.at = Math.abs(step) === 1 ? ((at % n) + n) % n : Math.max(0, Math.min(n - 1, at));
    this.scroll.scroll_to_item(this.at);
  }

  key(e, cx) {
    const k = e.key.toLowerCase(), m = e.modifiers;
    if (k === "escape") this.dismiss();
    else if (k === "r" && m.control && !m.alt) this.move(m.shift ? -1 : 1, "key");
    else if (k === "down" || k === "up") this.move(k === "down" ? 1 : -1, "arrow");
    else if (k === "pagedown" || k === "pageup") this.move(k === "pagedown" ? 8 : -8, "arrow");
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  dismiss() {
    if (this.done) return;
    this.done = true;
    if (bus.inbox === this.inbox) bus.inbox = null;
    if (this.overlay) closeOverlay(this.overlay);
  }

  // A new space there, with Herdr's default shell; a named space gets its name back.
  go(e, cx) {
    if (!e || this.done || this.busy) return;
    this.quick = false;
    if (e.machine && machines().find((m) => m.name === e.machine)?.layout !== "ready") {
      this.error = `${e.machine} isn't connected right now.`;
      return cx.notify();
    }
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const gone = await missing(e);
      this.busy = false;
      if (this.done) return;
      if (gone) {
        this.error = `${folderLabel(e)} isn't there anymore. Its × takes it off the list.`;
        return cx.notify();
      }
      this.dismiss();
      run("space.new", { ...(e.folder ? { folder: e.folder } : {}), machine: e.machine ?? "", ...(e.named ? { name: e.name } : {}) });
    });
  }

  forget(e, cx) {
    this.closed = this.closed.filter((x) => x.key !== e.key);
    this.forgotten.add(e.key);
    bus.forgets.push(e.key);
    run(`${MOD}.sync`);
    if (this.hovered === e.key) this.hovered = null;
    this.error = "";
    cx.notify();
  }

  row(e, i, t) {
    const on = i === this.at;
    const offline = Boolean(e.machine) && machines().find((m) => m.name === e.machine)?.layout !== "ready";
    const dim = (text) => div().flex_none().text_size(11).text_color(t.dim).child(text);
    return h_flex()
      .id(`rs-${e.key}`)
      .h(ROW)
      .flex_none()
      .mx(4)
      .px(10)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((hovered, cx) => {
        if (hovered) this.hovered = e.key;
        else if (this.hovered === e.key) this.hovered = null;
        cx.notify();
      })
      .on_click((_ev, cx) => this.go(e, cx))
      .child(svg(e.machine ? ICON.server : ICON.folder).size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(220).truncate().text_color(t.foreground).child(e.name || "~"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(folderLabel(e)))
      .when(Boolean(e.machine), (el) => el.child(div().flex_none().text_size(11).text_color(offline ? t.dim : t.accent)
        .child(offline ? `${e.machine} · offline` : e.machine)))
      .when(Boolean(e.at), (el) => el.child(dim(ago(e.at))))
      .child(
        on || this.hovered === e.key
          ? div().id(`rs-x-${e.key}`).flex_none().p(2).rounded(4).text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_mouse_down("left", (_ev, cx) => cx.stop_propagation())
              .on_click((_ev, cx) => { cx.stop_propagation(); this.forget(e, cx); })
              .child(svg(ICON.close).size(12))
          : div().flex_none().size(16),
      );
  }

  renderPicker() {
    const t = theme();
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const hint = this.busy ? "opening…" : "↑↓ choose · ↵ open · esc close";
    return v_flex()
      .id("recent-spaces")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      // Opened with Ctrl held: only after Ctrl+R again does letting go open the pick.
      .on_modifiers_changed((e, cx) => { if (this.quick && !e.modifiers.control) this.go(this.rows()[this.at], cx); })
      .w_full()
      .min_h(0)
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex().gap(10).items_center()
          .child(div().flex_none().text_size(15).font_semibold().text_color(t.foreground).child("Open recent"))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child("closed spaces, last used first"))
          .child(div().id("rs-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.dismiss()).child("Esc")),
      )
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg(ICON.search).size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(4).text_size(12).text_color(t.blocked).child(this.error)))
      .child(
        rows.length
          ? v_flex().id("rs-list").h(Math.min(MAX_LIST, rows.length * ROW)).flex_none().overflow_y_scrollbar().track_scroll(this.scroll)
              .children(rows.map((e, i) => this.row(e, i, t)))
          : div().px(4).py(6).text_color(t.dim).child(
              this.filter.trim() ? "No closed space matches." : "No closed spaces yet. Spaces you close show up here, last used first."),
      )
      .child(
        h_flex().gap(6).text_size(11).text_color(t.dim)
          .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
          .child(div().flex_1().child(rows.length ? "Ctrl+R again: next · let go of Ctrl to open" : ""))
          .child(hint),
      );
  }

  render(cx) {
    if (this.role === "picker") return this.renderPicker(cx);
    this.note();
    return div();
  }
}
