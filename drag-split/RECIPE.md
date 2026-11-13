# Drag to split

Drag a tab down out of the tab bar onto the panes, and its terminal joins the shown tab, split beside the pane you drop it on. Drag a pane's header up onto the tab bar, and that pane leaves its split and gets a tab of its own. It works the way browsers and editors handle dragging tabs out of a window. While you drag, the half of the pane it would take lights up, or a line in the tab bar shows where the new tab goes. The terminals keep running through the move, with their scrollback and whatever program is in them.

## What you see

- **Nothing new at rest.** The tab bar and the pane headers look exactly as before. The header is a copy of Herdr's own `pane` header.
- **While dragging, a label by the pointer.** It sits 14 px right of and 10 px below the pointer, and holds the dragged tab's name or the pane's name (the agent, program or title shown in its header). It's 12 px `foreground` text on `popover`, with a 1 px `border`, a 6 px radius, 9 × 3 px padding and a medium shadow.
- **Over a pane: the half it would take.** The half nearest the pointer's closest edge gets a 2 px `accent` border and an `accent` fill at 13% (`#…22`), with an 8 px radius. In its middle sits a chip reading "Split left", "Split right", "Split up" or "Split down": 12 px medium `accent_foreground` on `accent`, a 6 px radius, 9 × 3 px padding.
- **A pane over the tab bar: where the new tab goes.** A 3 px `accent` line with round ends stands between two tabs, 6 px short of the bar's top and bottom. Under the bar, a "New tab" chip, the same as the split chip, starts 30 px left of the line and 4 px below the bar.
- **A tab back over the tab bar: where it moves to.** A 2 px `accent` outline with a 7 px radius goes round the tab under the pointer.
- **The controller** floats on the layout's root, bottom center, and draws nothing (a 0 × 0 float).

## How it behaves

- **Dragging a tab onto the panes (split).**
  - Press a tab that isn't the shown one and move out of the bar with the button held. The drag starts as the pointer leaves the bar.
  - Over a pane of the shown tab, the half nearest the pointer's closest edge lights up. Let go to move the tab's terminals there.
  - The first terminal takes the side you dropped on. Any more from the same tab stack under it.
  - The emptied tab closes, and the keyboard goes to the first moved pane.
  - Panes in the tab that aren't terminals (a mod in a pane) stay where they were, and so does their tab.
