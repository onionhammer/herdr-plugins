# herdr-plugins

Mods for [Herdr](https://herdr.dev). Each folder holds one plugin, laid out like `~/.config/herdr-app`: its `mods/<name>/` folders, plus a `RECIPE.md` that describes it well enough to rebuild from scratch.

| Plugin | What it does |
|---|---|
| [branch-picker](branch-picker/) | Switch, create and check out git branches from a popup (VS Code's "Checkout to…"), with a status-bar branch button and a dialog that cleans up merged branches. |
| [terminal-switcher](terminal-switcher/) | Ctrl+Tab shows every terminal in every space as a tile with its latest screen, most recently used first (Alt+Tab for terminals). Let go of Ctrl to go there. |

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
- **terminal-switcher** runs `hc read` on each terminal while its card is open, to show the previews. It needs a float added to your layout and two keys in `keys.json`, as its `RECIPE.md` shows. Those keys replace Herdr's Ctrl+Tab / Ctrl+Shift+Tab tab switching.
