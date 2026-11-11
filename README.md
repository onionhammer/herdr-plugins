# herdr-plugins

Mods for [Herdr](https://herdr.dev). Each folder holds one plugin, laid out like `~/.config/herdr-app`: its `mods/<name>/` folders, plus a `RECIPE.md` that describes it well enough to rebuild from scratch.

| Plugin | What it does |
|---|---|
| [branch-picker](branch-picker/) | Switch, create and check out git branches from a popup (VS Code's "Checkout to…"), with a status-bar branch button and a dialog that cleans up merged branches. |

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
