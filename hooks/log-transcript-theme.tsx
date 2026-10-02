import { atom, read, update } from 'claude-code';
import type { EngineInterface, Elements, PluginOptions, PromptSubmitAttachment, Register, RenderElement } from 'claude-code';

import type { CallTiming, Detail, DetailView } from '../types';

/**
 * A log look for the transcript: every row opens with a coloured role label,
 * YOU for your prompts, CLAUDE for replies (CLAUDE ? when the reply asks you
 * something), TOOL for tool calls, which fold to one line once done. The ›
 * beside a label opens a pane docked beside the transcript with the row's
 * tabs: Summary, Payload, Result and Timing for a tool call; Summary, Preview
 * and Raw for a message.
 */
export type ChatStyle = {
  enabled: boolean;
  youColor: string;
  claudeColor: string;
  questionColor: string;
  toolColor: string;
};

/** Ultra Atom One Dark's blue, magenta, yellow and orange. */
export const DEFAULTS: ChatStyle = {
  enabled: true,
  youColor: '#4280FE',
  claudeColor: '#DE77FF',
  questionColor: '#FEDC71',
  toolColor: '#FF995A',
};

/** Red of a failed tool row's label. */
const ERROR_COLOR = '#FF5E92';
/** Grey of a tool row's result and other secondary text. */
const DIM_COLOR = '#828996';
/** Background of a row under the pointer. */
const HOVER_BACKGROUND = '#262C38';

/** Cells the label column takes: the widest label, `CLAUDE ?`, and a space. */
const LABEL_WIDTH = 9;
/** Cells the › opener takes after the label. */
const OPENER_WIDTH = 2;

/** The detail pane's id: letters, digits, `_` and `-` only. */
export const PANE = 'log-transcript-theme-detail';
const PANE_TITLE = 'Details';
/** Calls whose timing is kept; the oldest drop out past this. */
const TIMED_CALLS = 500;

const detail = atom({ plugin: 'log-transcript-theme', key: 'detail' } as const, null as Detail | null);
const tab = atom({ plugin: 'log-transcript-theme', key: 'tab' } as const, 'Summary');
const timing = atom({ plugin: 'log-transcript-theme', key: 'timing' } as const, {} as Record<string, CallTiming>);

export function chatStyle(options: PluginOptions): ChatStyle {
  const text = (key: Exclude<keyof ChatStyle, 'enabled'>): string => {
    const value = options[key];
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULTS[key];
  };
  return {
    enabled: options['enabled'] !== false,
    youColor: text('youColor'),
    claudeColor: text('claudeColor'),
    questionColor: text('questionColor'),
    toolColor: text('toolColor'),
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

/** The first line that is not blank, trimmed. */
export function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/** The last line that is not blank, trimmed: where a command's tally usually is. */
export function lastLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** What a tool call acts on, in one line: its command, file, pattern, address or query. */
export function inputSummary(input: unknown): string {
  const fields = record(input);
  for (const key of ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'path', 'description', 'prompt', 'skill']) {
    const value = str(fields[key]);
    if (value) return firstLine(value);
  }
  if (typeof input === 'string') return firstLine(input);
  const json = JSON.stringify(input);
  return json && json !== '{}' ? json : '';
}

/** A tool result's readable text: a shell's output, a file's content, a plain answer. */
export function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  const fields = record(output);
  const shell = [str(fields['stdout']), str(fields['stderr'])].filter(Boolean).join('\n');
  if (shell) return shell;
  const file = record(fields['file']);
  for (const value of [file['content'], fields['content'], fields['result'], fields['text'], fields['output']]) {
    if (typeof value === 'string') return value;
  }
  return '';
}

/** What a tool call came to, in one line: lines added and removed, lines read, files found, or its output's last line. */
export function outputSummary(output: unknown): string {
  if (output === undefined) return '';
  const fields = record(output);
  const patch = fields['structuredPatch'];
  if (Array.isArray(patch)) {
    let added = 0;
    let removed = 0;
    for (const hunk of patch) {
      const lines = record(hunk)['lines'];
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        if (typeof line !== 'string') continue;
        if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
      }
    }
    return `+${added} −${removed}`;
  }
  const lines = record(fields['file'])['numLines'];
  if (typeof lines === 'number') return `${lines} lines`;
  const files = fields['numFiles'] ?? (Array.isArray(fields['filenames']) ? fields['filenames'].length : undefined);
  if (typeof files === 'number') return `${files} ${files === 1 ? 'file' : 'files'}`;
  return lastLine(outputText(output));
}

