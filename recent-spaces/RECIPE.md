# Open recent

VS Code's Ctrl+R ("Open Recent") for Herdr's spaces. Press Ctrl+R, and a popup drops from the top of the window with the spaces you've closed, most recently used first. Spaces that are open now aren't listed. Type to filter, then use ↑/↓ and Enter, and a new space opens there with a terminal: in the same folder, on the same machine, with its name back if you'd named it. As in VS Code, holding Ctrl and pressing R again moves down the list, and letting go of Ctrl opens the pick.

## What you see

- **A popup pinned to the top of the window**, 40 px down, 620 px wide, at most 80% of the window high. It uses the `popover` background, 16 px padding, a 10 px gap and 13 px text, the same look as the [branch picker](../branch-picker/).
- **Header.** "Open recent" in 15 px semibold `foreground`, then "closed spaces, last used first" in 11.5 px `dim`. On the right, a small "Esc" button (11 px `dim`, `hover` background on hover) closes it.
- **Search field.** 36 px high with a 9 px radius and a 1 px `accent` border on `background`. It has a 15 px search icon, 12.8 px text and the placeholder "Reopen a closed space: type to filter".
- **Error line.** 12 px `blocked`, shown only when a pick can't open: "`<folder>` isn't there anymore. Its × takes it off the list." or "`<machine>` isn't connected right now."
- **List.** Rows are 32 px high, with a 4 px side margin, 10 px padding and a 7 px radius. The selected row is `selected` and hovered rows are `hover`. It shows up to 12 rows (384 px), then scrolls with a scrollbar. Each row, left to right:
  - a 14 px folder icon (`mods/workspace-chrome/folder.svg`), or a server icon for a space on another machine, in `muted`,
  - the space's name in `foreground` (at most 220 px, truncated): the name you gave it, or the name Herdr showed for it (its repo or folder),
  - the folder in 11.5 px `dim`, with your home as `~` on this computer and the full path on another machine,
  - for another machine, its name in 11 px `accent`, or "`<machine>` · offline" in `dim` when it isn't connected,
  - how long ago it was last used, in 11 px `dim` (`now`, `5m`, `3h`, `2d`, `4mo`, `1y`). Spaces from Herdr's own list (see How it behaves) have no time,
  - on the selected row and the hovered row, a 12 px × (`mods/pane/close.svg`, `dim`, `hover` background under the pointer). Other rows keep a 16 px gap there so nothing shifts.
- **Empty list.** "No closed spaces yet. Spaces you close show up here, last used first." in `dim`, or "No closed space matches." when typed text matches nothing.
- **Footer.** 11 px `dim`: a braille spinner and "opening…" while it checks the folder, "Ctrl+R again: next · let go of Ctrl to open" on the left, and "↑↓ choose · ↵ open · esc close" on the right.
- **Nothing else.** The copy that takes the key floats on the layout's root and draws nothing (a 0 × 0 float).

## How it behaves

- **What's remembered.** The controller notes every open space on every render: its name, whether someone named it, its machine, and where it is now (its first terminal's live folder, the same one Herdr names an unnamed space after, else the folder it was made in). When a space goes from a machine that's loaded, it's closed: it joins the list with the time it was last used. A space on a machine that isn't loaded right now (offline, still connecting) isn't counted as closed.
- **Last used.** That's the last time it was the shown space. The space you leave and the space you go to are both stamped when you switch, and the shown space counts as in use until you leave it or close it. A space opened in the background and never shown counts from when the controller first saw it.
- **One entry each.** A named space has one entry per name per machine. Any other space has one entry per folder per machine. Closing it again replaces the old entry. The newest 100 are kept.
- **What's listed.** Closed spaces, last used first, then any from Herdr's own list of closed spaces (`recent` in `view.json`, newest first) that the controller didn't see close, such as spaces closed before this was installed. Herdr's list doesn't say which machine a space was on, so only folders that can be this computer's are used: drive or UNC paths on Windows, `/` paths elsewhere. Entries with no folder are skipped.
- **Not the open ones.** A named entry is hidden while a space with that name is open on its machine. Any other entry is hidden while an open space on its machine is in that folder.
- **Typing** filters the list by name, folder (as shown) and machine. Words are separated by spaces, matching ignores case, and every word must match. The selection goes back to the first row.
- **Keys.**
  - ↑/↓ move the selection and wrap around. PgUp/PgDn move 8 rows and stop at the ends.
  - Enter or a click opens the selected row. Esc or the Esc button closes the popup.
  - Ctrl+R while it's open moves down and Ctrl+Shift+R moves up, both wrapping. After either one, letting go of Ctrl opens the selected row. Letting go of Ctrl after the press that opened the popup does nothing, so a single Ctrl+R leaves it open to type in.
- **Opening one.**
  - On another machine that isn't connected, the error line says so and the popup stays open.
  - Otherwise it first checks the folder is still there. If it's gone (a removed worktree, say), the error line says so and the popup stays open.
  - Then the popup closes and it runs `space.new { folder, machine, name? }`. `machine` is `""` for this computer, and `name` is passed only for a space someone had named. With no folder, Herdr starts the new space in that machine's home. The new space is shown at once, and it drops off the list because it's open again.
- **Taking one off the list.** The × removes the row at once, and the controller saves the removal. An entry from Herdr's list can't be removed from Herdr's file, so it stays hidden from then on. If that space is closed again later, it comes back.

## Built from

