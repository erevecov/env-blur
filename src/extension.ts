import * as vscode from "vscode";

const ENV_PATTERN = /^(#\s*)?([A-Za-z_][A-Za-z0-9_]*\s*=)(.*)/;

let blurEnabled = true;
const revealedLines: Map<string, Set<number>> = new Map();

let blurDecoration: vscode.TextEditorDecorationType;
let statusBarItem: vscode.StatusBarItem;

function createDecorationType(): vscode.TextEditorDecorationType {
  const config = vscode.workspace.getConfiguration("env-blur");
  const color = config.get<string>("blurColor", "#808080");

  return vscode.window.createTextEditorDecorationType({
    opacity: "1",
    backgroundColor: `${color}18`,
    borderRadius: "4px",
    textDecoration: "none; filter: blur(6px); -webkit-filter: blur(6px)",
  });
}

function isEnvFile(document: vscode.TextDocument): boolean {
  const name = document.fileName.toLowerCase();
  // .env, .env.local, .env.production, .env.example, etc.
  // .envrc (direnv)
  // env, env.example, env.local, env.development, etc. (without leading dot)
  // *.env (e.g. staging.env, production.env)
  return (
    /[/\\]\.env(\..+)?$/i.test(name) ||
    /[/\\]\.envrc$/i.test(name) ||
    /[/\\]env(\..+)?$/i.test(name) ||
    /[/\\][^/\\]+\.env$/i.test(name)
  );
}

function updateStatusBar(editor: vscode.TextEditor | undefined): void {
  if (editor && isEnvFile(editor.document)) {
    statusBarItem.text = blurEnabled
      ? "$(eye-closed) Env Blur: ON"
      : "$(eye) Env Blur: OFF";
    statusBarItem.tooltip = blurEnabled
      ? "Click to reveal all env values"
      : "Click to blur all env values";
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function getRevealed(fileName: string): Set<number> {
  let set = revealedLines.get(fileName);
  if (!set) {
    set = new Set();
    revealedLines.set(fileName, set);
  }
  return set;
}

function applyDecorations(editor: vscode.TextEditor): void {
  if (!isEnvFile(editor.document)) {
    return;
  }

  const config = vscode.workspace.getConfiguration("env-blur");
  if (!config.get<boolean>("enabled", true) || !blurEnabled) {
    editor.setDecorations(blurDecoration, []);
    return;
  }

  const revealed = getRevealed(editor.document.fileName);
  const ranges: vscode.DecorationOptions[] = [];

  for (let i = 0; i < editor.document.lineCount; i++) {
    if (revealed.has(i)) {
      continue;
    }

    const line = editor.document.lineAt(i);
    const match = line.text.match(ENV_PATTERN);

    if (match) {
      const prefix = match[1] || "";
      const keyWithEq = match[2];
      const valueStart = prefix.length + keyWithEq.length;
      const valueText = match[3];

      if (valueText.length === 0) {
        continue;
      }

      const startPos = new vscode.Position(i, valueStart);
      const endPos = new vscode.Position(i, line.text.length);

      ranges.push({ range: new vscode.Range(startPos, endPos) });
    }
  }

  editor.setDecorations(blurDecoration, ranges);
}

export function activate(context: vscode.ExtensionContext): void {
  blurDecoration = createDecorationType();

  // Status bar button
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "env-blur.toggle";
  statusBarItem.backgroundColor = undefined;

  // Toggle command
  const toggleCmd = vscode.commands.registerCommand("env-blur.toggle", () => {
    blurEnabled = !blurEnabled;

    if (!blurEnabled) {
      revealedLines.clear();
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      applyDecorations(editor);
    }
    updateStatusBar(editor);
  });

  // Apply on active editor change
  const editorChange = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        applyDecorations(editor);
      }
      updateStatusBar(editor);
    }
  );

  // Re-apply on document edits
  const docChange = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === event.document) {
      // Clear revealed lines on edit to re-blur modified content
      const revealed = getRevealed(event.document.fileName);
      for (const change of event.contentChanges) {
        const startLine = change.range.start.line;
        const endLine = change.range.end.line;
        for (let i = startLine; i <= endLine; i++) {
          revealed.delete(i);
        }
      }
      applyDecorations(editor);
    }
  });

  // Reveal on cursor/click
  const selectionChange = vscode.window.onDidChangeTextEditorSelection(
    (event) => {
      const editor = event.textEditor;
      if (!isEnvFile(editor.document)) {
        return;
      }

      const revealed = getRevealed(editor.document.fileName);
      const currentLines = new Set(
        event.selections.map((s) => s.active.line)
      );

      // Reveal clicked lines, re-blur previously revealed ones
      let changed = false;

      // Re-blur lines that are no longer selected
      for (const line of revealed) {
        if (!currentLines.has(line)) {
          revealed.delete(line);
          changed = true;
        }
      }

      // Reveal newly selected lines
      for (const line of currentLines) {
        if (!revealed.has(line)) {
          revealed.add(line);
          changed = true;
        }
      }

      if (changed) {
        applyDecorations(editor);
      }
    }
  );

  // React to config changes
  const configChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("env-blur")) {
      blurDecoration.dispose();
      blurDecoration = createDecorationType();

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        applyDecorations(editor);
      }
    }
  });

  context.subscriptions.push(
    toggleCmd,
    editorChange,
    docChange,
    selectionChange,
    configChange,
    blurDecoration,
    statusBarItem
  );

  // Apply to current editor on activation
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    applyDecorations(editor);
  }
  updateStatusBar(editor);
}

export function deactivate(): void {
  revealedLines.clear();
}
