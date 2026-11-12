# Scratch pad

A page of notes for each space. It's a third panel beside Herdr's Files and Changes: a "Notes" button in the tab bar, or Ctrl+Shift+S, opens a card on the right of the shown tab where you just type. Every space has its own page. A page is a plain markdown file, saved as you type, so an agent or an editor can read and write it too.

## What you see

- **The Notes button.** In the tab bar after Files and Changes, drawn exactly like them: 26 px high, a 14 px pen icon and "Notes" in 12 px, `muted` on `chrome`, and `foreground` on `selected` while its panel is open.
- **The panel.** The same card, in the same place and at the same width as Files and Changes: `background`, a 1 px `border` line, a 10 px radius. Only one of the three shows at a time. Drag the panel's left edge to resize it, as for the others.
- **Its header.** 42 px with a 1 px `border` line underneath: "Notes" in 13 px semibold `foreground` on the left, the space's name in 12 px `dim` on the right.
- **The page.** The rest of the card: one text area with 12 px padding, in the terminal font at 13 px. Long lines wrap. An empty page says "Notes for this space…".
- **Nothing else.** The copy that takes the key floats on the layout's root and draws nothing (a 0 × 0 float).

## How it behaves

- **Ctrl+Shift+S**
  - Panel closed, or showing Files or Changes: it opens on Notes and the keyboard goes to the page.
  - Notes open, keyboard somewhere else: the keyboard goes to the page.
  - Notes open and you're typing in it: the panel closes and the keyboard goes back to the pane you were in.
- **The Notes button** opens and closes the panel like the Files and Changes buttons do. It doesn't move the keyboard; click in the page to type.
- **Ctrl+X** (Cmd+X on macOS) in the page, as in VS Code:
  - Something selected: cuts it, as usual.
  - Nothing selected: cuts the caret's whole line with its line break, and the clipboard holds the line plus `\n`. The caret goes to the start of the line that took its place, so Ctrl+V there puts the line back above it; Ctrl+X again takes the next line.
  - On the last line, the line break before it goes instead, and the caret goes to the start of the line above. On an empty page nothing happens and the clipboard is left alone.
  - One Ctrl+Z puts it back. The key does nothing new anywhere else: terminals and other mods' text fields keep theirs.
- **Each space has its own page.** Switching spaces switches the page. Which panel a space shows (Files, Changes, Notes or none) is remembered per space by the tab bar, as it already is for Files and Changes.
- **Saving.** A page is saved 0.6 s after you stop typing, when the keyboard leaves it, when you switch spaces, and when Herdr closes. There's no save key and nothing to name.
- **Where it's kept.** `~/.config/herdr-app/scratch-pad/<space id>.md`; a space on another machine is `<machine>--<space id>.md`. The files stay on this computer. A page that was never typed in has no file.
- **Edited from outside.** When something else changes a page's file, the panel shows the new text within a second or so. If you've typed something that isn't saved yet, yours wins.
- **A closed space** keeps its file. Nothing deletes notes.
- **Agent status:** none. The panel shows no agents.

## Built from

