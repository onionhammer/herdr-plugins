# Terminal switcher

Alt+Tab for Herdr's terminals, in the style of Windows' Alt+Tab or Arc's Ctrl+Tab. Hold Ctrl and press Tab, and every terminal in every space shows as a tile with its latest screen, most recently used first. The terminal you were in before is already picked, so a quick Ctrl+Tab takes you back. Keep holding Ctrl and press Tab to move on, or Shift+Tab to move back. Let go of Ctrl and you're there: it switches space and tab if it has to, and the keyboard goes to that terminal.

## What you see

- **A dimmed window with one card in the middle.** The card is `popover` with a 1 px `border` line, a 14 px radius, a large shadow and 16 px padding.
- **Its header.** "Switch terminal" in 13 px semibold `foreground`. On the right, key hints in 11 px `dim`: `Tab` next, `Shift+Tab` back, `Ctrl` let go to switch, `Esc` stay. Each key sits in a small box with a `border` outline.
- **The tiles.** They're 248 px wide, laid out in a grid with 12 px gaps. The grid has as many columns as fit in the window, up to 5. When more rows exist than fit, the grid scrolls and keeps the picked tile in view. Each tile, from top to bottom:
  - The program's icon and name in 12 px medium `foreground`. An agent shows its terminal title instead (Claude Code's task name, for example). The terminal you came from says "current". On the right is its status: a turning spinner while it's working, `●` in `blocked` or `done`, `○` idle.
  - A 136 px preview: the last 17 lines of the screen that aren't blank, in the terminal font at 6 px, `muted`, on `background` with a `border` line. A terminal that can't be read says "No preview".
  - The space's color chip with its initial (the same colors as the sidebar), then "space · tab" in `muted`, then the folder in `dim`, with your home folder shown as `~`. A quick terminal says "space · quick terminal".
- **The picked tile.** It has a 2 px `accent` border on `selected`. Other tiles get `hover` under the pointer.
- **Nothing else.** The copy that takes the key floats on the layout's root and draws nothing (a 0 × 0 float).

## How it behaves

- **Ctrl+Tab** opens the card with the second tile picked: the terminal you were in before this one. **Ctrl+Shift+Tab** opens it with the last tile picked.
- **While it's open:**
  - Tab moves to the next tile and Shift+Tab to the one before, wrapping at the ends, with Ctrl held or not.
  - ← and → step one tile. ↑ and ↓ step one row and stop at the ends.
- **Going there.** Letting go of Ctrl, Enter, or a click on a tile goes to the picked terminal:
  1. `space.select {id}` if it's in another space.
  2. `tab.select {id}` if it's not that space's shown tab.
  3. `pane.focus {pane}`.

  A quick terminal goes through `quick-terminal.show` instead, which opens its panel and gives it the keyboard. Picking the terminal you came from just closes the card.
- **Leaving.** Esc, or a click beside the card, closes it and changes nothing.
- **The order.** The terminal that has the keyboard comes first, then the others from most to least recently focused. Terminals that haven't had the keyboard since the switcher started tracking come last, in sidebar order (space, tab, pane). The order is kept in the controller's `localStorage`, so it survives a restart.
- **What's listed.** Every terminal pane in every tab of every space, on this computer and on connected machines. Quick terminals from the [quick-terminal](../quick-terminal/) plugin are listed too, when the shown layout has its panel. Mod panes (a file viewer, say) aren't terminals, so they aren't listed. Neither are sub-agents without a pane.
- **Previews stay current.** Every terminal is read with `hc read <address>` when the card opens, and again every second while it's open. Titles and statuses update live.

## Built from

- **`mods/terminal-switcher/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Terminal switcher" }`). One mod, two kinds of copy, told apart by `props.role`:
  - `"controller"` floats on the layout root and draws an empty `div()`. Floats are always shown, so it gets `terminal-switcher.next` and `.prev` from `nextCommand()`, which only reaches shown copies. On every render, it moves `focused().terminal` to the front of its recently-used list. On a command, it opens the picker: `openOverlay({ mod: "terminal-switcher", kind: "dialog", frame: "none", width: 1, height: 1, props: { role: "picker", step, here, order } })`.
  - `"picker"` is that dialog. It covers the whole window and centers its own card, so the card fits its tiles without knowing the window's size. It takes the keyboard in `init` (`cx.focus_handle()`, then `.focus()`) and handles keys with `on_key_down`. `on_modifiers_changed` reporting `control: false` means Ctrl was let go.
  - Presses after the first reach the open picker from the controller through a small inbox kept at module scope, which both copies share. The picker's own task waits on it, so its `cx` redraws the picker.
  - From `herdr`, it uses `spaces`, `panes`, `terminals`, `focused`, `layout`, `hc` (`read`), `run` (`space.select`, `tab.select`, `pane.focus`, `quick-terminal.show`), `openOverlay` / `closeOverlay`, `nextCommand`, `shared` / `setShared` (`space.colors`, as the shipped mods keep it), `settings` (the terminal font and zoom), `notify`, `home`, `props` and `theme`.
- **The layout.** Add the controller to the root's `floating` list of each layout you want it in:

  ```json
  { "id": "terminal-switcher-keys", "content": { "mod": "terminal-switcher", "props": { "role": "controller" } }, "edge": "bottom", "align": "start" }
  ```

- **Keys.** `keys.json`'s `"global": { "ctrl-tab": "terminal-switcher.next", "ctrl-shift-tab": "terminal-switcher.prev" }`. Herdr's defaults bind these two to `tab.next` / `tab.prev`. Ctrl+PageDown / Ctrl+PageUp and Alt+] / Alt+[ still switch tabs.
- **Art.** The shipped `mods/workspace-chrome/spinner.svg`, and each program's icon from the program table.

## Watch out

- **Letting go of Ctrl** is only seen by the copy that has the keyboard. The picker focuses itself as it opens. A Ctrl+Tab tapped faster than the card opens leaves it open, because Ctrl was already up. Then Enter, a click, or another Ctrl+Tab finishes it.
- **One press, two routes.** While the picker has the keyboard, a Ctrl+Tab may reach it as a key, as the controller's forwarded command, or both, depending on how Herdr orders bindings against a focused mod's key handlers. A move from the other route within 120 ms counts as the same press.
- **Previews are text,** not pictures: `hc read` gives the screen's characters without colors. A layout terminal block would show the real thing, but it is a live view that takes typing and clicks, and small blocks might change the size programs see.
- **The order starts empty.** Until terminals have had the keyboard with the controller loaded, they list in sidebar order.
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
- With the quick-terminal plugin installed, a space's quick terminal is listed, and picking it opens that space's panel with the keyboard in it.