- **Dragging a pane onto the tab bar (unsplit).**
  - Press a pane's header near its left or right end. The middle 96 px belong to Herdr's own pane grip (see Watch out).
  - The drag starts once the press moves 6 px, or leaves the header.
  - Over the tab bar, a line shows where the tab will go: before or after the tab under the pointer (whichever half it's on), or after the last tab.
  - Let go there: the terminal leaves its pane, gets a new tab at that place, and the new tab is shown with the keyboard in it. The tab has no name of its own, so the tab bar labels it as it would any new tab.
  - Its old tab keeps the other panes.
- **Dragging a pane onto another pane** of the same tab moves it beside that pane, on the lit half, the same as a tab drop.
- **Dragging a tab back onto the bar** moves it to where the outlined tab is.
- **Letting go anywhere else does nothing.** That includes the pane being dragged, the sidebar and the panels. For a tab, it also includes the tab itself and any part of the bar that isn't a tab. The label and marks disappear and nothing moves.
- **What can be dragged:**
  - Only a pane in a split tab (two or more panes), that isn't zoomed, and that holds a terminal.
  - Only a tab that isn't shown, and has at least one terminal in it.
  - The shown tab already shows its panes, so there's nothing to drop it on.
- **Calling it off.** A right-click during a drag ends it with nothing moved. A release outside the window isn't seen, so the label stays until the next press anywhere, which ends the drag without moving anything.
- **The tab bar's own controls are unchanged.** A click selects a tab. A press on one tab released on another, without leaving the bar, still reorders as before. A double-click renames, and the right-click menu, + button and panel buttons work as before.
- **The header is unchanged too.** Click to focus the pane. On hover it shows split, zoom and close buttons. Pressing those never starts a drag.
- **When a move fails** (the pane it was dropped on closed meanwhile), an error notification says "Couldn't move the pane" with the reason. A terminal left without a pane is given a tab, so it never ends up hidden.
- **Agent status:** Herdr's header draws it as before. Working shows a spinning 12 px `working` spinner, blocked a "Needs you" chip in `blocked`, done a 7 px `done` dot, and idle nothing. A moved agent keeps working, and its status follows it to the new pane or tab.

## Built from

- **`mods/drag-split/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Drag to split" }`). It's one mod with two copies, told apart by `props.role`; a copy with no role draws nothing and does nothing.
  - **`"controller"`** floats on the layout root and draws an empty `div()`. It does the moves, because Herdr has no "move pane" command. A terminal moves by losing its pane with `terminal.park {terminal}`, which keeps it running, and then getting a new pane with `terminal.keep {terminal, place}`. `place` is `"right"` or `"down"` beside the focused pane, or `"tab"`.
    - Each step waits (polling every 40 ms, at most 4 s) until `panes()` shows that it happened.
    - Moves run one at a time, through a promise chain.
    - At start it clears `drag-split` and `drag-split-op`.
  - **`"overlay"`** is opened by the tab bar or a header when a drag starts: `openOverlay({ mod: "drag-split", props: { role: "overlay" }, kind: "window", frame: "none", at: { x: 0, y: 0 }, width: 1, height: 1 })`.
    - Its root is `size_full().relative()` and draws the marks as absolute children.
    - `on_mouse_move` keeps the pointer and the overlay's own bounds (its mouse events report the whole window).
    - `on_mouse_up("left")` drops, and `on_mouse_down` (left or right) cancels.
    - Either one sets `drag-split` to null and calls `closeOverlay(props().overlay)`.
    - A drop puts a move in `drag-split-op` for the controller. A tab reorder is a plain `tab.move`, so it runs right away.
  - **Shared state** (`shared` / `setShared`):
    - `"drag-split"`: the drag in progress, `{ kind: "tab" | "pane", tab, pane?, terminal?, label, overlay }`.
    - `"drag-split-panes"`: each pane header's window rectangle, `{ [pane]: [x, y, w, h] }`.
    - `"drag-split-tabs"`: the tab bar's and each tab's, `{ bar: [x, y, w, h], tabs: { [tab]: [x, y, w, h] } }`.
    - `"drag-split-op"`: a move, `{ id, at, kind: "split", terminals, target, side }` or `{ id, at, kind: "newtab", terminal, index }`. The controller takes a new `id` less than 5 s old, after the render (`cx.timer.after(0, …)`), and sets the key back to null.
  - **Where the panes are.** A pane's header sits at its pane's top left and is as wide as the pane. A pane ends where the next header below it starts, minus the frame's `gap`, or else at the bottom of the tab block. The bottom is worked out from the layout's column sizes (`px` and `weight`, `padding`, `gap`, `divider`). In a zoomed tab, only the zoomed pane counts.
  - **The side.** The pointer's nearest edge of the pane under it decides left, right, up or down. The source pane is never a target.
  - **A split**, for each terminal in turn: `terminal.park`, then `pane.focus {pane: anchor}`, waiting up to 1.5 s until `focused().pane` is the anchor. Then `terminal.keep` with `"right"` or `"down"`. Left and up add `pane.swap {pane: <new>, target: anchor}`. The new pane is the next terminal's anchor, and `pane.focus` goes to the first moved pane at the end.
  - **A new tab**:
    1. `terminal.park`, then `terminal.keep {place: "tab"}`.
    2. `tab.rename {id, name: ""}`.
    3. `tab.move {id, index}` when the index isn't last.
    4. `tab.select`, then `pane.focus`.
  - From `herdr`: `focused`, `layout`, `notify`, `panes`, `props`, `run`, `settings`, `setShared`, `shared`, `spaces`, `theme`, `closeOverlay`.