- **`mods/scratch-pad/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Scratch pad" }`). One mod, two copies told apart by `props.role`:
  - `"pad"` (the default) is the panel. It holds one `TextareaState`, and a map of pages by space id (`{ path, text, disk }`: what's typed and what the file held when last read or written). After every render (`cx.timer.after(0, …)`) it shows the shown space's page.
  - `"controller"` floats on the layout root and draws an empty `div()`. Floats are always shown, so it gets `scratch-pad.toggle`, `.show` and `.hide` from `nextCommand()` while the panel is hidden (commands only reach shown copies). It opens the panel with `layout.select {stack: "panel-body", child: "scratch-pad"}` and `layout.show {id: "panel"}`, then sets `shared("scratch-pad")` to `{ focus: <now> }`. The pad sees a new `focus` on its next render and takes the keyboard.
  - A shown pad answers `toggle` itself, because only it knows whether the page has the keyboard (the text state's `focus` and `blur` events).
  - **The cut key.** The pad's card declares `key_context("ScratchPad")` and `on_action("scratch_pad_cut", …)`. In `init` the pad calls `cx.bind_keys([{ keystroke: "ctrl-x", action: "scratch_pad_cut", context: "ScratchPad > Input" }])` (`"cmd-x"` when `window().platform` is `"macos"`). The handler `cut(cx)` works out what to cut, does it with `set_selected_range` + `replace("")`, and writes the clipboard with `cx.write_to_clipboard`.
  - From `herdr`: `readTextFile`, `writeTextFile`, `watchFolder`, `run` (`layout.select`, `layout.show`, `layout.hide`, `pane.focus`), `layout`, `spaces`, `panes`, `focused`, `shared` / `setShared`, `settings`, `theme`, `props`, `notify`, `nextCommand`, `appHome`, `window`. From `fs/promises`: `mkdir`.
- **The layout.** In a personal layout (clone `main` first: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`), add the pad to the `panel-body` stack, after `files` and `changes`:

  ```json
  { "id": "scratch-pad", "type": "block", "content": { "mod": "scratch-pad" } }
  ```

  and the controller to the root's `floating` list:

  ```json
  { "id": "scratch-pad-keys", "content": { "mod": "scratch-pad", "props": { "role": "controller" } }, "edge": "top", "align": "end" }
  ```

  The ids `panel`, `panel-body` and `scratch-pad` are fixed in `main.js`.
- **The button.** The tab bar is Herdr's `tabs` mod, which is read-only, so clone it (`herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'`), point the layout's `tabs` block at `my-tabs`, and change two lines in the clone's `render()`:

  ```js
  // was: this.syncPanel(space, panel, body, enabled);
  this.syncPanel(space, panel, body, [...enabled, "scratch-pad"]);
  ```

  ```js
  // after the "changes" panelButton line
  .when(Boolean(find(body, "scratch-pad")), el => el.child(panelButton("scratch-pad", "Notes", "mods/workspace-chrome/square-pen.svg")))
  ```

  The first makes the tab bar remember Notes per space like Files and Changes. The second draws the button when the layout has the pad.
- **Keys.** `keys.json`'s `"global": { "ctrl-shift-s": "scratch-pad.toggle" }`. `scratch-pad.show` and `scratch-pad.hide` can be bound too.
- **Art.** The shipped `mods/workspace-chrome/square-pen.svg`.

## Watch out

- **Without the tab bar change** the key still works, but there's no button, and the shipped tab bar closes the panel when you come back to a space that was showing Notes (it only restores panels it knows).
- **A clone isn't updated.** `my-tabs` stays as it was when cloned; after a Herdr update that changes the tab bar, clone again and redo the two lines. A fresh clone also starts without the old tab bar's memory of which panel each space had open.
- **"No file" and "empty" are the same page.** A page that was never saved has no file (`disk` is null) and its text is `""`. Treat that as clean, or an outside edit to a new file is never picked up and an empty file is written for every space you look at.
- **Setting the text fires `change`.** The change handler compares the text area with the page's known text and does nothing when they match, so loading a page doesn't count as typing.
- **Watched paths** can come back spelled differently from the one asked for (`\\?\C:\…` on Windows). Match a changed path by its end (`/scratch-pad/<file>`), not by equality.
- **Saves use `writeTextFile`'s expected text.** If the file changed underneath, the write is refused; the mod reads the file again and writes over it, so what's typed here wins.
- **`fs.mkdir` throws** when the mod is checked from a folder outside Herdr's (`herdr-app check` on a repo copy). Catch it, or the check fails.
- **A restart mustn't steal the keyboard.** `shared` is kept across restarts, so the pad only acts on a `focus` request less than 3 s old.
- **The text area binds Ctrl+X itself**, to a plain cut in its own `Input` context, and key-down handlers only see a key that no binding took. A binding in the pad's `"ScratchPad"` context alone is shallower and loses. Bind in `"ScratchPad > Input"`: that's the text area's depth, and the newer binding wins there. `bind_keys` is app-wide, so never bind the bare `Input` context: that takes Ctrl+X from every text field in Herdr.
- **The text state can't say where the caret is.** It has `set_selected_range` and `replace`, but no getter. `cut` replaces the selection with a marker character no page holds (U+E000, or the next free one). The marker's index is the caret, and how much the text shrank is the selection's length. Then it removes the line, or the marker alone, with one more `replace`. Both edits land in the same instant, so the text area's undo, which groups edits made close together, takes them back as one. Don't rebuild the text with `set_value`: that bypasses undo history.
- **Ranges are JavaScript string indices** (UTF-16, so an emoji is 2). `set_selected_range` refuses a backwards range (`start > end`).
- **Monaco or another web editor can't be used.** Mods have no web view. The built-in `Editor` (`EditorState`) has line numbers, syntax colors and folding, but its state has no `focus()`, `set_selected_range` or `replace`. With it, Ctrl+Shift+S couldn't put the caret in the page, and Ctrl+X couldn't cut lines.
- **Pane keys from the page.** While the page has the keyboard, `pane.go` and the other pane keys act on the pane you were in before, since the panel isn't a pane.
- **Limits.** One page per space, plain text, up to 1 MiB (what `readTextFile` reads). Notes for a space on another machine are kept on this computer, so another computer's Herdr doesn't show them.
- **One layout.** In a layout without the pad block, the key posts a warning toast.

## Done when

- `herdr-app check mods/scratch-pad` passes, from Herdr's folder and from a copy outside it. With `props.role` set to `controller`, it passes too.
- With the layout, tab bar and key added, the window looks as before except for a Notes button after Changes, and `herdr-app status` lists `scratch-pad-keys` with 0 × 0 bounds.
- Ctrl+Shift+S opens the panel on Notes with the caret in the page. Typing shows up, and half a second later `scratch-pad/<space id>.md` holds it.
- Ctrl+Shift+S again closes the panel, and typing goes to the pane you came from.
- In a second space the page is empty; typing there makes a second file. Switching back shows the first space's notes, and its panel as you left it.
- In the page, with three lines and the caret in the middle one, Ctrl+X leaves the first and third. The clipboard holds the middle line and a line break, and Ctrl+V puts it back. Ctrl+Z after a Ctrl+X restores the line in one step. With a word selected, Ctrl+X cuts only the word. Ctrl+X in a terminal still reaches the program.
- With the panel open, appending a line to the space's file from a shell shows the line in the panel. Deleting the file empties the page.
- The Notes, Files and Changes buttons swap the one panel between the three, and the lit button is the one showing.
- After a restart with Notes open, the notes are there and the keyboard is still in the terminal.
