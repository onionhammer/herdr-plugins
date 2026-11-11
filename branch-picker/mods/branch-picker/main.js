// Switch branch: VS Code's "Checkout to…" for one repo. Opened by the status
// bar's branch item as a popup at the top. Props: { cwd, on }: where to run
// git (on: a machine from `hc machine ls`, null for this one).
//
// Type to filter; ↑/↓ and Enter switch; Esc leaves. The first rows create a
// branch (from here, or from another ref); then local branches, newest commit
// first; then remote branches with no local branch yet (picking one makes a
// local branch that tracks it). A branch checked out in another worktree opens
// that worktree's space instead. When local changes block a switch, a row
// offers to stash them and switch.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { exec, run, props, closeOverlay, openOverlay, theme, notify, spaces, panes, focused, keys, window } from "herdr";

const ROW = 32;
const HEAD = 28;
const MAX_LIST = 380;
const ICON = {
  branch: "mods/workspace-chrome/branch.svg",
  check: "mods/workspace-chrome/check.svg",
  plus: "mods/workspace-chrome/plus.svg",
  stash: "mods/workspace-chrome/archive.svg",
  folder: "mods/workspace-chrome/folder.svg",
  remote: "mods/branch-picker/cloud.svg",
  search: "mods/workspace-chrome/search.svg",
  cleanup: "mods/branch-cleanup/trash.svg",
};
const CLEANUP = "Cleanup old branches…";

// The key bound to the cleanup dialog, as people read it ("Ctrl+Shift+P"), or "".
function cleanupKey() {
  const mac = window()?.platform === "macos";
  const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
  const b = keys().find((k) => k.section === "global" && /^mod\.open:branch-cleanup$/.test(k.action));
  return b ? b.keys.split("-").map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("") : "";
}

// One line per ref; a tab can't be in a ref name, the subject goes last.
const FIELDS = ["%(refname)", "%(objectname:short)", "%(committerdate:unix)", "%(upstream:short)", "%(upstream:track,nobracket)", "%(worktreepath)", "%(contents:subject)"];

