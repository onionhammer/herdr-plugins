// Drag to split: drag a tab down onto the panes to split it into the shown
// tab, or drag a pane's header up onto the tab bar to give it a tab of its own
// (or onto another pane to put it there).
//
// One mod, two copies, told apart by props.role:
//   "controller"  a floating block on the layout root that draws nothing. It
//                 does the moves: herdr has no "move pane" command, so a
//                 terminal moves by losing its pane (terminal.park, it keeps
//                 running) and getting one back where it was dropped
//                 (terminal.keep beside the focused pane, or as a tab).
//   "overlay"     opened over the whole window by the tab bar or a pane header
//                 once a drag leaves it. It shows where the drop lands and
//                 takes the release wherever it happens, so a drag never
//                 outlives the button.
//
// The tab bar and the pane headers start drags. Shared state between them:
//   "drag-split"        the drag going on: { kind: "tab" | "pane", tab, pane?, terminal?, label, overlay }
//   "drag-split-panes"  each pane header's place in the window: { [pane]: [x, y, w, h] }
//   "drag-split-tabs"   the tab bar's and each tab's place: { bar: [x, y, w, h], tabs: { [tab]: [x, y, w, h] } }
//   "drag-split-op"     a move for the controller: { id, at, kind: "split" | "newtab", ... }
// Places are window pixels, as mouse events report them; a mod's own sizes are
// those divided by the zoom.

import { View, div } from "gpui-kit";
import { focused, layout, notify, panes, props, run, settings, setShared, shared, spaces, theme, closeOverlay } from "herdr";

const DRAG = "drag-split", PANES = "drag-split-panes", TABS = "drag-split-tabs", OP = "drag-split-op";
const SIDES = { left: "Split left", right: "Split right", up: "Split up", down: "Split down" };

// The pane frame of the first visible tab block, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

// Where the tab block's top and bottom are, from the layout's sizes: columns
// share what their fixed children leave by weight. Good to a few pixels, which
// is all the bottom row of panes needs (their headers give everything else).
function tabSpan(node, top, bottom, z) {
  if (!node || node.hidden) return null;
  if (node.content?.tab) return [top, bottom];
  const pad = node.padding == null ? 0 : (Array.isArray(node.padding) ? node.padding[0] : node.padding) * z;
  top += pad; bottom -= pad;
  const kids = (node.children ?? []).filter(c => !c.hidden);
  if (node.type === "stack") return tabSpan(kids.find(c => c.id === node.active) ?? kids[0], top, bottom, z);
  if (node.type !== "column") {
    for (const c of kids) { const r = tabSpan(c, top, bottom, z); if (r) return r; }
    return null;
  }
  const gap = ((node.gap ?? 0) + (node.divider?.width ?? 0)) * z;
  const fixed = kids.reduce((s, c) => s + (c.size?.px != null ? c.size.px * z : 0), 0);
  const weights = kids.reduce((s, c) => s + (c.size?.px != null ? 0 : c.size?.weight ?? 1), 0) || 1;
  const free = Math.max(0, bottom - top - fixed - gap * (kids.length - 1));
  let y = top;
  for (const c of kids) {
    const h = c.size?.px != null ? c.size.px * z : free * (c.size?.weight ?? 1) / weights;
    const r = tabSpan(c, y, y + h, z);
    if (r) return r;
    y += h + gap;
  }
  return null;
}

// The shown tab's panes as window rectangles. Each header is at its pane's top
// left and as wide as it; a pane ends where the next header below it starts,
// or at the bottom of the tab block.
function paneRects(windowHeight) {
  const f = focused();
  if (!f) return [];
  const tab = spaces().flatMap(s => s.tabs).find(x => x.id === f.tab);
  let shown = panes().filter(p => p.tab === f.tab);
  if (tab?.zoomed) shown = shown.filter(p => p.zoomed);
  const heads = shared(PANES) ?? {};
  const tops = shown.filter(p => heads[p.pane]).map(p => {
    const [x, y, w] = heads[p.pane];
    return { pane: p.pane, x, y, w };
  });
  const z = settings().zoom ?? 1;
  const gap = (paneFrame(layout())?.gap ?? 0) * z;
  const bottom = tabSpan(layout(), 0, windowHeight, z)?.[1] ?? windowHeight;
  return tops.map(a => {
    const below = tops.filter(b => b.y > a.y + 4 && b.x < a.x + a.w - 4 && b.x + b.w > a.x + 4).map(b => b.y);
    const end = below.length ? Math.min(...below) - gap : bottom;
    return { ...a, h: Math.max(40, end - a.y) };
  });
}

const inside = (p, r) => r && p.x >= r[0] && p.x < r[0] + r[2] && p.y >= r[1] && p.y < r[1] + r[3];

