// Quick terminal: VS Code's Ctrl+` panel. Each space gets its own terminal in
// a panel under the shown tab, a third of its height (drag the divider to
// resize). The key shows the panel and gives it the keyboard; pressing it
// again hides the panel and hands the keyboard back to the pane you came from.
// A hidden terminal keeps running in herdr-core (hc run --keep), so whatever
// it was doing is still there next time.
//
// One mod, three copies, told apart by props.role:
//   "controller"  a floating block on the layout root that draws nothing. It is
//                 always shown, so it gets the key's command, and it keeps the
//                 panel in step with the shown space.
//   "bar"         the panel's header: program, folder, hide and close buttons.
//   "empty"       the stack's placeholder, seen only until a terminal is there.
//
// The layout supplies the panel (`quick-terminal`, hidden at first) and, in it,
// a stack (`quick-terminal-stack`) whose `qt-<space>` children this mod writes:
// one terminal block per space. shared("quick-terminal") remembers
// { open: { <space id>: true }, terms: { <space id>: <terminal address> } }.
//
// Commands (keys.json): quick-terminal.toggle, quick-terminal.show, quick-terminal.hide.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  appHome, focused, hc, home, layout, machines, nextCommand, notify, panes,
  props, readTextFile, run, setShared, shared, spaces, terminals, theme, writeTextFile,
} from "herdr";

const PANEL = "quick-terminal";
const STACK = "quick-terminal-stack";
const STATE = "quick-terminal";
const LABEL = "quick-terminal.space";
const CHILD = "qt-";

