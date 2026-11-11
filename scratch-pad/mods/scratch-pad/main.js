// Scratch pad: one plain page of notes per space, in a panel on the right of
// the shown tab. The key shows the panel and puts the keyboard in it; pressed
// again while you're typing there, it hides the panel and hands the keyboard
// back to the pane. Each space has its own page and remembers whether its
// panel is open.
//
// A page is a markdown file, `scratch-pad/<space id>.md` in Herdr's folder
// (~/.config/herdr-app), saved as you type. Anything else that edits the file
// (an agent, an editor) shows up in the panel.
//
// One mod, two copies, told apart by props.role:
//   "controller"  a floating block on the layout root that draws nothing. It is
//                 always shown, so it gets the key's command while the panel is
//                 hidden, and it keeps the panel in step with the shown space.
//   "pad"         the panel: a header and the page.
//
// The layout supplies the panel: a block with the id `scratch-pad`, hidden at
// first. shared("scratch-pad") remembers { open: { <space id>: true }, focus }
// (`focus`: when the keyboard was last asked into the page).
//
// Commands (keys.json): scratch-pad.toggle, scratch-pad.show, scratch-pad.hide.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import {
  appHome, focused, layout, nextCommand, notify, panes, props, readTextFile,
  run, setShared, settings, shared, spaces, theme, watchFolder, writeTextFile,
} from "herdr";
import * as fs from "fs/promises";

const PANEL = "scratch-pad";
const STATE = "scratch-pad";
const FOLDER = "scratch-pad";
const SAVE_AFTER = 600; // ms without typing before a page is saved
const FOCUS_WITHIN = 3000; // a focus request older than this is history (a restart)

const slashes = (p) => (p ?? "").replace(/\\/g, "/");
const folder = () => `${slashes(appHome())}/${FOLDER}`;
// "sp12" is sp12.md; "vps/sp12" (a space on another machine) is vps--sp12.md.
const fileFor = (space) => `${folder()}/${space.replace(/\//g, "--").replace(/[^A-Za-z0-9_.-]/g, "-")}.md`;
const samePath = (a, b) => slashes(a).toLowerCase() === slashes(b).toLowerCase();

function readState() {
  const s = shared(STATE) ?? {};
  return { open: { ...(s.open ?? {}) }, focus: s.focus ?? 0 };
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of [...(node.children ?? []), ...(node.floating ?? [])]) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

const shownSpace = () => spaces().find((s) => s.active) ?? null;

function setOpen(space, open) {
  const s = readState();
  if (open) { s.open[space] = true; s.focus = Date.now(); }
  else delete s.open[space];
  setShared(STATE, s);
}

