import { describe, expect, test } from 'claude-code/testing';

import { attachmentLabel, attachmentsSummary, chatStyle, DEFAULTS, duration, firstLine, formatName, holdsEngine, inputSummary, lastLine, isQuestion, outputSummary, outputText, PANE, questionText, textDetail, toolDetail } from '../hooks/log-transcript-theme.tsx';

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

/** Every element of a drawn tree, depth first. */
function walk(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const element = node as Node;
    out.push(element);
    walk(element.children ?? element.props?.['children'], out);
  }
  return out;
}

/** The strings a Text element draws. */
function textOf(element: Node): string {
  const children = element.children ?? element.props?.['children'];
  return (Array.isArray(children) ? children : [children]).filter((c) => typeof c === 'string').join('');
}

function texts(tree: unknown): { text: string; color: unknown; backgroundColor: unknown }[] {
  return walk(tree)
    .filter((element) => element.type === 'Text')
    .map((element) => ({ text: textOf(element), color: element.props?.['color'], backgroundColor: element.props?.['backgroundColor'] }));
}

/** All the text a Text element draws, nested Texts included. */
function allText(element: Node): string {
  const children = element.children ?? element.props?.['children'];
  return (Array.isArray(children) ? children : [children])
    .map((child) => (typeof child === 'string' ? child : child && typeof child === 'object' ? allText(child as Node) : ''))
    .join('');
}

const viewport = { columns: 100, rows: 40 };
const PLUGIN = 'log-transcript-theme';
const ERROR_RED = '#FF5E92';

const toolProps = (over: Record<string, unknown> = {}) => ({
  tool_use_id: 't1',
  tool: 'Bash',
  input: { command: 'npm test' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout: '14 passed\n' },
  ...over,
});

const paneProps = { title: 'Details', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} };

