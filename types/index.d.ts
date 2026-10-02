/** One tab of the detail pane: label and value pairs, a code block, markdown, or plain text. */
export type DetailView = {
  /** The tab's label, and its key. */
  name: string;
  fields?: [string, string][];
  code?: string;
  /** The code block's language, for colour: `json`, `bash`. */
  language?: string;
  markdown?: string;
  text?: string;
  /** Shown when the tab has nothing to show. */
  empty?: string;
};

/** What the detail pane shows: the row last clicked. */
export type Detail = {
  /** The row's role label: YOU, CLAUDE, CLAUDE ?, TOOL. */
  role: string;
  /** The header beside the label: a tool's name and step, "reply", "prompt". */
  title: string;
  views: DetailView[];
};

/** When a tool call ran, by its tool_use_id: epoch ms, and its place in the session's calls. */
export type CallTiming = { step: number; start: number; end?: number };

declare module 'claude-code' {
  interface PluginState {
    'log-transcript-theme': { detail: Detail | null; tab: string; timing: Record<string, CallTiming> };
  }
}
