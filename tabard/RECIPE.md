# Tabard

[Tabard](https://github.com/wivuu/wivuu.tabard), the Claude Code profile switcher, as the first agent in Herdr's **+** menu. Pick **Tabard** (or press **1** with the menu open) and a new tab opens running `tabard`. It starts Claude Code with the profile you last used in that folder. In a folder it hasn't seen, it first shows its profile picker. Once Claude Code is running, the tab is an ordinary Claude Code agent: its status shows in the agents list, the tab bar and the pane header, with attention sounds and toasts, using whichever profile you picked.

## What you see

- **The + menu.** The **+** at the right of the tab bar opens the menu, looking exactly like Herdr's. **⌘⇧T** opens the same menu from the keyboard, 250 × 512 px at the top center of the window, 40 px down. **⌘⇧T** again closes it. Under "Start an agent", **Tabard** is always first, with its key **1**, and a one-color tabard glyph (a tunic with a cross on it) drawn in `foreground`, 14 px. The other installed agents follow in Herdr's own order (most picked first), numbered 2–9. If `tabard` isn't installed on the space's machine, it's listed in `dim` with "not installed" after the installed agents, as the first of the two missing agents the menu shows.
- **The tab.** It's named "Tabard". While the tabard picker is up, the tab and pane header show the tabard glyph. The pane header shows the terminal's title next to it, as Herdr's header does for any program that isn't an agent or a shell. Once Claude Code starts, the tab, header and agents list show Claude Code's icon and name, and the tab keeps the name "Tabard".
- **Tiles.** Layouts that draw program tiles show the glyph in `#ffffff` on `#8b2635` (heraldic red).

## How it behaves

- **From the keyboard.** **⌘⇧T, 1** starts Tabard, and **⌘⇧T, 2** starts Claude Code. Each number starts the agent on that row, up to 9. Esc closes the menu.
- **Picking Tabard** (a click, or **1** while the menu is open) runs `tab.new {name: "Tabard", space, argv: ["tabard"]}`, the same as for every agent in the menu. Herdr starts it in your login shell, in the focused pane's folder, and the shell stays open after tabard exits.
- **A folder tabard knows** (`~/.tabard/directories.json`) goes straight into Claude Code with that profile, as `CLAUDE_CONFIG_DIR=~/.tabard/profiles/<name>`.
- **A new folder** shows tabard's picker: up/down or 1–9, Enter to launch, `q` to quit back to the shell. The profile you pick is remembered for that folder.
- **Agent status.** `tabard` starts `claude` as a child process and waits for it. Herdr follows what runs in the terminal now, so the pane becomes Claude Code. Claude Code reports its own status (`app: "claude-code"`), so working, blocked, done and idle all work as they do for a plain Claude Code tab. Tabard adds nothing to that.
- **Another machine.** In a space on a remote machine, the menu asks that machine whether `tabard` is installed, and runs it there.

## Built from

- **`programs.json`**: one entry in `programs`, merged into `~/.config/herdr-app/programs.json`:

  ```json
  { "programs": { "tabard": {
      "name": "Tabard", "icon": "program-icons/tabard.svg", "tint": true,
      "tile": "#8b2635", "color": "#ffffff", "run": ["tabard"] } } }
  ```

  The `run` field is what puts it in the + menu. The menu lists `knownAgents({on: machine})`, which is every program-table entry that has `run`, each checked for `installed`. The key `tabard` also matches the `tabard` process, so the picker screen gets the name and icon too.
- **`program-icons/tabard.svg`**: copied to `~/.config/herdr-app/program-icons/tabard.svg`. A 24×24 Lucide-style glyph (`stroke="currentColor"`, width 2, round caps and joins): the tunic `M9 3a3 3 0 0 0 6 0l5 2.5V10h-3v11H7V10H4V5.5Z` with a cross `M12 11v6` and `M9.5 13.5h5`. `tint: true` tells Herdr to draw it in the text color.
- **`mods/tabard-menu/`**: a clone of Herdr's + menu (`herdr-app do mod.clone '{"name":"new-menu","as":"tabard-menu"}'`, new-menu 0.1.15). `knownAgents()` sorts by how often each agent was picked, Herdr keeps those counts to itself, and nothing in `programs.json` sets the order. So the clone adds a `FIRST = ["tabard"]` list and an `ordered()` function that stable-sorts those keys to the front. `render()` builds `installed` and the two "not installed" rows from `ordered(this.agents)` instead of `this.agents`, and the 1–9 key handler uses the same `installed`, so the keys match the rows. Everything else is Herdr's code. It keeps Herdr's `shared("new-menu.agents")` cache, the unsorted list each machine reported, so both menus open with the same list at once. Its `mod.json` adds `"title": "New"` and `"overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 250, "height": 512 }`, the size `mod.open` uses when a key opens it. The tab bar passes its own size and position.
- **Keys** (`keys.json`): `"cmd-shift-t": "mod.open:tabard-menu"` in `global`. `mod.open` opens the mod as the overlay its `mod.json` describes, and closes it when it's already open. The menu focuses itself in `init()`, so the number keys reach it.
- **The tab bar.** The **+** button in your clone of Herdr's tab bar opens the clone: change `openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })` to `mod: "tabard-menu"`. Herdr's own `tabs` mod is read-only. If your layout still uses it, clone it first (`herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'`) and point your layout's tab bar block at the clone. Do the same in each personal layout's tab bar.

## Watch out

- **Merge, don't replace.** If `~/.config/herdr-app/programs.json` already exists, add the `tabard` key inside its `programs` object. Copying this file over it would lose your other entries.
- **Icons go outside `icons/`.** Herdr rewrites `~/.config/herdr-app/icons/` on every start, so the glyph lives in `program-icons/`. The icon path is relative to `~/.config/herdr-app`.
- **`run` needs a program on PATH, not an alias.** `tabard` installs to `~/.local/bin` (or Homebrew), and Herdr's launcher loads your login profile, so PATH is the one your shell has. If it's listed as "not installed", check `command -v tabard` in a new login shell.
- **Undocumented fields.** Don't set `"agent": true` on the entry to make the header show "Tabard" during the picker. `programs.json` doesn't document it, and the picker only lasts until you pick a profile.
- **Herdr's menu still exists.** Without the tab bar change, **+** opens Herdr's `new-menu`. It lists Tabard too, but after Claude Code, Pi and the others, until you've picked Tabard more often than them.
- **The key.** Check that `cmd-shift-t` isn't already in the person's `keys.json`, and ask before replacing a key they use. On Linux and Windows, choose a key terminal programs don't need instead, for example `ctrl-shift-n`.
- **A newer Herdr menu.** The clone doesn't get Herdr's updates. When `new-menu` changes, clone it again and redo the three changes: `FIRST`, `ordered()`, and the two lines in `render()`.
- **Profiles per menu item.** Each entry runs one command, so the menu has one Tabard item. To launch a specific profile with no picker, add another entry with its own key, for example `"tabard-work": { "name": "Claude (work)", "icon": "program-icons/tabard.svg", "tint": true, "run": ["tabard", "use", "work"] }`. Add its key to `FIRST` to list it near the top.

## Done when

- `~/.config/herdr-app/programs.error` doesn't exist after the edit, `herdr-app check ~/.config/herdr-app/mods/tabard-menu` passes, and `herdr-app status` lists no errors.
- The **+** menu lists **Tabard** first, with its glyph and the key **1**, and Claude Code second with **2**. Pressing **1** while the menu is open starts Tabard.
- **⌘⇧T** opens the menu at the top center, 250 px wide, and `herdr-app status` lists `tabard-menu` under `overlays`. **⌘⇧T, 1** opens a tab named "Tabard".
- Picking it in a folder tabard knows opens a tab named "Tabard". `hc ls --json` shows its terminal with `"agent": "claude-code"` and a status, and the `claude` process has `CLAUDE_CONFIG_DIR` set to that profile.
- Picking it in a new folder shows tabard's "Select a Claude profile" picker, with the tabard glyph on the tab and pane header. `q` quits back to the shell.
