# Terminal switcher

Alt+Tab for Herdr's terminals, in the style of Windows' Alt+Tab or Arc's Ctrl+Tab. Hold Ctrl and press Tab, and every terminal in every space shows as a tile with its latest screen, most recently used first. The terminal you were in before is already picked, so a quick Ctrl+Tab takes you back. Keep holding Ctrl and press Tab to move on, or Shift+Tab to move back. Let go of Ctrl and you're there: it switches space and tab if it has to, and the keyboard goes to that terminal.

## What you see

- **A dimmed window with one card in the middle.** The card is `popover` with a 1 px `border` line, a 14 px radius, a large shadow and 16 px padding.
- **Its header.** "Switch terminal" in 13 px semibold `foreground`. On the right, key hints in 11 px `dim`: `Tab` next, `Shift+Tab` back, `Ctrl` let go to switch, `Esc` stay, `Middle-click` close. Each key sits in a small box with a `border` outline.
- **The tiles.** They're 248 px wide, laid out in a grid with 12 px gaps. The grid has as many columns as fit in the window, up to 5. When more rows exist than fit, the grid scrolls and keeps the picked tile in view. Each tile, from top to bottom:
  - The program's icon and name in 12 px medium `foreground`. An agent shows its terminal title instead (Claude Code's task name, for example). The terminal you came from says "current". On the right is its status: a turning spinner while it's working, `●` in `blocked` or `done`, `○` idle. On the picked tile, and on the one under the pointer, a 12 px × follows it (`mods/pane/close.svg`, `dim`, with a `hover` background under the pointer).
  - A 136 px preview: the last 17 lines of the screen that aren't blank, in the terminal font at 6 px, `muted`, on `background` with a `border` line. A terminal that can't be read says "No preview".
  - The space's color chip with its initial (the same colors as the sidebar), then "space · tab" in `muted`, then the folder in `dim`, with your home folder shown as `~`. A quick terminal says "space · quick terminal".
- **The picked tile.** It has a 2 px `accent` border on `selected`. Other tiles get `hover` under the pointer. Once the pointer has moved, the tile under it is the picked one.
- **Nothing else.** The copy that takes the key floats on the layout's root and draws nothing (a 0 × 0 float).

## How it behaves

- **Ctrl+Tab** opens the card with the second tile picked: the terminal you were in before this one. **Ctrl+Shift+Tab** opens it with the last tile picked.
- **While it's open:**
  - Tab moves to the next tile and Shift+Tab to the one before, wrapping at the ends, with Ctrl held or not.
  - ← and → step one tile. ↑ and ↓ step one row and stop at the ends.
  - The mouse picks too, once it has moved 8 px from where it was first seen: from then on, the tile under the pointer is the picked one, so letting go of Ctrl goes there. A pointer resting where the card opens, or nudged during a quick Ctrl+Tab, leaves the pick alone. The keys still move the pick after that.
- **Going there.** Letting go of Ctrl or Enter goes to the picked terminal, and a click on a tile goes to that one at once, with Ctrl still held or not:
  1. `space.select {id}` if it's in another space.
  2. `tab.select {id}` if it's not that space's shown tab.
  3. `pane.focus {pane}`.

  A quick terminal goes through `quick-terminal.show` instead, which opens its panel and gives it the keyboard. Picking the terminal you came from just closes the card.
- **Leaving.** Esc, or a click beside the card (Ctrl held or not), closes it and changes nothing.
- **Closing a terminal.** The tile's ×, or a middle click anywhere on the tile, closes that terminal the way the pane header's × does: `pane.close {pane}`, or `terminal.kill {terminal}` for a quick terminal. The tile goes at once. The card stays open, the pick moves to the tile that takes its place, and the card keeps the keyboard, so letting go of Ctrl still switches. Closing a space's last tab closes the space, and Herdr asks first. If you cancel, the tile comes back.
- **The order is last used first.** The terminal that has the keyboard comes first, then the others from most to least recently focused. The controller records `focused().terminal` each time it changes, and keeps the list in its `localStorage`, so it survives a restart.
  - The switcher's own switch passes through other terminals on its way: the other space's shown pane, then the tab's. Only the terminal it was going to counts, for up to 3 s.
  - Herdr keeps no record of when a terminal was last used, so terminals not focused since the switcher was installed are placed by guess. Each space's shown tab is the one last used in that space, so those come next, the shown space's first. The rest follow in sidebar order (space, tab, pane).
  - Ended terminals drop off the list. Terminals on a machine that isn't loaded right now keep their place.
- **What's listed.** Every terminal pane in every tab of every space, on this computer and on connected machines. Quick terminals from the [quick-terminal](../quick-terminal/) plugin are listed too, when the shown layout has its panel. Mod panes (a file viewer, say) aren't terminals, so they aren't listed. Neither are sub-agents without a pane.
- **Previews stay current.** Every terminal is read with `hc read <address>` when the card opens, and again every second while it's open. Titles and statuses update live.

## Built from

