// Clean up branches. Fetches with --prune (remote branches deleted on the
// server go here too), then lists local branches left over from finished work:
// merged into the default branch, or whose remote branch was deleted (a merged
// pull request, often squashed, so git can't see it as merged). Nothing is
// deleted until you confirm: tick what to delete, Enter deletes.
//
// Props: { cwd, on } (where to run git), else the focused terminal's repo.
// Opened from the branch picker (its "Cleanup old branches…" row).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, props, closeOverlay, theme, notify, spaces, panes, focused } from "herdr";

// Long-lived branches: never offered, merged or not.
const KEEP = new Set(["main", "master", "develop", "development", "dev", "trunk", "qa", "staging", "production", "prod"]);
const FIELDS = ["%(refname:short)", "%(upstream:short)", "%(upstream:track)", "%(worktreepath)", "%(objectname:short)", "%(committerdate:unix)", "%(contents:subject)"];
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ago = (s) => {
  if (!s) return "";
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : d < 86400 * 730 ? `${Math.round(d / 86400 / 30)}mo` : `${Math.round(d / 86400 / 365)}y`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;
const firstLine = (s) => (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";

// Where the focused terminal is (as the Changes panel looks), else the shown space's folder.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

async function git(cwd, on, args, timeout) {
  const r = await exec("git", args, { cwd, on: on ?? undefined, ...(timeout ? { timeout } : {}) });
  const out = (r.stdout ?? "").replace(/\s+$/, ""), err = (r.stderr ?? "").trim();
  return { ok: r.code === 0, out, err: err || out, all: `${out}\n${err}` };
}

export default class BranchCleanup extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.where = p.cwd ? { cwd: p.cwd, on: p.on ?? null } : location();
    this.phase = "fetch"; // fetch | review | delete | none (not in git)
    this.repo = null;
    this.base = null;
    this.rows = [];
    this.skipped = 0;
    this.pruned = [];
    this.warning = "";
    this.error = "";
    this.at = 0;
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
    cx.spawn(async (cx) => {
      try { await this.load(cx); } catch (e) { this.error = String(e?.message ?? e); this.phase = this.repo ? "review" : "none"; }
      cx.notify();
      this.handle.focus();
    });
  }

  async load(cx) {
    const { cwd, on } = this.where;
    const top = cwd ? await git(cwd, on, ["rev-parse", "--path-format=absolute", "--show-toplevel"]) : { ok: false };
    if (!top.ok) { this.phase = "none"; return; }
    const dir = top.out;
    this.repo = { top: dir, on, name: dir.split("/").pop() };
    cx.notify();
    // Prune first, so a remote branch deleted on the server reads as gone below.
    const fetch = await git(dir, on, ["fetch", "--all", "--prune"], 180_000);
    this.pruned = [...fetch.all.matchAll(/\[deleted\].*->\s*(\S+)/g)].map((m) => m[1]);
    if (!fetch.ok) this.warning = `Couldn't fetch (${firstLine(fetch.err)}): using what this computer already knows.`;
    await this.analyze();
    this.phase = "review";
  }

  // The default branch: what origin/HEAD names, else main or master.
  async findBase(dir, on) {
    const head = await git(dir, on, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
    if (head.ok && head.out) return head.out;
    for (const ref of ["origin/main", "origin/master", "main", "master"]) {
      if ((await git(dir, on, ["rev-parse", "-q", "--verify", `${ref}^{commit}`])).ok) return ref;
    }
    return null;
  }

  async analyze() {
    const { top: dir, on } = this.repo;
    this.base = await this.findBase(dir, on);
    const refsWith = (fields) => git(dir, on, ["for-each-ref", `--format=${fields.join("%09")}`, "refs/heads"]);
    const [head, first, merged] = await Promise.all([
      git(dir, on, ["symbolic-ref", "-q", "--short", "HEAD"]),
      refsWith(FIELDS),
      this.base ? git(dir, on, ["for-each-ref", "--merged", this.base, "--format=%(refname:short)", "refs/heads"]) : Promise.resolve({ ok: true, out: "" }),
    ]);
    // %(worktreepath) needs git 2.23+.
    const refs = first.ok ? first : await refsWith(FIELDS.map((f) => (f === "%(worktreepath)" ? "" : f)));
    if (!refs.ok) throw new Error(refs.err || "git for-each-ref failed.");
    const current = head.ok ? head.out : null;
    const mergedSet = new Set(merged.ok ? merged.out.split("\n").filter(Boolean) : []);
    const baseName = this.base?.includes("/") ? this.base.slice(this.base.indexOf("/") + 1) : this.base;
    const rows = [];
    this.skipped = 0;
    for (const line of refs.out.split("\n").filter(Boolean)) {
      const [name, upstream, tracking, worktree, sha, at, ...subject] = line.split("\t");
      if (KEEP.has(name) || name === current || name === baseName) continue;
      const gone = tracking === "[gone]";
      const isMerged = mergedSet.has(name);
      const live = Boolean(upstream) && !gone;
      let reason = null, checked = false;
      if (isMerged && !live) [reason, checked] = ["merged", true];
      else if (gone) [reason, checked] = ["remote deleted", true];
      else if (isMerged) [reason, checked] = [`merged · still on ${upstream.split("/")[0]}`, false];
      if (!reason) continue;
      // Checked out in a worktree: git won't delete it (remove the worktree first).
      if (worktree) { this.skipped++; continue; }
      rows.push({ name, sha, at: Number(at) || 0, subject: subject.join("\t"), reason, merged: isMerged, checked });
    }
    rows.sort((a, b) => b.checked - a.checked || b.at - a.at);
    this.rows = rows;
    this.at = 0;
  }

  close() {
    closeOverlay(props().overlay);
  }

  picked() {
    return this.rows.filter((r) => r.checked);
  }

  toggle(r, cx) {
    if (!r || this.phase !== "review") return;
    r.checked = !r.checked;
    cx.notify();
  }

  toggleAll(cx) {
    if (this.phase !== "review") return;
    const on = this.picked().length < this.rows.length;
    for (const r of this.rows) r.checked = on;
    cx.notify();
  }

  remove(cx) {
    if (this.phase !== "review") return;
    const pick = this.picked();
    if (!this.rows.length) return this.close();
    if (!pick.length) return;
    this.phase = "delete";
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const { top: dir, on } = this.repo;
      // Each was checked against the default branch above: -d would refuse a
      // merged branch that isn't merged into HEAD, and every squashed one.
      const r = await git(dir, on, ["branch", "-D", ...pick.map((p) => p.name)]);
      const deleted = [...r.all.matchAll(/Deleted branch (\S+) \(was (\w+)\)/g)].map((m) => ({ name: m[1], sha: m[2] }));
      if (deleted.length) {
        const list = deleted.slice(0, 6).map((d) => `${d.name} (${d.sha})`).join(", ") + (deleted.length > 6 ? `, +${deleted.length - 6} more` : "");
        notify({ title: `Deleted ${plural(deleted.length, "branch")}`, body: `${list}. To bring one back: git branch <name> <hash>.`, level: "success", timeout: 10000 });
      }
      if (r.ok) return this.close();
      this.error = firstLine(r.err) || "git branch -D failed.";
      try { await this.analyze(); } catch {}
      this.phase = "review";
      cx.notify();
    });
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.phase !== "review") return;
    const n = this.rows.length;
    if (e.key === "enter") return this.remove(cx);
    if (e.key === "space") this.toggle(this.rows[this.at], cx);
    else if (e.key === "a" && !e.modifiers.control) this.toggleAll(cx);
    else if ((e.key === "down" || e.key === "up") && n) {
      this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      this.scroll.scroll_to_item(this.at);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  checkbox(on, t) {
    return div().size(15).flex_none().rounded(4).border_1().items_center().justify_center().flex()
      .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
      .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground)));
  }

  row(r, i, t) {
    const on = i === this.at;
    const tag = r.reason === "merged" ? t.done : r.reason === "remote deleted" ? t.working : t.dim;
    return h_flex()
      .id(`bc-${r.name}`)
      .flex_none()
      .h(34)
      .px(10)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.at = i; this.toggle(r, cx); })
      .child(this.checkbox(r.checked, t))
      .child(div().min_w(0).truncate().text_color(r.checked ? t.foreground : t.muted).child(r.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${r.sha}${r.subject ? ` · ${r.subject}` : ""}`))
      .child(div().flex_none().text_size(11).text_color(tag).child(r.reason))
      .child(div().flex_none().w(30).text_size(11).text_color(t.dim).text_right().child(ago(r.at)));
  }

  render() {
    const t = theme();
    const pick = this.picked().length;
    const busy = this.phase === "fetch" || this.phase === "delete";
    const summary = [
      this.pruned.length ? `Pruned ${plural(this.pruned.length, "remote branch")}` : "No remote branches to prune",
      this.rows.length ? `${plural(this.rows.length, "leftover local branch")}` : null,
    ].filter(Boolean).join(" · ");
    const status =
      this.phase === "fetch" ? (this.repo ? "Fetching and pruning remotes…" : "Finding the repository…")
        : this.phase === "delete" ? `Deleting ${plural(pick, "branch")}…`
          : summary;
    return v_flex()
      .id("branch-cleanup")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex().gap(10).items_center()
          .child(div().flex_none().text_size(15).font_semibold().text_color(t.foreground).child("Cleanup old branches"))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(this.repo ? `${this.repo.name}${this.base ? ` · against ${this.base}` : ""}` : ""))
          .child(div().id("bc-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")),
      )
      .when(this.phase === "none", (el) => el.child(div().text_color(t.muted).child(`${this.where.cwd ?? "This folder"} is not in a git repository.`)))
      .when(this.phase !== "none", (el) =>
        el.child(h_flex().gap(8).items_center().text_size(12).text_color(t.muted)
          .when(busy, (r) => r.child(div().frames(SPIN, 90)))
          .child(status)))
      .when(Boolean(this.warning), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.warning)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .when(this.phase === "review" && !this.base, (el) => el.child(div().text_size(12).text_color(t.dim).child("No default branch found (origin/HEAD, main or master): only branches whose remote was deleted are listed.")))
      .when(this.phase !== "none" && this.phase !== "fetch", (el) =>
        el.child(
          this.rows.length
            ? v_flex().id("bc-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
              .children(this.rows.map((r, i) => this.row(r, i, t)))
            : div().flex_1().pt(24).text_center().text_color(t.dim).child("Nothing to clean up."),
        ))
      .when(this.phase === "fetch", (el) => el.child(div().flex_1()))
      .when(this.skipped > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`${plural(this.skipped, "branch")} checked out in other worktrees left alone (remove the worktree first).`)))
      .child(
        h_flex().gap(10).items_center().text_size(11).text_color(t.dim)
          .child(div().flex_1().child(this.phase === "review" && this.rows.length ? "space tick · a all · ↵ delete · esc close" : "esc close"))
          .when(this.phase === "review" && this.rows.length > 0, (el) =>
            el.child(
              div().id("bc-delete").h(30).px(14).flex().items_center().rounded(8).text_size(12)
                .bg(pick ? t.solid : t.raised).text_color(pick ? t.solid_foreground : t.dim)
                .when(pick > 0, (b) => b.cursor_pointer())
                .on_click((_e, cx) => this.remove(cx))
                .child(pick ? `Delete ${plural(pick, "branch")}` : "Nothing ticked"),
            )),
      );
  }
}