/** Pretty JSON of a value, or the value itself when it is text. */
function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

/** A duration in ms as people read it: `840 ms`, `12.3 s`, `2 min 5 s`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** A clock time, `20:41:07`, from epoch ms. */
function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19) + ' UTC';
}

/** The detail a tool row opens: Summary, Payload (its input), Result and Timing. */
export function toolDetail(tool: string, input: unknown, output: unknown, status: string, timed?: CallTiming): Detail {
  const result = output === undefined ? '' : outputText(output) || pretty(output);
  const took = timed?.end !== undefined ? duration(timed.end - timed.start) : undefined;
  return {
    role: 'TOOL',
    title: timed ? `${tool} · step ${timed.step}` : tool,
    views: [
      {
        name: 'Summary',
        fields: [
          ['Tool', tool],
          ['Status', status],
          ['Input', inputSummary(input)],
          ['Result', outputSummary(output) || '—'],
          ...(took ? [['Duration', took] as [string, string]] : []),
        ],
      },
      { name: 'Payload', code: pretty(input), language: 'json' },
      { name: 'Result', code: result, empty: status === 'running' ? 'Still running.' : 'No result.' },
      {
        name: 'Timing',
        fields: timed
          ? [
              ['Step', String(timed.step)],
              ['Started', clock(timed.start)],
              ['Finished', timed.end !== undefined ? clock(timed.end) : '—'],
              ['Duration', took ?? '—'],
            ]
          : [],
        empty: 'Not timed: the call ran before this session loaded the plugin.',
      },
    ],
  };
}

/** The detail a prompt or reply row opens: Summary, Preview (rendered) and Raw (the source). */
export function textDetail(role: string, title: string, text: string): Detail {
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    role,
    title,
    views: [
      {
        name: 'Summary',
        fields: [
          ['Words', String(words)],
          ['Lines', String(text.split('\n').length)],
          ['Characters', String([...text].length)],
        ],
      },
      { name: 'Preview', markdown: text, empty: '(empty)' },
      { name: 'Raw', text, empty: '(empty)' },
    ],
  };
}

/** Origins of a prompt the person typed: the terminal's composer, the desktop app (an SDK host), Remote Control. */
const TYPED_ORIGINS = new Set(['composer', 'sdk', 'bridge']);

/** Prompts remembered with their attachments; the oldest drop out past this. */
const REMEMBERED_PROMPTS = 50;

/** The line an attachment draws under its prompt: its kind, and its file name when it had one. */
export function attachmentLabel(attachment: PromptSubmitAttachment): string {
  return attachment.filename ? `${attachment.type} · ${attachment.filename}` : attachment.type;
}

/** The tool that asks the person a multiple-choice question. */
const ASK_TOOL = 'AskUserQuestion';

/** An AskUserQuestion call's questions, one per line. */
export function questionText(questions: readonly unknown[]): string {
  return questions
    .map((question) => str(record(question)['question']))
    .filter(Boolean)
    .join('\n');
}

/**
 * True when the tree holds the engine's own drawing (what `next(e)` resolves
 * to). The engine refuses a tree that puts its drawing under a Box with
 * `minWidth`, and draws its own row without the label instead.
 */
export function holdsEngine(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(holdsEngine);
  if (!node || typeof node !== 'object') return false;
  const element = node as { type?: unknown; children?: unknown; props?: { children?: unknown } };
  return element.type === 'engine' || holdsEngine(element.children ?? element.props?.children);
}

/** The › that opens a row's detail in the pane. */
function opener(
  $: EngineInterface,
  ui: Elements['terminal'] | Elements['desktop'] | Elements['mobile'] | Elements['vscode'],
  requestId: string,
  open: () => Detail,
) {
  const { Button } = ui;
  return (
    <Button
      key={`open-${requestId}`}
      label="›"
      plain
      dimColor
      onPress={async () => {
        await update($, detail, () => open());
        await update($, tab, () => 'Summary');
        await $.ui.open({ id: PANE, title: PANE_TITLE });
      }}
    />
  );
}

/**
 * One log row: the coloured label, the › that opens its detail, then the
 * row's own drawing, which wraps in the room left.
 */
