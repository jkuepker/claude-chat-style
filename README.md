# claude-chat-style

A Claude Code plugin that turns the terminal transcript into a chat: you on
the right, Claude on the left, a colour per side.

![Claude Code in a terminal with this plugin: prompts as right-aligned blue bubbles, replies in orange boxes, a question tagged "awaiting your answer", a table in its own box](docs/demo.gif)

| Message | Drawn as |
|---|---|
| Your prompt | `>` in a right-aligned blue bubble, sized to the text |
| Claude's reply | an orange box opened by an **orange ●**, sized to the text; the markdown renders as usual |
| Claude's question | the same orange box with an "awaiting your answer" tag |
| A reply with a code block or table | the same orange box, sized to its widest line |
| Tool calls and output | left to Claude Code: green ⏺ (red on error), diffs, progress, dim `⎿` lines |

Every bubble is as wide as its widest drawn line (markdown markup left out, a
table as the terminal draws it). Claude's boxes and your bubbles are both up to
95% of the width; Claude's start 1 column in, so the gutters mirror. So the two sides never line up, and the gutters look even in the desktop
app's terminal pane, which pads its right side more than its left. A reply
counts as a question when its last paragraph outside code ends with `?`.

Only prompts you type get the bubble; task notifications, teammates and other
senders keep Claude Code's own row.

**Terminal only.** Checked on 2026-09-26 with Claude Code 2.1.281: the
desktop app's Code tab draws prompts (right-aligned bubbles) and replies with
its own renderer and does not ask plugins to draw those rows, so nothing
changes there, although the same drawing validates on the `desktop` surface in
`claude plugin test`. The plugin is harmless to leave installed for desktop.

It uses Claude Code's early-access function hooks (`ui.render`), which may
change between Claude Code releases; `types/claude-code.d.ts` was written by
Claude Code 2.1.274.

## Install

You need Claude Code in a terminal (tested with 2.1.281 to 2.1.283).

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
     claude plugin marketplace add jkuepker/claude-chat-style
     claude plugin install claude-chat-style@claude-chat-style
     ```

  2. Start a new `claude` session in a terminal. A session that is already
     open keeps its old look until you restart it.

  Note: `marketplace add` fetches the repository itself, so no clone is needed.

  <br>

- **Option 2: Clone from GitHub and install**

  1. Run the following commands (`./` or a full path; a bare `.` is rejected):

     ```sh
     git clone https://github.com/jkuepker/claude-chat-style.git
     cd claude-chat-style
     claude plugin marketplace add ./
     claude plugin install claude-chat-style@claude-chat-style
     ```

  2. Start a new `claude` session in a terminal.

  <br>

- **To update**

  ```sh
  cd /path/to/claude-chat-style && git pull   # Option 2 only
  claude plugin marketplace update claude-chat-style
  claude plugin update claude-chat-style@claude-chat-style
  ```

  Then restart `claude`.

  <br>

- **To uninstall**

  ```sh
  claude plugin uninstall claude-chat-style@claude-chat-style
  claude plugin marketplace remove claude-chat-style
  ```

  <br>

- **To try it for one session without installing:**

  ```sh
  git clone https://github.com/jkuepker/claude-chat-style.git
  cd claude-chat-style
  claude --plugin-dir ./
  ```

## Options

`/plugin configure claude-chat-style@claude-chat-style`, or
`--config KEY=VALUE` at install:

| Option | Default | |
|---|---|---|
| `enabled` | `true` | off leaves Claude Code's own drawing |
| `replyColor` | `#D97757` | Claude's dot, box and question tag: a hex colour or a theme key |
| `promptColor` | `#5BA4D8` | the border of your prompt bubbles |
| `replyWidthPercent` | `95` | widest Claude's prose boxes get, in percent of the width |
| `codeWidthPercent` | `95` | widest replies with code blocks or tables get |
| `promptWidthPercent` | `95` | widest your prompt bubbles get |
| `replyIndent` | `1` | columns before Claude's boxes; 0 suits a terminal with even padding |

## Make your own style

The colours and widths are settings (above), so a different palette needs no
code. For a different look altogether, fork the repository: the whole drawing
is `hooks/chat-style.tsx`, two `ui.render` hooks (one for your prompts, one
for Claude's text) that return a tree of `Box` and `Text` elements, and
`types/claude-code.d.ts` lists every element and prop a hook can use. Give
your fork its own `name` in `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` so it can be installed beside this one, and
run `npm test` to check the drawing on the terminal and desktop surfaces.

## License

MIT (see `LICENSE`): use, change and share it, including as your own style.

## Demo GIF

`docs/demo.gif` is a real Claude Code session, recorded with

```sh
demo/record-gif.sh docs/demo.gif /path/to/a/trusted/folder
```

It runs `claude --plugin-dir .` in a private tmux server, shows it in a new
Ghostty window, types three prompts (a plain answer, a question back, a
table), records that window with ScreenCaptureKit (`demo/wincap.swift`, so
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