- **`mods/recent-spaces/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Open recent" }`). One mod, two kinds of copy, told apart by `props.role`:
  - `"controller"` floats on the layout root and draws an empty `div()`. Floats are always shown, so it gets `recent-spaces.open` (also `.next`, which does the same) and `.prev` from `nextCommand()`. On every render it runs `note()`, which updates the open spaces it knows (`spaces()`, `panes()` for live folders, `machines()` for which are loaded) and moves the ones that have gone to the closed list. Both are kept in its `localStorage` under `"spaces"`: `{ known, closed, forgotten }`. On a command it opens the picker: `openOverlay({ mod: "recent-spaces", kind: "popup", at: "top", offset: 40, width: 620, height: 0.8, props: { role: "picker", closed, forgotten } })`.
  - `"picker"` is that popup. It reads `view.json` with `readTextFile(appHome() + "/view.json")` for Herdr's own list. It takes the keyboard in `init` (`cx.focus_handle()`, then `.focus()`, then the input's), handles keys with `on_key_down` on its root, and opens the pick on `on_modifiers_changed` with `control: false` once Ctrl+R has been pressed again. The list is a plain `overflow_y_scrollbar()` column driven by a `ScrollHandle`, so each row can have its own × with `on_click`.
  - Presses after the first reach the open picker from the controller through a small inbox kept at module scope, which both copies share, as in the [terminal switcher](../terminal-switcher/). The picker marks itself alive every second, and after 3 s without that, a press opens a fresh picker.
  - The ×: the picker leaves the key in a module-scope list and runs `recent-spaces.sync`, and the controller saves it from its own task. Every `note()` also applies the list, in case the command didn't arrive.
  - From `gpui-base`: `InputState`, `Input` and `ScrollHandle`. From `herdr`: `spaces`, `panes`, `machines`, `run` (`space.new`, `recent-spaces.sync`), `openOverlay` / `closeOverlay`, `nextCommand`, `readTextFile`, `exec` (`test -d`), `appHome`, `home`, `window` (the platform), `checking`, `notify`, `props` and `theme`.
- **The layout.** Add the controller to the root's `floating` list of each layout you want it in:

  ```json
  { "id": "recent-spaces-keys", "content": { "mod": "recent-spaces", "props": { "role": "controller" } }, "edge": "top", "align": "start" }
  ```

- **Keys.** `keys.json`'s `"global": { "ctrl-r": "recent-spaces.open" }`. Ctrl+Shift+R needs no binding: the open picker handles it itself.
- **Art.** The shipped `mods/workspace-chrome/folder.svg`, `server.svg` and `search.svg`, and `mods/pane/close.svg`.

## Watch out

- **Ctrl+R is taken from terminals.** Shells use Ctrl+R for reverse history search (bash, zsh, PowerShell's PSReadLine), and a global binding wins over the program. Bind another key (`ctrl-shift-r`, say) if you need that search, and the picker's own Ctrl+R / Ctrl+Shift+R keep working inside it.
- **Only one copy may save.** Each copy has its own `localStorage`. A save made from the picker's task, even through the controller's object, doesn't reach the controller's storage (in testing it threw and killed the picker's loop). So the picker hands keys over through the module and `recent-spaces.sync`.
- **`props()` after an await.** Inside a spawned task, after the folder check's `await`, `props()` no longer returns the picker's props, and `closeOverlay(props().overlay)` silently does nothing: the space opened but the popup stayed. The picker keeps `props().overlay` from `init`.
- **Checking a folder.** On this computer, `readTextFile(folder)` throws for a folder that's there and returns null for a missing path. On another machine it returns null for both, so the check runs `test -d <folder>` there (exit 1 means missing). Anything else (no `test`, a timeout) counts as there, and Herdr's own error shows if `space.new` fails.
- **Herdr's list has no machine.** `view.json`'s `recent` is `{ name, folder }` only, newest first, and Herdr drops a space from it once it's reopened. On Windows a `/home/...` entry can only be another machine's, so it's skipped. On macOS and Linux a remote `/` path can't be told apart from a local one and is offered as this computer's. `view.json` is Herdr's own file, not part of the mod API, so a later Herdr may change it. Then only the controller's own list shows.
- **The list starts when it's installed.** Spaces closed before then come only from Herdr's short list, without times. Spaces closed while the shown layout has no controller float aren't noted until a layout with it shows again. Then they count as closed at that moment, from the last time it saw them.
- **One list per controller copy.** The controller in another layout has its own `localStorage`, so its own list.
- **Machines that never come back.** A space on a machine that's removed stays in the controller's open list, out of sight, because its machine is never loaded again.

## Done when

- `herdr-app check mods/recent-spaces` passes.
- With the float and key added, the window looks exactly as before: `herdr-app status` lists `recent-spaces-keys` with 0 × 0 bounds and no errors.
- Close two spaces, A and then B, then press Ctrl+R: B is listed first and A second, each showing `now`. Spaces that are open aren't listed.
- Enter on B opens a new space in B's folder with a terminal, shown at once, and the popup closes. A space named "notes" comes back named "notes".
- With the popup open, holding Ctrl and pressing R moves down a row, and letting go of Ctrl opens that row. A single Ctrl+R, then letting go, leaves the popup open.
- Typing part of a folder name leaves only the matching rows.
- Delete a closed space's folder, then pick it: the error line says it isn't there anymore and the popup stays open. Its × removes the row, and it's still gone after Herdr reloads the mod.
- A space on another machine shows the machine's name, and opens there.
- On a fresh install, spaces in Herdr's own `view.json` `recent` list that can be this computer's are listed, without a time.
