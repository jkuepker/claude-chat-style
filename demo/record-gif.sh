#!/usr/bin/env bash
# Records a real Claude Code session with this plugin into docs/demo.gif.
#
#   demo/record-gif.sh [out.gif] [workdir]
#
# macOS only. Needs tmux, ffmpeg, Ghostty and Screen Recording permission for
# the app running the script. Starts `claude --plugin-dir <this repo>` in tmux
# (in `workdir`, a git repository Claude Code already trusts, default the
# current folder), shows it in a new Ghostty window, types three prompts into
# it (two shell commands, a failing one and a question back, an answer),
# records that window with ScreenCaptureKit
# (demo/wincap.swift; other windows may cover it) and encodes a looping GIF.
# About 40 seconds. The replies come from the model, so each run differs.
# Only `ls`, `git log` and `npm run` may run without asking. Disable an
# installed copy of the plugin first, or both copies draw the rows.
#
# DEMO_MODEL (default haiku), DEMO_COLS and DEMO_ROWS (the window, 108 x 30),
# DEMO_CLICK_SECONDS (0), GIF_WIDTH (960), GIF_FPS (15), GIF_COLORS (256) and
# GIF_KEEP_WORK=1 (keep the raw recording) tune it. DEMO_CLICK_SECONDS keeps
# recording that long after the last reply, for a person to click a row's
# details › and the pane's tabs; at 110 columns or more the pane docks beside
# the transcript, below that it opens above the prompt.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$repo/docs/demo.gif}
workdir=${2:-$PWD}
model=${DEMO_MODEL:-haiku}
cols=${DEMO_COLS:-108}
rows=${DEMO_ROWS:-30}
click_seconds=${DEMO_CLICK_SECONDS:-0}
width=${GIF_WIDTH:-960}
fps=${GIF_FPS:-15}
colors=${GIF_COLORS:-256}
session=log-theme-demo
work=$(mktemp -d "${TMPDIR:-/tmp}/log-theme-gif.XXXXXX")
[[ "${GIF_KEEP_WORK:-}" == 1 ]] && echo "work dir: $work" || trap 'rm -rf "$work"' EXIT

prompts=(
  "Run ls, then git log --oneline -3. Reply in one sentence."
  "Run npm run tset (a typo, it will fail), then ask me in one line whether to run npm test instead."
  "No thanks, that's all."
)

# A tmux server of its own: no personal config, no status bar, full colour.
cat > "$work/tmux.conf" <<'CONF'
set -g default-terminal "tmux-256color"
set -as terminal-overrides ",*:RGB"
set -g focus-events on
set -g status off
set -g escape-time 0
set -g mouse on
CONF
tmux_() { tmux -L "$session" -f "$work/tmux.conf" "$@"; }

