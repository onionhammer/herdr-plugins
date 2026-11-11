# Branch picker

VS Code's "Checkout to…" for Herdr. Click the branch in the status bar, or press a key, and a popup drops from the top of the window: type to filter, ↑/↓ and Enter to switch. The same popup creates a branch (from here or from any ref), checks out a remote branch as a local branch that tracks it, goes to the space that already has a branch checked out in another worktree, and offers to stash local changes when they block a switch. Its last action row, "Cleanup old branches…", opens a dialog that fetches with `--prune` and deletes the local branches left behind by merged or deleted remote branches. It deletes only the branches you tick.

## What you see

**Switch branch popup** (`branch-picker`): a popup pinned to the top of the window, 40 px down, 620 px wide, at most 80% of the window high. It uses the `popover` background, 16 px padding, a 10 px gap and 13 px text. From top to bottom:

- **Header.** "Switch branch" in 15 px semibold `foreground`. Beside it, in 11.5 px `dim`: `<repo folder name> · <current branch>` (or `detached at <hash>`). On the right, a small "Esc" button (11 px `dim`; `hover` background on hover) closes it. The title changes to "Create new branch from…", `Create "<name>" from…` or "New branch from <ref>" in the other two modes.
- **Search field.** 36 px high, 9 px radius, a 1 px `accent` border on the `background` color. It has a 15 px search icon (a branch icon in name mode) and 12.8 px text. The placeholders are "Select a branch to switch to, or type a new name", "Select a ref to create the branch from" and "New branch name".
- **Error line.** Shown when git refused something: git's own message in 12 px `blocked`.
- **List.** A virtual list, at most 380 px high, with a scrollbar. Group titles are 28 px rows of 11 px semibold `dim` text, aligned to the bottom. Item rows are 32 px high with a 4 px side margin, 10 px padding and a 7 px radius. The selected row is `selected`, and hovered rows are `hover`. Every row has a 14 px icon. In order:
  1. *Stash changes and switch to `<branch>`*: an archive icon in `blocked`, with "they stay in git stash" on the right. It appears only after local changes blocked a switch.
  2. *Create new branch…*, or *Create new branch "`<typed>`"* when the typed text isn't a branch yet: a plus icon.
  3. *Create new branch from…*, or *Create new branch "`<typed>`" from…*: a plus icon.
  4. *Cleanup old branches…*: a trash icon. On the right is the key bound to `mod.open:branch-cleanup` (such as `Ctrl+Shift+D`), if there is one. The row hides when typed text doesn't match "cleanup old branches prune merged delete".
  5. **Branches** (local): the current branch comes first, with an `accent` check icon and a semibold name. The rest follow, newest commit first, with a branch icon, or a folder icon when the branch is checked out in another worktree. After the name comes `<short hash> · <commit subject>` in 11.5 px `dim`, then a `worktree` tag in 11 px `accent` when it applies, then the tracking state (`↑1 ↓2`) and the commit's age (`5m`, `3h`, `2d`, `4mo`, `1y`), both in 11 px `dim`.
  6. **Remote branches**: a cloud icon. The group lists only remote branches that no local branch has the same name as or tracks.
- **Footer.** 11 px `dim`: a braille spinner while git works, `<n> local · <m> remote`, and on the right the keys for the mode (`↑↓ choose · ↵ switch · esc close`).

**Cleanup old branches dialog** (`branch-cleanup`): a dialog, 620 × 540 px, on `popover`, with 16 px padding and a 10 px gap.

