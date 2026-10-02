import type { PluginOptions, Register } from 'claude-code';

/**
 * A chat look for the terminal: your prompts as right-aligned blue bubbles,
 * Claude's replies in orange boxes opened by an orange dot and indented a
 * little, a question tagged "awaiting your answer", and both sides sized to
 * their text up to a share of the width: Claude's boxes end by 95%, your
 * prompts start after 5%, a mirror image, so the two sides never line up. Tool calls keep Claude Code's own drawing (diffs, progress,
 * errors), which this plugin leaves alone.
 */
export type ChatStyle = {
  enabled: boolean;
  /** The reply dot, box and question tag. */
  replyColor: string;
  /** The border of your prompts' bubbles. */
  promptColor: string;
  /** Where Claude's prose boxes stop at most, in percent of the terminal's columns. */
  replyWidthPercent: number;
  /** Where replies with code blocks or tables stop at most. */
  codeWidthPercent: number;
  /** Widest your prompt bubbles get. */
  promptWidthPercent: number;
  /** Columns between the terminal's left edge and Claude's boxes. */
  replyIndent: number;
};

export const DEFAULTS: ChatStyle = {
  enabled: true,
  replyColor: '#D97757',
  promptColor: '#5BA4D8',
  replyWidthPercent: 95,
  codeWidthPercent: 95,
  promptWidthPercent: 95,
  replyIndent: 1,
};

/** Dim grey of the `>` marker. */
const PROMPT_MARKER_COLOR = '#8A8B93';
/** Dark tint behind the question tag. */
const TAG_BACKGROUND = '#3B2219';
export const QUESTION_TAG = 'awaiting your answer';

/** Border, padding and marker column around a bubble's text, in cells. */
const BUBBLE_CHROME = 6;

export function chatStyle(options: PluginOptions): ChatStyle {
  const text = (key: 'replyColor' | 'promptColor'): string => {
    const value = options[key];
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULTS[key];
  };
  const number = (key: 'replyWidthPercent' | 'codeWidthPercent' | 'promptWidthPercent' | 'replyIndent', min: number, max: number): number => {
    const value = Number(options[key]);
    return options[key] !== undefined && Number.isInteger(value) && value >= min && value <= max ? value : DEFAULTS[key];
  };
  return {
    enabled: options['enabled'] !== false,
    replyColor: text('replyColor'),
    promptColor: text('promptColor'),
    replyWidthPercent: number('replyWidthPercent', 20, 100),
    codeWidthPercent: number('codeWidthPercent', 20, 100),
    promptWidthPercent: number('promptWidthPercent', 20, 100),
    replyIndent: number('replyIndent', 0, 20),
  };
}

/** The text with fenced code blocks taken out. */
function withoutCode(markdown: string): string {
  return markdown.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1[^\n]*$/gm, '');
}

/** True when the last paragraph outside code ends with a question mark. */
export function isQuestion(markdown: string): boolean {
  const paragraphs = withoutCode(markdown)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  return /\?$/.test(last.replace(/[\s*_`)"'”’\]]+$/u, ''));
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** True when the markdown holds a fenced code block or a table. */
export function hasWideContent(markdown: string): boolean {
  const lines = markdown.split('\n');
  return lines.some((line, i) => FENCE.test(line) || (TABLE_ROW.test(line) && TABLE_SEPARATOR.test(lines[i + 1] ?? '')));
}

/** Cells a string takes (one per code point). */
function cells(text: string): number {
  return [...text].length;
}

/** Cells a line of markdown takes once drawn: headings, links, code spans and emphasis markers drop out. */
export function inlineWidth(line: string): number {
  return cells(
    line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`/g, '')
      .replace(/\*\*|__|~~/g, '')
      .trimEnd(),
  );
}

function tableCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * The widest line of the markdown once drawn, in cells: code lines as they
 * are, a table as the terminal draws it (each column as wide as its widest
 * cell, a space either side, a rule between), other lines less their markup.
 */
export function markdownWidth(markdown: string): number {
  const lines = markdown.split('\n');
  let width = 0;
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker === fence) fence = undefined;
      else width = Math.max(width, cells(line.trimEnd()));
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_SEPARATOR.test(lines[i + 1] ?? '')) {
      const rows: string[][] = [];
      let j = i;
      for (; j < lines.length && TABLE_ROW.test(lines[j] ?? ''); j++) {
        if (!TABLE_SEPARATOR.test(lines[j] ?? '')) rows.push(tableCells(lines[j] ?? ''));
      }
      const columns = Math.max(...rows.map((row) => row.length));
      let table = columns + 1;
      for (let c = 0; c < columns; c++) table += 2 + Math.max(...rows.map((row) => inlineWidth(row[c] ?? '')));
      width = Math.max(width, table);
      i = j - 1;
      continue;
    }
    width = Math.max(width, inlineWidth(line));
  }
  return width;
}