- **`mods/terminal-switcher/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Terminal switcher" }`). One mod, two kinds of copy, told apart by `props.role`:
  - `"controller"` floats on the layout root and draws an empty `div()`. Floats are always shown, so it gets `terminal-switcher.next` and `.prev` from `nextCommand()`, which only reaches shown copies. On every render, it moves `focused().terminal` to the front of its recently-used list. On a command, it opens the picker: `openOverlay({ mod: "terminal-switcher", kind: "dialog", frame: "none", width: 1, height: 1, props: { role: "picker", step, here, order } })`.
  - `"picker"` is that dialog. It covers the whole window and centers its own card, so the card fits its tiles without knowing the window's size. It takes the keyboard in `init` (`cx.focus_handle()`, then `.focus()`) and handles keys with `on_key_down`. `on_modifiers_changed` reporting `control: false` means Ctrl was let go. `on_mouse_move` on its root counts the pointer's travel, and each tile's `on_hover` moves the pick once it has gone 8 px. The tiles, their ×, the card and the backdrop take the right mouse button as well as the left (see Watch out).
  - Presses after the first reach the open picker from the controller through a small inbox kept at module scope, which both copies share. The picker's own task waits on it, so its `cx` redraws the picker.
  - From `herdr`, it uses `spaces`, `panes`, `terminals`, `focused`, `machines`, `layout`, `hc` (`read`), `run` (`space.select`, `tab.select`, `pane.focus`, `pane.close`, `terminal.kill`, `quick-terminal.show`), `openOverlay` / `closeOverlay`, `nextCommand`, `shared` / `setShared` (`space.colors`, as the shipped mods keep it), `settings` (the terminal font and zoom), `notify`, `home`, `props` and `theme`.
- **The layout.** Add the controller to the root's `floating` list of each layout you want it in:

  ```json
  { "id": "terminal-switcher-keys", "content": { "mod": "terminal-switcher", "props": { "role": "controller" } }, "edge": "bottom", "align": "start" }
  ```

- **Keys.** `keys.json`'s `"global": { "ctrl-tab": "terminal-switcher.next", "ctrl-shift-tab": "terminal-switcher.prev" }`. Herdr's defaults bind these two to `tab.next` / `tab.prev`. Ctrl+PageDown / Ctrl+PageUp and Alt+] / Alt+[ still switch tabs.
- **Art.** The shipped `mods/workspace-chrome/spinner.svg` and `mods/pane/close.svg`, and each program's icon from the program table.

## Watch out

- **Letting go of Ctrl** is only seen by the copy that has the keyboard. The picker focuses itself as it opens. A Ctrl+Tab tapped faster than the card opens leaves it open, because Ctrl was already up. Then Enter, a click, or another Ctrl+Tab finishes it.
- **Ctrl+click is a right-click on macOS.** GPUI hands the app a left press with Ctrl held as a right-button press, and drops the left release. The card is open because Ctrl is down, so a tile with only `on_click` ignores the click. Ctrl has to be let go first, and that goes to the keyboard's pick, not the tile clicked. So the tile (go), its × (close), the card (stop) and the backdrop (leave) also listen with `on_mouse_down("right")`. Elsewhere, Ctrl+click stays a left click, and `on_click` handles it.
- **One press, two routes.** While the picker has the keyboard, a Ctrl+Tab may reach it as a key, as the controller's forwarded command, or both, depending on how Herdr orders bindings against a focused mod's key handlers. A move from the other route within 120 ms counts as the same press.
- **Previews are text,** not pictures: `hc read` gives the screen's characters without colors. A layout terminal block would show the real thing, but it is a live view that takes typing and clicks, and small blocks might change the size programs see.
- **The order starts as a guess.** Herdr records no last-used times, so until terminals have had the keyboard with the controller loaded, they're placed by each space's shown tab, then sidebar order.
- **A stuck inbox.** If the picker closes without its cleanup running, the controller's next press would go nowhere. The picker marks itself alive every second, and after 3 s without that, a press opens a fresh picker.
- **One layout at a time.** The key does nothing in a layout without the controller float.

## Done when

- `herdr-app check mods/terminal-switcher` passes.
- With the float and keys added, the window looks exactly as before: `herdr-app status` lists `terminal-switcher-keys` with 0 × 0 bounds and no errors.
- Ctrl+Tab, then letting go, goes back to the terminal you were in before, even in another space. Doing it again comes back.
- Holding Ctrl and pressing Tab three times picks the fourth tile, and letting go goes there, switching space and tab as needed.
- Ctrl+Shift+Tab picks the least recent terminal.
- Each tile shows the program, its status, its latest screen, and its space, tab and folder. The previews change while the card is open.
- Esc leaves everything as it was. Clicking a tile goes there.
- Holding Ctrl, clicking a tile goes there at once. On macOS this arrives as a right-button press.
- Holding Ctrl, moving the mouse onto a tile and letting go of Ctrl goes to that tile.
- With the mouse resting still, or nudged a pixel or two, a quick Ctrl+Tab still goes back to the terminal you were in before.
- Switching A → B → C with the switcher, then Ctrl+Tab, picks B, not a terminal passed through on the way.
- The × on the picked or hovered tile, or a middle click on any tile, closes that terminal. Its tile goes, the card stays open, and letting go of Ctrl still switches.
- With the quick-terminal plugin installed, a space's quick terminal is listed, and picking it opens that space's panel with the keyboard in it.
