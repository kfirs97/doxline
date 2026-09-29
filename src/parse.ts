/** Parses C, C++ and Java declarations well enough to write Doxygen/Javadoc comments for them. */

export interface CParam {
  name?: string; // undefined for unnamed parameters like `int`
  type: string;
  variadic?: boolean;
}

export interface CDeclaration {
  kind: 'function' | 'type' | 'macro' | 'other';
  name: string;
  params: CParam[];
  templateParams: string[];
  returnType?: string; // undefined for constructors/destructors/void
  throws: string[];
  /** Index of the last line of the declaration (ends with `{`, `;` or `:` for ctor initializer lists). */
  end: number;
  /** Whether the declaration opens a body (`{`) — used to know whether it is a definition. */
  hasBody: boolean;
}

const SPECIFIERS = new Set([
  'static', 'inline', 'virtual', 'extern', 'constexpr', 'consteval', 'constinit', 'explicit', 'friend', 'thread_local', 'register', 'mutable',
  'public', 'private', 'protected', 'final', 'abstract', 'synchronized', 'native', 'default', 'strictfp', '__inline', '__forceinline',
]);
const TYPE_WORDS = new Set([
  'const', 'volatile', 'unsigned', 'signed', 'short', 'long', 'int', 'char', 'float', 'double', 'bool', 'void', 'auto', 'struct', 'class',
  'enum', 'union', 'typename', 'restrict', '__restrict', 'wchar_t', 'char8_t', 'char16_t', 'char32_t', 'size_t', 'final',
]);

/** Removes comments and string/char literals (keeping length-independent structure), joins lines. */
function clean(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out += c + c;
      i = j;
      continue;
    }
    out += c === '\n' ? ' ' : c;
  }
  return out;
}

/** Splits on `sep` at nesting depth 0 across (), [], {} and template <> brackets. */
export function splitTop(s: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{<'.includes(c)) depth++;
    else if (')]}>'.includes(c) && !(c === '>' && s[i - 1] === '-')) depth = Math.max(0, depth - 1);
    if (c === sep && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Collects the declaration starting at `start`: lines up to the first top-level `{` or `;`. */
export function collectDeclaration(lines: string[], start: number): { text: string; end: number; hasBody: boolean } | undefined {
  if (/^\s*#\s*define\b/.test(lines[start])) {
    let end = start;
    while (end < lines.length - 1 && lines[end].trimEnd().endsWith('\\')) end++;
    return { text: lines.slice(start, end + 1).join('\n'), end, hasBody: false };
  }
  let depth = 0;
  let text = '';
  for (let i = start; i < lines.length && i < start + 40; i++) {
    const line = clean(lines[i]);
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0 && (c === '{' || c === ';')) return { text: text + line.slice(0, j), end: i, hasBody: c === '{' };
      // Constructor initializer list: `Foo::Foo(int x) : x_(x) {` — stop at the `:` after the parameter list.
      else if (depth === 0 && c === ':' && line[j + 1] !== ':' && line[j - 1] !== ':' && /\)\s*(noexcept|const)?\s*$/.test(text + line.slice(0, j))) {
        return { text: text + line.slice(0, j), end: i, hasBody: true };
      }
    }
    text += line + ' ';
  }
  return undefined;
}

function parseParam(raw: string): CParam | undefined {
  let p = raw.replace(/\s+/g, ' ').trim();
  if (!p || p === 'void') return undefined;
  if (p === '...' || p.endsWith('...')) return { type: '...', variadic: true, name: p === '...' ? undefined : p.replace(/\.\.\.$/, '').trim().split(/[\s*&]+/).pop() };
  p = splitTop(p, '=')[0].trim(); // drop default value
  p = p.replace(/^@\w+(\([^)]*\))?\s*/g, ''); // Java annotations like @NonNull
  // Function pointer / reference: `void (*cb)(int)` or `int (&arr)[3]`
  const fp = /\(\s*[*&^]+\s*([A-Za-z_]\w*)\s*\)/.exec(p);
  if (fp) return { name: fp[1], type: p.replace(fp[1], '').replace(/\s+/g, ' ').trim() };
  p = p.replace(/\s*\[[^\]]*\]\s*$/, m => (m.includes('[') ? '[]' : '')); // arrays: `int xs[]`
  const arr = p.endsWith('[]');
  const core = arr ? p.slice(0, -2).trim() : p;
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(core);
  if (!m) return { type: p };
  const before = core.slice(0, m.index).trim();
  // A lone type (unnamed parameter): nothing before it, or the last word is a type keyword.
  if (!before || TYPE_WORDS.has(m[1]) || /::$/.test(before) || /<$/.test(before)) return { type: p };
  return { name: m[1], type: (before + (arr ? '[]' : '')).replace(/\s+([*&])/g, '$1').trim() };
}