wait_for() { # pattern, seconds
  for _ in $(seq 1 $(($2 * 5))); do tmux_ capture-pane -t "$session" -p | grep -q -- "$1" && return 0; sleep 0.2; done
  echo "timed out waiting for: $1" >&2; return 1
}
# True once a "… for Ns · done" line follows the row that starts with the prompt.
answered() {
  tmux_ capture-pane -t "$session" -p -S -500 | python3 -c '
import re, sys
lines = sys.stdin.read().splitlines()
hits = [i for i, line in enumerate(lines) if sys.argv[1] in line]
sys.exit(0 if hits and any(re.search(r" for \d+s · done", line) for line in lines[hits[-1] + 1:]) else 1)' "${1:0:28}"
}
type_slowly() { # text
  local text=$1 i
  for ((i = 0; i < ${#text}; i++)); do tmux_ send-keys -t "$session" -l -- "${text:i:1}"; sleep 0.035; done
}

tmux_ kill-server 2>/dev/null || true
# Claude Code drops to 256 colours when it sees tmux, which washes the colours
# out; hidden from it, it sends 24-bit colour, which tmux passes through.
# The server starts with a clean environment, so the session looks like a fresh
# terminal's and not like one nested in the shell that runs this script.
env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" PATH="$PATH" SHELL="${SHELL:-/bin/zsh}" \
  LANG="${LANG:-en_US.UTF-8}" TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)" \
  tmux -L "$session" -f "$work/tmux.conf" new-session -d -s "$session" -x "$cols" -y "$rows" \
  "cd '$workdir' && env -u TMUX -u TMUX_PANE TERM=xterm-256color COLORTERM=truecolor claude --plugin-dir '$repo' --model '$model' --allowedTools 'Bash(ls:*)' 'Bash(git log:*)' 'Bash(npm run:*)'"
wait_for '❯' 30

# A Ghostty window of its own, attached to the session, in Ultra Atom One
# Dark's background and text colours, the theme the labels come from.
before=$(pgrep -x ghostty | sort)
open -na Ghostty.app --args --window-width=$cols --window-height=$rows --font-size=14 \
  --background=191d25 --foreground=ccd3e0 --cursor-style=block \
  --confirm-close-surface=false --quit-after-last-window-closed=true \
  --window-save-state=never --title=claude \
  --command="$(command -v tmux) -L $session attach -t $session"
pid=""
for _ in $(seq 1 50); do
  pid=$(comm -13 <(echo "$before") <(pgrep -x ghostty | sort) | head -1)
  [[ -n "$pid" ]] && break
  sleep 0.2
done
[[ -n "$pid" ]] || { echo "Ghostty did not start" >&2; exit 1; }

# Record the Ghostty window itself (ScreenCaptureKit), so other windows can
# cover it without spoiling the recording.
swiftc -O "$repo/demo/wincap.swift" -o "$work/wincap"
sleep 1.5 # let the attach redraw at the window's size
"$work/wincap" "$pid" "$work/rec.mov" "$work/capture-start" > "$work/wincap.log" 2>&1 &
capture_pid=$!
for _ in $(seq 1 50); do [[ -s "$work/capture-start" ]] && break; sleep 0.2; done
[[ -s "$work/capture-start" ]] || { echo "window capture did not start: $(cat "$work/wincap.log")" >&2; exit 1; }
cat "$work/wincap.log"
sleep 1
start=$(python3 -c 'import time; print(time.time())')

for prompt in "${prompts[@]}"; do
  sleep 0.8
  type_slowly "$prompt"
  sleep 0.4
  tmux_ send-keys -t "$session" Enter
  for _ in $(seq 1 300); do answered "$prompt" && break; sleep 0.2; done
  answered "$prompt" || { echo "no reply to: $prompt" >&2; exit 1; }
  sleep 1.5
done
sleep 2.5
if ((click_seconds > 0)); then
  echo "recording $click_seconds s more: click a row's details › now" >&2
  sleep "$click_seconds"
fi
end=$(python3 -c 'import time; print(time.time())')

kill -INT "$capture_pid" 2>/dev/null || true
wait "$capture_pid" || true
tmux_ kill-server 2>/dev/null || true

ss=$(awk -v r="$(cat "$work/capture-start")" -v a="$start" 'BEGIN { printf "%.3f", a - r }')
dur=$(awk -v a="$start" -v e="$end" 'BEGIN { printf "%.3f", e - a }')
IFS=, read -r w h < <(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$work/rec.mov")
echo "$ss $dur" > "$work/cut" # where the demo sits in rec.mov, for re-encoding
gh=$(( (h * width / w) / 2 * 2 ))

# The capture is the window alone: its rounded corners are transparent, laid
# here on the terminal background. Frames come only when the window changes;
# fps fills the gaps.
#
# A label's exact colour covers few pixels next to the antialiased shades
# around it, so a palette built from the frames alone merges it into those
# shades and the labels come out washed out. Swatches of the plugin's colours
# (YOU, CLAUDE, CLAUDE ?, TOOL, a failed TOOL), painted only into the copy
# the palette is built from, put each one in the palette exactly; no
# dithering keeps the letters crisp.
swatches=""
x=0
for c in 4280FE DE77FF FEDC71 FF995A FF5E92; do
  swatches+="drawbox=x=$x:y=0:w=60:h=60:c=0x$c:t=fill,"
  x=$((x + 60))
done
mkdir -p "$(dirname "$out")"
ffmpeg -hide_banner -loglevel error -y -ss "$ss" -t "$dur" -i "$work/rec.mov" -filter_complex "\
color=c=0x191d25:s=${w}x${h}[bg];[bg][0:v]overlay=shortest=1,fps=$fps,scale=${width}:${gh}:flags=lanczos,format=rgb24,split[a][b];\
[a]${swatches}palettegen=max_colors=$colors:stats_mode=full:reserve_transparent=0[p];\
[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 "$out"
echo "wrote $out ($(du -h "$out" | cut -f1 | tr -d ' '), ${dur}s, ${width}x${gh}, ${fps} fps)"
