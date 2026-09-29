import * as vscode from 'vscode';
import { CDeclaration, parseDeclaration } from './parse';
import { undocumentedDeclarations } from './scan';
import { docComment, snippetToText } from './generate';
import { License } from './license';
import { BUY_URL } from './licenseVerify';

const LANGUAGES = ['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp', 'java'];

const options = () => {
  const c = vscode.workspace.getConfiguration('doxline');
  return {
    commandPrefix: c.get<'@' | '\\'>('commandPrefix', '@'),
    brief: c.get<boolean>('includeBrief', true),
    placeholder: c.get<string>('placeholder', 'Description'),
  };
};
const linesOf = (doc: vscode.TextDocument) => doc.getText().split(/\r?\n/);
const indentOf = (line: string) => /^\s*/.exec(line)![0];
const withIndent = (block: string, indent: string) => block.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n');
const documentable = (d: CDeclaration | undefined): d is CDeclaration => !!d && d.kind !== 'other' && !!d.name;

/** Offers the full comment right after typing `/**` above a declaration. */
class CommentCompletion implements vscode.CompletionItemProvider {
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    const text = doc.lineAt(pos.line).text;
    const before = text.slice(0, pos.character);
    if (before.trim() !== '/**') return undefined;
    const decl = parseDeclaration(linesOf(doc), pos.line + 1);
    if (!documentable(decl)) return undefined;
    const item = new vscode.CompletionItem('Generate Doxygen Comment', vscode.CompletionItemKind.Snippet);
    item.detail = `Doxline · ${decl.kind} ${decl.name}`;
    item.insertText = new vscode.SnippetString(withIndent(docComment(decl, options()), indentOf(text)));
    // Replace `/**` and a `*/` the editor may have auto-closed after the cursor.
    const after = text.slice(pos.character);
    const closing = /^\s*\*\/\s*$/.test(after) ? after.length : 0;
    item.range = new vscode.Range(pos.line, pos.character - 3, pos.line, pos.character + closing);
    item.filterText = '/**';
    item.sortText = '\0';
    item.preselect = true;
    return [item];
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const license = new License(context);
  void license.init();
  const selector = LANGUAGES.map(language => ({ language }));

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new CommentCompletion(), '*'),
    vscode.commands.registerTextEditorCommand('doxline.generate', async editor => {
      const lines = linesOf(editor.document);
      let line = editor.selection.active.line;
      while (line < lines.length && !lines[line].trim()) line++;
      const decl = parseDeclaration(lines, line);
      if (!documentable(decl)) return void vscode.window.showInformationMessage('Put the cursor on a function, class, struct, enum or macro declaration.');
      const indent = indentOf(lines[line]);
      await editor.insertSnippet(new vscode.SnippetString(indent + withIndent(docComment(decl, options()), indent) + '\n'), new vscode.Position(line, 0));
    }),
    vscode.commands.registerTextEditorCommand('doxline.generateFile', async editor => {
      if (!(await license.require('Documenting a whole file'))) return;
      const lines = linesOf(editor.document);
      const decls = undocumentedDeclarations(lines);
      if (!decls.length) return void vscode.window.showInformationMessage('Every declaration in this file already has a doc comment.');
      await editor.edit(edit => {
        for (const { line, decl } of decls) {
          const indent = indentOf(lines[line]);
          edit.insert(new vscode.Position(line, 0), indent + withIndent(snippetToText(docComment(decl, options())), indent) + '\n');
        }
      });
      void vscode.window.showInformationMessage(`Doxline added ${decls.length} doc comment${decls.length === 1 ? '' : 's'}.`);
    }),
    vscode.commands.registerCommand('doxline.enterLicense', () => license.enterKey()),
    vscode.commands.registerCommand('doxline.removeLicense', () => license.removeKey()),
    vscode.commands.registerCommand('doxline.buyPro', () => vscode.env.openExternal(vscode.Uri.parse(BUY_URL))),
  );
}

export function deactivate(): void {}
