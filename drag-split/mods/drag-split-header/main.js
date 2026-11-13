// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "drag-split-header" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
//
// Herdr's `pane` header, plus drag to split (the drag-split mod): press on the
// header and drag out of it to move this pane onto the tab bar (a tab of its
// own) or onto another pane. It also tells drag-split where it is in the
// window, which is where its pane is.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, shared, setShared, spaces, settings, openOverlay } from "herdr";

const DRAG = "drag-split", PANES = "drag-split-panes";

// Match the first visible tab frame, including the active child of a stack.
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

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; this.pressed = null; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // Tell drag-split where this header is, when that changed.
  place(bounds) {
    const pane = props()?.pane;
    if (!bounds || !pane) return;
    const r = [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
    const all = shared(PANES) ?? {};
    if (all[pane]?.every((v, i) => v === r[i])) return;
    const live = new Set(panes().map((p) => p.pane));
    const next = {};
    for (const k of Object.keys(all)) if (live.has(k)) next[k] = all[k];
    next[pane] = r;
    setShared(PANES, next);
  }

  // The press left the header: drag this pane, if it has somewhere to go.
  drag(p, name) {
    const tab = spaces().flatMap((s) => s.tabs).find((x) => x.id === p.tab);
    if (!p.terminal || !tab || tab.panes < 2 || tab.zoomed || shared(DRAG)) return;
    const overlay = openOverlay({ mod: "drag-split", props: { role: "overlay" }, kind: "window", frame: "none", at: { x: 0, y: 0 }, width: 1, height: 1 });
    setShared(DRAG, { kind: "pane", tab: p.tab, pane: p.pane, terminal: p.terminal, label: name, overlay });
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/drag-split-header/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      // A drag starts once a press moves 6px, or leaves the header (which can
      // happen in fewer moves than it takes to see 6px).
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        if (!hovered && this.pressed) { this.pressed = null; this.drag(p, name); }
        cx.notify();
      })
      .on_mouse_move((e) => {
        this.place(e.bounds);
        const at = this.pressed, z = settings().zoom ?? 1;
        if (at && Math.hypot(e.position.x - at.x, e.position.y - at.y) > 6 * z) { this.pressed = null; this.drag(p, name); }
      })
      // Every press anywhere reports this header's place, so it's fresh when a drag starts.
      .on_mouse_down_out((e) => { this.pressed = null; this.place(e.bounds); })
      .on_mouse_down("left", (e) => {
        this.place(e.bounds);
        // Herdr's own grip sits at the top center: leave presses there to it.
        const b = e.bounds, z = settings().zoom ?? 1;
        this.pressed = !b || Math.abs(e.position.x - (b.x + b.width / 2)) > 48 * z ? e.position : null;
      })
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