export default class DragSplit extends View {
  init(_props, cx) {
    // Only a copy given a role does anything: a stray copy must not run moves twice.
    this.role = props()?.role ?? null;
    this.pointer = null;
    this.area = null; // the overlay's own bounds: its origin and the window's size
    this.chain = Promise.resolve();
    this.lastOp = null;
    if (this.role === "controller") {
      // A drag or a move from before a restart is over.
      setShared(DRAG, null);
      setShared(OP, null);
    }
  }

  // ---- overlay -------------------------------------------------------------

  // What a release here would do, or null for nothing.
  target(drag) {
    const p = this.pointer;
    if (!drag || !p) return null;
    const tabs = shared(TABS);
    if (inside(p, tabs?.bar)) {
      const space = spaces().find(s => s.active);
      const listed = (space?.tabs ?? []).filter(x => tabs.tabs?.[x.id]);
      const over = listed.find(x => inside(p, tabs.tabs[x.id]));
      // tab.move counts places from 1, as the tab bar does.
      const at = over ? space.tabs.findIndex(x => x.id === over.id) + 1 : 0;
      if (drag.kind === "tab") {
        if (!over || over.id === drag.tab) return null;
        return { kind: "reorder", key: `r${over.id}`, tab: drag.tab, index: at, rect: tabs.tabs[over.id] };
      }
      // A pane becomes a tab before or after the tab under the pointer, else last.
      let index = (space?.tabs.length ?? 0) + 1, x;
      if (over) {
        const r = tabs.tabs[over.id], after = p.x > r[0] + r[2] / 2;
        index = at + (after ? 1 : 0);
        x = after ? r[0] + r[2] + 1 : r[0] - 2;
      } else {
        const last = listed[listed.length - 1], r = last && tabs.tabs[last.id];
        x = r ? r[0] + r[2] + 1 : tabs.bar[0] + 10;
      }
      return { kind: "newtab", key: `n${index}`, index, x, bar: tabs.bar };
    }
    if (!this.area) return null;
    const hit = paneRects(this.area.y + this.area.height).find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
    if (!hit || hit.pane === drag.pane) return null;
    // The nearest edge says which side the dragged terminal goes on.
    const rx = (p.x - hit.x) / hit.w, ry = (p.y - hit.y) / hit.h;
    const side = [["left", rx], ["right", 1 - rx], ["up", ry], ["down", 1 - ry]].sort((a, b) => a[1] - b[1])[0][0];
    const half = {
      left: [hit.x, hit.y, hit.w / 2, hit.h], right: [hit.x + hit.w / 2, hit.y, hit.w / 2, hit.h],
      up: [hit.x, hit.y, hit.w, hit.h / 2], down: [hit.x, hit.y + hit.h / 2, hit.w, hit.h / 2],
    }[side];
    return { kind: "split", key: `s${hit.pane}${side}`, pane: hit.pane, side, rect: half };
  }

  finish(drop) {
    const drag = shared(DRAG);
    setShared(DRAG, null);
    closeOverlay(props().overlay);
    if (!drag || !drop) return;
    const id = `${Date.now()}-${Math.random()}`;
    if (drop.kind === "reorder") return run("tab.move", { id: drop.tab, index: drop.index });
    if (drop.kind === "newtab") return setShared(OP, { id, at: Date.now(), kind: "newtab", terminal: drag.terminal, index: drop.index });
    const terminals = drag.kind === "pane" ? [drag.terminal]
      : panes().filter(p => p.tab === drag.tab && p.terminal).map(p => p.terminal);
    setShared(OP, { id, at: Date.now(), kind: "split", terminals, target: drop.pane, side: drop.side });
  }