- **`mods/drag-split-header/`**: Herdr's `pane` header, cloned (`herdr-app do mod.clone '{"name":"pane","as":"drag-split-header"}'`, from pane 0.1.15), with its art paths changed to `mods/drag-split-header/…`. Its `mod.json` is `{ "place": "none", "title": "Pane header", "cloned_from": … }`. Added to it:
  - **`place(bounds)`** writes the header's `[x, y, w, h]` (rounded) into `drag-split-panes`, only when it changed. It drops panes that no longer exist. The root calls it from `on_mouse_move`, `on_mouse_down("left")` and `on_mouse_down_out` (every press anywhere), so every header's place is fresh when a drag starts.
  - **The press.** `on_mouse_down("left")` keeps `e.position` in `this.pressed`, unless it's within 48 px × zoom of the header's center. `on_mouse_up` and `on_mouse_down_out` clear it.
  - **The start.** The drag starts on whichever comes first: an `on_mouse_move` more than 6 px × zoom from the press, or `on_hover(false)` while pressed. `drag(p, name)` checks the pane can move (a terminal, a tab with two or more panes, not zoomed, no drag already), opens the overlay and sets `drag-split`.
  - Each header button gets `.on_mouse_down("left", (_e, cx) => cx.stop_propagation())`, so a press on it never starts a drag.
  - Extra `herdr` imports: `shared`, `setShared`, `spaces`, `settings`, `openOverlay`.
- **The layout.** In a personal layout (clone `main` first: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`), point the tab block's pane header at the new header:

  ```json
  "pane": { "header": { "content": { "mod": "drag-split-header" } } }
  ```

  and add the controller to the root's `floating` list:

  ```json
  { "id": "drag-split-keys", "content": { "mod": "drag-split", "props": { "role": "controller" } }, "edge": "bottom", "align": "center" }
  ```

- **The tab bar.** Herdr's `tabs` mod is read-only, so clone it (`herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'`) and point the layout's `tabs` block at `my-tabs`. Then add to the clone:

  ```js
  // imports: add setShared to the "herdr" import
  const DRAG = "drag-split", TABS = "drag-split-tabs";
  ```

  ```js
  // in init()
  this.places = {}; // each tab's window bounds, and the bar's
  this.labels = {};
  ```

  ```js
  // methods on the class
  // Where the bar and its tabs are, for a pane dropped on them. Once per press.
  place(cx, id, bounds) {
    if (bounds) this.places[id] = [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
    if (this.placing) return;
    this.placing = true;
    cx.timer.after(0, () => {
      this.placing = false;
      const live = new Set(spaces().flatMap(s => s.tabs).map(x => x.id));
      for (const id of Object.keys(this.places)) if (id !== "bar" && !live.has(id)) delete this.places[id];
      const { bar, ...tabs } = this.places, next = { bar, tabs };
      if (JSON.stringify(next) !== JSON.stringify(shared(TABS))) setShared(TABS, next);
    });
  }

  // A press on a tab that isn't shown, carried out of the bar, drags its terminals.
  dragTab(id) {
    const tab = spaces().flatMap(s => s.tabs).find(x => x.id === id);
    if (!tab || tab.active || shared(DRAG) || !panes().some(p => p.tab === id && p.terminal)) return;
    this.pressed = null;
    const overlay = openOverlay({ mod: "drag-split", props: { role: "overlay" }, kind: "window", frame: "none", at: { x: 0, y: 0 }, width: 1, height: 1 });
    setShared(DRAG, { kind: "tab", tab: id, label: this.labels[id], overlay });
  }
  ```

  In each tab item, right after `name` is worked out, record the label:

  ```js
  this.labels[c.id] = name;
  ```

  Have the tab's left press also remember the tab and report its place, and give the tab a press-outside handler:

  ```js
  .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; this.pressedTab = c.id; this.place(cx, c.id, e.bounds); if (e.click_count === 2) run("tab.rename", { id: c.id }); })
  .on_mouse_down_out((e, cx) => this.place(cx, c.id, e.bounds))
  ```

  And on the bar's root, after its `on_mouse_up`:

  ```js
  .on_mouse_move((e) => { if (e.bounds) this.places.bar = [e.bounds.x, e.bounds.y, e.bounds.width, e.bounds.height].map(Math.round); })
  .on_mouse_down_out((e, cx) => { this.pressed = null; this.place(cx, "bar", e.bounds); })
  .on_hover((hovered) => { if (!hovered && this.pressed !== null) this.dragTab(this.pressedTab); })
  ```

- **Keys:** none.
- **Art.** The header's `close`, `split-right`, `split-down`, `zoom` and `unzoom` SVGs (from Herdr's `pane` mod) and the shipped `mods/workspace-chrome/spinner.svg`.

## Watch out