- **Header.** "Cleanup old branches" in 15 px semibold, then `<repo> · against <default branch>` in 11.5 px `dim`, then an "Esc" button.
- **Status line.** 12 px `muted`, with a spinner while it works: "Finding the repository…", then "Fetching and pruning remotes…", then "Pruned 2 remote branches · 3 leftover local branches" (or "No remote branches to prune").
- **Warnings.** These are in `blocked`: "Couldn't fetch (…): using what this computer already knows.", and git's error if a delete fails. If the repo has no default branch, a `dim` note says that only branches whose remote was deleted are listed.
- **List.** 34 px rows with a 7 px radius; the selected row is `selected`. Each row has a 15 px checkbox (`accent` with a check when ticked, otherwise an `input` border), the branch name (`foreground` when ticked, `muted` otherwise), `<hash> · <subject>` in 11.5 px `dim`, a reason tag in 11 px and the age right-aligned in 30 px. The reason tag reads `merged` in `done`, `remote deleted` in `working`, or `merged · still on origin` in `dim`. If the list is empty, it says "Nothing to clean up." in the middle.
- **Footer.** First, a `dim` note when branches checked out in other worktrees were left alone. Then the keys (`space tick · a all · ↵ delete · esc close`) and a 30 px button. With branches ticked, the button reads "Delete 3 branches" in `solid`/`solid_foreground`; with nothing ticked, it reads "Nothing ticked" in `raised`/`dim`.

**Status bar** (`branch-status`): a 28 px bar at the bottom of the work column, in `chrome` with a 1 px `border` line on top and 11.8 px `muted` text. From left to right:

- The machine: a monitor icon with "This computer", or a server icon with the machine's name.
- The branch, as a button: 20 px high, 6 px padding and a 5 px radius, with a 13 px branch icon. A detached HEAD shows `<hash> (detached)`. On hover, the background turns `hover` and the text `foreground`.
- `<n> agents` after a 6 px `dim` dot. When agents are blocked, `· <n> needs you` follows in `blocked`.
- On the right, the palette hint as bound (`Ctrl+Shift+P  commands`), in `dim`.

## How it behaves

**Which repo.** Props `{ cwd, on }` choose the folder and the machine (from `hc machine ls`; null means this computer). Without props, the mods look where the focused terminal is: the focused pane's live `cwd`, else `focused().cwd`, else the shown space's `folder`. The machine comes from the shown space, or from the `machine/` prefix of a focused terminal block's address. Every git command runs there through `exec(…, { on })`.

**Switch branch popup.**

- It opens with the search field focused and reads the branches with one `git for-each-ref --sort=-committerdate` over `refs/heads` and `refs/remotes`. "Reading branches…" shows until the read finishes. Outside a repo, it shows "`<folder>` is not in a git repository."
- Typing filters every list. Words are separated by spaces, matching ignores case, and every word must match. With text typed, the selection jumps to the first matching branch. With no text, it sits on the first row.
- ↑/↓ move the selection and wrap around. PgUp/PgDn move 8 rows and stop at the ends. When the first row of a group is selected, its group title stays in view. Enter or a click picks the selected row, and Esc closes the popup.
- **Picking the current branch** closes the popup.
- **Picking another local branch** runs `git switch <name>`, with a 120 s timeout.
- **Picking a remote branch** runs `git switch --track <remote>/<name>`, which makes a local branch of the short name that tracks it.
- **Picking a branch checked out in another worktree** closes the popup and selects the space whose first terminal is in that checkout. When checkouts are nested, the deepest one wins. If no space shows the checkout, `space.new { folder, machine }` opens one there.
- **When local changes block a switch** ("would be overwritten" / "commit your changes or stash them"), the error line explains it. A *Stash changes and switch to …* row appears first and is selected. Picking it runs `git stash push --include-untracked -m "before switching to <name>"`, then the switch, and posts a toast: "Switched to `<name>`. Your changes are in the stash: git stash pop brings them back."
- **Create new branch "x"** creates the branch at once. Spaces in the typed name become dashes. Plain *Create new branch…* goes to name mode instead: a field for the name, with "Creates the branch and switches to it. Spaces become dashes." under it. Enter runs `git switch -c <name>`.
- **Create new branch from…** goes to ref mode, which lists local branches, remote branches, and `HEAD` when HEAD is detached. Picking a ref goes to name mode, or creates the branch at once if a name was already typed. Either way it runs `git switch -c <name> --no-track <ref>`, so a feature branch made from `origin/main` doesn't pull `main`.
- **Cleanup old branches…** closes the popup and opens the cleanup dialog on the same repo.
- Every change shows the spinner and "working…" while git runs. When git succeeds, the popup closes. When git fails, git's message shows in the error line and the popup stays open.

