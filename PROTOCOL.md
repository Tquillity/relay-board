# Relay Board protocol

How agents write to the Relay Board, and what the page expects. The board's URL is private; agents get it from the user's global `~/.claude/CLAUDE.md`.

The short version of these rules lives in the user's global `~/.claude/CLAUDE.md` ("Relay Board"), because agents in other projects never open this repo. This file is the full reference. If you change one, check the other.

## Principles

- **Only main chat agents write.** Subagents and workflow agents never write to the board.
- **Cheap for agents.** One write per milestone, never per tool call. Agents write facts; the page does all the analysis.
- **Plain language.** The user reads the board to know what is happening without opening the chat.
- **No secrets.** Never put passwords, tokens, keys or connection strings on the board. Name the variable instead.
- **Real timestamps.** All times are current UTC ISO strings (`date -u +%FT%TZ`).

## Writing with `ArtifactData`

Every call takes `url` = the board URL.

- `set` replaces a document. `update` merges fields into it. Arrays are always replaced whole, so send the full array.
- When you already have a document's `version` from a read or an earlier write, pass it as `if_version`. A pinned write that fails means someone else changed the document: re-read, then redo the write. Don't read a document only to get its version, except for the answer-relay claim, which must be pinned.
- To remove a field from an agent, write `{"__delete__": true}` in an `update`.
- Use `batch` when writing more than a couple of documents. It needs one approval and is atomic.

The page itself uses the in-page db API. That API has no field delete (the page writes `null` instead), and its `update` merges nested objects. Treat `null` and a missing field the same way when reading.

## When to write

- At the start of a task with more than 3 steps or about 15+ minutes of work.
- When a step starts, finishes or gets blocked.
- When you start waiting (CI, deploy, the user).
- When a PR opens or merges, or a deploy goes live.
- When you find something only the user can do (see `needs`).

## Collections

### `projects/<slug>`: project meta only

`<slug>` is the lowercase repo or folder name.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Display name |
| `repo` | string | `owner/name`, if there is a repo |
| `repoUrl` | string | |
| `path` | string | Local folder |
| `order` | number | Optional tab order (lower first, default 99) |
| `pinned` | boolean | Set by the user on the page |
| `updatedAt` | ISO string | |

Tab order: pinned first, then projects with recent activity before idle ones, then `order`, then most recently updated. A project is idle (dimmed) when none of its streams is `active`, `waiting` or `blocked` and nothing was written for 7 days.

If the doc is missing, `set` it. Do not put status on the project doc.

**Legacy fields.** Older agents wrote status fields onto the project doc: `status`, `currentTask`, `waitingOn`, `steps`, `blockers`, `links`, `recent`, `agent`. The page shows them as a stream called "Main". If you find them, copy them into your own stream, then remove them from the project doc (`{"__delete__": true}` per field).

### `streams/<slug>--<topic>`: one per chat

`<topic>` is a short kebab-case name for the chat's work (for example `full-review`). It stays the same for the whole chat. `set` the stream once, then `update` it. Only write your own stream.

| Field | Type | Notes |
| --- | --- | --- |
| `project` | string | The project slug |
| `title` | string | 2-4 words |
| `tool` | string | `"Claude Code"` |
| `agent` | string | Model name |
| `session` | `{id, title, link}` | From `mcp__ccd_session_mgmt__get_session` with `"self"`, fetched once. Omit if unavailable. `link` is shown as "Open chat" only when it is a `claude://` URL |
| `status` | string | `active` \| `waiting` \| `blocked` \| `done` \| `idle` (the page also accepts `todo`; unknown values show as `idle`) |
| `currentTask` | string | One sentence |
| `waitingOn` | string \| null | What you are waiting for |
| `updatedAt` | ISO string | Set on every write |
| `steps` | `[{title, state, size?, by?, note?, link?}]` | `state` uses the same values as `status`. `size`: `S` \| `M` \| `L` (see progress below). `by: "you"` marks a step only the user can do |
| `blockers` | `[{text, severity}]` | `severity`: `high` \| `normal` |
| `links` | `[{label, url}]` | |
| `recent` | `[{text, url?, at}]` | Newest first, at most 15 |
| `pr` | `{number, url, ci, state}` | The chat's main PR. `ci`: `pass` \| `fail` \| `running`; `state`: `open` \| `merged` \| `closed` |
| `lastShipped` | `{text, url?, at}` | When something merges or deploys |