function row(
  $: EngineInterface,
  ui: Elements['terminal'] | Elements['desktop'] | Elements['mobile'] | Elements['vscode'],
  requestId: string,
  label: string,
  color: string,
  open: () => Detail,
  body: RenderElement | RenderElement[],
) {
  const { Box, Text } = ui;
  return (
    <Box key={`row-${requestId}`} flexDirection="row" alignItems="flex-start" hover={{ backgroundColor: HOVER_BACKGROUND }}>
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text color={color} bold>{label}</Text>
      </Box>
      <Box width={OPENER_WIDTH} flexShrink={0}>
        {opener($, ui, requestId, open)}
      </Box>
      {holdsEngine(body) ? (
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {body}
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          {body}
        </Box>
      )}
    </Box>
  );
}


export const register: Register = (on, options) => {
  const style = chatStyle(options);
  if (!style.enabled) return;

  // The drawn row carries only the text, so attachments are noted as the
  // prompt is submitted and matched to its row by text. A resumed session's
  // earlier prompts were submitted before this ran and show none.
  const attachments = new Map<string, readonly PromptSubmitAttachment[]>();
  on('prompt.submit', async ($, e, next) => {
    if (e.attachments?.length) {
      attachments.delete(e.text);
      attachments.set(e.text, e.attachments);
      if (attachments.size > REMEMBERED_PROMPTS) attachments.delete(attachments.keys().next().value as string);
    }
    return next(e);
  });

  // When each call starts and ends, for the pane's Timing tab.
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id;
    if (id) {
      const start = Date.now();
      await update($, timing, (all) => {
        const ids = Object.keys(all);
        const kept = ids.length >= TIMED_CALLS ? Object.fromEntries(ids.slice(-TIMED_CALLS + 1).map((key) => [key, all[key]!])) : all;
        const last = Math.max(0, ...Object.values(all).map((call) => call.step));
        return { ...kept, [id]: { step: last + 1, start } };
      });
    }
    try {
      return await next(e);
    } finally {
      if (id) {
        const end = Date.now();
        await update($, timing, (all) => (all[id] ? { ...all, [id]: { ...all[id]!, end } } : all));
      }
    }
  });

  // Claude's text: CLAUDE, or CLAUDE ? in yellow when it asks you something.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { text } = e.props;
    const question = isQuestion(text);
    const label = question ? 'CLAUDE ?' : 'CLAUDE';
    return row($, ui, e.requestId, label, question ? style.questionColor : style.claudeColor, () => textDetail(label, question ? 'question' : 'reply', text), <ui.Markdown text={text} />);
  });

  // Your own prompts: YOU. Notifications, teammates and other senders keep the engine's row.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!TYPED_ORIGINS.has(e.props.origin.kind)) return next(e);
    const ui = $.ui.resolve(e);
    const { text } = e.props;
    const chips = (attachments.get(text) ?? []).map((attachment, i) => (
      <ui.Text key={String(i)} color={style.youColor}>{`▣ ${attachmentLabel(attachment)}`}</ui.Text>
    ));
    return row($, ui, e.requestId, 'YOU', style.youColor, () => textDetail('YOU', 'prompt', text), text ? [<ui.Text>{text}</ui.Text>, ...chips] : chips);
  });

  // The live question dialog: CLAUDE ? on a line of its own above the engine's
  // dialog. The engine refuses a sized Box around the dialog, so the label
  // cannot take its usual column beside it.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const ui = $.ui.resolve(e);
    const { Box, Text } = ui;
    const text = questionText(e.props.questions);
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={style.questionColor} bold>CLAUDE ?</Text>
          {opener($, ui, e.requestId, () => textDetail('CLAUDE ?', 'question', text))}
        </Box>
        {await next(e)}
      </Box>
    );
  });

  // A tool call: TOOL and one line, `Bash npm test → 14 passed`, once done.
  // While it runs, or when it failed, the engine's own drawing stays under the label.
  // An AskUserQuestion call is a question to you: CLAUDE ? over the engine's card.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const ui = $.ui.resolve(e);
    const { tool, input, output, isRunning, isErrored, isInterrupted } = e.props;
    const status = isRunning ? 'running' : isInterrupted ? 'interrupted' : isErrored ? 'failed' : 'done';
    const timed = (await read($, timing))[e.props.tool_use_id];
    const open = () => toolDetail(tool, input, output, status, timed);
    if (tool === ASK_TOOL && !isErrored && !isInterrupted) {
      return row($, ui, e.requestId, 'CLAUDE ?', style.questionColor, open, await next(e));
    }
    if (isRunning || isErrored || isInterrupted) {
      return row($, ui, e.requestId, 'TOOL', isRunning ? style.toolColor : ERROR_COLOR, open, await next(e));
    }
    const result = outputSummary(output);
    return row(
      $,
      ui,
      e.requestId,
      'TOOL',
      style.toolColor,
      open,
      <ui.Text wrap="truncate-end">
        {`${tool} ${inputSummary(input)}`}
        <ui.Text color={DIM_COLOR}>{result ? ` → ${result}` : ''}</ui.Text>
      </ui.Text>,
    );
  });

  // A finished call's result lives in the pane now; a failed one keeps its block, error text and all.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e);
    const fields = record(e.props.output);
    if (e.props.isErrored || fields['is_error'] === true || fields['interrupted'] === true) return next(e);
    return <Box />;
  });

  // A folded group (`Ran 2 shell commands`): TOOL and one line per call, as a
  // single call draws once done, red when one failed. The engine's count line
  // drops below the label column, so it stays only while the group is live or
  // expanded (ctrl+o).
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const ui = $.ui.resolve(e);
    const { calls, isActive, isExpanded } = e.props;
    const status = (call: (typeof calls)[number]) =>
      call.isRunning ? 'running' : call.isInterrupted ? 'interrupted' : call.isErrored ? 'failed' : 'done';
    const only = calls.length === 1 ? calls[0] : undefined;
    const open = (): Detail =>
      only
        ? toolDetail(only.tool, only.input, only.output, status(only))
        : {
            role: 'TOOL',
            title: `${calls.length} calls`,
            views: [
              { name: 'Summary', fields: calls.map((call): [string, string] => [call.tool, `${inputSummary(call.input)} → ${outputSummary(call.output) || status(call)}`]) },
              { name: 'Payload', code: pretty(calls.map((call) => ({ tool: call.tool, input: call.input }))), language: 'json' },
            ],
          };
    const failed = calls.some((call) => call.isErrored || call.isInterrupted);
    const color = failed ? ERROR_COLOR : style.toolColor;
    if (isActive || isExpanded) return row($, ui, e.requestId, 'TOOL', color, open, await next(e));
    return row(
      $,
      ui,
      e.requestId,
      'TOOL',
      color,
      open,
      calls.map((call, i) => {
        const bad = call.isErrored || call.isInterrupted;
        const result = bad ? status(call) : outputSummary(call.output);
        return (
          <ui.Text key={String(i)} wrap="truncate-end">
            {`${call.tool} ${inputSummary(call.input)}`}
            <ui.Text color={bad ? ERROR_COLOR : DIM_COLOR}>{result ? ` → ${result}` : ''}</ui.Text>
          </ui.Text>
        );
      }),
    );
  });

  // The pane: the row's label and title, a button per tab, and the open tab.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown, Code } = $.ui.resolve(e);
    const shown = await read($, detail);
    if (!shown) return <Text color={DIM_COLOR}>Click › beside a row to see it here.</Text>;
    const name = await read($, tab);
    const view = shown.views.find((one) => one.name === name) ?? shown.views[0];
    const color =
      shown.role === 'YOU' ? style.youColor : shown.role === 'TOOL' ? style.toolColor : shown.role === 'CLAUDE ?' ? style.questionColor : style.claudeColor;
    const body = (one: DetailView | undefined) => {
      if (!one) return <Text color={DIM_COLOR}>Nothing to show.</Text>;
      const empty = <Text color={DIM_COLOR}>{one.empty ?? 'Nothing to show.'}</Text>;
      if (one.fields) {
        if (!one.fields.length) return empty;
        return (
          <Box flexDirection="column">
            {one.fields.map(([label, value], i) => (
              <Box key={String(i)} flexDirection="row">
                <Box width={12} flexShrink={0}>
                  <Text color={DIM_COLOR}>{label}</Text>
                </Box>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text>{value}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        );
      }
      if (one.code !== undefined) return one.code ? <Code source={one.code} language={one.language} /> : empty;
      if (one.markdown !== undefined) return one.markdown ? <Markdown text={one.markdown} /> : empty;
      return one.text ? <Text>{one.text}</Text> : empty;
    };
    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text color={color} bold>{shown.role}</Text>
          <Text color={DIM_COLOR}>{` · ${shown.title}`}</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          {shown.views.map((one) => (
            <Button key={`tab-${one.name}`} label={one.name} variant={one === view ? 'primary' : 'secondary'} onPress={() => void update($, tab, () => one.name)} />
          ))}
        </Box>
        {body(view)}
      </Box>
    );
  });
};