**Cleanup old branches dialog.**

- It first runs `git fetch --all --prune`, with a 180 s timeout. It counts the `[deleted]` lines as pruned remote branches. If the fetch fails, it warns and carries on.
- The default branch is what `origin/HEAD` names, else the first of `origin/main`, `origin/master`, `main` and `master` that exists.
- It never offers `main`, `master`, `develop`, `development`, `dev`, `trunk`, `qa`, `staging`, `production` or `prod`, the current branch, or the default branch.
- Of the other local branches, it lists three kinds:
  - Merged into the default branch with no live upstream: `merged`, ticked.
  - Upstream `[gone]`, which is usually a squash-merged pull request: `remote deleted`, ticked.
  - Merged, but still on the remote: `merged · still on <remote>`, not ticked.
- Branches checked out in a worktree are skipped, and only counted in the note.
- Ticked rows come first, then the rest, newest first.
- ↑/↓ move the selection (wrapping). Space or a click ticks a row, `a` ticks or unticks every row, Enter deletes the ticked branches, and Esc closes the dialog. With an empty list, Enter closes it.
- Deleting runs a single `git branch -D <ticked…>`. It must be `-D`: `-d` refuses squash-merged branches and branches not merged into HEAD. A toast (`success`, 10 s) names up to six deleted branches with their hashes: "Deleted 3 branches. feat-x (1a2b3c4), …. To bring one back: git branch <name> <hash>." On success the dialog closes. On failure, git's first line shows and the list is read again.

**Status bar.**

- Every 400 ms it compares where the focused terminal is, and reads git only when that place changed. It runs `rev-parse --show-toplevel`, `rev-parse --git-common-dir` and `symbolic-ref HEAD`.
- For a repo on this computer, `watchFolder` watches the git common dir, so a switch made anywhere (the picker, a terminal, another app) shows at once. For a repo on another machine, it reads git again every 15 s.
- Until git first answers, it shows Herdr's own `space.branch` (so nothing flickers in), and the branch isn't clickable yet. Outside a repo, there is no branch item.
- A click on the branch opens the picker with `openOverlay({ mod: "branch-picker", kind: "popup", at: "top", offset: 40, width: 620, height: 0.8, props: { cwd: <repo top>, on } })`.
- Agent status counts only `blocked` (shown as "needs you"). Working, done and idle agents count only toward the `<n> agents` total.

## Built from

- **`mods/branch-picker/`**: `main.js`, `cloud.svg`, and `mod.json`, which is `{ "place": "none", "title": "Switch branch", "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 620, "height": 0.8 } }`, so `mod.open:branch-picker` opens it as that popup. Props are `{ cwd?, on? }`.
  - From `gpui-base`: `InputState` and `Input` (one input per mode, each listening for `change` and `submit`), `v_virtual_list` with `VirtualListScrollHandle`, and `Scrollbar.vertical`.
  - From `herdr`: `exec`, `run` (`space.select`, `space.new`), `props`, `closeOverlay`, `openOverlay`, `theme`, `notify`, `spaces`, `panes`, `focused`, `keys` and `window`.
