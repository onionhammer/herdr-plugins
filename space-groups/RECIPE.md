# Space groups

Name groups of spaces, such as Personal, Work 1 and Work 2, and show one group at a time. A strip of pills above the spaces list reads "All · Personal · Work 1 · Work 2 · +". Click one and the sidebar lists only that group's spaces and their agents, and Herdr goes to the space you last used there. It's a level above spaces, like virtual desktops. A space made while a group is shown joins that group. Going to a space in another group by any other route (a key, the terminal switcher, a notification) shows that space's group, so the space you're in is always listed. A dot on a pill says something in that group needs you.

## What you see

- **The strip.** A 36 px block between the sidebar's top row and the spaces list, on `chrome`, with 8 px side padding.
  - **Pills.** "All" first, then each group in its order. Each is 24 px tall, with 9 px side padding and a 7 px radius, in 12 px text, 3 px apart. Names over 120 px truncate.
  - The shown pill is `selected` with `foreground` text. The others are `muted`, and on hover they turn `hover` with `foreground` text.
  - When the pills don't fit, they scroll sideways, and the shown one scrolls into view.
  - **The + button** on the right is 24 × 24 with a 6 px radius: a 13 px plus in `dim`, `hover` behind it on hover, tooltip "New group". Until there's a group it reads "+ New group".
- **Attention dots.** A 6 px dot after a pill's name, in `blocked` or `done`, when an agent in one of that group's spaces is blocked or finished unseen. Blocked wins. "All" speaks for spaces in no group. The shown pill never has one, because its list is in view. Working gets no dot, the same as Herdr's own spaces list.
- **The spaces list** shows only the shown group's spaces, in Herdr's order, with worktrees under their repo. It's otherwise Herdr's own list.
  - An empty group says "No spaces in Work 1 yet." in 12 px `dim`, followed by two rows: "+ New space" and "Choose spaces…".
  - With other machines, their headers stay. A machine with none of the group's spaces shows its usual "New space there".
- **The agents list** shows only agents in the shown group's spaces, in its usual priority or grouped view. When none are there, it says "No agents in Work 1."
- **The group dialog** (+, or Edit). It's 420 px wide and as tall as 12 spaces need; past that, the list scrolls. Herdr's prompt look: `popover`, 18 px padding.
  - The title is "New group" or "Edit group", with an "Esc" hint.
  - **Name** is a 36 px input with a 9 px radius, outlined in `accent` while it has the keyboard. The placeholder is "Personal, Work…".
  - **Spaces** lists every space, on every machine, in sidebar order. Each 30 px row holds:
    - A 16 px checkbox, `accent` with a check when ticked.
    - The space's avatar: 18 px, its letter on its `space.colors` color, as the sidebar draws it.
    - Its name, then its machine in 11 px `dim` for a space elsewhere.
    - When the space is in another group, that group's name, or "from Work 1" once ticked.
  - The footer: "Delete group" on the left (Edit only), then Cancel, then Create or Save. The primary button is dimmed until there's a name.
