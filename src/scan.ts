import { CDeclaration, isDocumented, parseDeclaration } from './parse';

const documentable = (d: CDeclaration | undefined, text = ''): d is CDeclaration =>
  !!d && d.kind !== 'other' && !!d.name && !/^\s*namespace\b/.test(text);

/** Declarations at namespace/class scope (not inside function bodies) that lack a doc comment. */
export function undocumentedDeclarations(lines: string[]): { line: number; decl: CDeclaration }[] {
  const found: { line: number; decl: CDeclaration }[] = [];
  const stack: ('scope' | 'body')[] = [];
  const countBraces = (s: string) => {
    const t = s.replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|\/\/.*$/g, '');
    for (const c of t) {
      if (c === '{') stack.push('body');
      else if (c === '}') stack.pop();
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const atScope = stack.every(k => k === 'scope');
    if (atScope && t && !/^(}|\/\/|\/\*|\*|#\s*(include|if|endif|else|elif|pragma|undef|import)|using namespace|import |package |return\b|@|(public|private|protected|signals|slots|Q_SIGNALS|Q_SLOTS)\s*:)/.test(t)) {
      const decl = parseDeclaration(lines, i);
      if (decl && decl.end >= i) {
        if (documentable(decl, lines[i]) && !isDocumented(lines, i)) found.push({ line: i, decl });
        // Walk the declaration's own lines; its opening brace is a scope for types/namespaces, a body for functions.
        for (let j = i; j <= decl.end; j++) countBraces(lines[j]);
        if (decl.hasBody && lines.slice(i, decl.end + 1).join('\n').includes('{') && (decl.kind === 'type' || /\b(namespace|extern\s+"C")\b/.test(lines.slice(i, decl.end + 1).join(' ')))) {
          stack[stack.length - 1] = 'scope';
        }
        i = decl.end;
        continue;
      }
    }
    countBraces(lines[i]);
  }
  return found;
}
