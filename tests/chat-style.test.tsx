import { describe, expect, test } from 'claude-code/testing';

import { chatStyle, fit, hasWideContent, inlineWidth, isQuestion, markdownWidth, QUESTION_TAG, textWidth } from '../hooks/chat-style.tsx';

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

/** The first Box drawn with a border. */
function bubble(tree: unknown): Node | undefined {
  return walk(tree).find((element) => element.type === 'Box' && element.props?.['borderStyle'] === 'round');
}

const viewport = { columns: 100, rows: 40 };

describe('rules', () => {
  test('a reply is a question when its last paragraph outside code ends with a question mark', () => {
    expect(isQuestion('Do you mean a real language or a made-up one?')).toBe(true);
    expect(isQuestion('Which one do you want? **Pick A or B?**')).toBe(true);
    expect(isQuestion('Is it this?\n\nNo, it is that.')).toBe(false);
    expect(isQuestion('Run it:\n\n```sh\nwhich node?\n```')).toBe(false);
    expect(isQuestion('Next: reply A or B.')).toBe(false);
  });

  test('code blocks and tables count as wide content', () => {
    expect(hasWideContent('Here:\n\n```ts\nconst a = 1;\n```')).toBe(true);
    expect(hasWideContent('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
    expect(hasWideContent('a | b is not a table')).toBe(false);
  });

  test('bubbles fit their content plus chrome, up to the cap', () => {
    expect(fit(textWidth('hello'), 75)).toBe(11);
    expect(fit(textWidth('x'.repeat(200)), 75)).toBe(75);
    expect(fit(textWidth('short\nand a longer line'), 75)).toBe(23);
    expect(fit(5, undefined)).toBeUndefined();
  });

  test('markdown is measured as drawn', () => {
    expect(inlineWidth('## Retry now uses **backoff** and `jitter`')).toBe('Retry now uses backoff and jitter'.length);
    expect(inlineWidth('see [the docs](https://example.com/very/long/path)')).toBe('see the docs'.length);
    // A poem in a code block: the widest line wins, whether code or prose.
    const poem = '```\nfn main:\n    print("no braces, no noise, just the shape of a thought.")\n```\n\nWant it run?';
    expect(markdownWidth(poem)).toBe('    print("no braces, no noise, just the shape of a thought.")'.length);
    // A table as the terminal draws it: each column its widest cell plus a space either side, rules between.
    expect(markdownWidth('| Fruit | Color |\n|---|---|\n| Blueberry | Blue |\n| Apple | Red |')).toBe(1 + (9 + 2) + 1 + (5 + 2) + 1);
  });

  test('options fall back to defaults and reject out-of-range values', () => {
    expect(chatStyle({})).toEqual({
      enabled: true,
      replyColor: '#D97757',
      promptColor: '#5BA4D8',
      replyWidthPercent: 95,
      codeWidthPercent: 95,
      promptWidthPercent: 95,
      replyIndent: 1,
    });
    expect(chatStyle({ replyWidthPercent: 80, replyIndent: 0, replyColor: ' red ' })).toMatchObject({ replyWidthPercent: 80, replyIndent: 0, replyColor: 'red' });
    expect(chatStyle({ replyWidthPercent: 5, promptWidthPercent: 150, replyIndent: -1 })).toMatchObject({ replyWidthPercent: 95, promptWidthPercent: 95, replyIndent: 1 });
    expect(chatStyle({ enabled: false }).enabled).toBe(false);
  });
});

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`${surface}: replies`, () => {
    test('sit in an orange box opened by an orange dot, sized to the text', async ($) => {
      const tree = await $.ui.render({
        surface,
        component: 'AssistantMessage',
        requestId: 'r1',
        viewport,
        props: { text: 'Retry now uses **backoff**.', isFirstOfReply: true },
      });
      expect(bubble(tree)?.props).toMatchObject({ borderColor: '#D97757', width: 'Retry now uses backoff.'.length + 6 });
      expect(walk(tree)[0]?.props?.['paddingLeft']).toBe(1);
      expect(texts(tree)).toContainEqual({ text: '●', color: '#D97757', backgroundColor: undefined });
      expect(walk(tree).find((element) => element.type === 'Markdown')?.props?.['text']).toBe('Retry now uses **backoff**.');
      expect(texts(tree).some((t) => t.text.includes(QUESTION_TAG))).toBe(false);
    });

    test('keep the box but draw no dot on a later block of the same reply', async ($) => {
      const tree = await $.ui.render({
        surface,
        component: 'AssistantMessage',
        requestId: 'r2',
        viewport,
        props: { text: 'A second paragraph.', isFirstOfReply: false },
      });
      expect(bubble(tree)?.props?.['borderColor']).toBe('#D97757');
      expect(texts(tree).some((t) => t.text === '●')).toBe(false);
    });

    test('tag a question as awaiting your answer', async ($) => {
      const tree = await $.ui.render({
        surface,
        component: 'AssistantMessage',
        requestId: 'r3',
        viewport,
        props: { text: 'Do you mean a real language, or a made-up one?', isFirstOfReply: true },
      });
      expect(texts(tree)).toContainEqual({ text: ` ${QUESTION_TAG} `, color: '#D97757', backgroundColor: '#3B2219' });
    });

    test('grow long prose to 95% of the width, shifted by the indent', async ($) => {
      const tree = await $.ui.render({
        surface,
        component: 'AssistantMessage',
        requestId: 'r4',
        viewport,
        props: { text: 'word '.repeat(60), isFirstOfReply: true },
      });
      expect(bubble(tree)?.props?.['width']).toBe(95);
    });

    test('size code blocks and tables to their widest line, up to 95% wide', async ($) => {
      const cases: [string, number][] = [
        ['Hello world:\n\n```quux\nsay "hi"!\n```', 'Hello world:'.length + 6],
        ['| Statement | Meaning |\n|---|---|\n| say | print |', 1 + (9 + 2) + 1 + (7 + 2) + 1 + 6],
        ['```\n' + 'x'.repeat(98) + '\n```', 95],
      ];
      for (const [text, width] of cases) {
        const tree = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'r5', viewport, props: { text, isFirstOfReply: true } });
        expect(bubble(tree)?.props?.['width']).toBe(width);
      }
    });

    test('make room for the question tag', async ($) => {
      const tree = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'r6', viewport, props: { text: 'Ready?', isFirstOfReply: true } });
      expect(bubble(tree)?.props?.['width']).toBe(QUESTION_TAG.length + 2 + 6);
    });
  });

  test(`${surface}: a long reply and a long prompt are the same width, so the gutters mirror`, async ($) => {
    const text = 'word '.repeat(40);
    const reply = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'm1', viewport, props: { text, isFirstOfReply: true } });
    const prompt = await $.ui.render({ surface, component: 'UserMessage', requestId: 'm2', viewport, props: { text, origin: { kind: 'composer' }, isExpanded: false } });
    expect(bubble(reply)?.props?.['width']).toBe(bubble(prompt)?.props?.['width']);
  });

  test(`${surface}: a narrow terminal keeps the indented reply on screen`, async ($) => {
    const tree = await $.ui.render({ surface, component: 'AssistantMessage', requestId: 'm3', viewport: { columns: 30, rows: 20 }, props: { text: 'word '.repeat(40), isFirstOfReply: true } });
    expect(bubble(tree)?.props?.['width']).toBe(28);
  });

  describe(`${surface}: prompts`, () => {
    test('sit in a right-aligned blue bubble sized to the text', async ($) => {
      const tree = await $.ui.render({
        surface,
        component: 'UserMessage',
        requestId: 'u1',
        viewport,
        props: { text: 'Add jitter to the backoff.', origin: { kind: 'composer' }, isExpanded: false },
      });
      expect(walk(tree)[0]?.props?.['justifyContent']).toBe('flex-end');
      expect(bubble(tree)?.props).toMatchObject({ borderColor: '#5BA4D8', width: 32 });
      expect(texts(tree).map((t) => t.text)).toEqual(['>', 'Add jitter to the backoff.']);
    });

    test('grow to at most 95% of the width', async ($) => {
      const tree = await $.ui.render({
        surface,
        component: 'UserMessage',
        requestId: 'u3',
        viewport,
        props: { text: 'word '.repeat(40), origin: { kind: 'composer' }, isExpanded: false },
      });
      expect(bubble(tree)?.props?.['width']).toBe(95);
    });

    test('from anyone else keep the engine\'s own row', async ($, on) => {
      // Stands in for the engine's own drawing beneath the plugin.
      on('ui.render', { component: 'UserMessage' }, (hook$, e) => {
        const { Text } = hook$.ui.resolve(e);
        return <Text dimColor>{e.props.text}</Text>;
      });
      const tree = await $.ui.render({
        surface,
        component: 'UserMessage',
        requestId: 'u2',
        viewport,
        props: { text: 'Background build finished.', origin: { kind: 'task-notification' }, isExpanded: false },
      });
      expect(bubble(tree)).toBeUndefined();
      expect(texts(tree).map((t) => t.text)).toEqual(['Background build finished.']);
    });
  });
}