- **Write `mod.json` before `main.js`.** Herdr docks a new mod folder into the layout unless its `mod.json` says `"place": "none"`. If `main.js` lands first, a 320 px block of `drag-split` appears on the right of the window. That's a blank, wasted area, and a second copy of the mod. Remove the block from the layout if it happens. For the same reason, a copy without a role must stay inert, or two controllers would run every move twice.
- **`terminal.keep` goes beside the focused pane, whichever window region that is.** Focus the anchor and wait for `focused().pane` to match before every keep. Otherwise the terminal lands in some other space's tab.
- **`terminal.park` and `terminal.keep` are asynchronous.** Wait for `panes()` to show each step before the next.
- **Parking a tab's only pane closes the tab.** A tab dragged onto the panes disappears after its last terminal moves out. That's wanted, but don't refer to its id afterwards.
- **`terminal.keep {place: "tab"}` names the new tab after the terminal** (`t1n`). Rename it to `""` so the tab bar labels it like any other tab.
- **There's no keep to the left or up.** Keep right or down, then `pane.swap`.
- **No mouse-up-outside event exists,** and move events don't say whether a button is held. So the drag lives in a window overlay over everything, which takes the release wherever it happens. Releases outside Herdr's window are lost, so any press during a drag ends it.
- **The press starts in the tab bar or a header, but the release lands in the overlay.** GPUI sends `on_mouse_up` to whatever is under the pointer, across mods. The tab bar's own `on_mouse_up` must not run a reorder for a drag, which is why `dragTab` sets `this.pressed = null`.
- **Starting a drag from a header.** Hover-out alone wasn't reliable while the button was held, so a 6 px move also starts it. Use both.
- **Herdr's grip.** Herdr draws its own pane-move grip at the top center of each pane (`movable` in the layout docs), and it takes presses there. The header leaves presses within 48 px × zoom of its center alone. That width is an estimate, not a documented size.
- **Places are window pixels,** as mouse events report them, and a mod's sizes are those divided by `settings().zoom`. Convert before drawing.
- **The pane rectangles come from the headers.** The overlay assumes headers sit at the top of each pane. With `"position": "bottom"` headers, the rectangles are wrong, so dropping onto panes misses. Dragging a pane to the tab bar still works. With no headers, nothing works: there's nothing to drag a pane by, and no pane rectangles to drop a tab on.
- **Count tab places from 1, from `space.tabs`.** `tab.move {id, index}` puts the tab at that place, counting from 1, as the shipped tab bar does (`findIndex(…) + 1`). A new tab from `terminal.keep` arrives last, so it only needs moving when its place is before the end.
- **`place()` must only write when something changed.** Every `setShared` re-renders every mod, so writing on every mouse move would redraw the window constantly. The tab bar batches its writes once per press with `cx.timer.after(0, …)`.
- **`shared` survives restarts.** The controller clears the drag and the op at start, and ignores an op more than 5 s old.
- **Clones aren't updated.** `drag-split-header` and `my-tabs` stay as they were when cloned. After a Herdr update that changes `pane` or `tabs`, clone again and redo the changes.
- **Limits.** Targets are panes of the shown tab and the tab bar of the shown space. You can't drop onto another space, and you can't drop a pane onto a hidden tab to join it. A pane must hold a terminal. Mod panes don't drag, and they're left behind when their tab is dragged.

## Done when

- `herdr-app check` passes for `mods/drag-split` and `mods/drag-split-header`, and for the patched `my-tabs`.
- With the layout and tab bar changes, the window looks as before. `herdr-app status` lists `drag-split-keys` with 0 × 0 bounds and no errors, and there's no extra block on the right.
- Dragging a hidden one-pane tab onto the right half of the shown tab's only pane shows "Split right". Letting go leaves one tab with two panes side by side, the moved terminal on the right with its scrollback, and the dragged tab gone.
- The same onto the top half puts the moved terminal above.
- Dragging that new pane's header (near its left end) up onto the tab bar, past the last tab, shows the "New tab" line. Letting go leaves two one-pane tabs, the new one last and shown. `hc` shows the same terminal ids running as before.
- Dropping a pane between two tabs puts its new tab between them.
- Dragging a hidden tab out of the bar and back onto another tab moves it to that tab's place.
- A right-click mid-drag, or letting go over the sidebar, moves nothing, and no label stays behind.
- Pressing the middle of a header still lets Herdr's grip move panes. Clicking a tab still selects it, and the header's split, zoom and close buttons still work.
