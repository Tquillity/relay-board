# Relay Board

The Relay Board is a live dashboard of all Claude agent work across the user's projects. It is a private claude.ai artifact:

**<your-board-url>**

- One tab per project, with one card per chat ("workstream"): status, current task, steps, blockers, PR, recent activity.
- A cross-project **Needs you** list: tasks, approvals and decisions only the user can handle. The user can answer them on the board, and the answer is relayed back to the chat that asked.
- A progress indicator in the header for the open project, for example `22% / 100% − 12%`. The first number is the share done; the orange one is the share waiting on the user.
- Plan usage bars (weekly all models, weekly Fable, 5-hour) with projections.
- A History section per project. Done items fold away at once, move to History after 7 days, and after 30 days are squeezed into one archive record per project and month, so the board never fills up.

Agents write the data; the page does all the analysis (quiet-chat detection, "Since you last looked" digest, activity feed, usage projections). This keeps the agents' token cost low.

The page is a single file, [`index.html`](index.html). It uses the artifact `db` capability and is pinned to runtime contract `0.2.60`.

The data model and agent rules are in [`PROTOCOL.md`](PROTOCOL.md).

## Publish a change

Use the `Artifact` tool:

```
action:    publish
url:       <your-board-url>
file_path: C:\DEV\relay-board\index.html
```

- Leave out `capabilities`. The `db` capability then carries over from the current version.
- Leave out `icon`. The board keeps its icon.
- Leave out `contract`. The board stays on its current runtime version.
- Always publish to this URL. Publishing without `url` creates a separate board.

Commit every published change, so `main` always matches what is live.

## Verify a change

1. Check that the page script parses. Extract the `<script>` body and run `node --check` on it once (Git Bash or any POSIX shell):

   ```bash
   tr -d '\r' < index.html | sed -n '/^<script>$/,/^<\/script>$/p' | sed '1d;$d' > "${TMP:-/tmp}/board.js" && node --check "${TMP:-/tmp}/board.js"
   ```

   This expects the page's single `<script>` and `</script>` tags each alone on a line at column 0.

2. After publishing, run one `ArtifactData` `list` for each collection the change touches (`projects`, `streams`, `needs` or `usage`). Check that the documents still have the shape the page expects.

## No secrets

This repo is public. It must never contain secrets: no tokens, keys, passwords or connection strings, and no data copied from the board's database. The board URL is fine to publish, because the artifact itself is private.

## Not yet verified

- The answer relay (answered → relayed → handled via `send_message`) has not been exercised end to end.
- The `claude://` "Open chat" links may not open from inside the artifact.
- The last-week-rhythm usage projection needs a full week of readings before it kicks in.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The page source, identical to the published version |
| `PROTOCOL.md` | Data model and the rules agents follow when writing to the board |
| `CLAUDE.md` | Local-only agent rules for this repo (git-excluded) |