describe('desktop: no viewport reported', () => {
  test('a reply shrinks to its text inside a row 95% wide, its dot on the first line', async ($) => {
    const tree = await $.ui.render({ surface: 'desktop', component: 'AssistantMessage', requestId: 'd1', props: { text: 'Short.', isFirstOfReply: true } });
    expect(walk(tree)[0]?.props).toMatchObject({ width: '95%', paddingLeft: 1 });
    expect(bubble(tree)?.props).toMatchObject({ flexGrow: 0 });
    expect(bubble(tree)?.props?.['width']).toBeUndefined();
    expect(walk(tree).some((element) => element.props?.['alignItems'] === 'flex-start')).toBe(true);
  });

  test('a prompt typed in the desktop app (an SDK host) shrinks to its text, right-aligned in a row 95% wide', async ($) => {
    const tree = await $.ui.render({ surface: 'desktop', component: 'UserMessage', requestId: 'd2', props: { text: 'Hi.', origin: { kind: 'sdk' }, isExpanded: false } });
    expect(walk(tree)[1]?.props).toMatchObject({ width: '95%', justifyContent: 'flex-end' });
    expect(bubble(tree)?.props).toMatchObject({ flexGrow: 0, borderColor: '#5BA4D8' });
    expect(bubble(tree)?.props?.['width']).toBeUndefined();
  });
});
