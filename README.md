# herdr-plugins

Mods for [Herdr](https://herdr.dev). Each folder holds one plugin, laid out like `~/.config/herdr-app`: its `mods/<name>/` folders, plus a `RECIPE.md` that describes it well enough to rebuild from scratch.

| Plugin | What it does |
|---|---|
| [branch-picker](branch-picker/) | Switch, create and check out git branches from a popup (VS Code's "Checkout to…"), with a status-bar branch button and a dialog that cleans up merged branches. |
| [quick-terminal](quick-terminal/) | Ctrl+` opens a terminal under the shown tab (VS Code's terminal panel), one per space. Ctrl+` again hides it and leaves it running. |
| [terminal-switcher](terminal-switcher/) | Ctrl+Tab shows every terminal in every space as a tile with its latest screen, most recently used first (Alt+Tab for terminals). Let go of Ctrl to go there. |
| [scratch-pad](scratch-pad/) | A page of notes for each space, in a Notes panel beside Files and Changes. Opened from the tab bar or with Ctrl+Shift+S, saved as you type to a markdown file. |
| [drag-split](drag-split/) | Drag a tab down onto the panes to split it into the shown tab, or drag a pane's header up onto the tab bar to give it a tab of its own. The terminals keep running through the move. |
| [space-groups](space-groups/) | Name groups of spaces (Personal, Work 1, Work 2) and show one group at a time: pills above the spaces list filter the spaces and agents lists, new spaces join the shown group, and a dot says another group needs you. |

## Installing

Ask the agent in Herdr: "add https://github.com/onionhammer/herdr-plugins/tree/main/branch-picker". It follows Herdr's own steps for adding a mod.

To install by hand:

1. Copy each folder under `<plugin>/mods/` into `~/.config/herdr-app/mods/`. Rename it if the name is taken.
2. Run `herdr-app check ~/.config/herdr-app/mods/<name>` for each one.
3. Open the plugin the way its `RECIPE.md` describes under **Built from**.

What these mods do on your machine:

- **branch-picker** runs `git`. It reads refs, runs `git switch` and `git stash`, and makes no network calls of its own.
- **branch-cleanup** runs `git fetch --all --prune`, which reaches your remotes. It runs `git branch -D` only on the branches you tick.
- **branch-status** runs `git rev-parse` and watches the repo's `.git` folder.
- **quick-terminal** starts shells with `hc run`, on another machine for a remote space. It rewrites the stack in the shown layout's file to show them. It ends a quick terminal when you close it or close its space. It needs nodes added to your own layout and a key in `keys.json`, as its `RECIPE.md` shows.
- **terminal-switcher** runs `hc read` on each terminal while its card is open, to show the previews. It needs a float added to your layout and two keys in `keys.json`, as its `RECIPE.md` shows. Those keys replace Herdr's Ctrl+Tab / Ctrl+Shift+Tab tab switching.
- **scratch-pad** reads and writes its notes in `~/.config/herdr-app/scratch-pad/`, one markdown file per space, and watches that folder. It runs no programs and makes no network calls. It needs a block and a float added to your layout, a key in `keys.json`, and two lines changed in a clone of Herdr's tab bar for the button, as its `RECIPE.md` shows.
- **drag-split** moves terminals between panes and tabs with Herdr's own commands (`terminal.park`, `terminal.keep`, `pane.swap`, `tab.move`). It runs no programs, reads no files and makes no network calls. **drag-split-header** is a clone of Herdr's pane header that starts the drags. Both need changes to your layout, plus some lines added to a clone of Herdr's tab bar, as its `RECIPE.md` shows.
- **space-groups** keeps its groups in Herdr's shared state (`shared.json`). It runs no programs, reads no files and makes no network calls. **space-groups-spaces** and **space-groups-agents** are clones of Herdr's own spaces and agents lists with a filter added, so they run what those lists run: `git` reads of each space's refs, `hc machine ls`, and `hc machine rm` / `add` when you click Connect on a rebuilt machine. They need a block added to your layout, the spaces and agents blocks pointed at the clones, and two keys in `keys.json`, as its `RECIPE.md` shows.

## New features
Start with

> Read ~/.config/herdr-app/AGENTS.md