- **`mods/branch-cleanup/`**: `main.js`, `trash.svg`, and `mod.json`, which is `{ "place": "none", "title": "Cleanup old branches", "overlay": { "kind": "dialog", "width": 620, "height": 540 } }`. Props are `{ cwd?, on? }`. It uses `ScrollHandle` from `gpui-base`, and `exec`, `props`, `closeOverlay`, `theme`, `notify`, `spaces`, `panes` and `focused` from `herdr`.
- **`mods/branch-status/`**: a clone of Herdr's shipped `workspace-status` (0.1.15, recorded in `cloned_from`) with the git reading and the branch button added. It uses `exec`, `watchFolder`, `openOverlay`, `spaces`, `panes`, `focused`, `agents`, `theme`, `run` (`app.palette`), `window` and `keys`.
- **Programs**: `git` only, run with `exec` on the repo's machine.
- **Art**: `cloud.svg` and `trash.svg` (24 px stroke icons, tinted). The rest come from the shipped `mods/workspace-chrome/` folder: `branch`, `check`, `plus`, `archive`, `folder`, `search`, `server` and `monitor`.
- **Ways to open it**:
  - In a layout whose status block uses `branch-status`, click the branch. To get one, `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`, then set the `status` block's `content.mod` to `"branch-status"` (that's the only change from `main`).
  - Or bind a free key in `keys.json`, which works in any layout: `"global": { "ctrl-shift-g": "mod.open:branch-picker" }`. Without props, the picker uses the focused terminal's repo. A `mod.open:branch-cleanup` binding opens the dialog directly, and the picker shows that key on its cleanup row.

## Watch out

- **Names are wired together.** The picker opens the overlay `branch-cleanup` and draws `mods/branch-cleanup/trash.svg`. The status bar opens `branch-picker`. If you rename a mod, rename those references too.
- **It relies on Herdr's own icons** in `mods/workspace-chrome/`, as shipped with Herdr 0.1.15. If a later Herdr renames them, the icons go blank.
- **Git version.** `rev-parse --path-format=absolute` needs git 2.31 or later; on an older git the mods say the folder is not in a repository. `%(worktreepath)` needs git 2.23; without it, both mods read the refs again without worktree info.
- **Paths.** git prints `C:/x/y` on Windows. Paths are compared with `/` separators, and Windows drive paths ignore case, before deciding whether a branch is checked out "here".
- **Focus.** An input mounts on the next frame. Without the follow-up `focus()` after a short timer (100 ms on open, 60 ms on a mode change), typing goes nowhere.
- **Fields.** Each `for-each-ref` line is split on tabs (`%09`). A ref name can't contain a tab but a commit subject can, so the subject is the last field and whatever is left over is joined back into it.
- **Remote repos.** The status bar can't watch another machine's folder, so a switch there shows within 15 s, not at once.
- **The status bar is a clone.** `branch-status` won't get Herdr's later changes to `workspace-status`.
- **Cleanup force-deletes** with `-D` and trusts its own merged/gone check. The toast's hashes are the way back. The list of long-lived branches it never offers is hard-coded at the top of `branch-cleanup/main.js`.
- **No key is bound by default.** The picker's cleanup row shows a key only if you bind `mod.open:branch-cleanup`.

## Done when

- `herdr-app check` passes for `mods/branch-picker`, `mods/branch-cleanup` and `mods/branch-status`.
- In a repo, the picker lists:
  - the current branch first, with a check,
  - then the other local branches, newest commit first, with hash, subject, ↑/↓ and age,
  - then only the remote branches with no local branch.
- Typing `fix login` shows *Create new branch "fix-login"*, and Enter creates and switches to `fix-login`.
- *Create new branch "x" from…* → `origin/main` makes `x` at `origin/main` with no upstream set.
- Picking a remote-only branch leaves a local branch of the same name that tracks it, and the popup closes.
- With a change that conflicts with the target branch, picking that branch shows the error and a selected *Stash changes and switch to …* row. Enter stashes, switches and posts the toast.
- A branch checked out in another worktree shows the `worktree` tag. Picking it selects that worktree's space, or opens a new one there.
- *Cleanup old branches…* opens the dialog on the same repo. It fetches and prunes, lists squash-merged branches as `remote deleted` (ticked), and Enter deletes them with a toast giving each hash.
- Running `git switch` in a terminal changes the status bar's branch within a second, and clicking it opens the picker on that repo.