describe('helpers', () => {
  test('holdsEngine finds the engine\'s drawing anywhere in a tree', () => {
    expect(holdsEngine({ type: 'engine', ref: 1 })).toBe(true);
    expect(holdsEngine([{ type: 'Text', children: ['a'] }, { type: 'Box', children: [{ type: 'engine', ref: 2 }] }])).toBe(true);
    expect(holdsEngine({ type: 'Text', children: ['plain'] })).toBe(false);
  });

  test('questionText lists each question on its own line', () => {
    expect(questionText([{ question: 'Run?' }, { question: 'Push?' }, {}])).toBe('Run?\nPush?');
  });

  test('a reply is a question when its last paragraph outside code ends with a question mark', () => {
    expect(isQuestion('Do you mean a real language or a made-up one?')).toBe(true);
    expect(isQuestion('Which one do you want? **Pick A or B?**')).toBe(true);
    expect(isQuestion('Is it this?\n\nNo, it is that.')).toBe(false);
    expect(isQuestion('Run it:\n\n```sh\nwhich node?\n```')).toBe(false);
    expect(isQuestion('Next: reply A or B.')).toBe(false);
  });

  test('firstLine skips blank lines and trims', () => {
    expect(firstLine('\n  \n  hello  \nworld')).toBe('hello');
    expect(firstLine('')).toBe('');
  });

  test('inputSummary names the command, the file, or falls back to JSON', () => {
    expect(inputSummary({ command: 'npm test\nsecond line' })).toBe('npm test');
    expect(inputSummary({ file_path: '/a/b.ts', other: 1 })).toBe('/a/b.ts');
    expect(inputSummary({ foo: 1 })).toBe('{"foo":1}');
    expect(inputSummary({})).toBe('');
    expect(inputSummary('plain\nmore')).toBe('plain');
  });

  test('outputSummary says what a call came to in one line', () => {
    expect(outputSummary({ stdout: '(pass) one test\n\n 40 pass\nRan 40 tests across 1 file.\n\n' })).toBe('Ran 40 tests across 1 file.');
    expect(lastLine('a\n  b  \n\n')).toBe('b');
    expect(lastLine('')).toBe('');
    expect(lastLine('{\n  "content": "found 3 tools"\n}\n')).toBe('"content": "found 3 tools"');
    expect(lastLine('}\n]')).toBe('');
    expect(outputSummary({ structuredPatch: [{ lines: [' ctx', '+a', '+b', '-c'] }] })).toBe('+2 −1');
    expect(outputSummary({ file: { numLines: 48, content: 'x' } })).toBe('48 lines');
    expect(outputSummary({ numFiles: 3 })).toBe('3 files');
    expect(outputSummary({ numFiles: 1 })).toBe('1 file');
    expect(outputSummary(undefined)).toBe('');
    expect(outputSummary({ numLines: 17 })).toBe('17 lines');
    expect(outputSummary('179', 'Read')).toBe('179 lines');
    expect(outputSummary(1, 'Read')).toBe('1 line');
    expect(outputSummary('179', 'Bash')).toBe('179');
    expect(outputSummary('1\t{\n2\t  "a": 1\n17\t}', 'Read')).toBe('17 lines');
    expect(outputSummary('1\t# Title\n2\t\n179\t', 'Read')).toBe('179 lines');
  });

  test('outputText reads shell output, file content or a plain string', () => {
    expect(outputText('hi')).toBe('hi');
    expect(outputText({ stdout: 'out', stderr: 'err' })).toBe('out\nerr');
    expect(outputText({ file: { content: 'body' } })).toBe('body');
    expect(outputText({ result: 'answer' })).toBe('answer');
    expect(outputText(undefined)).toBe('');
  });

  test('options fall back to defaults and are trimmed', () => {
    expect(chatStyle({})).toEqual(DEFAULTS);
    expect(chatStyle({ youColor: ' red ', claudeColor: '   ', toolColor: 5 })).toMatchObject({ youColor: 'red', claudeColor: DEFAULTS.claudeColor, toolColor: DEFAULTS.toolColor });
    expect(chatStyle({ enabled: false }).enabled).toBe(false);
  });

  test('attachment labels name the kind and place, then the file name or, for a paste, the format', () => {
    expect(attachmentLabel({ type: 'document', filename: 'spec.pdf', mediaType: 'application/pdf' }, 1)).toBe('document 1 · spec.pdf');
    expect(attachmentLabel({ type: 'image', mediaType: 'image/png' }, 2)).toBe('image 2 · PNG');
    expect(attachmentLabel({ type: 'audio' }, 3)).toBe('audio 3');
  });

  test('formats read as people name them', () => {
    expect(formatName('image/png')).toBe('PNG');
    expect(formatName('image/svg+xml')).toBe('SVG');
    expect(formatName('image/jpeg; q=1')).toBe('JPEG');
    expect(formatName(undefined)).toBeUndefined();
  });

  test('a prompt\'s attachments sum up by kind and format', () => {
    const png = { type: 'image' as const, mediaType: 'image/png' };
    expect(attachmentsSummary([png, png, png])).toBe('3 images (PNG)');
    expect(attachmentsSummary([png, { type: 'document', mediaType: 'application/pdf' }])).toBe('1 image, 1 document (PNG, PDF)');
    expect(attachmentsSummary([{ type: 'image' }])).toBe('1 image');
  });

  test('a prompt\'s detail lists its attachments in Summary and Raw', () => {
    const shown = textDetail('YOU', 'prompt', 'Testing images', [{ type: 'image', mediaType: 'image/png' }, { type: 'image', mediaType: 'image/png' }]);
    expect(shown.views[0]?.fields).toContainEqual(['Attachments', '2 images (PNG)']);
    expect(shown.views[2]?.text).toBe('Testing images\n\nattachments:\n1. image 1 · PNG (image/png)\n2. image 2 · PNG (image/png)');
    expect(textDetail('YOU', 'prompt', 'plain').views[0]?.fields?.map(([name]) => name)).not.toContain('Attachments');
  });

  test('durations read as people say them', () => {
    expect(duration(840)).toBe('840 ms');
    expect(duration(12_300)).toBe('12.3 s');
    expect(duration(125_000)).toBe('2 min 5 s');
  });

  test('details carry role, title and named views', () => {
    const tool = toolDetail('Bash', { command: 'npm test' }, { stdout: '14 passed\n' }, 'done');
    expect(tool).toMatchObject({ role: 'TOOL', title: 'Bash' });
    expect(tool.views.map((v) => v.name)).toEqual(['Summary', 'Payload', 'Result', 'Timing']);
    expect(tool.views[0]?.fields).toContainEqual(['Input', 'npm test']);
    expect(tool.views[0]?.fields).toContainEqual(['Result', '14 passed']);
    expect(tool.views[1]).toMatchObject({ language: 'json' });
    expect(tool.views[1]?.code).toContain('"command": "npm test"');
    expect(tool.views[2]?.code).toBe('14 passed\n');
    expect(tool.views[3]?.fields).toEqual([]);
    expect(toolDetail('Bash', {}, undefined, 'running').views[2]).toMatchObject({ code: '', empty: 'Still running.' });
    expect(toolDetail('Bash', {}, undefined, 'done').views[2]?.empty).toBe('No result.');
    const timed = toolDetail('Bash', {}, { stdout: 'x' }, 'done', { step: 3, start: 1000, end: 3000 });
    expect(timed.title).toBe('Bash · step 3');
    expect(timed.views[0]?.fields).toContainEqual(['Duration', '2.0 s']);
    expect(timed.views[3]?.fields).toContainEqual(['Step', '3']);
    const text = textDetail('CLAUDE', 'reply', 'one two\nthree');
    expect(text.views.map((v) => v.name)).toEqual(['Summary', 'Preview', 'Raw']);
    expect(text.views[0]?.fields).toEqual([['Words', '3'], ['Lines', '2'], ['Characters', '13']]);
    expect(text.views[1]?.markdown).toBe('one two\nthree');
    expect(text.views[2]?.text).toBe('one two\nthree');
  });
});

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`${surface}: replies`, () => {
    test('are labelled CLAUDE in the claude colour', async ($) => {
      const tree = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'r1', viewport, props: { text: 'Retry now uses **backoff**.', isFirstOfReply: true } });
      expect(texts(tree)[0]).toMatchObject({ text: 'CLAUDE', color: DEFAULTS.claudeColor });
      expect(walk(tree).find((element) => element.type === 'Markdown')?.props?.['text']).toBe('Retry now uses **backoff**.');
      expect(walk(tree).some((element) => element.type === 'Button' && element.props?.['label'] === '›')).toBe(true);
    });

    test('ending in a question become CLAUDE ? in the question colour', async ($) => {
      const tree = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'r2', viewport, props: { text: 'Do you mean a real language?', isFirstOfReply: true } });
      expect(texts(tree)[0]).toMatchObject({ text: 'CLAUDE ?', color: DEFAULTS.questionColor });
    });

    test('with a question mark only inside code stay CLAUDE', async ($) => {
      const tree = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'r3', viewport, props: { text: 'Run it:\n\n```sh\nwhich node?\n```', isFirstOfReply: true } });
      expect(texts(tree)[0]).toMatchObject({ text: 'CLAUDE', color: DEFAULTS.claudeColor });
    });
  });

  describe(`${surface}: prompts`, () => {
    test('typed in the composer or by an SDK host get the YOU label and the text', async ($) => {
      for (const kind of ['composer', 'sdk'] as const) {
        const tree = await $.ui.render({ surface, component: 'UserMessage', requestId: `u-${kind}`, viewport, props: { text: 'Add jitter to the backoff.', origin: { kind }, isExpanded: false } });
        expect(texts(tree).map((t) => t.text)).toEqual(['YOU', 'Add jitter to the backoff.']);
        expect(texts(tree)[0]?.color).toBe(DEFAULTS.youColor);
      }
    });

    test('from anyone else keep the engine\'s own row', async ($, on) => {
      on('ui.render', { component: 'UserMessage' }, (hook$, e) => {
        const { Text } = hook$.ui.resolve(e);
        return <Text dimColor>{e.props.text}</Text>;
      });
      const tree = await $.ui.render({ surface, component: 'UserMessage', requestId: 'u2', viewport, props: { text: 'Background build finished.', origin: { kind: 'task-notification' }, isExpanded: false } });
      expect(texts(tree).map((t) => t.text)).toEqual(['Background build finished.']);
    });
  });

  describe(`${surface}: tool calls`, () => {
    test('fold to one line once done', async ($) => {
      const tree = await $.ui.render({ surface, component: 'ToolUse', requestId: 't1', viewport, props: toolProps() });
      const all = texts(tree);
      expect(all[0]).toMatchObject({ text: 'TOOL', color: DEFAULTS.toolColor });
      const lines = walk(tree).filter((element) => element.type === 'Text').map(allText);
      expect(lines).toContain('Bash npm test → 14 passed');
      expect(walk(tree).some((element) => element.props?.['position'] === 'absolute')).toBe(false);
      // The pointer underlines the label and paints no background, which would hide a selection.
      const hovers = walk(tree).map((element) => ((element as { hover?: unknown }).hover ?? element.props?.['hover']) as { backgroundColor?: string; underline?: boolean } | undefined);
      expect(hovers.some((hover) => hover?.backgroundColor)).toBe(false);
      expect(hovers.some((hover) => hover?.underline === true)).toBe(true);
    });

    test('keep the engine\'s row under the label while running', async ($, on) => {
      on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 0 }));
      const tree = await $.ui.render({ surface, component: 'ToolUse', requestId: 't2', viewport, props: toolProps({ isRunning: true, output: undefined }) });
      expect(texts(tree).map((t) => t.text)).toEqual(['TOOL']);
      expect(walk(tree).filter((element) => element.type === 'engine')).toHaveLength(1);
      expect(texts(tree)[0]?.color).toBe(DEFAULTS.toolColor);
    });

    test('that errored get a red label and the engine\'s row', async ($, on) => {
      on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 0 }));
      const tree = await $.ui.render({ surface, component: 'ToolUse', requestId: 't3', viewport, props: toolProps({ isErrored: true }) });
      expect(texts(tree).map((t) => t.text)).toEqual(['TOOL']);
      expect(walk(tree).filter((element) => element.type === 'engine')).toHaveLength(1);
      expect(texts(tree)[0]?.color).toBe(ERROR_RED);
    });

    const call = (over: Record<string, unknown> = {}) => ({ tool: 'Bash', input: { command: 'ls' }, output: { stdout: 'a\ntypes\n' }, isRunning: false, isErrored: false, isInterrupted: false, ...over });
    const group = (calls: unknown[], over: Record<string, unknown> = {}) => ({ calls, isActive: false, isExpanded: false, ...over });

    test('folded groups draw TOOL and one line per call, no engine count line', async ($, on) => {
      on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'engine', ref: 0 }));
      const props = group([call(), call({ input: { command: 'git log --oneline -3' }, output: { stdout: 'abc first\n' } })]);
      const tree = await $.ui.render({ surface, component: 'ToolGroup', requestId: 'g1', viewport, props: props as never });
      const lines = walk(tree).filter((element) => element.type === 'Text').map(allText);
      expect(lines).toContain('Bash ls → types');
      expect(lines).toContain('Bash git log --oneline -3 → abc first');
      const reads = group([call({ tool: 'Read', input: { file_path: '/r.md' }, output: '179' })]);
      const readTree = await $.ui.render({ surface, component: 'ToolGroup', requestId: 'g4', viewport, props: reads as never });
      expect(walk(readTree).filter((element) => element.type === 'Text').map(allText)).toContain('Read /r.md → 179 lines');
      expect(texts(tree)[0]).toMatchObject({ text: 'TOOL', color: DEFAULTS.toolColor });
      expect(walk(tree).filter((element) => element.type === 'engine')).toHaveLength(0);
    });

    test('a folded group with a failed call gets a red label and says failed', async ($) => {
      const props = group([call(), call({ input: { command: 'npm run tset' }, output: { stdout: '', stderr: 'Missing script' }, isErrored: true })]);
      const tree = await $.ui.render({ surface, component: 'ToolGroup', requestId: 'g2', viewport, props: props as never });
      expect(texts(tree)[0]?.color).toBe(ERROR_RED);
      expect(walk(tree).filter((element) => element.type === 'Text').map(allText)).toContain('Bash npm run tset → failed');
    });

    test('a live or expanded group keeps the engine\'s drawing under TOOL', async ($, on) => {
      on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'engine', ref: 0 }));
      for (const over of [{ isActive: true }, { isExpanded: true }]) {
        const tree = await $.ui.render({ surface, component: 'ToolGroup', requestId: 'g3', viewport, props: group([call()], over) as never });
        expect(texts(tree).map((t) => t.text)).toEqual(['TOOL']);
        expect(walk(tree).filter((element) => element.type === 'engine')).toHaveLength(1);
      }
    });
  });

  describe(`${surface}: questions`, () => {
    const questions = [{ question: 'Run the tests?', header: 'Tests', multiSelect: false, options: [{ label: 'Yes', description: 'Run them' }, { label: 'No', description: 'Stop' }] }];

    test('the AskUserQuestion dialog gets CLAUDE ? over the engine\'s dialog', async ($, on) => {
      // The dialog must hold exactly one engine node: the engine's own drawing, as `next(e)` gives it.
      on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine', ref: 0 }));
      const tree = await $.ui.render({ surface, component: 'AskUserQuestion', requestId: 'q1', viewport, props: { tool: 'AskUserQuestion', questions } });
      expect(texts(tree).map((t) => t.text)).toEqual(['CLAUDE ?']);
      expect(texts(tree)[0]?.color).toBe(DEFAULTS.questionColor);
      expect(walk(tree).filter((element) => element.type === 'engine')).toHaveLength(1);
    });

    test('an answered AskUserQuestion call keeps the engine\'s card under CLAUDE ?', async ($, on) => {
      on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 0 }));
      const tree = await $.ui.render({ surface, component: 'ToolUse', requestId: 'q2', viewport, props: toolProps({ tool: 'AskUserQuestion', input: { questions }, output: { answers: { 'Run the tests?': 'Yes' } } }) });
      expect(texts(tree).map((t) => t.text)).toEqual(['CLAUDE ?']);
      expect(walk(tree).filter((element) => element.type === 'engine')).toHaveLength(1);
      expect(texts(tree)[0]?.color).toBe(DEFAULTS.questionColor);
    });
  });

  describe(`${surface}: tool results`, () => {
    test('of a finished call draw no text', async ($) => {
      const tree = await $.ui.render({ surface, component: 'ToolResult', requestId: 'x1', viewport, props: { tool_use_id: 'x1', tool: 'Bash', output: { stdout: '14 passed\n' }, isErrored: false } });
      expect(texts(tree)).toEqual([]);
    });

    test('with is_error or interrupted keep the engine\'s drawing', async ($, on) => {
      on('ui.render', { component: 'ToolResult' }, (hook$, e) => {
        const { Text } = hook$.ui.resolve(e);
        return <Text>ENGINE ERROR</Text>;
      });
      for (const output of [{ is_error: true }, { interrupted: true }]) {
        const tree = await $.ui.render({ surface, component: 'ToolResult', requestId: 'x2', viewport, props: { tool_use_id: 'x2', tool: 'Bash', output, isErrored: true } });
        expect(texts(tree).map((t) => t.text)).toEqual(['ENGINE ERROR']);
      }
    });

    test('of a failed call keep the engine\'s drawing, even as plain shell output', async ($, on) => {
      on('ui.render', { component: 'ToolResult' }, (hook$, e) => {
        const { Text } = hook$.ui.resolve(e);
        return <Text>ENGINE ERROR</Text>;
      });
      const output = { stdout: '', stderr: 'npm ERR! missing script: tset\n' };
      const tree = await $.ui.render({ surface, component: 'ToolResult', requestId: 'x3', viewport, props: { tool_use_id: 'x3', tool: 'Bash', output, isErrored: true } });
      expect(texts(tree).map((t) => t.text)).toEqual(['ENGINE ERROR']);
    });
  });

  describe(`${surface}: the detail pane`, () => {
    test('pressing › opens the row in the pane, and the tabs switch its view', async ($, on) => {
      const opened: unknown[] = [];
      on('ui.open', (_, e) => {
        opened.push(e.id);
        return { value: { isPlaced: true as const } };
      });
      await $.ui.render({ surface, component: 'ToolUse', requestId: 't9', viewport, props: toolProps({ tool_use_id: 't9' }) });
      await $.ui.press({ plugin: PLUGIN, key: 'open-t9', requestId: 't9', surface });
      expect(opened).toEqual([PANE]);

      const pane = () => $.ui.render({ surface, component: 'Pane', requestId: PANE, viewport, props: paneProps });
      let tree = await pane();
      const shown = texts(tree).map((t) => t.text);
      expect(shown).toContain('TOOL');
      expect(shown).toContain(' · Bash');
      expect(shown).toEqual(expect.arrayContaining(['Tool', 'Status', 'Input', 'Result', 'npm test', '14 passed', 'done']));
      const buttons = (t: unknown) => walk(t).filter((element) => element.type === 'Button').map((element) => [element.props?.['label'], element.props?.['variant']]);
      expect(buttons(tree)).toEqual([['Summary', 'primary'], ['Payload', 'secondary'], ['Result', 'secondary'], ['Timing', 'secondary']]);

      await $.ui.press({ plugin: PLUGIN, key: 'tab-Payload', requestId: PANE, surface });
      tree = await pane();
      expect(buttons(tree)[1]).toEqual(['Payload', 'primary']);
      const code = walk(tree).find((element) => element.type === 'Code');
      expect(code?.props).toMatchObject({ language: 'json' });
      expect(String(code?.props?.['source'])).toContain('"command": "npm test"');

      await $.ui.press({ plugin: PLUGIN, key: 'tab-Timing', requestId: PANE, surface });
      tree = await pane();
      expect(texts(tree).some((t) => t.text.startsWith('Not timed'))).toBe(true);
    });

    test('shows a hint until a row is opened', async ($) => {
      const tree = await $.ui.render({ surface, component: 'Pane', requestId: PANE, viewport, props: paneProps });
      expect(texts(tree).map((t) => t.text)).toEqual(['Click › beside a row to see it here.']);
    });
  });
}

