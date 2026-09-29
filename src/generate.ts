import type { CDeclaration } from './parse';

export interface CommentOptions {
  /** '@' → `@param`, '\\' → `\param`. */
  commandPrefix: '@' | '\\';
  brief: boolean;
  placeholder: string;
}

const esc = (s: string) => s.replace(/[$}\\]/g, m => `\\${m}`);

/** Builds a Doxygen/Javadoc block comment snippet (lines without indentation). */
export function docComment(decl: CDeclaration, opts: CommentOptions): string {
  let n = 0;
  const tab = (t: string) => `\${${++n}:${esc(t)}}`;
  const cmd = (c: string) => esc(opts.commandPrefix) + c;
  const lines = ['/**', ` * ${opts.brief ? `${cmd('brief')} ` : ''}${tab('Brief description')}`];
  const tags: string[] = [];
  for (const t of decl.templateParams) tags.push(` * ${cmd('tparam')} ${esc(t)} ${tab(opts.placeholder)}`);
  for (const p of decl.params) {
    if (p.variadic && !p.name) tags.push(` * ${cmd('param')} ... ${tab(opts.placeholder)}`);
    else if (p.name) tags.push(` * ${cmd('param')} ${esc(p.name)} ${tab(opts.placeholder)}`);
  }
  if (decl.kind === 'function' && decl.returnType) tags.push(` * ${cmd('return')} ${tab(opts.placeholder)}`);
  for (const t of decl.throws) tags.push(` * ${cmd('throws')} ${esc(t)} ${tab(opts.placeholder)}`);
  if (tags.length) lines.push(' *', ...tags);
  lines.push(' */');
  return lines.join('\n');
}

export function snippetToText(snippet: string): string {
  return snippet.replace(/\$\{\d+:((?:\\.|[^}\\])*)\}|\\([$}\\])/g, (_, placeholder: string | undefined, escaped: string | undefined) =>
    placeholder !== undefined ? placeholder.replace(/\\(.)/g, '$1') : escaped!,
  );
}
