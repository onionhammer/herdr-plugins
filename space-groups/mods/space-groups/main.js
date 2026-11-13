// Space groups: name groups of spaces (Personal, Work 1, Work 2) and show one
// group at a time. The sidebar's spaces and agents lists (the clones
// space-groups-spaces and space-groups-agents) list only the shown group's
// spaces and agents.
//
// One mod, told apart by props.role:
//   "bar"   a strip of pills above the spaces list: All, each group, then +.
//           A click shows a group, a double-click or right-click edits it. It
//           also keeps the groups in step with the spaces (track()): a space
//           made while a group is shown joins it, and going to a space outside
//           the shown group shows that space's group.
//   "edit"  the dialog that names a group and picks its spaces.
//   "menu"  a group's right-click menu.
//   "pick"  the groups as a menu, from the bar on the sidebar's narrow rail.
// A copy without a role draws nothing and does nothing.
//
// Everything lives in shared("space-groups"), which every mod can read:
//   { groups: [{ id, name }], of: { [space]: group }, shown: group | null,
//     last: { [group]: space } }
// A space is in at most one group. A space in none is listed only under All.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle, InputState, Input } from "gpui-base";
import { spaces, machines, run, theme, shared, setShared, props, openOverlay, closeOverlay, nextCommand, layout } from "herdr";

const MOD = "space-groups";
const KEY = "space-groups";
const icon = (name) => `mods/workspace-chrome/${name}.svg`;
// What a stored color name looks like on an avatar (as Herdr's spaces list draws it).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// Statuses a pill speaks up for: something in the group needs you.
const RANK = { blocked: 2, done: 1 };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, as Herdr's own sidebar mods do.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const record = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});

// The groups, read defensively: anything malformed counts as absent.
function state() {
  const g = record(shared(KEY));
  const groups = (Array.isArray(g.groups) ? g.groups : []).filter((x) => typeof x?.id === "string" && typeof x?.name === "string");
  const shown = groups.some((x) => x.id === g.shown) ? g.shown : null;
  return { groups, of: record(g.of), shown, last: record(g.last) };
}

const save = (g) => setShared(KEY, g);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const machineOf = (space) => (space.includes("/") ? space.split("/")[0] : null);
const initial = (name) => [...name.trim()][0]?.toUpperCase() ?? "?";

// Shows a group (null: every space). Unless the shown space is in it, it goes to
// the space last used in that group, else its first.
function show(id, g = state()) {
  if (id === g.shown) return;
  save({ ...g, shown: id });
  if (!id) return;
  const sp = spaces();
  if (g.of[sp.find((s) => s.active)?.id] === id) return;
  const mine = sp.filter((s) => g.of[s.id] === id);
  const to = mine.find((s) => s.id === g.last[id]) ?? mine[0];
  if (to) run("space.select", { id: to.id });
}

// The next or previous group, All counting as the first.
function step(by) {
  const g = state();
  const ids = [null, ...g.groups.map((x) => x.id)];
  if (ids.length > 1) show(ids[(ids.indexOf(g.shown) + by + ids.length) % ids.length], g);
}

// The dialog that names a group and picks its spaces (group null: a new one).
function edit(group) {
  const rows = Math.max(1, Math.min(spaces().length, 12));
  openOverlay({ mod: MOD, kind: "dialog", width: 420, height: 262 + rows * 30, props: { role: "edit", group } });
}

// Its spaces go back to being in no group.
function remove(id) {
  const g = state();
  const of = Object.fromEntries(Object.entries(g.of).filter(([, x]) => x !== id));
  const last = Object.fromEntries(Object.entries(g.last).filter(([x]) => x !== id));
  save({ ...g, groups: g.groups.filter((x) => x.id !== id), of, last, shown: g.shown === id ? null : g.shown });
}

function move(id, by) {
  const g = state();
  const i = g.groups.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= g.groups.length) return;
  const groups = [...g.groups];
  [groups[i], groups[j]] = [groups[j], groups[i]];
  save({ ...g, groups });
}

// The pill that speaks up for each space needing you: its group's, else All's.
function attention(g, sp) {
  const valid = new Set(g.groups.map((x) => x.id));
  const need = {};
  for (const s of sp) {
    if (!RANK[s.status]) continue;
    const key = valid.has(g.of[s.id]) ? g.of[s.id] : "all";
    if ((RANK[need[key]] ?? 0) < RANK[s.status]) need[key] = s.status;
  }
  return need;
}