Set `status: "done"` when the chat's work is finished.

The page flags quiet streams on its own. An `active` stream with no write for 90 minutes shows as quiet, and after 4 hours as "may have stopped". A `waiting` stream shows as quiet after 6 hours, unless `waitingOn` contains one of the words "you", "your", "user", "approval", "approve", "decide", "decision" or "merge". So when you are waiting on the user, say so in those words (for example "Waiting on your approval"). Agents do not need to send heartbeats.

#### Progress %

When a project tab is open, the header shows how far its live work has come, for example `22% / 100% − 12%`:

- The first number is the share done. Its colour goes from red through yellow to green.
- The last number, in orange, is the share waiting on the user. While it is above zero, the first number can reach at most 100 minus that share.

The page computes this from the steps of the project's `active`, `waiting` and `blocked` streams, plus open `needs` items that belong to those streams (or to no stream). Each step weighs `S` = 1, `M` = 2 (the default) and `L` = 4, and each open need weighs 1. Steps with `by: "you"` and unanswered needs (snoozed ones included) count as the user's share. An answered need counts as done. The indicator is hidden when the project has no live stream, or its live streams have no steps and no open needs.

To keep it meaningful, agents should:
- list the whole plan as steps up front, not only the current step;
- give each step a rough `size` (S = minutes, M = default, L = hours);
- mark steps only the user can do with `by: "you"`.

This adds a few characters to writes agents already make. There are no extra reads or writes.

### `needs/<slug>-<short-id>`: things only the user can do

For secrets or keys, account or billing settings, sign-ins, approvals before merging to main or touching production, decisions, and anything a permission rule blocked. Check that the item is not already listed first.

| Field | Type | Notes |
| --- | --- | --- |
| `project` | string | Project slug |
| `stream` | string | Your stream's doc id, e.g. `myrepo--full-review` (without `streams/`) |
| `session` | string | Your session id. Needed for the answer relay |
| `kind` | string | `task` \| `approval` \| `decision` |
| `priority` | string | `high` \| `normal` |
| `title` | string | |
| `why` | string | |
| `steps` | string[] | What the user should do |
| `options` | string[] | 2-4 short choices, for decisions. If you give options on a `task`, keep one called exactly "Done" |
| `link` | string | Optional |
| `done` | boolean | `false` when created |
| `createdAt` | ISO string | |
| `doneAt`, `doneBy` | ISO string, string | `doneBy`: `"claude"` or `"you"` |
| `answer` | `{choice, note, at}` | Written by the page when the user answers |
| `answerState` | string | `answered` → `relayed` → `handled` |
| `relayedAt` | ISO string | Written by the relaying agent |
| `snoozedUntil` | ISO string \| null | Written by the page |
| `updatedAt` | ISO string | Optional. The header's "Last update" uses it, else `createdAt` |

When you complete a listed item yourself, set `done: true`, `doneAt`, `doneBy: "claude"`.

What the user can do on the page:
- **Answer** an item. See the answer relay below.
- **Mark a `task` "Done".** The page sets `done: true`, `doneBy: "you"` together with the answer.
- **Close** an approval or decision without answering. The page sets `done: true`, `doneBy: "you"` and no `answer`. Treat that as "no longer needed": stop waiting on it.
- **Snooze** an item. It is hidden until `snoozedUntil`; nothing changes for agents.

### `usage/u-<YYYYMMDDTHHMMZ>-<slug>`: plan usage readings

About once an hour, and only alongside a board write you are already making, call `mcp__ccd_session_mgmt__get_usage`. If it is missing or `plan.status` is not `"ok"`, skip silently. Otherwise `set` a new doc:

```json
{
  "at": "2026-09-28T13:00:00Z",
  "project": "<slug>",
  "weekAll":   { "pct": 42, "resetsAt": "..." },
  "weekFable": { "pct": 18, "resetsAt": "..." },
  "fiveHour":  { "pct": 7,  "resetsAt": "..." }
}
```

`pct` is `percentUsed` of "Weekly · all models", "Weekly · Fable" and "5-hour limit". Readings are account totals: never sum or edit other agents' readings.

