# Decision Debt Tracker

A small desktop application for decisions you have postponed. It records what is
being deferred, how expensive the delay is becoming, and makes sure the decision
comes back up for review instead of quietly rotting.

Postponed decisions are invisible in a way postponed tasks are not. A task sits on
a list; an unmade decision leaves no trace at all, so it keeps accruing cost —
options close, work stalls, and nobody notices until it is urgent. This app makes
that cost explicit and finite.

The whole product is one loop: **Capture → Review → Resolve.**

- **Capture** a decision with its context, the people affected, why it was delayed,
  a review date, and a decay level.
- **Review** the open decisions, ordered by how expensive further delay is and how
  soon each one is due. Overdue decisions are called out.
- **Resolve** a decision by recording the outcome, which closes it and takes it out
  of the way.

It is deliberately not a task manager, a project planner, a calendar, or an
analytics dashboard.

## Screens

**Reviewing what is open.** Decay sets the order; overdue decisions are washed and
their lateness stated in days. The detail pane carries the full context, who is
affected, and why it stalled. Double-clicking a row opens it for editing.

**Capturing, editing, resolving.** `Ctrl+N` or the New Decision button opens a form
with the title, context, people involved, reason delayed, review date and decay
level. Enter saves and Escape cancels; validation reports per-field errors in place
rather than in a message box. Resolve asks for the outcome and the date it was
settled, then takes the decision out of the open list.

**The week, counted.** How many were resolved this week, how many are still open, and
what has been outstanding longest.

## Requirements

- Node.js 22.13 or newer — the build and tests use the built-in `node:sqlite` and
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

`Delete` is deliberately not a menu accelerator: it belongs to whatever text field
has focus.

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

**The data model is one table.** `decisions` holds exactly the fields the product
needs, and the SQLite column names match the TypeScript field names so a selected
row is a `Decision` with no mapping layer in between. `overdue` and `age` are
derived at render time rather than stored, so they can never go stale.

**Decay level is the primary sort key.** It answers "how expensive is another week
of not deciding?", which is the question the app exists to surface. The default
ordering is decay (high first), then the earliest review date. The Decision, Decay
and Review headers are clickable and re-sort the list; the review date is always
the tie-breaker.

**Dates are calendar dates, not instants.** `review_date` is a `YYYY-MM-DD` string
in the user's local calendar, and day arithmetic goes through UTC day numbers so it
stays correct across daylight-saving boundaries. `created_at` and `resolved_at` are
genuine instants; a backdated resolution is stamped at local noon so the stored
instant can never drift onto the neighbouring calendar day.

**A week is Monday to Sunday.** The weekly summary counts decisions whose resolution
falls inside the current week and reports what is still open. Nothing more.

**Validation lives in `shared/`.** The same rules run in the dialog for immediate
feedback and in the main process before anything is written, so the store cannot be
persuaded to accept a decision the interface would reject.

**The renderer has no privileges.** It runs with `contextIsolation`, `sandbox` and
no Node integration, with a content security policy that permits only the app's own
files. Everything it can do is the narrow set of calls on `window.ddt`. The native
menu owns the `Ctrl` accelerators and forwards intent to the renderer as commands,
so a shortcut is defined in exactly one place.
