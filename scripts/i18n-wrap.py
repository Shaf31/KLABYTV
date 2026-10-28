# One-off helper: wraps Arabic string literals in the renderer with t(...) for the translation table.
#   '...'  -> t('...')
#   `...${a}...${b}...` -> t('...{0}...{1}...', [a, b])
import re, sys

AR = re.compile(r'[؀-ۿ]')

def split_template(body):
    """Return (key, [exprs]) or None if the template is too complex (nested template)."""
    parts, exprs, i = [], [], 0
    while i < len(body):
        if body.startswith('${', i):
            depth, j = 1, i + 2
            while j < len(body) and depth:
                if body[j] == '{': depth += 1
                elif body[j] == '}': depth -= 1
                elif body[j] == '`': return None
                j += 1
            exprs.append(body[i + 2:j - 1].strip())
            parts.append('{%d}' % (len(exprs) - 1))
            i = j
        else:
            parts.append(body[i]); i += 1
    return ''.join(parts), exprs

def wrap(src):
    out, i, skipped = [], 0, []
    n = len(src)
    while i < n:
        c = src[i]
        # skip comments
        if src.startswith('//', i):
            j = src.find('\n', i); j = n if j < 0 else j
            out.append(src[i:j]); i = j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i) + 2
            out.append(src[i:j]); i = j; continue
        if c in "'\"`":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\': j += 1
                elif c == '`' and src.startswith('${', j):
                    depth = 1; j += 2
                    while j < n and depth:
                        if src[j] == '{': depth += 1
                        elif src[j] == '}': depth -= 1
                        if src[j] == '`':  # nested template: skip to its end
                            k = j + 1
                            while k < n and src[k] != '`': k += 1
                            j = k
                        j += 1
                    continue
                j += 1
            lit = src[i:j + 1]
            body = lit[1:-1]
            already = re.search(r'(?<![\w$.])t\($', ''.join(out)[-40:]) is not None
            if AR.search(body) and not already:
                if c == '`' and '${' in body:
                    r = split_template(body)
                    if r is None:
                        skipped.append(lit); out.append(lit)
                    else:
                        key, exprs = r
                        out.append("t(%s, [%s])" % (quote(key), ', '.join(exprs)))
                else:
                    out.append('t(%s)' % quote(body if c != '`' else body))
            else:
                out.append(lit)
            i = j + 1; continue
        out.append(c); i += 1
    return ''.join(out), skipped

def quote(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'" if "\\" not in s else "'" + s.replace("'", "\\'") + "'"

for f in sys.argv[1:]:
    s = open(f, encoding='utf-8').read()
    new, skipped = wrap(s)
    open(f, 'w', encoding='utf-8').write(new)
    print(f, 'skipped:', len(skipped))
    for x in skipped: print('   ', x[:110])
