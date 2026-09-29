import { runTests } from '@vscode/test-electron';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

(async () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'doxline-e2e-')));
  writeFileSync(join(ws, 'math.cpp'), '\ntemplate <typename T>\nT clamp(T v, T lo, T hi) {\n  return v < lo ? lo : v > hi ? hi : v;\n}\n\nint twice(int x);\n');
  await runTests({
    extensionDevelopmentPath: resolve(__dirname, '../..'),
    extensionTestsPath: resolve(__dirname, 'suite.js'),
    launchArgs: [ws, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