The page projects each weekly bar to its reset. For the first 12 hours of a week it shows "Too early to project". After that it uses last week's rhythm when last week has at least 4 readings reaching into its final 12 hours. Otherwise it uses the trailing 36 hours, and otherwise the week so far. The page deletes readings older than 15 days.

### `archive/<slug>--<YYYY-MM>`: history, written only by the page

Done items are kept, then slimmed down, by the page itself:

| Age of a done stream or need | Where it shows |
| --- | --- |
| 0-7 days | Folded under "Show N finished" / "Show N done" |
| 7-30 days | The project's **History** section (full doc still stored) |
| Over 30 days | Summarised into the archive doc for its project and month; the full doc is deleted |

Age is counted from a stream's `updatedAt` (else `lastShipped.at`) and a need's `doneAt` (else `updatedAt`, else `createdAt`). A legacy "Main" stream is never moved or archived; its own chat migrates it. An archive doc looks like:

```json
{
  "project": "<slug>", "month": "2026-08", "updatedAt": "...",
  "items": {
    "stream_<id>": { "kind": "stream", "title": "...", "summary": "...", "url": "...", "pr": { "number": 7, "url": "...", "state": "merged" }, "agent": "...", "startedAt": "...", "finishedAt": "..." },
    "need_<id>":   { "kind": "need", "title": "...", "needKind": "decision", "summary": "<answer>", "url": "...", "doneBy": "claude", "startedAt": "...", "finishedAt": "..." }
  }
}
```

The page archives once per load, only from server-confirmed (not cached) data, and renews a lease on `archive/_lock` before each month, so two open tabs don't run at the same time. If archiving fails (a read-only viewer, a full store), nothing is deleted and it retries on the next load. `items` is a map, so merge-updates from different tabs never overwrite each other. Summaries are written before the full docs are deleted.

Agents never write to `archive`. So that a finished chat's card isn't archived early, only touch your stream while the chat is running. After 30 days a done stream may be gone: if you resume an old chat, `set` a fresh stream.

## Answer relay

The user can answer a `needs` item on the board. The page writes `answer: {choice, note, at}` and `answerState: "answered"`. The board is private to the user, so an answer is the user's instruction for that item.

```
user answers on page      answerState: answered
any agent, next write     answerState: relayed   (claimed with if_version, then send_message)
owning chat acts on it    answerState: handled   (+ done, doneAt, doneBy when complete)
```

**Pick up your own answers.** While your chat has open `needs` items, query `needs` where `project == <slug>` at the start of each user turn and before each board write. Act on answered items from your chat, then set `answerState: "handled"` together with `done: true`, `doneAt` and `doneBy: "claude"`. Don't leave an item `handled` but not done: the page then shows it as waiting on the chat, with no controls for the user. If the answer leads to a new question, create a new item. Also check for items you are waiting on that are `done` with no `answer`: the user closed them, so stop waiting.

A message "Relay Board: answer waiting on needs/<id>" means: read that doc and continue.

**Relay for other chats.** At each board write, also query `needs` where `answerState == "answered"`. For each item whose `session` belongs to another chat:

1. `update` it with `if_version` to `answerState: "relayed"`, `relayedAt: <now>`. If the pinned write fails, another agent already claimed it; skip it.
2. Send that session a message (`SendMessage` or `mcp__ccd_session_mgmt__send_message`): "Relay Board: answer waiting on needs/<id>. Read it from the board and continue."
3. If the send fails, set `answerState` back to `"answered"` so another agent can try.

Skip items without a `session`. Answered and relayed items are left out of the open counts and shown under "Answered, waiting on the chat", with "Sent to the chat … ago" once relayed. If one sits in `relayed` for a long time, the owning chat has likely stopped.

## What the page does on its own

These run in the browser and cost agents nothing:

- Quiet and stopped chat detection (see streams above).
- The progress % in the header (see streams above).
- "Since you last looked" digest. The last-seen time is kept in the viewer's `localStorage`.
- The activity feed, built from every stream's `recent`.
- Usage projections, the even-pace marker and the week curve.
- Pruning of old usage readings.
- Moving done items to History after 7 days and archiving them after 30 (see `archive` above).
- Answering, snoozing, closing and reopening `needs` items.
