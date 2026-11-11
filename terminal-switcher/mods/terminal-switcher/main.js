// Terminal switcher: Alt+Tab for terminals. Hold Ctrl and press Tab, and every
// terminal in every space shows as a tile with its latest screen, most recently
// used first, with the one you were in before already picked. Tab moves on,
// Shift+Tab moves back, and letting go of Ctrl goes there.
//
// One mod, two kinds of copy, told apart by props.role:
//   "controller"  a floating block on the layout root that draws nothing. It is
//                 always shown, so it gets terminal-switcher.next / .prev from
//                 keys.json, and it notes every terminal that gets the keyboard
//                 (its localStorage keeps that order across restarts).
//   "picker"      the tiles: a frameless dialog over the whole window, opened by
//                 the controller. It holds the keyboard: Tab, Shift+Tab and the
//                 arrows move, letting go of Ctrl, Enter or a click goes, Esc or a
//                 click beside the card leaves.
//
// While the picker is open, the controller hands it later presses through `bus`.
// Both copies run this one module, and a task's cx stays its own copy's when
// another copy wakes it, so the picker redraws itself.
//
// Quick terminals (the quick-terminal plugin) are listed too, when the shown
// layout has its panel; going to one asks quick-terminal to show it.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import {
  closeOverlay, focused, hc, home, layout, nextCommand, notify, openOverlay, panes,
  props, run, settings, setShared, shared, spaces, terminals, theme,
} from "herdr";

const MOD = "terminal-switcher";
const QUICK_LABEL = "quick-terminal.space";
const QUICK_STACK = "quick-terminal-stack";

const TILE_W = 248;
const PREVIEW_H = 136;
const GAP = 12;
const MAX_COLS = 5;
const LINES = 17;
const REFRESH_MS = 1000;
const STATUSES = new Set(["working", "blocked", "done", "idle"]);

// Shared by both copies (same module): the open picker's inbox, or a stand-in
// that queues presses made before the picker has started.
const bus = { inbox: null };

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

// "vps/t7" lives on vps; "t7" on this computer.
const machineOf = (id) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : null);
const localId = (id) => id.slice(id.lastIndexOf("/") + 1);
const slashes = (p) => (p ?? "").replace(/\\/g, "/");

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

function folderLabel(cwd) {
  if (!cwd) return "";
  const c = slashes(cwd), h = slashes(home());
  return c === h ? "~" : c.startsWith(h + "/") ? "~" + c.slice(h.length) : c;
}

