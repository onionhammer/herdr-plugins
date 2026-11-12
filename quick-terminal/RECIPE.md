# Quick terminal

VS Code's Ctrl+` terminal for Herdr. Press Ctrl+` and a terminal opens under the shown tab, a third of the height. It starts in the folder you're working in, and the keyboard moves to it. Press Ctrl+` again and the panel hides, the keyboard goes back to the pane you came from, and the terminal keeps running: a build, a server or a half-typed command is still there the next time you open it. Drag the line between the tab and the panel to resize it. Each space has its own quick terminal and remembers whether its panel is open.

## What you see

- **The panel.** A card under the shown tab's panes, 8 px below them, inside the same 8 px padding as the panes. It looks like a pane card: `background`, a 1 px `border` line, a 10 px radius, and an `accent` border while its terminal has the keyboard. It takes a third of the height (weights 2 : 1), never less than 120 px. The divider above it drags to resize. The Files / Changes panel on the right keeps its full height.
- **Its header.** 30 px, drawn like Herdr's pane header: `background` with a 1 px `border` line underneath and 12 px text. It shows the shell's icon and name from the program table (for example PowerShell), in medium-weight `foreground` text up to 260 px wide. Then comes the terminal's live folder in `dim`, with your home folder shown as `~`. While the pointer is on the header, two 14 px buttons appear on the right (3 px padding, 4 px radius, `dim`, `hover` background on hover): a chevron-down that hides the panel, and a × that ends the terminal, as the pane header's × does.
- **The terminal.** Fills the rest of the card, with the layout's terminal padding. While a space's terminal is first starting, the card shows "Starting a terminal…" centered in 12 px `dim`.
- **Nothing else.** The mod copy that takes the key floats on the layout's root and draws nothing (a 0 × 0 float).

## How it behaves

- **Ctrl+`, panel hidden.**
  1. It finds the shown space's quick terminal: the one it remembers, else a live terminal labeled `quick-terminal.space=<space id>`.
  2. If there's none, it starts one: `hc run --bg --json --keep --rm --no-parent --label quick-terminal.space=<id> [--on <machine>] --cwd <folder>`. The folder is the focused pane's folder when it's in that space, else the first folder in the space's shown tab, else the space's own folder. If that folder fails, it tries home: `home()` here, or that machine's home with `--on`.
  3. It makes sure the layout's stack has that terminal's block, selects it, shows the panel and focuses the terminal (`pane.focus {terminal}`).
- **Ctrl+`, panel shown.** It hides the panel. If the keyboard was in the quick terminal, it goes back to the pane that had it before. If that pane is gone, it goes to the shown tab's first terminal pane.
- **Switching spaces.** The panel follows each space's own state: shown with that space's terminal if its panel is open, otherwise hidden. Switching tabs in a space keeps the panel as it is.
- **Hidden, it keeps running.** The terminal lives in herdr-core with `--keep`, so it survives Herdr closing, and a lost program becomes a shell in the same place at the same address. It has no `herdr.space` / `herdr.tab` labels, so no tab adopts it and it isn't in the agents list.
- **When it ends** (`exit`, the header's ×, or a kill), `--rm` removes it, so it's forgotten and the panel hides. The next Ctrl+` starts a fresh one.
- **Closing a space** ends its quick terminal, as it ends the space's tabs. This only happens for a space this copy of Herdr saw close.
- **The header.** A click on it focuses the terminal. The chevron hides the panel and leaves the terminal running. The × ends the terminal.
- **What it remembers.** `shared("quick-terminal")` holds `{ open: { <space id>: true }, terms: { <space id>: <address> } }`, so which panels are open survives a restart. The panel's size, and whether it's shown, are layout clicks, kept as Herdr keeps any.
- **Agent status:** none of its own. An agent run in the quick terminal works, but it doesn't show in the agents list, because the terminal isn't in a tab.

## Built from

- **`mods/quick-terminal/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Quick terminal" }`). One mod, three copies told apart by `props.role`:
  - `"controller"` floats on the layout root and draws an empty `div()`. Floats are always shown, so it gets `quick-terminal.toggle`, `.show` and `.hide` from `nextCommand()`, which only reaches shown copies. After every render (`cx.timer.after(0, …)`), it brings the panel in line with the shown space, using `layout.select`, `layout.show` and `layout.hide`.
  - `"bar"` is the panel's header.
  - `"empty"` is the stack's placeholder.
  - From `herdr`, it uses `hc` (`run`, `ls --json [--label]`), `run` (`layout.select`, `layout.show`, `layout.hide`, `layout.set`, `pane.focus`, `terminal.kill`), `readTextFile` / `writeTextFile`, `layout`, `shared` / `setShared`, `spaces`, `panes`, `focused`, `terminals`, `machines`, `notify`, `home`, `appHome`, `props` and `theme`.