/** Cells of the longest line of plain text. */
export function textWidth(text: string): number {
  return Math.max(0, ...text.split('\n').map((line) => cells(line)));
}

/**
 * Width of a bubble in cells: its content plus the chrome, at most `cap`;
 * undefined when the surface has not said how wide it is (the desktop app):
 * the bubble then shrinks to its content inside a percent-wide row.
 */
export function fit(contentWidth: number, cap: number | undefined): number | undefined {
  if (cap === undefined) return undefined;
  return Math.max(BUBBLE_CHROME + 1, Math.min(cap, contentWidth + BUBBLE_CHROME));
}

/**
 * Widest a bubble may be: `percent` of the columns, and no wider than the room
 * left after `indent`. A reply gets the same width as a prompt, shifted by the
 * indent, so in a pane padded more on the right the two sides mirror.
 */
function widthCap(columns: number | undefined, percent: number, indent = 0): number | undefined {
  if (columns === undefined) return undefined;
  return Math.max(BUBBLE_CHROME + 10, Math.min(Math.floor((columns * percent) / 100), columns - indent));
}

/**
 * Origins of a prompt the person typed: the terminal's composer, the desktop
 * app (which drives Claude Code as an SDK host), and the Remote Control bridge.
 */
const TYPED_ORIGINS = new Set(['composer', 'sdk', 'bridge']);

export const register: Register = (on, options) => {
  const style = chatStyle(options);
  if (!style.enabled) return;

  // Claude's text: an orange box opened by an orange dot, a question tagged.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e);
    const { text, isFirstOfReply } = e.props;
    const question = isQuestion(text);
    // Sized to the widest drawn line, at most replyWidthPercent wide (codeWidthPercent with code or tables).
    const percent = hasWideContent(text) ? style.codeWidthPercent : style.replyWidthPercent;
    const cap = widthCap(e.viewport?.columns, percent, style.replyIndent);
    const width = fit(Math.max(markdownWidth(text), question ? cells(QUESTION_TAG) + 2 : 0), cap);
    return (
      <Box flexDirection="row" paddingLeft={style.replyIndent} width={width === undefined ? `${percent}%` : undefined}>
        <Box
          width={width}
          flexGrow={0}
          flexShrink={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={style.replyColor}
          paddingX={1}
        >
          <Box flexDirection="row" alignItems="flex-start">
            <Box width={2} flexShrink={0}>
              <Text color={style.replyColor}>{isFirstOfReply ? '●' : ' '}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Markdown text={text} />
            </Box>
          </Box>
          {question ? (
            <Box paddingLeft={2}>
              <Text color={style.replyColor} backgroundColor={TAG_BACKGROUND}>{` ${QUESTION_TAG} `}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    );
  });

  // Your own prompts: a right-aligned blue bubble. Notifications, teammates
  // and other senders keep the engine's row.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!TYPED_ORIGINS.has(e.props.origin.kind)) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const width = fit(textWidth(e.props.text), widthCap(e.viewport?.columns, style.promptWidthPercent));
    return (
      <Box flexDirection="row" justifyContent="flex-end">
        <Box flexDirection="row" justifyContent="flex-end" width={width === undefined ? `${style.promptWidthPercent}%` : undefined}>
          <Box width={width} flexGrow={0} flexShrink={1} borderStyle="round" borderColor={style.promptColor} paddingX={1} flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color={PROMPT_MARKER_COLOR}>&gt;</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text>{e.props.text}</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  });
};
