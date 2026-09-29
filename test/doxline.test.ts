import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDocumented, parseDeclaration, splitTop } from '../src/parse';
import { docComment, snippetToText } from '../src/generate';

const p = (src: string) => parseDeclaration(src.split('\n'), 0)!;
const sig = (src: string) => {
  const d = p(src);
  return { kind: d.kind, name: d.name, params: d.params.map(x => x.name ?? `<${x.type}>`), tparams: d.templateParams, ret: d.returnType, throws: d.throws };
};

test('splits at top level across templates, parens and braces', () => {
  assert.deepEqual(splitTop('std::map<int, std::string> m, int (*f)(int, int), std::vector<int> v = {1, 2}'), [
    'std::map<int, std::string> m', 'int (*f)(int, int)', 'std::vector<int> v = {1, 2}',
  ]);
});

test('C function with pointers, const, arrays and unnamed params', () => {
  assert.deepEqual(sig('static inline int parse(const char *src, size_t len, int out[], void *);'), {
    kind: 'function', name: 'parse', params: ['src', 'len', 'out', '<void *>'], tparams: [], ret: 'int', throws: [],
  });
  assert.deepEqual(sig('void reset(void) {').params, []);
  assert.equal(sig('void reset(void) {').ret, undefined);
});

test('multi-line C++ template function with defaults, references, function pointers and trailing return', () => {
  const src = [
    'template <typename T, typename Alloc = std::allocator<T>, int N = 3>',
    '[[nodiscard]] constexpr auto accumulate(',
    '    const std::vector<T, Alloc>& items,  // input',
    '    T init = T{},',
    '    bool (*keep)(const T&) = nullptr,',
    '    Args&&... rest) noexcept -> T',
    '{',
  ].join('\n');
  assert.deepEqual(sig(src), { kind: 'function', name: 'accumulate', params: ['items', 'init', 'keep', 'rest'], tparams: ['T', 'Alloc', 'N'], ret: 'T', throws: [] });
  assert.equal(p(src).end, 6);
});

test('constructors, destructors, qualified names, operators and init lists', () => {
  assert.equal(sig('Widget::Widget(int w, int h) : w_(w), h_(h) {').ret, undefined);
  assert.deepEqual(sig('Widget::Widget(int w, int h) : w_(w), h_(h) {').params, ['w', 'h']);
  assert.deepEqual(sig('explicit Widget(QObject *parent = nullptr);'), { kind: 'function', name: 'Widget', params: ['parent'], tparams: [], ret: undefined, throws: [] });
  assert.equal(sig('virtual ~Widget() override;').name, '~Widget');
  assert.equal(sig('virtual ~Widget() override;').ret, undefined);
  const op = sig('bool operator==(const Point& a, const Point& b) const;');
  assert.equal(op.name, 'operator==');
  assert.deepEqual(op.params, ['a', 'b']);
  assert.equal(op.ret, 'bool');
  assert.equal(sig('std::string ns::Parser::name() const {').ret, 'std::string');
});

test('types, macros and variables', () => {
  assert.deepEqual(sig('template <class K, class V>\nclass LruCache : public Cache<K, V> {'), { kind: 'type', name: 'LruCache', params: [], tparams: ['K', 'V'], ret: undefined, throws: [] });
  assert.equal(sig('struct Point {').kind, 'type');
  assert.equal(sig('enum class Color : uint8_t {').name, 'Color');
  assert.deepEqual(sig('#define CLAMP(x, lo, hi) \\\n  ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))'), { kind: 'macro', name: 'CLAMP', params: ['x', 'lo', 'hi'], tparams: [], ret: undefined, throws: [] });
  assert.equal(sig('#define VERSION 3').params.length, 0);
  assert.equal(sig('static const int kMaxRetries = 5;').kind, 'other');
});

test('Java methods: modifiers, generics, annotations, throws', () => {
  assert.deepEqual(sig('public static <T extends Comparable<T>> List<T> topK(@NonNull List<T> items, int k) throws IOException, InterruptedException {'), {
    kind: 'function', name: 'topK', params: ['items', 'k'], tparams: ['T'], ret: 'List<T>', throws: ['IOException', 'InterruptedException'],
  });
  assert.equal(sig('public Account(String owner, long balance) {').ret, undefined, 'Java constructor');
  assert.equal(sig('public class Account implements Serializable {').kind, 'type');
});

test('strings and comments inside declarations are ignored', () => {
  assert.deepEqual(sig('void log(const char* fmt = "a, b; {c}", int level /* 0-3 */);').params, ['fmt', 'level']);
});

test('doxygen output with @ and backslash prefixes', () => {
  const d = p('template <typename T>\nT clamp(T value, T lo, T hi);');
  assert.equal(snippetToText(docComment(d, { commandPrefix: '@', brief: true, placeholder: 'Description' })), [
    '/**', ' * @brief Brief description', ' *', ' * @tparam T Description', ' * @param value Description', ' * @param lo Description', ' * @param hi Description', ' * @return Description', ' */',
  ].join('\n'));
  const c = snippetToText(docComment(p('void stop();'), { commandPrefix: '\\', brief: true, placeholder: 'x' }));
  assert.equal(c, '/**\n * \\brief Brief description\n */');
  const snip = docComment(d, { commandPrefix: '@', brief: false, placeholder: 'd' });
  assert.deepEqual([...snip.matchAll(/\$\{(\d+):/g)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6]);
});

test('detects existing doc comments above a declaration', () => {
  const lines = ['/** Adds. */', 'int add(int a, int b);', '', '// plain comment', 'int sub(int a, int b);', '/// Triple', 'template <class T>', 'T id(T x);'];
  assert.equal(isDocumented(lines, 1), true);
  assert.equal(isDocumented(lines, 4), false);
  assert.equal(isDocumented(lines, 6), true, 'template line belongs to the declaration');
});

import { undocumentedDeclarations } from '../src/scan';

test('whole-file scan finds undocumented declarations at scope level only', () => {
  const src = [
    '#include <vector>',
    'namespace geo {',
    '/** Documented. */',
    'double area(double w, double h);',
    '',
    'class Shape {',
    ' public:',
    '  virtual ~Shape();',
    '  double perimeter() const {',
    '    auto helper = [](int x) { return x; };',
    '    if (x) { run(1); }',
    '    return 0;',
    '  }',
    '};',
    '',
    'int scale(int v, int k = 2) {',
    '  for (int i = 0; i < k; ++i) { v *= 2; }',
    '  return v;',
    '}',
    '}  // namespace geo',
    '#define SQUARE(x) ((x) * (x))',
  ];
  const found = undocumentedDeclarations(src).map(f => `${f.line}:${f.decl.kind}:${f.decl.name}`);
  assert.deepEqual(found, ['5:type:Shape', '7:function:~Shape', '8:function:perimeter', '15:function:scale', '20:macro:SQUARE']);
});
