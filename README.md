# Decision Debt Tracker

1 loop- capture review resolve

## Screens

detailed analyses along w keybinds

## Requirements

- Node.js 22.13 or newer since the build and tests use the built-in `node:sqlite` and
  `node --test`. Developed against Node 24 and Electron 44.
- Windows, macOS, or Linux

## Running it

```sh
npm install
npm start
```

`npm start` compiles the TypeScript and launches the Electron app.

If the app fails to launch because `node_modules/electron/dist` is missing, your
package manager skipped Electron's install script. Fetch the binary once:

```sh
node node_modules/electron/install.js
```

## Tests and checks

```sh
npm test         # compiles, then runs the store/validation/date suites
npm run typecheck
```

The tests exercise the persistence layer, validation rules, date arithmetic and
ordering against an in-memory database. They do not need Electron.

## Where your data lives

A single SQLite file in the per-user application data directory:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\decision-debt-tracker\decisions.db` |
| macOS | `~/Library/Application Support/decision-debt-tracker/decisions.db` |
| Linux | `~/.config/decision-debt-tracker/decisions.db` |

Persistence uses Node's built-in `node:sqlite`, so there are no native modules to
compile and nothing to rebuild when Electron is upgraded. Writes go through SQLite
in WAL mode, so the file survives an unexpected shutdown.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl+N` | New decision |
| `Ctrl+E` | Edit the selected decision |
| `Ctrl+R` | Resolve the selected decision |
| `Ctrl+F` | Focus search |
| `Ctrl+1` / `Ctrl+2` | Open Decisions / Weekly Summary |
| `↑` `↓` `Home` `End` | Move through the list |
| `Enter` | Open the selected decision |
| `Delete` | Delete the selected decision (while the list has focus) |
| `Esc` | Close a dialog, or clear the search box |
| `Ctrl+Enter` | Save from inside a dialog |


## Project layout

```
src/
  main/          Electron main process
    main.ts        window and application lifecycle
    menu.ts        native application menu and accelerators
    ipc.ts         the IPC boundary, including payload narrowing
    store.ts       SQLite schema, queries and ordering
  preload/       context-isolated bridge exposing window.ddt
  renderer/      the interface
    index.html     static shell: toolbar, list, detail pane, dialogs
    styles.css     all styling
    app.ts         state, IPC wiring, keyboard, status bar
    list.ts        the decisions table
    detail.ts      the detail pane
    dom.ts         the few shared DOM and message helpers
    editor.ts      create/edit dialog
    resolve.ts     resolve dialog
    summary.ts     weekly summary view
  shared/        code used by both processes
    model.ts       the Decision type and domain constants
    dates.ts       calendar-date arithmetic and formatting
    validation.ts  the input rules, enforced on both sides of IPC
    api.ts         the shape of the preload bridge
test/            node:test suites
scripts/         the renderer bundling step
```

## Design notes

**The data model is one table.** 

**Decay level is the primary sort key.** 

**Dates are calendar dates, not instants.** 

**A week is Monday to Sunday.** 


**Validation lives in `shared/`.** The same rules run in the dialog for immediate
feedback and in the main process before anything is written, so the store cannot be
persuaded to accept a decision the interface would reject.

**The renderer has no privileges.** 