export default class ScratchPad extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "pad";
    if (this.role === "controller") this.initController(cx);
    else this.initPad(cx);
  }

  // ---- controller ----------------------------------------------------------

  initController(cx) {
    this.applied = null; // what the panel was last told: "<space>|shown", "<space>|hidden"
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        const space = shownSpace();
        if (!space) continue;
        if (!find(layout(), PANEL)) {
          notify({ title: "Scratch pad", body: `This layout has no "${PANEL}" block: add the panel from the scratch-pad recipe.`, level: "warning" });
          continue;
        }
        const open = Boolean(readState().open[space.id]);
        // A shown panel answers "toggle" itself: it knows whether it has the keyboard.
        if (command === "show" || (command === "toggle" && !open)) setOpen(space.id, true);
        else if (command === "hide" && open) setOpen(space.id, false);
      }
    });
  }

  // Shows or hides the panel for the shown space. Runs after every render and
  // does nothing when nothing changed.
  reconcile() {
    const space = shownSpace();
    if (!space) return;
    const open = Boolean(readState().open[space.id]);
    const want = `${space.id}|${open ? "shown" : "hidden"}`;
    if (want === this.applied) return;
    this.applied = want;
    const node = find(layout(), PANEL);
    if (!node || Boolean(node.hidden) === !open) return;
    run(open ? "layout.show" : "layout.hide", { id: PANEL });
  }

  // ---- pad -----------------------------------------------------------------

  initPad(cx) {
    this.page = TextareaState.new({ placeholder: "Notes for this space…" });
    this.docs = new Map(); // space id -> { path, text, disk, loaded, rev, saving }
    this.current = null; // the space whose page is shown
    this.typing = false; // the page has the keyboard
    this.hovered = false;
    this.focusSeen = 0;
    // (Refused when the mod is checked from outside Herdr's folder: saving then says why.)
    this.ready = (async () => { await fs.mkdir(folder(), { recursive: true }); })().catch(() => {});
    this.page.on("change", (_e, cx) => this.changed(cx));
    this.page.on("focus", () => { this.typing = true; });
    this.page.on("blur", (_e, cx) => { this.typing = false; this.flush(cx, this.docs.get(this.current)); });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "toggle") {
          if (this.typing) this.hide();
          else this.page.focus();
        } else if (command === "hide" && this.typing) this.giveBack();
      }
    });
    // Someone else edited a page (an agent, an editor): show what's there now.
    cx.spawn(async (cx) => {
      await this.ready;
      for (;;) {
        let paths;
        try { paths = await watchFolder(folder()); } catch { return; }
        const all = paths.some((p) => samePath(p, folder()));
        for (const [space, doc] of this.docs) {
          if (all || paths.some((p) => samePath(p, doc.path))) await this.reload(space, doc);
        }
      }
    });
  }

  hide() {
    const space = shownSpace();
    if (this.typing) this.giveBack();
    if (space) setOpen(space.id, false);
  }

  // The keyboard goes back to the pane it came from, else the shown tab's first.
  giveBack() {
    const f = focused();
    const pane = f?.pane ?? panes().find((p) => p.tab === f?.tab)?.pane;
    if (pane) run("pane.focus", { pane });
  }

  // Brings the page in line with the shown space, and takes the keyboard when
  // it was just asked for. Runs after every render.
  sync(cx) {
    const space = shownSpace();
    if (space && space.id !== this.current) this.open(cx, space.id);
    const asked = readState().focus;
    if (asked !== this.focusSeen) {
      this.focusSeen = asked;
      if (Date.now() - asked < FOCUS_WITHIN) this.page.focus();
    }
  }

  open(cx, space) {
    this.flush(cx, this.docs.get(this.current));
    this.current = space;
    let doc = this.docs.get(space);
    if (doc?.loaded) return this.page.set_value(doc.text);
    this.page.set_value("");
    if (doc) return; // still loading
    doc = { path: fileFor(space), text: "", disk: null, loaded: false, rev: 0, saving: false };
    this.docs.set(space, doc);
    cx.spawn(async (cx) => {
      let disk = null;
      try { disk = await readTextFile(doc.path); } catch {}
      doc.disk = disk;
      // Anything typed while the file was being read goes after what it held.
      const typed = this.current === space ? this.page.value() : "";
      doc.text = (disk ?? "") + (typed && disk ? "\n" : "") + typed;
      doc.loaded = true;
      if (this.current === space && doc.text !== typed) this.page.set_value(doc.text);
      if (typed) this.flush(cx, doc);
    });
  }

  changed(cx) {
    const doc = this.docs.get(this.current);
    if (!doc?.loaded) return;
    const text = this.page.value();
    if (text === doc.text) return;
    doc.text = text;
    const rev = ++doc.rev;
    cx.timer.after(SAVE_AFTER, (cx) => { if (doc.rev === rev) this.flush(cx, doc); });
  }

  flush(cx, doc) {
    if (!doc?.loaded || doc.saving || doc.text === doc.disk) return;
    cx.spawn(() => this.save(doc));
  }

  // Writes a page. What's typed here wins over a change made elsewhere meanwhile.
  async save(doc) {
    if (!doc.loaded || doc.saving) return;
    doc.saving = true;
    try {
      await this.ready;
      for (let tries = 0; tries < 3 && doc.text !== doc.disk; tries++) {
        const text = doc.text;
        if (text === "" && doc.disk === null) break; // nothing written yet: no file
        try {
          await writeTextFile(doc.path, text, doc.disk);
          doc.disk = text;
        } catch (e) {
          // The file isn't what we last saw: look again, then write over it.
          let now = null;
          try { now = await readTextFile(doc.path); } catch {}
          if (now === doc.disk && tries > 0) throw e;
          doc.disk = now;
        }
      }
    } catch (e) {
      notify({ title: "Scratch pad", body: `Couldn't save the notes: ${String(e?.message ?? e)}`, level: "error" });
    } finally {
      doc.saving = false;
    }
  }

  // Takes the file's text, unless there's something typed here that isn't saved yet.
  async reload(space, doc) {
    if (!doc.loaded || doc.saving || doc.text !== doc.disk) return;
    let disk = null;
    try { disk = await readTextFile(doc.path); } catch { return; }
    if (disk === doc.disk || doc.saving || doc.text !== doc.disk) return;
    doc.disk = disk;
    doc.text = disk ?? "";
    if (this.current === space) this.page.set_value(doc.text);
  }

  // Closing the app or the layout: save what's still waiting.
  async close() {
    const waiting = [...(this.docs?.values() ?? [])].filter((d) => d.loaded && d.text !== d.disk);
    await Promise.all(waiting.map((d) => this.save(d)));
  }

  // Looks like the Files panel: a card with a title, the space's name beside it.
  pad(t) {
    const space = shownSpace();
    const font = settings()?.font_family;
    return v_flex()
      .id("scratch-pad")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .child(h_flex()
        .h(42)
        .flex_none()
        .px(14)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(div().flex_none().font_semibold().child("Scratch pad"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(space?.name ?? ""))
        .when(this.hovered, (el) => el.child(div()
          .id("scratch-pad-hide")
          .flex_none()
          .p(3)
          .rounded(4)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.hide(); })
          .child(svg("mods/pane/close.svg").size(14)))))
      .child(Textarea.new(this.page)
        .flex_1()
        .min_h(0)
        .w_full()
        .p(12)
        .text_size(13)
        .text_color(t.foreground)
        .when(typeof font === "string", (el) => el.font_family(font)));
  }

  // ---- render --------------------------------------------------------------

  render(cx) {
    if (this.role === "controller") {
      // Draws nothing; it reacts to what changed once this render is over.
      cx.timer.after(0, () => this.reconcile());
      return div();
    }
    cx.timer.after(0, (cx) => this.sync(cx));
    return this.pad(theme());
  }
}