- **The layout.** In a personal layout (clone `main` first: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`), replace the tab block (`"id": "main"`, `content.tab: "active"`) with this column. Give the old block `"size": { "weight": 2 }` and keep everything else about it:

  ```json
  { "id": "main-area", "type": "column", "gap": 8, "children": [
      { "id": "main", "type": "block", "size": { "weight": 2 }, "content": { "tab": "active", "pane": { "…": "as it was" } } },
      { "id": "quick-terminal", "type": "column", "size": { "weight": 1 }, "min": 120, "hidden": true,
        "background": "background", "radius": 10,
        "border": { "width": 1, "color": "border" }, "focus": { "border": { "width": 1, "color": "accent" } },
        "children": [
          { "id": "quick-terminal-bar", "type": "block", "size": { "px": 30 },
            "content": { "mod": "quick-terminal", "props": { "role": "bar" } } },
          { "id": "quick-terminal-stack", "type": "stack", "active": "quick-terminal-empty", "children": [
              { "id": "quick-terminal-empty", "type": "block",
                "content": { "mod": "quick-terminal", "props": { "role": "empty" } } } ] } ] } ] }
  ```

  Then add the controller to the root's `floating` list:

  ```json
  { "id": "quick-terminal-keys", "content": { "mod": "quick-terminal", "props": { "role": "controller" } }, "edge": "bottom", "align": "end" }
  ```

  The ids `quick-terminal`, `quick-terminal-stack` and the `qt-` prefix are fixed in `main.js`. The mod adds `{ "id": "qt-<space id>", "type": "block", "content": { "terminal": "<address>" } }` children to the stack itself.
- **Keys.** `keys.json`'s `"global": { "ctrl-`": "quick-terminal.toggle" }`. `quick-terminal.show` and `quick-terminal.hide` can be bound too.
- **Art.** The shipped `mods/workspace-chrome/chevron-down.svg` and `mods/pane/close.svg`, and the shell's icon from the program table.

## Watch out

- **A mod can't draw a terminal.** Only a layout block can (`{ "terminal": "t7" }`). That's why the panel is a stack of terminal blocks the mod writes, one per space, and selects. Selecting a stack child is a click. Adding one is a layout edit.
- **It edits the shown layout's file** (`layouts/<shared("layout")>.json`) to change the stack's children, and waits up to 2 s for the window to load it. A file edit changes only the fields it touches, so your clicks (the panel's size, shown/hidden, the selected child) stay. If the window doesn't pick the change up, it falls back to `layout.set`. A space's first Ctrl+` therefore takes about a second; after that, toggling is instant.
- **The file is rewritten** with `JSON.stringify(tree, null, 2)`, so hand formatting in that layout file doesn't survive the first quick terminal.
- **Labels.** Don't start the terminal with `herdr.space` / `herdr.tab` labels: Herdr would adopt it as a pane in a tab. `hc run` needs `--bg`, or it waits for the shell to exit. `--no-parent` keeps it from being tied to whichever terminal started Herdr's call.
- **An ended terminal** is one seen in `terminals()` and then gone from it. A new terminal isn't in `terminals()` straight away, so "not listed yet" mustn't count as ended. When opening, `hc ls --json` (which covers connected machines too) has the last word.
- **The keyboard in a terminal block.** While the quick terminal has the keyboard, Herdr's pane keys (`pane.go`, split, zoom) don't act, because a layout terminal block isn't a tab pane. Ctrl+` or a click on a pane takes the keyboard back.
- **Space closing** ends the quick terminal only when this copy of Herdr saw that space close. A quick terminal whose space was closed while this window wasn't running stays in herdr-core. `hc ls --label quick-terminal.space=<id>` finds it, and `hc kill` ends it.
- **One layout.** The panel lives in the layout you add it to. In a layout without the nodes, Ctrl+` does nothing; if only the stack is missing, it posts a warning toast.

## Done when

- `herdr-app check mods/quick-terminal` passes. With `props.role` set to `bar` and to `empty`, it passes too.
- With the layout and key added, the window looks exactly as before: no panel, and no float drawn (`herdr-app status` lists `quick-terminal-keys` with 0 × 0 bounds).
- Ctrl+` opens a terminal under the panes, a third of the height, in the focused pane's folder, and typing goes into it.
- Ctrl+` again hides it, and typing goes back to the pane that had the keyboard. Ctrl+` once more shows the same terminal, with its scrollback and any running program.
- Dragging the divider resizes the panel, and the size stays after a hide and show, and after a restart.
- In a second space, Ctrl+` opens a different terminal in that space's folder. Switching back and forth shows each space's own panel state.
- `exit` in the quick terminal hides the panel, and the next Ctrl+` starts a new shell.
- The header shows the shell's name and live folder. On hover, the chevron hides the panel and × ends the terminal.