- **A group's menu** (right-click a pill), in Herdr's menu look:
  - Edit group…
  - Move left, Move right (when there's room)
  - A line, then Delete group
- **On the narrow rail** (a sidebar under 160 px), the strip is one 32 × 26 cell. It shows the shown group's initial in 12 px semibold, or a layers icon for All, and its tooltip names the group. A 6 px dot sits at its top right when another group needs you. Clicking it opens the groups as a menu:
  - All spaces, then each group, with a check by the shown one and dots as on the pills
  - A line, then New group…, and Edit *group*… while a group is shown

## How it behaves

- **Showing a group.** Click its pill.
  - Unless the shown space is already in that group, Herdr goes to the space you last used in it, or else its first space.
  - "All" lists every space and doesn't change space.
  - An empty group changes nothing but the lists.
- **Making a group.** Use + (or New group… on the rail), type a name, tick spaces and press Create or Enter. The new group is shown at once. A blank name does nothing.
- **Editing.** Double-click a pill, or right-click it and pick Edit group…, to rename it or change its spaces.
  - Ticking a space that's in another group moves it here. A space is in one group at most.
  - Unticking a space puts it back in no group. Such spaces are listed only under All.
  - "Choose spaces…" in an empty group's list opens the same dialog.
- **Order.** Move left and Move right in a pill's menu reorder the groups.
- **Deleting.** Delete group in the menu or the dialog, then click again to confirm. It closes nothing. The group's spaces go back to no group, and if it was shown, All is shown.
- **New spaces join the shown group,** however they're made: the + in the spaces header, a worktree, `hc` or a script. Under All, a new space is in no group.
- **The list follows you.** Going to a space outside the shown group by any other route shows that space's group, or All for a space in none. That covers Alt+1…9, Ctrl+Shift+PageUp/PageDown, the terminal switcher, the search, and a notification. Only a change of space does this: a group you picked stays shown even when the shown space isn't in it (an empty group, say).
- **Keys.** Alt+PageDown and Alt+PageUp step through All and then the groups, wrapping around, as if you'd clicked the pill.
- **Agent keys stay in the group.** The agents list hands Herdr its filtered order, so Alt+Up and Alt+Down (`agent.next` / `agent.prev`) move between the shown group's agents.
- **Agent status.** Working, blocked, done and idle look as in Herdr's lists. In a group that isn't shown, blocked and done put a dot on its pill instead, and working and idle stay quiet.
- **Everything is remembered.** The groups, which space is in which, the shown group and each group's last space persist across restarts.

## Built from

- **`mods/space-groups/`**: `main.js` and `mod.json` (`{ "place": "none", "title": "Space groups" }`). One mod, told apart by `props.role`. A copy with no role draws an empty `div()` and does nothing.
  - **`"bar"`** is the strip, a layout block. It does three things.
    - It draws the pills.
    - Its `nextCommand()` loop takes `next`, `prev`, `new` (the dialog for a new group) and `edit` (the dialog for the shown group, or a new one under All).
    - On every render, `track()` keeps the groups in step with the spaces, and writes only when something changed:
      1. **New spaces.** A space id not seen this run, on a machine that was `ready` at the previous render, was just made. It joins the shown group. Ids that arrive with a machine that's still loading are only noted.
      2. **Forgetting.** Entries for deleted groups go, and so do spaces no longer listed on a machine that's `ready` now and was at the previous render.
      3. **Following.** When the active space changes to one outside the shown group, the shown group becomes that space's group, or null.
      4. **Last space.** The active space is recorded as its group's last.
  - **`"edit"`** is the dialog, `openOverlay({ mod: "space-groups", kind: "dialog", width: 420, height: 262 + 30 × min(12, spaces), props: { role: "edit", group } })`. `group` is null for a new one. It's built like Herdr's `prompt` mod: an `InputState` that takes focus in `init` and again 600 ms later, with `submit` saving. New group ids are `g` plus `Date.now()` in base 36.
  - **`"menu"`** (`props.group`) and **`"pick"`** are popups in Herdr's `menu` look: ↑/↓ move, Enter runs, Esc closes. Delete is marked `confirm`: the first click only changes its label to "Click again to delete", in `blocked`.
  - **Shared state**, `shared("space-groups")`:

    ```js
    { groups: [{ id, name }], of: { [spaceId]: groupId }, shown: groupId | null, last: { [groupId]: spaceId } }
    ```

    It's read defensively: a missing or malformed field counts as empty, and a `shown` that names no group means All. Space ids are as `spaces()` gives them, `machine/` prefix included.
  - **Showing a group:** `setShared` with the new `shown`, then `space.select {id}` for its last or first space, unless the active space is in it.
  - From `herdr`: `spaces`, `machines`, `run` (`space.select`), `theme`, `shared` / `setShared` (`space-groups`, and `space.colors` read for avatars), `props`, `openOverlay` / `closeOverlay`, `nextCommand`, `layout` (the sidebar's width, for the rail).
- **`mods/space-groups-spaces/`**: Herdr's `spaces` list, cloned (`herdr-app do mod.clone '{"name":"spaces","as":"space-groups-spaces"}'`, from spaces 0.1.15). Added to it:

  ```js
  // Space groups (the space-groups mod): the group the sidebar shows, or null
  // when it shows every space.
  function shownGroup() {
    const g = shared("space-groups");
    const group = Array.isArray(g?.groups) ? g.groups.find((x) => x?.id === g.shown) : null;
    return group ? { ...group, has: (space) => g.of?.[space] === group.id } : null;
  }
  ```

  At the top of `grouped()`, filter what `ordered()` returns, and note an empty group:

  ```js
  const group = shownGroup();
  const rows = this.ordered().filter((r) => !group || group.has(r.w.id));
  const none = group && !rows.length && !collapsed ? [this.none(t, group)] : [];
  ```

  Put `...none` before the rows in both of `grouped()`'s returns: `[...none, ...rows.map(draw)]` and `[...none, ...machineNames.flatMap(…)]`. `none(t, group)` draws the "No spaces in … yet." text and two link rows, 28 px, 12 px `dim` text with a 12 px icon, `hover` on hover. "New space" runs `space.new`. "Choose spaces…" runs `space-groups.edit`, which reaches the bar's `nextCommand()`.
- **`mods/space-groups-agents/`**: Herdr's `agents` list, cloned the same way (from agents 0.1.15). The clone's sort popup opens `space-groups-agents` (`mod.clone` rewrites that). Added to it:
  - The same `shownGroup()`.
  - Right after `this.track(list, now);` in `render`:

    ```js
    const group = shownGroup();
    if (group) list = list.filter((a) => group.has(a.space));
    ```

  - The empty text becomes `` group ? `No agents in ${group.name}.` : "No agent status yet. …" ``.
- **The layout.** In a personal layout (clone `main` first: `herdr-app do layout.clone '{"name":"main","as":"my-main"}'`), put the strip in the `sidebar` column right after `brand`:

  ```json
  { "id": "space-groups", "type": "block", "content": { "mod": "space-groups", "props": { "role": "bar" } }, "size": { "px": 36 } }
  ```

  Then point the `spaces` and `agents` blocks at the clones: `"content": { "mod": "space-groups-spaces" }` and `"content": { "mod": "space-groups-agents" }`.
- **Keys** (`keys.json`): `"alt-pagedown": "space-groups.next"` and `"alt-pageup": "space-groups.prev"` in `global`.
- **Art.** Herdr's own `mods/workspace-chrome/` icons: `plus`, `layers`, `check`, `square-pen`, `chevron-left`, `chevron-right` and `x`.

## Watch out

- **Write `mod.json` before `main.js`.** Herdr docks a new mod folder into the layout unless its `mod.json` says `"place": "none"`.
- **Filter after ordering.** The spaces list's `ordered()` runs `space.move` to put worktree spaces under their repo's. Filtering its input instead of its output would make it shuffle the real space order.
- **Spaces that arrive with a machine aren't new.** At start, and whenever a machine finishes loading, its spaces appear all at once. Only a space on a machine that was already `ready` at the previous look counts as made just now. Otherwise starting Herdr would pour every space into the shown group.
- **Bookkeeping runs on the bar's renders,** and Herdr doesn't render mods while the window isn't drawn (minimized, say). It catches up on the next render: a space made meanwhile is still new to it and joins the shown group, and a space switch meanwhile is followed.
- **Save once.** Enter in the name field can reach both the input's `submit` and the dialog's own key handler. Without a guard, a new group gets made twice.
- **`herdr-app check` can't pass props,** so it only ever renders the role-less copy, which draws nothing. Check the roles in the app.
- **Herdr's space keys don't know about groups.** Alt+1…9 and `space.next` / `space.prev` count every space. Going to one in another group shows that group, so nothing is hidden, but the numbers aren't per group.
- **Only the sidebar is filtered.** The terminal switcher, the search, the tab bar and the status bar still see every space. Pinned agents in a hidden group are hidden with it.
- **Clones aren't updated.** `space-groups-spaces` and `space-groups-agents` stay as they were when cloned. After a Herdr update that changes `spaces` or `agents`, clone again and redo the few lines above. A clone also starts with its own empty `localStorage`. The agents list's "for how long" times start over, and folded machine sections unfold.
- **One list of groups per window.** `shared` lives in this window's `shared.json`, so groups aren't shared with other Herdr clients. A space on another machine keeps its group while that machine is away.
- **Each `setShared` re-renders every mod,** so `track()` compares before it writes, and a switch of space within a group writes once (its new last space).

## Done when

- `herdr-app check` passes for `mods/space-groups`, `mods/space-groups-spaces` and `mods/space-groups-agents`. `herdr-app status` shows no errors.
- With the layout changes and no groups yet, the sidebar looks as before, plus a strip with an "All" pill and "+ New group".
- + → "Work", ticking two spaces, then Create:
  - The strip reads "All · Work" with Work shown.
  - The spaces list shows just those two, the agents list just their agents, and the shown space is one of them.
- Clicking All lists every space and stays in the same space. Clicking Work goes back to the space last used in Work.
- With Work shown, the spaces header's + makes a space that stays listed under Work.
- With Work shown, Alt+1 to a space in no group shows All.
- An agent turning blocked in a hidden group puts a `blocked` dot on that group's pill. Going there clears it.
- Right-click Work → Delete group, then again: Work goes, and its spaces are listed under All.
- Alt+PageDown steps All → Work → … → All.
- On the narrow rail, the strip is one cell showing the shown group's initial. Clicking it lists the groups, and picking one shows it.
