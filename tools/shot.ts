/** VS Code-like mock showing comments produced by the real parser/generator. */
import { writeFileSync } from 'node:fs';
import { parseDeclaration } from '../src/parse';
import { docComment, snippetToText } from '../src/generate';

const [out] = process.argv.slice(2);
const src = [
  '#include <vector>',
  '',
  'template <typename T, typename Compare = std::less<T>>',
  'std::vector<T> top_k(const std::vector<T>& items, std::size_t k,',
  '                     Compare cmp = Compare{}) {',
  '  if (k > items.size()) throw std::out_of_range("k");',
  '  // ...',
  '}',
  '',
  '#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))',
];
const opts = { commandPrefix: '@' as const, brief: true, placeholder: 'Description' };
const insert = (at: number) => snippetToText(docComment(parseDeclaration(src, at)!, opts)).split('\n');
const lines = [...src.slice(0, 2), ...insert(2), ...src.slice(2, 9), ...insert(9), src[9]];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const color = (l: string) => {
  if (/^\s*(\/\*\*|\*)/.test(l)) return `<span style="color:#6a9955">${esc(l).replace(/(@\w+)(\s+\w+)?/, (m, c, n = '') => `<span style="color:#569cd6">${c}</span><span style="color:#9cdcfe">${n}</span>`)}</span>`;
  return esc(l)
    .replace(/(#include|#define)/g, '<span style="color:#c586c0">$1</span>')
    .replace(/(&lt;vector&gt;|"k")/g, '<span style="color:#ce9178">$1</span>')
    .replace(/\b(template|typename|const|if|throw)\b/g, '<span style="color:#569cd6">$1</span>')
    .replace(/\b(top_k|size|CLAMP)\b/g, '<span style="color:#dcdcaa">$1</span>')
    .replace(/\b(std|vector|less|size_t|out_of_range|T|Compare)\b/g, '<span style="color:#4ec9b0">$1</span>');
};
writeFileSync(out, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#1f1f1f;color:#d4d4d4;font:13px -apple-system,sans-serif}
.tabs{height:35px;background:#181818;border-bottom:1px solid #2b2b2b}.tab{display:inline-block;height:35px;line-height:35px;padding:0 16px;background:#1f1f1f;border-top:1px solid #0078d4;color:#fff}
.code{white-space:pre;padding:8px 0 16px;font:13.5px/20px Menlo,monospace}.num{display:inline-block;width:40px;text-align:right;padding-right:24px;color:#6e7681}
</style></head><body><div class="tabs"><span class="tab">algorithms.hpp</span></div><div class="code">${lines.map((l, i) => `<div><span class="num">${i + 1}</span>${color(l) || ' '}</div>`).join('')}</div></body></html>`);