describe('tool timing', () => {
  test('a tool.call is timed by its tool_use_id and the pane shows its step', async ($, on) => {
    on('tool.call', () => ({ result: { stdout: 'ok' } }) as never);
    on('ui.open', () => ({ value: { isPlaced: true as const } }));
    await $.tool.call({ tool: 'Bash', command: 'echo hi', tool_use_id: 'tm1' } as never);
    await $.ui.render({ surface: 'terminal', component: 'ToolUse', requestId: 'tm1', viewport, props: toolProps({ tool_use_id: 'tm1' }) });
    await $.ui.press({ plugin: PLUGIN, key: 'open-tm1', requestId: 'tm1', surface: 'terminal' });
    await $.ui.render({ surface: 'terminal', component: 'Pane', requestId: PANE, viewport, props: paneProps });
    await $.ui.press({ plugin: PLUGIN, key: 'tab-Timing', requestId: PANE, surface: 'terminal' });
    const tree = await $.ui.render({ surface: 'terminal', component: 'Pane', requestId: PANE, viewport, props: paneProps });
    expect(texts(tree).map((t) => t.text)).toEqual(expect.arrayContaining(['Step', '1', 'Finished']));
  });
});

describe('prompts with attachments', () => {
  test('an attached image shows as a chip in the YOU row', async ($, on) => {
    on('prompt.submit', (_, e) => ({ text: e.text }));
    await $.prompt.submit({ origin: { kind: 'sdk' }, wait: false, text: 'Make the header sticky', attachments: [{ type: 'image', mediaType: 'image/png', filename: 'header.png' }] });
    const tree = await $.ui.render({ surface: 'desktop', component: 'UserMessage', requestId: 'a1', props: { text: 'Make the header sticky', origin: { kind: 'sdk' }, isExpanded: false } });
    expect(texts(tree).map((t) => t.text)).toEqual(['YOU', 'Make the header sticky', '▣ image 1 · header.png']);
  });

  test('a prompt that was only an image still shows the chip', async ($, on) => {
    on('prompt.submit', (_, e) => ({ text: e.text }));
    await $.prompt.submit({ origin: { kind: 'composer' }, wait: false, text: '', attachments: [{ type: 'image', mediaType: 'image/png' }, { type: 'image', mediaType: 'image/jpeg' }] });
    const tree = await $.ui.render({ surface: 'terminal', component: 'UserMessage', requestId: 'a2', viewport, props: { text: '', origin: { kind: 'composer' }, isExpanded: false } });
    expect(texts(tree).map((t) => t.text)).toEqual(['YOU', '▣ image 1 · PNG', '▣ image 2 · JPEG']);
  });
});
