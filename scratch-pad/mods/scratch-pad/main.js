// Scratch pad: one plain page of notes per space. It's a third panel beside
// Files and Changes, on the right of the shown tab: the same card, in the same
// place, opened from the same row of buttons (a "Notes" button in the tab bar)
// or with a key. The key shows the panel and puts the keyboard in it; pressed
// again while you're typing there, it hides the panel and hands the keyboard
// back to the pane.
//
// A page is a markdown file, `scratch-pad/<space id>.md` in Herdr's folder
// (~/.config/herdr-app), saved as you type. Anything else that edits the file
// (an agent, an editor) shows up in the panel.
//
// One mod, two copies, told apart by props.role:
//   "pad"         the panel: a header and the page. A child of the layout's
//                 `panel-body` stack, with the id `scratch-pad`.
//   "controller"  a floating block on the layout root that draws nothing. It is
//                 always shown, so it gets the key's command while the panel is
//                 hidden.
//
// shared("scratch-pad") is { focus }: when the keyboard was last asked into the
// page. Which panel a space shows is the tab bar's to remember, as for Files.
//
// Commands (keys.json): scratch-pad.toggle, scratch-pad.show, scratch-pad.hide.
// In the page, Ctrl+X (Cmd+X on macOS) with nothing selected cuts the whole line.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import {
  appHome, focused, layout, nextCommand, notify, panes, props, readTextFile,
  run, setShared, settings, shared, spaces, theme, watchFolder, window, writeTextFile,
} from "herdr";
import * as fs from "fs/promises";

const PANEL = "panel"; // the side panel: a column holding…
const STACK = "panel-body"; // …a stack of Files, Changes and…
const CHILD = "scratch-pad"; // …this
const STATE = "scratch-pad";
const FOLDER = "scratch-pad";
const SAVE_AFTER = 600; // ms without typing before a page is saved
const FOCUS_WITHIN = 3000; // a focus request older than this is history (a restart)
const KEYS = "ScratchPad"; // the page's key context…
const CUT = "scratch_pad_cut"; // …and the action its cut key runs there

const slashes = (p) => (p ?? "").replace(/\\/g, "/");
const folder = () => `${slashes(appHome())}/${FOLDER}`;
// "sp12" is sp12.md; "vps/sp12" (a space on another machine) is vps--sp12.md.
const fileFor = (space) => `${folder()}/${space.replace(/\//g, "--").replace(/[^A-Za-z0-9_.-]/g, "-")}.md`;
// A watched path may come back spelled differently (\?\C:\…), so match its end.
const endsWith = (path, tail) => slashes(path).toLowerCase().endsWith(tail.toLowerCase());

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of [...(node.children ?? []), ...(node.floating ?? [])]) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

// Typed here and not in the file yet. (A page with no file is "".)
const dirty = (doc) => doc.text !== (doc.disk ?? "");

const shownSpace = () => spaces().find((s) => s.active) ?? null;

// Is the side panel open on the page?
function showing() {
  const root = layout(), panel = find(root, PANEL);
  return Boolean(panel) && !panel.hidden && find(root, STACK)?.active === CHILD;
}

// Opens the side panel on the page and asks the keyboard into it.
function show() {
  run("layout.select", { stack: STACK, child: CHILD });
  run("layout.show", { id: PANEL });
  setShared(STATE, { focus: Date.now() });
}