const ago = (s) => {
  if (!s) return "";
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : d < 86400 * 730 ? `${Math.round(d / 86400 / 30)}mo` : `${Math.round(d / 86400 / 365)}y`;
};
// Paths as git prints them (C:/x/y); Windows drives compare without case.
const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const same = (p) => (/^[a-z]:\//i.test(p) ? p.toLowerCase() : p);
const inside = (p, dir) => same(p) === same(dir) || same(p).startsWith(same(dir) + "/");
// "ahead 1, behind 2" as ↑1 ↓2.
const track = (s) => (s ?? "").replace(/ahead (\d+)/, "↑$1").replace(/behind (\d+)/, "↓$1").replace(/,\s*/, " ");

// Where the focused terminal is (as the Changes panel looks), else the shown space's folder.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

async function git(cwd, on, args, timeout) {
  const r = await exec("git", args, { cwd, on: on ?? undefined, ...(timeout ? { timeout } : {}) });
  return { ok: r.code === 0, out: (r.stdout ?? "").replace(/\s+$/, ""), err: (r.stderr || r.stdout || "").trim() };
}

export default class BranchPicker extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.where = p.cwd ? { cwd: p.cwd, on: p.on ?? null } : location();
    this.repo = undefined; // undefined: looking; null: not in git
    this.current = null; // the branch checked out here (null: detached)
    this.detached = null; // HEAD's short hash when detached
    this.locals = [];
    this.remotes = [];
    this.mode = "pick"; // pick | from (a ref to start a new branch from) | name (the new branch's name)
    this.base = null; // name mode: the ref the new branch starts from (null: HEAD)
    this.pendingName = null; // from mode: the name already typed
    this.blocked = null; // the row whose switch local changes stopped
    this.busy = false;
    this.error = "";
    this.at = 0;
    this.filter = "";
    this.inputs = {
      pick: InputState.new({ placeholder: "Select a branch to switch to, or type a new name" }),
      from: InputState.new({ placeholder: "Select a ref to create the branch from" }),
      name: InputState.new({ placeholder: "New branch name" }),
    };
    for (const [mode, input] of Object.entries(this.inputs)) {
      input.on("change", (_e, cx) => {
        if (this.mode !== mode) return;
        this.filter = input.value();
        this.error = "";
        this.blocked = null;
        this.at = this.firstPick();
        this.scroll.scroll_to_item(0);
        cx.notify();
      });
      input.on("submit", (_e, cx) => {
        if (this.mode !== mode) return;
        if (mode === "name") this.createNamed(cx);
        else this.choose(this.picks()[this.at], cx);
      });
    }
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.inputs.pick.focus();
    cx.timer.after(100, () => this.inputs[this.mode].focus());
    cx.spawn(async (cx) => {
      try { await this.load(); } catch (e) { this.repo = null; this.error = String(e?.message ?? e); }
      this.at = this.firstPick();
      cx.notify();
      this.inputs[this.mode].focus();
    });
  }

  async load() {
    const { cwd, on } = this.where;
    if (!cwd) { this.repo = null; return; }
    const top = await git(cwd, on, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
    if (!top.ok) { this.repo = null; return; }
    const dir = top.out;
    const refsWith = (fields) => git(dir, on, ["for-each-ref", "--sort=-committerdate", `--format=${fields.join("%09")}`, "refs/heads", "refs/remotes"]);
    const [head, first] = await Promise.all([git(dir, on, ["symbolic-ref", "-q", "--short", "HEAD"]), refsWith(FIELDS)]);
    // %(worktreepath) needs git 2.23+; an older git (another machine) lists refs without it.
    const refs = first.ok ? first : await refsWith(FIELDS.map((f) => (f === "%(worktreepath)" ? "" : f)));
    if (!refs.ok) throw new Error(refs.err || "git for-each-ref failed.");
    this.current = head.ok ? head.out : null;
    if (!this.current) this.detached = (await git(dir, on, ["rev-parse", "--short", "HEAD"])).out || null;
    const locals = [], remotes = [];
    for (const line of refs.out.split("\n").filter(Boolean)) {
      const [ref, sha, at, upstream, tracking, worktree, ...subject] = line.split("\t");
      const b = { sha, at: Number(at) || 0, upstream, track: track(tracking), subject: subject.join("\t") };
      if (ref.startsWith("refs/heads/")) {
        b.name = ref.slice(11);
        // Checked out in another worktree: git won't switch to it here.
        b.worktree = worktree && same(norm(worktree)) !== same(dir) ? norm(worktree) : null;
        locals.push(b);
      } else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) {
        b.name = ref.slice(13);
        b.short = b.name.slice(b.name.indexOf("/") + 1);
        remotes.push(b);
      }
    }
    // The current branch first, then newest commit first.
    locals.sort((a, b) => (b.name === this.current) - (a.name === this.current));
    this.locals = locals;
    this.remotes = remotes;
    this.repo = { top: dir, on, name: dir.split("/").pop() };
  }

  // Every row of the shown mode, headers included.
  rows() {
    const f = this.filter.trim();
    const terms = f.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (name) => terms.every((t) => name.toLowerCase().includes(t));
    const out = [];
    const local = (b) => ({ kind: "local", key: `l:${b.name}`, b });
    const remote = (b) => ({ kind: "remote", key: `r:${b.name}`, b });
    if (!this.repo) return out;
    if (this.mode === "name") return out;
    const locals = this.locals.filter((b) => match(b.name));
    if (this.mode === "from") {
      const remotes = this.remotes.filter((b) => match(b.name));
      if (this.current === null && this.detached && match("HEAD")) out.push({ kind: "head-ref", key: "x:HEAD" });
      if (locals.length) out.push({ kind: "head", key: "h:local", label: "Branches" }, ...locals.map(local));
      if (remotes.length) out.push({ kind: "head", key: "h:remote", label: "Remote branches" }, ...remotes.map(remote));
      return out;
    }
    if (this.blocked) out.push({ kind: "action", key: "a:stash", act: "stash", label: `Stash changes and switch to ${this.label(this.blocked)}`, icon: "stash", detail: "they stay in git stash" });
    // A typed name that isn't a branch yet can be created as it is (spaces as dashes, as VS Code does).
    const name = f.replace(/\s+/g, "-");
    const fresh = name && !this.locals.some((b) => b.name === name);
    out.push({ kind: "action", key: "a:create", act: "create", name: fresh ? name : null, label: fresh ? `Create new branch "${name}"` : "Create new branch…", icon: "plus" });
    out.push({ kind: "action", key: "a:from", act: "from", name: fresh ? name : null, label: fresh ? `Create new branch "${name}" from…` : "Create new branch from…", icon: "plus" });
    if (!terms.length || match(`${CLEANUP} prune merged delete`)) out.push({ kind: "action", key: "a:cleanup", act: "cleanup", label: CLEANUP, icon: "cleanup", detail: cleanupKey() });
    // A remote branch with a local one already (same name, or tracked) would only repeat it.
    const tracked = new Set(this.locals.flatMap((b) => [b.upstream, ...this.remoteNames(b.name)]));
    const remotes = this.remotes.filter((b) => !tracked.has(b.name) && match(b.name));
    if (locals.length) out.push({ kind: "head", key: "h:local", label: "Branches" }, ...locals.map(local));
    if (remotes.length) out.push({ kind: "head", key: "h:remote", label: "Remote branches" }, ...remotes.map(remote));
    return out;
  }

  remoteNames(name) {
    return this.remotes.filter((r) => r.short === name).map((r) => r.name);
  }

  picks() {
    return this.rows().filter((r) => r.kind !== "head");
  }

  // Where the selection starts: the stash offer, else (when typing) the first
  // matching branch, else the first row, as VS Code does.
  firstPick() {
    const picks = this.picks();
    if (this.blocked || !this.filter.trim() || this.mode !== "pick") return 0;
    const i = picks.findIndex((r) => r.kind === "local" || r.kind === "remote");
    return i >= 0 ? i : 0;
  }

  label(r) {
    return r.kind === "remote" ? r.b.short : r.b.name;
  }

  close() {
    closeOverlay(props().overlay);
  }

  setMode(mode, cx, extra = {}) {
    this.mode = mode;
    Object.assign(this, extra);
    this.filter = "";
    this.error = "";
    this.blocked = null;
    const input = this.inputs[mode];
    input.set_value(mode === "name" && this.pendingName ? this.pendingName : "");
    this.filter = input.value();
    this.at = 0;
    this.scroll.scroll_to_item(0);
    input.focus();
    // The new input mounts on the next frame; focus it again once it's there.
    cx.timer.after(60, () => this.inputs[this.mode].focus());
    cx.notify();
  }

  choose(r, cx) {
    if (!r || this.busy || !this.repo) return;
    if (this.mode === "from") {
      const base = r.kind === "head-ref" ? "HEAD" : r.b.name;
      if (this.pendingName) return this.act(cx, () => this.create(this.pendingName, base));
      return this.setMode("name", cx, { base });
    }
    if (r.kind === "action") {
      if (r.act === "stash") return this.act(cx, () => this.switchTo(this.blocked, true));
      if (r.act === "create") return r.name ? this.act(cx, () => this.create(r.name, null)) : this.setMode("name", cx, { base: null, pendingName: null });
      if (r.act === "from") return this.setMode("from", cx, { pendingName: r.name });
      if (r.act === "cleanup") {
        this.close();
        openOverlay({ mod: "branch-cleanup", kind: "dialog", width: 620, height: 540, props: { cwd: this.repo.top, on: this.repo.on } });
        return;
      }
      return;
    }
    if (r.kind === "local" && r.b.name === this.current) return this.close();
    if (r.kind === "local" && r.b.worktree) return this.openWorktree(r.b.worktree);
    this.act(cx, () => this.switchTo(r, false));
  }

  createNamed(cx) {
    const name = this.inputs.name.value().trim().replace(/\s+/g, "-");
    if (!name) { this.error = "Type a branch name."; return cx.notify(); }
    this.act(cx, () => this.create(name, this.base));
  }

  // Runs one git change: closes on success, else shows what git said.
  act(cx, work) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.error = await work(); } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      if (!this.error) return this.close();
      if (this.blocked) this.at = 0;
      cx.notify();
    });
  }

  async switchTo(r, stash) {
    const { top, on } = this.repo;
    const name = this.label(r);
    this.blocked = null;
    if (stash) {
      const s = await git(top, on, ["stash", "push", "--include-untracked", "-m", `before switching to ${name}`]);
      if (!s.ok) return s.err || "git stash failed.";
    }
    // A remote branch becomes a local branch of its short name that tracks it.
    const res = await git(top, on, r.kind === "remote" ? ["switch", "--track", r.b.name] : ["switch", r.b.name], 120_000);
    if (res.ok) {
      if (stash) notify({ title: `Switched to ${name}`, body: "Your changes are in the stash: git stash pop brings them back.", level: "info" });
      return "";
    }
    if (stash) return `${res.err || "git switch failed."}\nYour changes are in the stash (git stash pop).`;
    if (/would be overwritten|commit your changes or stash them/i.test(res.err)) {
      this.blocked = r;
      return `Local changes would be overwritten by switching to ${name}.`;
    }
    return res.err || "git switch failed.";
  }

  async create(name, base) {
    const { top, on } = this.repo;
    // From another ref, the new branch doesn't track it (a feature branch from origin/main shouldn't pull main).
    const res = await git(top, on, ["switch", "-c", name, ...(base && base !== "HEAD" ? ["--no-track", base] : [])], 120_000);
    return res.ok ? "" : res.err || "git switch -c failed.";
  }

  // The space showing that checkout (the deepest checkout wins), else a new one there.
  openWorktree(path) {
    this.close();
    const on = this.repo.on ?? null;
    const all = [this.repo.top, ...this.locals.map((b) => b.worktree).filter(Boolean)];
    const paneList = panes();
    const s = spaces().find((s) => {
      if ((s.machine ?? null) !== on) return false;
      const at = norm(place(s, paneList));
      if (!at || !inside(at, path)) return false;
      return !all.some((c) => c !== path && c.length > path.length && inside(at, c));
    });
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: path, machine: on ?? "" });
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    const n = this.picks().length;
    if (!n) return;
    const step = { down: 1, up: -1, pagedown: 8, pageup: -8 }[e.key];
    if (step === undefined) return;
    this.at = Math.abs(step) === 1 ? (this.at + step + n) % n : Math.max(0, Math.min(n - 1, this.at + step));
    const rows = this.rows();
    const i = rows.indexOf(rows.filter((r) => r.kind !== "head")[this.at]);
    // Keep a group's title in view when its first row is selected.
    this.scroll.scroll_to_item(i > 0 && rows[i - 1].kind === "head" ? i - 1 : i);
    cx.stop_propagation();
    cx.notify();
  }

  row(r, sel, t) {
    if (r.kind === "head") {
      return h_flex().h(HEAD).px(14).pb(4).items_end().text_size(11).font_semibold().text_color(t.dim).child(r.label);
    }
    const on = r === sel;
    const base = h_flex().h(ROW).mx(4).px(10).gap(10).items_center().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)));
    const icon = (name, color) => svg(ICON[name]).size(14).flex_none().text_color(color);
    const dim = (text) => div().flex_none().text_size(11).text_color(t.dim).child(text);
    if (r.kind === "action") {
      return base
        .child(icon(r.icon, r.act === "stash" ? t.blocked : t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.label))
        .when(Boolean(r.detail), (el) => el.child(dim(r.detail)));
    }
    if (r.kind === "head-ref") {
      return base
        .child(icon("branch", t.muted))
        .child(div().flex_none().text_color(t.foreground).child("HEAD"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`detached at ${this.detached}`));
    }
    const b = r.b;
    const here = r.kind === "local" && b.name === this.current;
    return base
      .child(icon(here ? "check" : r.kind === "remote" ? "remote" : b.worktree ? "folder" : "branch", here ? t.accent : t.muted))
      .child(div().min_w(0).truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()).child(b.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${b.sha}${b.subject ? ` · ${b.subject}` : ""}`))
      .when(Boolean(b.worktree) && this.mode === "pick", (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("worktree")))
      .when(Boolean(b.track), (el) => el.child(dim(b.track)))
      .child(dim(ago(b.at)));
  }

  title() {
    if (this.mode === "from") return this.pendingName ? `Create "${this.pendingName}" from…` : "Create new branch from…";
    if (this.mode === "name") return `New branch from ${this.base && this.base !== "HEAD" ? this.base : this.current ?? "HEAD"}`;
    return "Switch branch";
  }

  render() {
    const t = theme();
    const r = this.repo;
    const rows = this.rows();
    const picks = rows.filter((x) => x.kind !== "head");
    this.at = Math.max(0, Math.min(this.at, picks.length - 1));
    const sel = picks[this.at];
    const sizes = rows.map((x) => (x.kind === "head" ? HEAD : ROW));
    const total = sizes.reduce((a, b) => a + b, 0);
    const where = r ? `${r.name} · ${this.current ?? (this.detached ? `detached at ${this.detached}` : "")}` : "";
    const hint = this.busy ? "working…" : this.mode === "name" ? "↵ create · esc close" : this.mode === "from" ? "↑↓ choose · ↵ pick · esc close" : "↑↓ choose · ↵ switch · esc close";
    return v_flex()
      .id("branch-picker")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex().gap(10).items_center()
          .child(div().flex_none().text_size(15).font_semibold().text_color(t.foreground).child(this.title()))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where))
          .child(div().id("bp-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")),
      )
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg(this.mode === "name" ? ICON.branch : ICON.search).size(15).text_color(t.dim))
          .child(Input.new(this.inputs[this.mode]).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(4).text_size(12).text_color(t.blocked).child(this.error)))
      .when(r === undefined, (el) => el.child(div().px(4).py(6).text_color(t.muted).child("Reading branches…")))
      .when(r === null && !this.error, (el) => el.child(div().px(4).py(6).text_color(t.muted).child(`${this.where.cwd ?? "This folder"} is not in a git repository.`)))
      .when(Boolean(r) && this.mode === "name", (el) =>
        el.child(div().px(4).text_size(12).text_color(t.dim).child("Creates the branch and switches to it. Spaces become dashes.")))
      .when(Boolean(r) && this.mode !== "name" && rows.length > 0, (el) =>
        el.child(
          div().relative().h(Math.min(MAX_LIST, total)).flex_none()
            .child(
              v_virtual_list("bp-list", rows.length, sizes, (i) => rows[i].key, (range) => rows.slice(range.start, range.end).map((x) => this.row(x, sel, t)))
                .track_scroll(this.scroll)
                .on_item_click((key, cx) => this.choose(rows.find((x) => x.key === key && x.kind !== "head"), cx))
                .size_full(),
            )
            .child(Scrollbar.vertical("bp-list").absolute().inset_0()),
        ))
      .when(Boolean(r) && this.mode === "from" && rows.length === 0, (el) => el.child(div().px(4).py(6).text_color(t.dim).child("No matching refs.")))
      .child(
        h_flex().gap(6).text_size(11).text_color(t.dim)
          .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
          .child(div().flex_1().child(r ? `${this.locals.length} local · ${this.remotes.length} remote` : ""))
          .child(hint),
      );
  }
}