/** Parses the declaration beginning at `start` (the first line under the cursor/comment). */
export function parseDeclaration(lines: string[], start: number): CDeclaration | undefined {
  while (start < lines.length && !lines[start].trim()) start++;
  if (start >= lines.length) return undefined;
  const collected = collectDeclaration(lines, start);
  if (!collected) return undefined;
  const { end, hasBody } = collected;
  let text = collected.text.replace(/\s+/g, ' ').trim();
  const base = { params: [] as CParam[], templateParams: [] as string[], throws: [] as string[], end, hasBody };

  const macro = /^#\s*define\s+([A-Za-z_]\w*)(\(([^)]*)\))?/.exec(text);
  if (macro) {
    const params = macro[2] ? splitTop(macro[3]).filter(Boolean).map(n => ({ name: n === '...' ? undefined : n.trim(), type: '', variadic: n.trim() === '...' })) : [];
    return { ...base, kind: 'macro', name: macro[1], params };
  }

  // template <typename T, int N = 3> ...
  let templateParams: string[] = [];
  const tpl = /^template\s*</.exec(text);
  if (tpl) {
    let depth = 0;
    let i = tpl[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === '<') depth++;
      else if (text[i] === '>' && --depth === 0) break;
    }
    templateParams = splitTop(text.slice(tpl[0].length, i))
      .map(t => splitTop(t, '=')[0].trim().replace(/\.\.\.$/, '').split(/\s+/).pop()!.replace(/^\.\.\./, ''))
      .filter(Boolean);
    text = text.slice(i + 1).trim();
  }
  // Java generic methods: `public <T> List<T> copy(...)`
  const javaGeneric = /^((?:[a-z]+\s+)*)</.exec(text);
  if (javaGeneric) {
    const open = javaGeneric[0].length - 1;
    let depth = 0;
    let close = open;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '<') depth++;
      else if (text[i] === '>' && --depth === 0) {
        close = i;
        break;
      }
    }
    templateParams.push(...splitTop(text.slice(open + 1, close)).map(t => t.split(/\s+/)[0]));
    text = javaGeneric[1] + text.slice(close + 1).trimStart();
  }

  const typeDecl = /^(?:(?:public|private|protected|static|abstract|final|sealed|export)\s+)*(class|struct|union|enum(?:\s+class|\s+struct)?|interface|record|namespace|typedef|using)\s+(?:\[\[[^\]]*\]\]\s*)?([A-Za-z_]\w*)/.exec(text);
  if (typeDecl && !/\(/.test(text.split(/[:{]/)[0].replace(/^typedef.*$/, ''))) {
    return { ...base, templateParams, kind: 'type', name: typeDecl[2] };
  }

  // Find the parameter list: the first top-level '(' preceded by a (qualified) name, operator, or destructor.
  const nameRe = /((?:[A-Za-z_]\w*\s*(?:<[^()]*>)?\s*::\s*)*(?:~\s*)?(?:operator\s*(?:\(\s*\)|\[\s*\]|new\s*\[\]|delete\s*\[\]|[^\s(]+|\s+[A-Za-z_][\w:<>*& ]*)|[A-Za-z_$][\w$]*))\s*\(/g;
  let match: RegExpExecArray | null;
  let paramsOpen = -1;
  let nameStart = 0;
  let fullName = '';
  while ((match = nameRe.exec(text))) {
    const before = text.slice(0, match.index);
    const depth = [...before].reduce((d, c) => d + ('(<'.includes(c) ? 1 : ')>'.includes(c) ? -1 : 0), 0);
    if (depth !== 0) continue;
    paramsOpen = match.index + match[0].length - 1;
    nameStart = match.index;
    fullName = match[1].replace(/\s+/g, ' ').trim();
    break;
  }
  if (paramsOpen === -1) {
    const lastIdent = /([A-Za-z_$][\w$]*)\s*(?:=.*)?$/.exec(text);
    return { ...base, templateParams, kind: 'other', name: lastIdent?.[1] ?? '' };
  }
  let depth = 0;
  let close = paramsOpen;
  for (let i = paramsOpen; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  const prefix = text.slice(0, nameStart).trim();
  const words = prefix.split(/\s+/).filter(w => w && !SPECIFIERS.has(w) && !/^\[\[.*\]\]$/.test(w) && !/^__attribute__/.test(w) && !/^@/.test(w));
  const retRaw = words.join(' ').replace(/\s+([*&])/g, '$1').trim();
  const shortName = fullName.split('::').pop()!.trim();
  const className = fullName.includes('::') ? fullName.split('::').slice(-2, -1)[0].replace(/<.*$/, '').trim() : undefined;
  const isCtorDtor = shortName.startsWith('~') || (className !== undefined && shortName === className) || (!retRaw && !shortName.startsWith('operator'));
  const tail = text.slice(close + 1);
  const trailing = /->\s*([^{;=]+?)\s*(?:override|final|noexcept|=|$)/.exec(tail);
  let returnType: string | undefined = trailing ? trailing[1].trim() : retRaw || undefined;
  if (isCtorDtor || returnType === 'void') returnType = undefined;
  const throwsMatch = /\bthrows\s+([\w.,\s<>]+)/.exec(tail);
  const params = splitTop(text.slice(paramsOpen + 1, close)).map(parseParam).filter((p): p is CParam => !!p);
  return {
    ...base,
    templateParams,
    kind: 'function',
    name: shortName,
    params,
    returnType,
    throws: throwsMatch ? throwsMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [],
  };
}

/** Whether the line just above `line` already ends a doc comment. */
export function isDocumented(lines: string[], line: number): boolean {
  for (let i = line - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^(template\s*<|\[\[|@\w)/.test(t)) continue;
    return t.endsWith('*/') || t.startsWith('///') || t.startsWith('//!');
  }
  return false;
}