export default class ScratchPad extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "pad";
    if (this.role === "controller") this.initController(cx);
    else this.initPad(cx);
  }

  // ---- controller ----------------------------------------------------------

  initController(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (!find(find(layout(), STACK), CHILD)) {
          notify({ title: "Scratch pad", body: `This layout has no "${CHILD}" block in a "${STACK}" stack: add it from the scratch-pad recipe.`, level: "warning" });
          continue;
        }
        // A shown page answers "toggle" itself: it knows whether it has the keyboard.
        if (command === "show" || (command === "toggle" && !showing())) show();
        else if (command === "hide" && showing()) run("layout.hide", { id: PANEL });
      }
    });
  }

  // ---- pad -----------------------------------------------------------------

  initPad(cx) {
    this.page = TextareaState.new({ placeholder: "Notes for this space…" });
    this.docs = new Map(); // space id -> { path, text, disk, loaded, rev, saving }
    this.current = null; // the space whose page is shown
    this.typing = false; // the page has the keyboard
    this.focusSeen = 0;
    // (Refused when the mod is checked from outside Herdr's folder: saving then says why.)
    this.ready = (async () => { await fs.mkdir(folder(), { recursive: true }); })().catch(() => {});
    this.page.on("change", (_e, cx) => this.changed(cx));
    this.page.on("focus", () => { this.typing = true; });
    this.page.on("blur", (_e, cx) => { this.typing = false; this.flush(cx, this.docs.get(this.current)); });
    // The text area binds the cut key to its own cut, in its "Input" context. A
    // binding of ours in the same context, inside the page's, is newer, so it
    // comes first (and nowhere else changes).
    try {
      const key = window()?.platform === "macos" ? "cmd-x" : "ctrl-x";
      cx.bind_keys([{ keystroke: key, action: CUT, context: `${KEYS} > Input` }]);
    } catch {}
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "toggle") {
          if (!showing()) continue; // the controller opens it
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
        const all = paths.some((p) => endsWith(p, `/${FOLDER}`));
        for (const [space, doc] of this.docs) {
          if (all || paths.some((p) => endsWith(p, doc.path.slice(folder().length)))) await this.reload(space, doc);
        }
      }
    });
  }

  hide() {
    if (this.typing) this.giveBack();
    run("layout.hide", { id: PANEL });
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
    const asked = shared(STATE)?.focus ?? 0;
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

  // The cut key: the selection, or with nothing selected the caret's whole line
  // and its line break, as in VS Code. After cutting a line the caret is at the
  // start of a line, so pasting there puts the line back above it.
  //
  // The text state can't say where the caret is, so a marker character briefly
  // takes the selection's place to find it; the edits land within a moment of
  // each other, and an undo takes them back together.
  cut(cx) {
    const before = this.page.value();
    let mark = "\uE000"; // private use, and not in the page
    while (before.includes(mark)) mark = String.fromCharCode(mark.charCodeAt(0) + 1);
    this.page.replace(mark);
    const at = this.page.value().indexOf(mark);
    const selected = before.length + mark.length - this.page.value().length;
    // What goes, [from, to) of `before`; and where the caret ends up, if not there.
    let from = at, to = at + selected, clip = before.slice(from, to), caret = null;
    if (!selected) {
      const nl = before.indexOf("\n", at);
      from = at && before.lastIndexOf("\n", at - 1) + 1;
      to = nl < 0 ? before.length : nl + 1;
      clip = before.slice(from, nl < 0 ? to : nl) + "\n";
      if (nl < 0 && from > 0) { // the last line takes the break before it
        from--;
        caret = from && before.lastIndexOf("\n", from - 1) + 1;
      }
    }
    this.page.set_selected_range({ start: from, end: to - selected + mark.length });
    this.page.replace("");
    if (caret !== null) this.page.set_selected_range({ start: caret, end: caret });
    if (before) cx.write_to_clipboard(clip);
  }

  flush(cx, doc) {
    if (!doc?.loaded || doc.saving || !dirty(doc)) return;
    cx.spawn(() => this.save(doc));
  }

  // Writes a page. What's typed here wins over a change made elsewhere meanwhile.
  async save(doc) {
    if (!doc.loaded || doc.saving) return;
    doc.saving = true;
    try {
      await this.ready;
      for (let tries = 0; tries < 3 && dirty(doc); tries++) {
        const text = doc.text;
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
    if (!doc.loaded || doc.saving || dirty(doc)) return;
    let disk = null;
    try { disk = await readTextFile(doc.path); } catch { return; }
    if (disk === doc.disk || doc.saving || dirty(doc)) return;
    doc.disk = disk;
    doc.text = disk ?? "";
    if (this.current === space) this.page.set_value(doc.text);
  }

  // Closing the app or the layout: save what's still waiting.
  async close() {
    const waiting = [...(this.docs?.values() ?? [])].filter((d) => d.loaded && dirty(d));
    await Promise.all(waiting.map((d) => this.save(d)));
  }

  // Looks like the Files panel: a card with a title, the space's name beside it.
  pad(t) {
    const space = shownSpace();
    const font = settings()?.font_family;
    return v_flex()
      .id("scratch-pad")
      .key_context(KEYS)
      .on_action(CUT, (_e, cx) => this.cut(cx))
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .child(h_flex()
        .h(42)
        .flex_none()
        .px(14)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(div().flex_none().font_semibold().child("Notes"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(space?.name ?? "")))
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
      return div(); // draws nothing
    }
    cx.timer.after(0, (cx) => this.sync(cx));
    return this.pad(theme());
  }
}
