# Timetracker

A small web app for tracking employee working time: employees, a start/stop timer with a task description,
and reports for any period. English only. All sample data is fictional.

Stack: **Node.js >= 18, no external dependencies** (built-in `http`, `fs`, `node:test`) and a single
`public/index.html` written in plain JavaScript with inline SVG charts.

## Run

```bash
npm start                            # http://localhost:3000
PORT=8080 npm start                  # another port
DATA_FILE=/path/to/db.json npm start # another storage location
npm test                             # automated checks
```

Nothing needs to be installed (`npm install` is not required). Data is stored in `data/db.json` and survives restarts,
including a timer that was running when the server stopped.

## Features

- **Overview** (opens first): four summary cards (employees, active timers, hours in period, tasks in period), a
  "Team status" donut (who is working right now), "Hours by employee" bars, a work timeline (one lane per employee,
  one coloured segment per task, the running task is striped, hover for details) and "Time by task" (identical task
  names are merged, case-insensitively). Charts are inline SVG, no libraries.
- **Employees**: add employees (whitespace is normalized, duplicates are rejected case-insensitively).
- **Timers**: start and stop a timer with a task description. One active timer per employee.
- **Report**: pick a period (from/to, plus Today / 7 days / This month) and see entries per employee with totals.
  The period is shared with Overview, which shows it under its title with a "Change period" link.
- Sidebar navigation: pages switch inside the same window without reloading (hash URLs such as `#report`, so the
  browser back/forward buttons and bookmarks work). The Timers item shows a count of running timers. On narrow
  screens the sidebar becomes a horizontal bar. Content is centered, and light/dark themes follow the system.
- A period includes both dates. An entry crossing a boundary counts only inside the period; a running timer counts
  up to the current moment, and the report refreshes every 5 seconds while a timer is running.

## Structure

| File | Purpose |
|---|---|
| `store.js` | all logic and storage (JSON file, atomic write via temp file + `rename`) |
| `server.js` | HTTP API and the page |
| `public/index.html` | the interface |
| `test/app.test.js` | automated checks |

API: `GET/POST /api/employees`, `POST /api/timers/start`, `POST /api/timers/stop`,
`GET /api/report?from=<ms>&to=<ms>` (period `[from, to)`). Errors return `{ error, code }`.

## Tests (`npm test`, 11 scenarios)

Adding an employee (empty name, duplicate) · start, stop and duration in the report · **starting a timer twice**
(409, the first entry is untouched, starting again after stopping works) · stop without start, empty task, unknown
employee · **empty report** (no employees; a period without entries) · boundary entries and invalid periods · a
running timer in the report · **persistence after restart** · corrupted data file · full HTTP scenario with status
codes · the home page is served as HTML. Time is injected (`new Store(file, now)`), so durations are asserted exactly
without sleeping. A real process restart was also checked manually: an employee created before stopping the server
is still there after starting it again.

The tests run on Node only and cannot see the browser UI. The UI was checked separately in a jsdom emulation
(outside this repository) with mocked and real-server data, and by looking at screenshots you send back; the AI did
not look at the rendered page itself.

## AI tools and models

- **Claude Sonnet 5.5** (Anthropic) in claude.ai: design, code, tests and this README.
- The code-execution sandbox of the same chat (Node v22) ran the tests, the restart check and the jsdom UI checks.
- No other AI tools were used.

### Requests used in this project (paraphrased)

1. "Build a small web app for tracking employee working time from scratch: add employees, a start/stop timer with a task
   description, entries and total time per employee for a period, persistence across restarts. No auth, fictional data.
   In the README describe how to run it, the AI tools and models, example prompts, and the bugs you found and fixed. Add
   checks, including starting a timer twice and an empty report."
2. "Make it a nicer design, with a sidebar of tabs that open in the same window." 
3. "Add a work timeline for employees and tasks to the report, plus a donut and a bar chart like this screenshot."
4. "Move those blocks to a separate first tab called Overview, with stat cards at the top, and center the content."
5. "Remove the period block from Overview, it already exists in Report."
6. "Make the whole project English only, no other language and no language switcher."

## Bugs found and fixed

Found by running and testing:

1. **The `public/` and `test/` folders were not created.** `mkdir -p dir/{public,test}` does not expand braces in
   `/bin/sh`, so a folder literally named `{public,test}` appeared and writing the files failed. Fixed with `mkdir -p public test`.
2. **`npm test` failed on Node 22** ("Cannot find module .../test"): `node --test test/` treats the folder as a module.
   Fixed: the script is `node --test`, which finds `test/*.test.js` itself.
3. **The test suite hung.** The HTTP test called `srv.close()`, but keep-alive connections from the built-in `fetch`
   kept the server open. Fixed with `srv.closeAllConnections()` before `close()`.
4. **The home page opened as `{"type":"Buffer","data":[...]}`.** `index.html` was read as a `Buffer`, and `send()` only
   passed strings through unchanged and turned everything else into JSON. The tests did not catch it because they only
   checked the status code. Fixed in `send()`, and a test now checks `Content-Type` and the `<!doctype html>` start.
5. **Typing in the input fields was impossible.** Handlers like `onkeydown = e => e.key === 'Enter' && ...` return
   `false` for every other key, and returning `false` from a handler property cancels the keystroke. Fixed with `if`.
   Verified in jsdom: a keypress was blocked before the fix and is not blocked after.
6. **The report froze at request time.** A running task showed `0:00:00` while the timer card was already counting,
   because the running duration is computed by the server at request time and the page never refreshed it. Fixed: the
   report reloads every 5 seconds while a timer runs and an Overview or Report page is open, and on entering the page.
7. **"Request failed" explained nothing.** An unreachable server (stopped or restarted while the page was open) and a
   code error looked the same. Now an unreachable server shows "Cannot reach the server. Check that it is running",
   and unexpected code errors are printed to the browser console (F12).

Noticed in code review (not confirmed by tests):

8. After a server error (for example 409 on a second start) the UI refreshed the employee list but not the report.
   `act()` now always re-reads the state from the server.
9. Report periods are half-open `[from, to)` and the date boundaries are computed in the browser in local time (the last
   day is included by adding one day), which avoids off-by-one-day shifts for users outside UTC and double counting at
   the seam between periods.

## Limitations

- Storage is a single JSON file: fine for a small team and one server process; several servers would need a database.
- No editing or deleting of entries or employees, and no authentication (by design).
