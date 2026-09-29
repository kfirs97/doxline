import * as vscode from 'vscode';
import assert from 'node:assert/strict';

export async function run(): Promise<void> {
  await vscode.extensions.getExtension('branchline.doxline-doxygen-javadoc')!.activate();
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'math.cpp');
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);

  await editor.edit(e => e.insert(new vscode.Position(0, 0), '/**'));
  const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, new vscode.Position(0, 3), '*');
  const item = list.items.find(i => i.label === 'Generate Doxygen Comment');
  assert.ok(item, `completion offered (got ${list.items.slice(0, 5).map(i => i.label)})`);
  const snip = (item!.insertText as vscode.SnippetString).value;
  assert.match(snip, /@tparam T/);
  assert.match(snip, /@param lo/);
  assert.match(snip, /@return/);

  await editor.edit(e => e.delete(new vscode.Range(0, 0, 0, 3)));
  editor.selection = new vscode.Selection(6, 0, 6, 0);
  await vscode.commands.executeCommand('doxline.generate');
  await new Promise(r => setTimeout(r, 300));
  assert.match(doc.getText(), /\/\*\*\n \* @brief Brief description\n \*\n \* @param x Description\n \* @return Description\n \*\/\nint twice\(int x\);/, doc.getText());
  console.log('E2E: all checks passed');
}