  overlay(cx) {
    const t = theme(), drag = shared(DRAG), z = settings().zoom ?? 1;
    const root = div().id("drag-split-overlay").size_full().relative()
      .on_mouse_move((e, cx) => { this.area = e.bounds; this.pointer = e.position; cx.notify(); })
      // A press means the release was missed (let go outside the window): call it off.
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.finish(null); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.finish(null); })
      .on_mouse_up("left", (e, cx) => { cx.stop_propagation(); this.pointer = e.position; this.finish(this.target(shared(DRAG))); });
    if (!drag) {
      // Ended elsewhere (the tab bar took the release): this overlay is done.
      cx.timer.after(0, () => closeOverlay(props().overlay));
      return root;
    }
    if (!this.pointer || !this.area) return root;
    const L = x => (x - this.area.x) / z, T = y => (y - this.area.y) / z;
    const chip = (text) => div().px(9).py(3).rounded(6).bg(t.accent).text_color(t.accent_foreground).text_size(12).font_medium().child(text);
    const drop = this.target(drag);
    const marks = [];
    if (drop?.kind === "split") {
      const [x, y, w, h] = drop.rect;
      marks.push(div().absolute().left(L(x)).top(T(y)).w(w / z).h(h / z).rounded(8).border(2).border_color(t.accent).bg(t.accent + "22")
        .flex().items_center().justify_center().child(chip(SIDES[drop.side])));
    } else if (drop?.kind === "newtab") {
      const [, y, , h] = drop.bar;
      marks.push(div().absolute().left(L(drop.x) - 1).top(T(y) + 6).w(3).h(h / z - 12).rounded(2).bg(t.accent));
      marks.push(div().absolute().left(L(drop.x) - 30).top(T(y + h) + 4).child(chip("New tab")));
    } else if (drop?.kind === "reorder") {
      const [x, y, w, h] = drop.rect;
      marks.push(div().absolute().left(L(x)).top(T(y)).w(w / z).h(h / z).rounded(7).border(2).border_color(t.accent));
    }
    // What's being dragged, by the pointer.
    marks.push(div().absolute().left(L(this.pointer.x) + 14).top(T(this.pointer.y) + 10).px(9).py(3).rounded(6)
      .bg(t.popover).border(1).border_color(t.border).text_size(12).text_color(t.foreground).shadow_md().child(drag.label ?? "Pane"));
    return root.children(marks);
  }

  // ---- controller ----------------------------------------------------------

  async until(cx, test, ms = 4000) {
    const end = Date.now() + ms;
    for (;;) {
      const v = test();
      if (v) return v;
      if (Date.now() > end) return null;
      await cx.sleep(40);
    }
  }

  async park(cx, terminal) {
    run("terminal.park", { terminal });
    if (!await this.until(cx, () => !panes().some(p => p.terminal === terminal))) throw new Error(`${terminal} kept its pane`);
  }

  async keep(cx, terminal, place) {
    run("terminal.keep", { terminal, place });
    const pane = await this.until(cx, () => panes().find(p => p.terminal === terminal));
    if (!pane) throw new Error(`${terminal} didn't get a pane`);
    return pane;
  }

  // After a failed step, a terminal that lost its pane gets a tab rather than nothing.
  async rescue(cx, terminal) {
    if (panes().some(p => p.terminal === terminal)) return;
    try { await this.keep(cx, terminal, "tab"); } catch { /* the toast from terminal.keep says why */ }
  }

  async split(cx, op) {
    let anchor = op.target, first = null;
    for (const [i, terminal] of op.terminals.entries()) {
      // The first goes on the dropped side; any more stack under it.
      const side = i === 0 ? op.side : "down";
      await this.park(cx, terminal);
      try {
        run("pane.focus", { pane: anchor });
        if (!await this.until(cx, () => focused()?.pane === anchor, 1500)) throw new Error("the pane it was dropped on is gone");
        const moved = await this.keep(cx, terminal, side === "left" || side === "right" ? "right" : "down");
        if (side === "left" || side === "up") run("pane.swap", { pane: moved.pane, target: anchor });
        first ??= moved.pane;
        anchor = moved.pane;
      } catch (e) {
        await this.rescue(cx, terminal);
        throw e;
      }
    }
    if (first) run("pane.focus", { pane: first });
  }

  async newTab(cx, op) {
    await this.park(cx, op.terminal);
    try {
      const moved = await this.keep(cx, op.terminal, "tab");
      // terminal.keep names the tab after the terminal; unnamed, it's called by its place.
      run("tab.rename", { id: moved.tab, name: "" });
      const space = spaces().find(s => s.tabs.some(x => x.id === moved.tab));
      if (space && op.index < space.tabs.length) run("tab.move", { id: moved.tab, index: op.index });
      run("tab.select", { id: moved.tab });
      run("pane.focus", { pane: moved.pane });
    } catch (e) {
      await this.rescue(cx, op.terminal);
      throw e;
    }
  }

  perform(cx, op) {
    this.chain = this.chain.then(async () => {
      try {
        if (op.kind === "split") await this.split(cx, op);
        else if (op.kind === "newtab") await this.newTab(cx, op);
      } catch (e) {
        notify({ title: "Couldn't move the pane", body: String(e?.message ?? e), level: "error" });
      }
    });
  }

  render(cx) {
    if (this.role === "overlay") return this.overlay(cx);
    if (this.role !== "controller") return div();
    // The controller draws nothing; it runs a move once this render is over.
    const op = shared(OP);
    if (op?.id && op.id !== this.lastOp) {
      this.lastOp = op.id;
      if (Date.now() - (op.at ?? 0) < 5000) cx.timer.after(0, (cx) => { setShared(OP, null); this.perform(cx, op); });
    }
    return div();
  }
}