const childId = (space) => CHILD + space.replace(/[^A-Za-z0-9_-]/g, "-");
// "vps/t7" and "vps/sp12" live on vps; "t7" and "sp12" on this computer.
const machineOf = (id) => (id.includes("/") ? id.slice(0, id.indexOf("/")) : null);
const localId = (id) => id.slice(id.lastIndexOf("/") + 1);
const firstLine = (s) => (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
const slashes = (p) => (p ?? "").replace(/\\/g, "/");

function readState() {
  const s = shared(STATE) ?? {};
  return { open: { ...(s.open ?? {}) }, terms: { ...(s.terms ?? {}) } };
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

// The stack's terminal blocks, one per space, in a stable order.
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isBlock = (c) => String(c?.id ?? "").startsWith(CHILD);
function blocksFor(terms) {
  return Object.keys(terms).map((space) => ({ id: childId(space), type: "block", content: { terminal: terms[space] } })).sort(byId);
}
// Ids and addresses; ids only when a tree doesn't carry the blocks' content.
function same(have, want) {
  const a = have.filter(isBlock).sort(byId);
  const withAddress = a.every((c) => c.content !== undefined);
  const sig = (list) => JSON.stringify(list.map((b) => (withAddress ? [b.id, b.content?.terminal ?? null] : b.id)));
  return sig(a) === sig(want);
}

const shownSpace = () => spaces().find((s) => s.active) ?? null;
const machineReady = (name) => machines().find((m) => (m.name ?? null) === (name ?? null))?.layout === "ready";

// Where a new terminal starts: the focused pane's folder when it's in this
// space, else the first folder in the space's shown tab, else the space's own.
function folderFor(space) {
  const f = focused(), all = panes();
  if (f?.space === space.id && f.pane) {
    const p = all.find((p) => p.pane === f.pane);
    if (p?.cwd) return p.cwd;
  }
  const tab = space.tabs.find((t) => t.active);
  return all.find((p) => p.tab === tab?.id && p.cwd)?.cwd || space.folder || null;
}

function folderLabel(cwd) {
  if (!cwd) return "";
  const c = slashes(cwd), h = slashes(home());
  return c === h ? "~" : c.startsWith(h + "/") ? "~" + c.slice(h.length) : c;
}

async function coreList(extra = []) {
  const r = await hc(["ls", "--json", ...extra]);
  try { return JSON.parse(r.stdout); } catch { return { terminals: [], machines: [] }; }
}

export default class QuickTerminal extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "controller";
    this.hovered = false;
    // Only the controller reads commands: every shown copy may be sent them.
    if (this.role !== "controller") return;
    this.applied = null; // what the panel shows: "<space>|<address>", "" hidden, null not yet set
    this.shownAddress = null; // the terminal it shows (to know whether the keyboard is in it)
    this.returnTo = null; // the pane that had the keyboard before the panel took it
    this.known = new Set(); // addresses seen in terminals(): gone from there means ended
    this.seen = new Set(); // spaces seen: gone from spaces() means closed
    this.starting = false;
    this.chain = Promise.resolve(); // layout writes, one at a time
    this.tried = null; // the last set of blocks written, so a failed write isn't repeated
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try {
          if (command === "toggle") await this.toggle(cx);
          else if (command === "show") await this.show(cx);
          else if (command === "hide") this.hide();
        } catch (e) {
          notify({ title: "Quick terminal", body: String(e?.message ?? e), level: "error" });
        }
      }
    });
  }

  // ---- controller ----------------------------------------------------------

  async toggle(cx) {
    const space = shownSpace();
    if (!space) return;
    if (readState().open[space.id] && this.applied) return this.hide();
    await this.show(cx);
  }

  hide() {
    const space = shownSpace();
    if (!space) return;
    const s = readState();
    delete s.open[space.id];
    setShared(STATE, s);
    this.reconcile();
  }

  async show(cx) {
    const space = shownSpace();
    if (!space || this.starting) return;
    if (!find(layout(), STACK)) {
      notify({ title: "Quick terminal", body: `This layout has no "${STACK}" node: add the panel from the quick-terminal recipe.`, level: "warning" });
      return;
    }
    const f = focused();
    if (f?.pane) this.returnTo = f.pane;
    this.starting = true;
    try {
      let address = readState().terms[space.id];
      if (!(await this.alive(address))) address = (await this.adopt(space)) ?? (await this.start(space));
      // Remember the terminal first (still closed), so the layout gets its block…
      let s = readState();
      s.terms[space.id] = address;
      setShared(STATE, s);
      await this.writeBlocks(cx, childId(space.id));
      // …then open the panel on it.
      s = readState();
      s.terms[space.id] = address;
      s.open[space.id] = true;
      setShared(STATE, s);
      this.applied = null;
      this.reconcile(cx);
      run("pane.focus", { terminal: address });
    } finally {
      this.starting = false;
    }
  }

  // Is this terminal still running? terminals() lists the live ones; hc ls is
  // the last word when it isn't there (yet). A machine that isn't connected
  // can't say, so its terminal counts as running.
  async alive(address) {
    if (!address) return false;
    if (terminals().some((t) => t.address === address)) return true;
    const list = await coreList();
    if ((list.terminals ?? []).some((t) => t.address === address)) return true;
    const m = machineOf(address);
    return Boolean(m) && !(list.machines ?? []).some((x) => x.name === m && x.state === "connected");
  }

  // A terminal this space already has, found by its label (shared state was lost).
  async adopt(space) {
    const list = await coreList(["--label", `${LABEL}=${localId(space.id)}`]);
    const hit = (list.terminals ?? []).find((t) => t.state === "live" && machineOf(t.address ?? "") === (space.machine ?? null));
    return hit?.address ?? null;
  }

  // A new shell on the space's machine, kept by the core, without Herdr's
  // labels (a terminal with them would be adopted as a pane in a tab).
  async start(space) {
    const base = ["run", "--bg", "--json", "--keep", "--rm", "--no-parent", "--label", `${LABEL}=${localId(space.id)}`];
    if (space.machine) base.push("--on", space.machine);
    const folder = folderFor(space);
    // A folder that's gone falls back to home: here, home(); with --on, that machine's.
    const tries = [folder && [...base, "--cwd", folder], space.machine ? base : [...base, "--cwd", home()]].filter(Boolean);
    let last = "";
    for (const args of tries) {
      const r = await hc(args);
      let address = null;
      try { address = JSON.parse(r.stdout).address; } catch {}
      if (r.code === 0 && address) return space.machine && !address.includes("/") ? `${space.machine}/${address}` : address;
      last = firstLine(r.stderr || r.stdout);
    }
    throw new Error(`Couldn't start a terminal: ${last || "hc run failed."}`);
  }

  writeBlocks(cx, wait) {
    this.chain = this.chain.then(() => this.write(cx, wait)).catch((e) => {
      notify({ title: "Quick terminal", body: `Couldn't update the layout: ${String(e?.message ?? e)}`, level: "error" });
    });
    return this.chain;
  }

  // Makes the stack hold one terminal block per remembered terminal, then
  // waits until the window has the block `wait` (when given).
  //
  // It edits the layout file, which the window reloads within a second: a file
  // edit changes only the fields it touches, so the panel's size, shown/hidden
  // and stack selection (clicks) stay. layout.set is the fallback.
  async write(cx, wait) {
    const want = blocksFor(readState().terms);
    const inWindow = () => same(find(layout(), STACK)?.children ?? [], want);
    if (!find(layout(), STACK)) return;
    const key = JSON.stringify(want);
    if (!inWindow() && key !== this.tried) {
      this.tried = key; // a write that didn't take isn't repeated for the same blocks
      const file = await this.layoutFile(want);
      if (file?.changed) {
        try { await writeTextFile(file.path, JSON.stringify(file.tree, null, 2) + "\n", file.text); } catch {}
      }
      if (!(await this.until(cx, inWindow, 2000)) && file) run("layout.set", { layout: file.tree });
      this.applied = null; // a reloaded layout: show or hide the panel again
      this.reconcile();
    }
    if (wait) await this.until(cx, () => Boolean(find(layout(), wait)), 2000);
  }

  // The shown layout's file with the stack's blocks replaced by `want`.
  async layoutFile(want) {
    const name = shared("layout");
    if (!name) return null;
    const path = `${appHome()}/layouts/${name}.json`;
    const text = await readTextFile(path);
    if (!text) return null;
    const tree = JSON.parse(text);
    const stack = find(tree, STACK);
    if (!stack) return null;
    const before = JSON.stringify(stack.children ?? []);
    stack.children = [...(stack.children ?? []).filter((c) => !isBlock(c)), ...want];
    return { path, text, tree, changed: JSON.stringify(stack.children) !== before };
  }

  async until(cx, test, ms) {
    for (let waited = 0; waited < ms; waited += 50) {
      if (test()) return true;
      await cx.sleep(50);
    }
    return test();
  }

  // Brings the panel in line with the shown space, and forgets terminals that
  // ended. Runs after every render; does nothing when nothing changed.
  reconcile(cx) {
    const s = readState();
    const live = new Set(terminals().map((t) => t.address));
    for (const a of live) this.known.add(a);
    let changed = false;
    for (const [space, address] of Object.entries(s.terms)) {
      const ended = this.known.has(address) && !live.has(address);
      // A space that closed while we watched takes its terminal with it, as its tabs do.
      const closed = this.seen.has(space) && !spaces().some((sp) => sp.id === space) && machineReady(machineOf(space));
      if (closed && !ended) run("terminal.kill", { terminal: address });
      if (ended || closed) {
        delete s.terms[space];
        delete s.open[space];
        this.known.delete(address);
        changed = true;
      }
    }
    for (const sp of spaces()) this.seen.add(sp.id);
    if (changed) setShared(STATE, s);
    if (cx) this.writeBlocks(cx, null);

    const space = shownSpace();
    const address = space && s.open[space.id] ? s.terms[space.id] : null;
    const want = address ? `${space.id}|${address}` : "";
    if (want === this.applied) return;
    const was = this.shownAddress;
    this.applied = want;
    this.shownAddress = address;
    if (address) {
      run("layout.select", { stack: STACK, child: childId(space.id) });
      run("layout.show", { id: PANEL });
    } else {
      const f = focused();
      const inPanel = Boolean(was) && Boolean(f) && !f.pane && f.terminal === was;
      run("layout.hide", { id: PANEL });
      if (inPanel) this.giveBack();
    }
  }

  // The keyboard goes back to the pane it came from, else the shown tab's first.
  giveBack() {
    const tab = focused()?.tab;
    const mine = panes().filter((p) => p.tab === tab);
    const p = mine.find((p) => p.pane === this.returnTo) ?? mine.find((p) => p.terminal) ?? mine[0];
    if (p) run("pane.focus", { pane: p.pane });
  }

  // ---- bar -----------------------------------------------------------------

  button(t, id, icon, onClick) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(svg(icon).size(14));
  }

  // Looks like Herdr's pane header: program, folder, buttons on hover.
  bar(t) {
    const space = shownSpace();
    const address = space ? readState().terms[space.id] : null;
    const term = address ? terminals().find((x) => x.address === address) : null;
    const p = term?.program;
    const pic = p?.icon ? (p.tint ? svg(p.icon).size(14).flex_none().text_color(t.dim) : image(p.icon).w(14).h(14).flex_none()) : null;
    return h_flex()
      .id("qt-bar")
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => { if (address) run("pane.focus", { terminal: address }); })
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(p?.name || term?.agent || "Terminal"))
      .child(div().flex_1().truncate().text_color(t.dim).child(folderLabel(term?.cwd)))
      .when(this.hovered && Boolean(space), (el) => el
        // Hide: it keeps running.
        .child(this.button(t, "qt-hide", "mods/workspace-chrome/chevron-down.svg", () => {
          const s = readState();
          delete s.open[space.id];
          setShared(STATE, s);
        }))
        // Close: ends it, as a pane header's × does.
        .child(this.button(t, "qt-close", "mods/pane/close.svg", () => {
          const s = readState();
          delete s.open[space.id];
          delete s.terms[space.id];
          setShared(STATE, s);
          if (address) run("terminal.kill", { terminal: address });
        })));
  }

  // ---- render --------------------------------------------------------------

  render(cx) {
    const t = theme();
    if (this.role === "bar") return this.bar(t);
    if (this.role === "empty") {
      return div().size_full().flex().items_center().justify_center().bg(t.background).text_size(12).text_color(t.dim).child("Starting a terminal…");
    }
    // The controller draws nothing; it reacts to what changed once this render is over.
    cx.timer.after(0, (cx) => this.reconcile(cx));
    return div();
  }
}
