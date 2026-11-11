import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, agents, theme, run, window, keys, exec, watchFolder, openOverlay } from "herdr";

// The branch item follows the focused terminal's folder (as the Changes panel
// does), else the shown space's folder, and reads git itself so a switch made
// anywhere (the picker, a terminal, another app) shows at once.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on };
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.git = undefined; // undefined: not read yet; null: not in git; else { top, common, branch, sha, on }
    this.where = null;
    this.look(cx);
    // Cheap: compares the focused folder, reads git only when it moved.
    cx.timer.every(400, (cx) => this.look(cx));
    // Another machine's repo can't be watched: look again now and then.
    cx.timer.every(15000, (cx) => { if (this.git?.on) this.refresh(cx); });
  }

  look(cx) {
    const where = JSON.stringify(location());
    if (where === this.where) return;
    this.where = where;
    this.refresh(cx);
  }

  // One read at a time; a request meanwhile reads again after it.
  refresh(cx) {
    if (this.reading) { this.again = true; return; }
    this.reading = true;
    const where = this.where;
    const { cwd, on } = JSON.parse(where);
    cx.spawn(async (cx) => {
      let info = null;
      try {
        if (cwd) {
          const opts = { cwd, on: on ?? undefined };
          // Ref-only reads: nothing under .git changes, so the folder watch stays quiet.
          const [top, common, head] = await Promise.all([
            exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], opts),
            exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], opts),
            exec("git", ["symbolic-ref", "-q", "--short", "HEAD"], opts),
          ]);
          if (top.code === 0 && common.code === 0) {
            const branch = head.code === 0 ? head.stdout.trim() : null;
            const sha = branch ? null : (await exec("git", ["rev-parse", "--short", "HEAD"], opts)).stdout.trim() || null;
            info = { top: top.stdout.trim(), common: common.stdout.trim(), branch, sha, on: on ?? null };
          }
        }
      } catch {
        info = this.git ?? null; // the machine is away: keep what it showed
      }
      this.reading = false;
      if (where === this.where) {
        const changed = JSON.stringify(info) !== JSON.stringify(this.git);
        this.git = info;
        if (info && !info.on) this.watch(info.common, cx);
        if (changed) cx.notify();
      }
      if (this.again) { this.again = false; this.refresh(cx); }
    });
  }

  watch(dir, cx) {
    if (this.watched === dir) return;
    this.watched = dir;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === dir) {
          await watchFolder(dir);
          if (this.watched === dir) this.refresh(cx);
        }
      } catch { if (this.watched === dir) this.watched = null; }
    });
  }

  openBranches() {
    const g = this.git;
    if (!g) return;
    openOverlay({ mod: "branch-picker", kind: "popup", at: "top", offset: 40, width: 620, height: 0.8, props: { cwd: g.top, on: g.on } });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    // Until git answers, Herdr's own idea of the branch, so nothing flickers in.
    const g = this.git;
    const branch = g === undefined ? space?.branch : g ? g.branch ?? (g.sha ? `${g.sha} (detached)` : null) : null;
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      // A status-bar button, as in VS Code: click to switch or create a branch.
      .when(Boolean(branch), el => el.child(
        h_flex().id("branch").h(20).px(6).gap(6).items_center().rounded(5)
          .when(Boolean(g), (b) => b.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.openBranches()))
          .child(svg("mods/workspace-chrome/branch.svg").size(13))
          .child(branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
