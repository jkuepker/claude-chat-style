# log-transcript-theme

Formerly `claude-chat-style`: Claude Code 2.1.288 reserves plugin names that
start with `claude-`. GitHub redirects the old repository URL here.

A Claude Code plugin that draws the transcript as a log: every row opens
with a coloured role label, tool calls fold to one line, and the `details ›` button beside a
label opens that row's details in a pane docked beside the transcript.

![Claude Code in a terminal with this plugin: YOU, TOOL, CLAUDE and CLAUDE ? labels, tool calls folded to one line each, a failed call marked in red, then a details › click opening a row in the side pane](docs/demo.gif)

| Row | Drawn as |
|---|---|
| Your prompt | **YOU** (blue), then the text |
| Your prompt with attachments | the same, then a line per attachment: `▣ image 1 · header.png`, or for a paste, which has no file name, `▣ image 2 · PNG` |
| Claude's reply | **CLAUDE** (magenta), then the markdown as usual |
| Claude's question | **CLAUDE ?** (yellow): the reply's last paragraph outside code ends with `?` |
| A multiple-choice question (AskUserQuestion) | **CLAUDE ?** over Claude Code's own dialog, and over its answered card |
| A finished tool call | **TOOL** (orange) and one line: `Bash npm test → 14 passed`, `Edit src/fetch.ts → +12 −3` |
| A running or failed tool call | **TOOL** (orange, red on failure) over Claude Code's own drawing |
| A folded group (`Ran 2 shell commands`) | **TOOL** and one line per call, `→ failed` in red for a failed one; while it runs or under ctrl+o, Claude Code's own drawing, each call with its own **TOOL** |

Click `details ›` beside any label to open the **Details** pane. A tool call has
**Summary** (tool, status, input, result, duration), **Payload** (its input as
JSON), **Result** (its output) and **Timing** (step, start, finish,
duration). A prompt or reply has **Summary** (its length, and a prompt's
attachments), **Preview** (the text rendered) and **Raw** (the source, with
the attachments listed). The colours are Ultra Atom One
Dark's.

Only prompts you type get the YOU label; task notifications, teammates and
other senders keep Claude Code's own row.

Works in the terminal and in the desktop app's Code tab, checked by eye on
2026-10-02 with Claude Code 2.1.286 to 2.1.288. In the desktop app the pane
docks to the right of the transcript; in the terminal it docks in fullscreen
mode at 110 columns or more, and otherwise opens above the prompt. The desktop
app draws some rows itself (the text inside its own groups of tool calls), and
those keep its look.

It uses Claude Code's early-access function hooks (`ui.render`), which may
change between Claude Code releases; `types/claude-code.d.ts` was written by
Claude Code 2.1.286.

## Install

You need Claude Code 2.1.283 or later, in a terminal or the desktop app.

- **Required before installing:**

  Turn on function hooks, which this plugin uses and which are off by
  default (they are early access). Add this to the `env` block of
  `~/.claude/settings.json`, creating the block if there is none:

  ```json
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
  ```

  <br>

- **Option 1: Install directly from GitHub**

  1. Run the following commands:

     ```sh
     claude plugin marketplace add jkuepker/log-transcript-theme
     claude plugin install log-transcript-theme@log-transcript-theme
     ```

  2. Start a new `claude` session in a terminal. A session that is already
     open keeps its old look until you restart it.

  Note: `marketplace add` fetches the repository itself, so no clone is needed.

  <br>

- **Option 2: Clone from GitHub and install**

  1. Run the following commands (`./` or a full path; a bare `.` is rejected):

     ```sh
     git clone https://github.com/jkuepker/log-transcript-theme.git
     cd log-transcript-theme
     claude plugin marketplace add ./
     claude plugin install log-transcript-theme@log-transcript-theme
     ```

  2. Start a new `claude` session in a terminal.

  <br>

- **To update**

  ```sh
  cd /path/to/log-transcript-theme && git pull   # Option 2 only
  claude plugin marketplace update log-transcript-theme
  claude plugin update log-transcript-theme@log-transcript-theme
  ```

  Then restart `claude`.

  <br>

- **To uninstall**

  ```sh
  claude plugin uninstall log-transcript-theme@log-transcript-theme
  claude plugin marketplace remove log-transcript-theme
  ```

  <br>

- **To try it for one session without installing:**

  ```sh
  git clone https://github.com/jkuepker/log-transcript-theme.git
  cd log-transcript-theme
  claude --plugin-dir ./
  ```

## Options

`/plugin configure log-transcript-theme@log-transcript-theme`, or
`--config KEY=VALUE` at install:

| Option | Default | |
|---|---|---|
| `enabled` | `true` | off leaves Claude Code's own drawing |
| `youColor` | `#4280FE` | the YOU label: a hex colour or a theme key |
| `claudeColor` | `#DE77FF` | the CLAUDE label |
| `questionColor` | `#FEDC71` | the CLAUDE ? label |
| `toolColor` | `#FF995A` | the TOOL label |

## Make your own style

The colours are settings (above), so a different palette needs no code. For
a different look altogether, fork the repository: the whole drawing is
`hooks/log-transcript-theme.tsx`, one `ui.render` hook per row kind (your prompts,
Claude's text, tool calls and results, the pane) that returns a tree of
`Box`, `Text` and `Button` elements, and
`types/claude-code.d.ts` lists every element and prop a hook can use. Give
your fork its own `name` in `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` so it can be installed beside this one, and
run `npm test` to check the drawing on the terminal and desktop surfaces.

## License

MIT (see `LICENSE`): use, change and share it, including as your own style.

## Demo GIF

`docs/demo.gif` is a real Claude Code session, recorded with

```sh
claude plugin disable log-transcript-theme@log-transcript-theme   # if installed
DEMO_COLS=150 DEMO_ROWS=32 DEMO_CLICK_SECONDS=20 GIF_WIDTH=1280 \
  demo/record-gif.sh docs/demo.gif /path/to/a/trusted/git/repository
claude plugin enable log-transcript-theme@log-transcript-theme
```

An installed copy would draw every row a second time, hence the disable.
The last 20 seconds are for a person to click a row's `details ›` and the
pane's tabs; at 150 columns the pane docks beside the transcript.

It runs `claude --plugin-dir .` in a private tmux server, shows it in a new
Ghostty window, types three prompts (two shell commands, a failing one and a question back,
an answer; only `ls`, `git log` and `npm run` may run unasked), records that window with ScreenCaptureKit (`demo/wincap.swift`, so
other windows may cover it) and encodes a 960 px, 15 fps GIF. Needs tmux,
ffmpeg, Ghostty and Screen Recording permission. Two things it works around:
Claude Code drops to 256 colours when it sees tmux, so the session hides tmux
from it, and the tmux server starts with a clean environment so the session
looks like a fresh terminal's.

## Develop

```sh
npm install
npm run typecheck   # tsc over hooks, tests and the API types
npm test            # claude plugin test .
npm run validate    # claude plugin validate
```