// Space colors, as the shipped spaces and picker mods keep them in shared
// "space.colors": a theme color name or a #rrggbb, by space id. A space seen
// without one gets the color fewest spaces use; every mod does the same in the
// same order, so they agree.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const SPACE_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((s) => s.id));
  const stored = shared("space.colors") ?? {};
  const kept = Object.fromEntries(Object.entries(stored).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(stored).length;
  for (const s of spaces()) {
    if (kept[s.id] || s.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[s.id] = SPACE_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
function spaceColor(t, s) {
  if (s.name === "~") return t.dim;
  const c = spaceColors()[s.id] ?? SPACE_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

// Every terminal you can go to: each tab's terminal panes, then the quick
// terminals this layout can show. In spaces → tabs → panes order.
function everyTerminal() {
  const all = spaces();
  const where = new Map();
  for (const space of all) for (const tab of space.tabs) where.set(tab.id, { space, tab });
  const out = [];
  const seen = new Set();
  for (const p of panes()) {
    const w = p.terminal ? where.get(p.tab) : null;
    if (!w || seen.has(p.terminal)) continue;
    seen.add(p.terminal);
    out.push({
      address: p.terminal, pane: p.pane, quick: false, space: w.space, tab: w.tab,
      title: p.title ?? "", cwd: p.cwd, status: p.status, program: p.program,
    });
  }
  if (find(layout(), QUICK_STACK)) {
    for (const x of terminals()) {
      const sid = x.labels?.[QUICK_LABEL];
      if (!sid || x.state !== "live" || seen.has(x.address)) continue;
      const m = machineOf(x.address);
      const space = all.find((s) => localId(s.id) === sid && (s.machine ?? null) === m);
      if (!space) continue;
      seen.add(x.address);
      out.push({
        address: x.address, pane: null, quick: true, space, tab: null,
        title: x.name ?? "", cwd: x.cwd ?? null, status: STATUSES.has(x.status) ? x.status : null, program: x.program,
      });
    }
  }
  return out;
}

// `order` first (addresses, most recent first), then the rest as listed.
function arrange(list, order) {
  const rank = new Map();
  order.forEach((a, i) => { if (a && !rank.has(a)) rank.set(a, i); });
  const n = order.length;
  return list.map((e, i) => ({ e, r: rank.get(e.address) ?? n + i })).sort((a, b) => a.r - b.r).map((x) => x.e);
}

// The bottom of a screen: its last LINES lines that aren't blank.
function tail(text) {
  const lines = (text ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "").slice(0, 200));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(-LINES);
}

function loadOrder() {
  try { return JSON.parse(localStorage.getItem("mru") ?? "[]").filter((a) => typeof a === "string"); } catch { return []; }
}
function saveOrder(order) {
  try { localStorage.setItem("mru", JSON.stringify(order)); } catch {}
}

export default class TerminalSwitcher extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "controller";
    if (this.role === "picker") return this.initPicker(cx);
    this.order = loadOrder();
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        try {
          if (command === "next") this.open(1);
          else if (command === "prev") this.open(-1);
        } catch (e) {
          notify({ title: "Terminal switcher", body: String(e?.message ?? e), level: "error" });
        }
      }
    });
  }

  // ── controller ──────────────────────────────────────────────────────────

  open(step) {
    // Open already, or opening: the picker takes the press. A stand-in nobody
    // took up, or a picker that stopped refreshing, is gone.
    const inbox = bus.inbox;
    if (inbox && Date.now() - inbox.seen < 3000) return inbox.send({ step, from: "command" });
    this.note();
    const here = focused()?.terminal ?? null;
    const list = everyTerminal();
    if (!list.length) return;
    bus.inbox = new Inbox();
    bus.inbox.seen = Date.now();
    openOverlay({
      mod: MOD, kind: "dialog", frame: "none", width: 1, height: 1,
      props: { role: "picker", step, here, order: [here, ...this.order].filter(Boolean) },
    });
  }

  // The terminal that has the keyboard goes to the front.
  note() {
    const a = focused()?.terminal;
    if (!a || a === this.order[0]) return;
    const live = new Set(terminals().map((x) => x.address));
    this.order = [a, ...this.order.filter((x) => x !== a && (!live.size || live.has(x)))].slice(0, 100);
    saveOrder(this.order);
  }

  // ── picker ──────────────────────────────────────────────────────────────

  initPicker(cx) {
    const p = props() ?? {};
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    this.here = p.here ?? null;
    this.order = arrange(everyTerminal(), p.order ?? []).map((e) => e.address);
    const n = this.order.length;
    this.at = n < 2 ? 0 : (p.step ?? 1) < 0 ? n - 1 : 1;
    this.text = {};
    this.done = false;
    this.cols = 1;
    this.last = { from: null, time: 0 };

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
        this.move(step, from, true);
        cx.notify();
      }
    });

    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  async close() {
    if (this.role === "picker" && bus.inbox === this.inbox) bus.inbox = null;
  }

  list() {
    const all = everyTerminal();
    // Opened order; anything that started since goes last.
    return arrange(all, this.order);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      if (this.inbox && !this.done) this.inbox.seen = Date.now();
      const list = this.list();
      await Promise.all(list.map(async (e) => {
        try {
          const r = await hc(["read", e.address]);
          if (r.code === 0) this.text[e.address] = tail(r.stdout);
        } catch {}
      }));
      if (!this.done) cx.notify();
    });
  }

  // Tab and the controller's presses wrap around; up and down stop at the ends.
  // One press can arrive twice (as a key here and as the controller's command),
  // so a move from the other source right after one is the same press.
  move(step, from, wrap) {
    const now = Date.now();
    if (from !== this.last.from && now - this.last.time < 120) return;
    this.last = { from, time: now };
    const n = this.order.length;
    if (!n) return;
    const at = this.at + step;
    this.at = wrap ? ((at % n) + n) % n : Math.max(0, Math.min(n - 1, at));
    this.scroll.scroll_to_item(Math.floor(this.at / this.cols));
  }

  selected() {
    return this.list().find((e) => e.address === this.order[this.at]) ?? null;
  }

  dismiss() {
    if (this.done) return;
    this.done = true;
    if (bus.inbox === this.inbox) bus.inbox = null;
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  go(e) {
    if (this.done) return;
    this.dismiss();
    if (!e || e.address === this.here) return;
    const space = spaces().find((s) => s.id === e.space.id);
    if (!space) return;
    if (!space.active) run("space.select", { id: space.id });
    if (e.quick) {
      run("quick-terminal.show");
      return;
    }
    const tab = space.tabs.find((t) => t.id === e.tab.id);
    if (tab && !tab.active) run("tab.select", { id: tab.id });
    run("pane.focus", { pane: e.pane });
  }

  glyph(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    return div().flex_none().text_size(10).text_color(t[status] ?? t.dim).child(status === "idle" ? "○" : "●");
  }

  tile(t, e, i, font) {
    const on = i === this.at;
    const p = e.program;
    const pic = p?.icon ? (p.tint ? svg(p.icon).size(13).flex_none().text_color(t.muted) : image(p.icon).w(13).h(13).flex_none()) : null;
    const name = p?.agent && e.title ? e.title : (p?.name || e.title || e.address);
    const lines = this.text[e.address];
    const where = e.quick ? "quick terminal" : e.tab?.name ?? "";
    return v_flex()
      .id(`ts-${e.address}`)
      .w(TILE_W)
      .flex_none()
      .p(8)
      .gap(6)
      .rounded(10)
      .border_2()
      .border_color(on ? t.accent : t.popover)
      .bg(on ? t.selected : t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(on ? t.selected : t.hover))
      .on_click(() => this.go(e))
      .child(
        h_flex().h(18).gap(6).items_center()
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(name))
          .when(e.address === this.here, (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child("current")))
          .when(Boolean(e.status), (el) => el.child(this.glyph(t, e.status))),
      )
      .child(
        div().h(PREVIEW_H).flex_none().overflow_hidden().rounded(6).bg(t.background).border_1().border_color(t.border).px(6).py(4)
          .font_family(font).text_size(6).line_height("7.5px").text_color(t.muted)
          .when(!lines, (el) => el.flex().items_center().justify_center().text_size(10).text_color(t.dim).child("No preview"))
          .when(Boolean(lines), (el) => el.children(lines.map((l) => div().whitespace_nowrap().child(l || " ")))),
      )
      .child(
        h_flex().h(16).gap(6).items_center().text_size(11)
          .child(h_flex().size(14).flex_none().rounded(4).bg(spaceColor(t, e.space)).items_center().justify_center()
            .text_size(9).font_bold().text_color("#ffffff").child([...e.space.name][0]?.toUpperCase() ?? "?"))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(where ? `${e.space.name} · ${where}` : e.space.name))
          .child(div().flex_none().max_w(96).truncate().text_color(t.dim).child(folderLabel(e.cwd))),
      );
  }

  renderPicker() {
    const t = theme();
    const list = this.list();
    // Keep the pick on the same terminal when the list changes under it.
    const picked = this.order[this.at];
    this.order = list.map((e) => e.address);
    const keep = this.order.indexOf(picked);
    this.at = keep >= 0 ? keep : Math.min(this.at, Math.max(0, this.order.length - 1));

    const W = this.size?.width ?? 1200, H = this.size?.height ?? 800;
    this.cols = Math.max(1, Math.min(list.length || 1, MAX_COLS, Math.floor((W - 96 + GAP) / (TILE_W + GAP))));
    const rows = [];
    for (let i = 0; i < list.length; i += this.cols) rows.push(list.slice(i, i + this.cols));
    const rowH = PREVIEW_H + 18 + 16 + 12 + 16 + 4;
    const fit = Math.max(1, Math.floor((H - 140 + GAP) / (rowH + GAP)));
    const font = settings()?.font_family;
    const key = (k) => div().px(5).rounded(4).border_1().border_color(t.border).text_color(t.muted).child(k);

    return div()
      .id("ts-root")
      .size_full()
      .flex()
      .items_center()
      .justify_center()
      .track_focus(this.handle)
      .on_size_change((size, cx) => {
        const zoom = settings()?.zoom || 1;
        this.size = { width: size.width / zoom, height: size.height / zoom };
        cx.notify();
      })
      .on_mouse_down("left", () => this.dismiss())
      .on_key_down((ev, cx) => {
        const k = ev.key;
        if (k === "tab") this.move(ev.modifiers.shift ? -1 : 1, "key", true);
        else if (k === "right") this.move(1, "arrow", true);
        else if (k === "left") this.move(-1, "arrow", true);
        else if (k === "down") this.move(this.cols, "arrow", false);
        else if (k === "up") this.move(-this.cols, "arrow", false);
        else if (k === "enter") this.go(this.selected());
        else if (k === "escape") this.dismiss();
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      // It opens on Ctrl+Tab, so Ctrl is down until this says otherwise.
      .on_modifiers_changed((ev) => { if (!ev.modifiers.control) this.go(this.selected()); })
      .child(
        v_flex()
          .id("ts-card")
          .p(16)
          .gap(12)
          .rounded(14)
          .bg(t.popover)
          .border_1()
          .border_color(t.border)
          .shadow_xl()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(
            h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
              .child(div().flex_1().text_size(13).font_semibold().text_color(t.foreground).child("Switch terminal"))
              .child(key("Tab")).child("next")
              .child(key("Shift+Tab")).child("back")
              .child(key("Ctrl")).child("let go to switch")
              .child(key("Esc")).child("stay"),
          )
          .child(
            list.length
              ? v_flex()
                  .id("ts-rows")
                  .track_scroll(this.scroll)
                  .overflow_y_scroll()
                  .max_h(fit * (rowH + GAP) - GAP)
                  .gap(GAP)
                  .children(rows.map((row, r) => h_flex().gap(GAP).children(row.map((e, c) => this.tile(t, e, r * this.cols + c, font)))))
              : div().w(TILE_W).py(24).text_size(12).text_color(t.dim).child("No terminals"),
          ),
      );
  }

  render(cx) {
    if (this.role === "picker") return this.renderPicker(cx);
    this.note();
    return div();
  }
}