function avatar(t, s) {
  const color = (shared("space.colors") ?? {})[s.id] ?? "ansi6";
  const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color] ?? t.accent);
  return h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center()
    .text_size(10.5).font_bold().text_color("#ffffff").child(initial(s.name));
}

export default class SpaceGroups extends View {
  init(_props, cx) {
    this.role = props()?.role ?? null;
    if (this.role === "bar") return this.initBar(cx);
    if (this.role === "edit") return this.initEdit(cx);
    if (this.role === "menu" || this.role === "pick") {
      this.at = -1;
      this.handle = cx.focus_handle();
      this.handle.focus();
    }
  }

  render(cx) {
    const t = theme();
    if (this.role === "bar") return this.renderBar(t);
    if (this.role === "edit") return this.renderEdit(t);
    if (this.role === "menu" || this.role === "pick") return this.renderList(t, this.role === "menu" ? this.menuItems() : this.pickItems());
    return div();
  }

  // ── bar ─────────────────────────────────────────────────────────────────

  initBar(cx) {
    this.known = new Set(); // spaces seen this run
    this.ready = new Set(); // machines whose spaces were loaded at the last look
    this.active = null; // the shown space at the last look
    this.scroll = ScrollHandle.new();
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next") step(1);
        else if (command === "prev") step(-1);
        else if (command === "new") edit(null);
        else if (command === "edit") edit(state().shown);
        cx.notify();
      }
    });
  }

  // Keeps the groups in step with the spaces. Runs on every render of the bar,
  // which Herdr redraws whenever the spaces change, and writes only on a change.
  track() {
    const g = state();
    const sp = spaces();
    const listed = new Set(sp.map((s) => s.id));
    const valid = new Set(g.groups.map((x) => x.id));
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
    const was = this.ready;
    const of = { ...g.of };
    let { shown, last } = g;
    // A space that wasn't there at the last look, on a machine that was loaded
    // then, was just made: it joins the shown group. A machine that's loading
    // brings its spaces with it, and those stay where they were.
    for (const s of sp) {
      if (this.known.has(s.id)) continue;
      this.known.add(s.id);
      if (shown && !valid.has(of[s.id]) && was.has(s.machine ?? null)) of[s.id] = shown;
    }
    // Forget groups that are gone, and spaces gone from a machine that's loaded.
    for (const id of Object.keys(of)) {
      const m = machineOf(id);
      if (!valid.has(of[id]) || (sp.length && !listed.has(id) && ready.has(m) && was.has(m))) delete of[id];
    }
    this.ready = ready;
    // Going to a space outside the shown group (a key, the switcher, a toast)
    // shows that space's group, or All for a space in none.
    const active = sp.find((s) => s.active)?.id ?? null;
    if (active && active !== this.active) {
      this.active = active;
      const its = valid.has(of[active]) ? of[active] : null;
      if (shown && its !== shown) shown = its;
    }
    if (active && valid.has(of[active]) && last[of[active]] !== active) last = { ...last, [of[active]]: active };
    last = Object.fromEntries(Object.entries(last).filter(([x]) => valid.has(x)));
    const next = { ...g, of, shown, last };
    if (!same(next, g)) save(next);
    return next;
  }

  renderBar(t) {
    const g = this.track();
    const need = attention(g, spaces());
    if (narrow()) return this.renderRail(t, g, need);
    const pills = [{ id: null, key: "all", name: "All" }, ...g.groups.map((x) => ({ id: x.id, key: x.id, name: x.name }))];
    const at = pills.findIndex((p) => p.id === g.shown);
    if (at !== this.at) {
      this.at = at;
      this.scroll.scroll_to_item(at);
    }
    const pill = (p) => {
      const on = p.id === g.shown;
      const alert = on ? null : need[p.key];
      return h_flex().id(`group-${p.key}`).h(24).px(9).gap(6).flex_none().items_center().rounded(7)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .when(p.id !== null, (el) => el
          .tooltip(`${p.name}: double-click or right-click to edit`)
          .on_mouse_down("left", (e) => { if (e.click_count === 2) edit(p.id); })
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            openOverlay({ mod: MOD, kind: "popup", width: 200, height: 200, props: { role: "menu", group: p.id } });
          }))
        .on_click(() => show(p.id))
        .child(div().max_w(120).truncate().child(p.name))
        .when(Boolean(alert), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t[alert])));
    };
    const empty = !g.groups.length;
    return h_flex().size_full().min_w(0).px(8).gap(3).items_center().bg(t.chrome).text_size(12)
      .child(h_flex().id("groups-scroll").flex_1().min_w(0).h_full().items_center().gap(3)
        .overflow_x_scrollbar().track_scroll(this.scroll)
        .children(pills.map(pill)))
      .child(h_flex().id("group-new").h(24).flex_none().gap(5).items_center().justify_center().rounded(6)
        .when(empty, (el) => el.px(8))
        .when(!empty, (el) => el.w(24).tooltip("New group"))
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => edit(null))
        .child(svg(icon("plus")).size(13))
        .when(empty, (el) => el.child("New group")));
  }

  // On the narrow rail: one cell for the shown group, which opens the groups.
  renderRail(t, g, need) {
    const shown = g.groups.find((x) => x.id === g.shown);
    const elsewhere = Object.entries(need).filter(([k]) => k !== (g.shown ?? "all")).map(([, s]) => s);
    const alert = elsewhere.includes("blocked") ? "blocked" : elsewhere[0];
    return h_flex().size_full().bg(t.chrome).items_center().justify_center()
      .child(h_flex().id("group-pick").relative().w(32).h(26).rounded(6).items_center().justify_center()
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(shown?.name ?? "All spaces")
        .on_click(() => openOverlay({ mod: MOD, kind: "popup", width: 220, height: 420, props: { role: "pick" } }))
        .child(shown ? div().text_size(12).font_semibold().child(initial(shown.name)) : svg(icon("layers")).size(14))
        .when(Boolean(alert), (el) => el.child(div().absolute().top(3).right(5).size(6).rounded(3).bg(t[alert]))));
  }

  // ── menus ───────────────────────────────────────────────────────────────

  // A group's right-click menu. Delete asks for a second click.
  menuItems() {
    const g = state();
    const id = props()?.group;
    const i = g.groups.findIndex((x) => x.id === id);
    if (i < 0) return [];
    return [
      { label: "Edit group…", icon: "square-pen", act: () => edit(id) },
      ...(i > 0 ? [{ label: "Move left", icon: "chevron-left", act: () => move(id, -1) }] : []),
      ...(i < g.groups.length - 1 ? [{ label: "Move right", icon: "chevron-right", act: () => move(id, 1) }] : []),
      { label: this.deleting ? "Click again to delete" : "Delete group", icon: "x", line: true, danger: this.deleting, confirm: true, act: () => remove(id) },
    ];
  }

  // The groups, for the narrow rail.
  pickItems() {
    const g = state();
    const need = attention(g, spaces());
    const shown = g.groups.find((x) => x.id === g.shown);
    return [
      { label: "All spaces", icon: "layers", check: !g.shown, dot: g.shown ? need.all : null, act: () => show(null) },
      ...g.groups.map((x) => ({ label: x.name, letter: initial(x.name), check: x.id === g.shown, dot: x.id === g.shown ? null : need[x.id], act: () => show(x.id) })),
      { label: "New group…", icon: "plus", line: true, act: () => edit(null) },
      ...(shown ? [{ label: `Edit ${shown.name}…`, icon: "square-pen", act: () => edit(shown.id) }] : []),
    ];
  }

  // An item with `confirm` takes a second click (its label changes in between).
  choose(item, cx) {
    if (!item) return;
    if (item.confirm && !this.deleting) { this.deleting = true; cx.notify(); return; }
    closeOverlay(props().overlay);
    item.act();
  }

  renderList(t, items) {
    return v_flex().id("groups-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (!items.length) return;
        if (e.key === "down") this.at = (this.at + 1) % items.length;
        else if (e.key === "up") this.at = this.at <= 0 ? items.length - 1 : this.at - 1;
        else if (e.key === "enter") this.choose(items[this.at], cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .children(items.map((it, i) => v_flex()
        .when(i > 0 && Boolean(it.line), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`gm-${i}`).h(31).px(8).gap(9).rounded(7).items_center()
          .text_color(it.danger ? t.blocked : t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(it, cx))
          .child(it.letter
            ? h_flex().size(14).flex_none().items_center().justify_center().text_size(10.5).font_bold().text_color(t.muted).child(it.letter)
            : svg(icon(it.icon)).size(14).flex_none().text_color(it.danger ? t.blocked : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .when(Boolean(it.dot), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t[it.dot])))
          .when(Boolean(it.check), (el) => el.child(svg(icon("check")).size(14).flex_none())))));
  }

  // ── edit dialog ─────────────────────────────────────────────────────────

  initEdit(cx) {
    const g = state();
    this.group = g.groups.find((x) => x.id === props()?.group) ?? null;
    this.picked = new Set(this.group ? Object.keys(g.of).filter((s) => g.of[s] === this.group.id) : []);
    const name = this.group?.name ?? "";
    this.input = InputState.new({ value: name, placeholder: "Personal, Work…" });
    if (name) this.input.set_selected_range({ start: 0, end: name.length });
    this.input.on("change", (_e, cx) => cx.notify());
    this.input.on("submit", (_e, cx) => this.saveEdit(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    // As Herdr's own prompt does: the dialog may take the keyboard after init.
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
  }

  // Once only: Enter in the name field can reach both the input's submit and the
  // dialog's own key handler.
  saveEdit(cx) {
    if (this.done) return;
    const name = this.input.value().trim();
    if (!name) { this.input.focus(); cx?.notify(); return; }
    this.done = true;
    const g = state();
    const known = this.group && g.groups.some((x) => x.id === this.group.id);
    const id = known ? this.group.id : `g${Date.now().toString(36)}`;
    const groups = known ? g.groups.map((x) => (x.id === id ? { ...x, name } : x)) : [...g.groups, { id, name }];
    const of = { ...g.of };
    for (const s of spaces()) {
      if (this.picked.has(s.id)) of[s.id] = id;
      else if (of[s.id] === id) delete of[s.id];
    }
    closeOverlay(props().overlay);
    const next = { ...g, groups, of };
    save(next);
    if (!known) show(id, next);
  }

  renderEdit(t) {
    const g = state();
    const sp = spaces();
    const named = Boolean(this.input.value().trim());
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
      .on_click(action).child(text);
    const row = (s) => {
      const on = this.picked.has(s.id);
      const other = g.groups.find((x) => x.id === g.of[s.id] && x.id !== this.group?.id);
      return h_flex().id(`pick-${s.id}`).h(30).flex_none().px(8).gap(9).items_center().rounded(7).cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => { on ? this.picked.delete(s.id) : this.picked.add(s.id); cx.notify(); })
        .child(h_flex().size(16).flex_none().rounded(4).border_1().items_center().justify_center()
          .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
          .when(on, (el) => el.child(svg(icon("check")).size(11).text_color(t.accent_foreground))))
        .child(avatar(t, s))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name))
        .when(Boolean(s.machine), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(s.machine)))
        // In another group: ticking it moves it here.
        .when(Boolean(other), (el) => el.child(div().flex_none().max_w(120).truncate().text_size(11).text_color(t.dim)
          .child(on ? `from ${other.name}` : other.name)));
    };
    return v_flex().id("group-edit").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter") this.saveEdit(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(this.group ? "Edit group" : "New group"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(label("Spaces"))
      .child(v_flex().id("group-spaces").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).text_size(12.8)
        .when(!sp.length, (el) => el.child(div().px(8).text_size(12).text_color(t.dim).child("No spaces yet.")))
        .children(sp.map(row)))
      .child(h_flex().pt(16).gap(8).items_center()
        .when(Boolean(this.group), (el) => el.child(h_flex().id("group-delete").h(32).px(10).items_center().rounded(8)
          .text_size(12.5).text_color(this.deleting ? t.blocked : t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.blocked))
          .on_click((_e, cx) => {
            if (!this.deleting) { this.deleting = true; cx.notify(); return; }
            closeOverlay(props().overlay);
            remove(this.group.id);
          })
          .child(this.deleting ? "Click again to delete" : "Delete group")))
        .child(div().flex_1())
        .child(button("group-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button("group-save", this.group ? "Save" : "Create", true, named, (_e, cx) => this.saveEdit(cx))));
  }
}
