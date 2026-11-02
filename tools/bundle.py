#!/usr/bin/env python3
"""Unpack / repack the single-file quiz bundle (index.html).

index.html carries every script, font and the page template inside two <script> islands:
  __bundler/manifest  {uuid: {mime, compressed, data(base64, gzip if compressed)}}
  __bundler/template  the real page HTML (JSON string) that references resources by uuid

Usage (from the repo root):
  python3 tools/bundle.py unpack build/src     # writes one file per resource + template.html + names.json
  python3 tools/bundle.py pack   build/src     # writes the edited files back into index.html

To add a new script: put the file in the unpacked folder, add "name": "<new uuid>" to names.json
(and to KNOWN below), and add <script src="<new uuid>"></script> to template.html where it should load.

Only text resources are written back; fonts and anything you did not touch are re-emitted byte for byte.
"""
import base64, gzip, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
MAN_RE = re.compile(r'(<script type="__bundler/manifest">)(.*?)(</script>)', re.S)
TPL_RE = re.compile(r'(<script type="__bundler/template">)(.*?)(</script>)', re.S)

# Friendly names for the resources we edit (uuid -> file name). Anything else keeps its uuid.
KNOWN = {
    'a4b8abce-5704-4008-9708-c89edf2a4efb': 'quiz-data.js',
    'a6044759-90f2-4ae7-867b-c36237add0be': 'scoring.js',
    '02dcbfca-3716-468e-9ad6-52f47b8536bb': 'archetypes-data.js',
    'f8c1b3f8-b71a-4cfd-aadc-7b3b0416c073': 'mascots.js',
    '5eb8a9c1-9737-44ce-ad39-0dcc85a070b2': 'brand-assets.js',
    '1460ad19-65ca-4c9c-8533-3d14cfd3bb64': 'quiz-screens.jsx',
    '5275a9b8-7da3-49d4-bb50-62dcdf51e63a': 'quiz-report.jsx',
    '2c15bd6c-3a7b-5027-81db-b0e3796fed8b': 'quiz-share.jsx',
    '8f1d6a52-3c1e-5b7a-9e40-4d2b7c6e1a90': 'quiz-capture.js',
}


def load():
    s = open(INDEX, encoding='utf-8').read()
    return s, json.loads(MAN_RE.search(s).group(2)), json.loads(TPL_RE.search(s).group(2))


def unpack(out):
    _, man, tpl = load()
    os.makedirs(out, exist_ok=True)
    names = {}
    for k, v in man.items():
        if not v['mime'].startswith(('text/', 'application/javascript')):
            continue
        raw = base64.b64decode(v['data'])
        if v.get('compressed'):
            raw = gzip.decompress(raw)
        name = KNOWN.get(k, k + '.js')
        names[name] = k
        open(os.path.join(out, name), 'wb').write(raw)
    open(os.path.join(out, 'template.html'), 'w', encoding='utf-8').write(tpl)
    json.dump(names, open(os.path.join(out, 'names.json'), 'w'), indent=1)
    print('unpacked', len(names), 'resources to', out)


def pack(src):
    s, man, _ = load()
    names = json.load(open(os.path.join(src, 'names.json')))
    for name, k in names.items():
        raw = open(os.path.join(src, name), 'rb').read()
        # A script added after the original bundle (e.g. quiz-capture.js) gets a new manifest entry;
        # its <script src="uuid"> tag is added to template.html by hand.
        v = man.setdefault(k, {'mime': 'application/javascript', 'compressed': True, 'data': ''})
        data = gzip.compress(raw, 9, mtime=0) if v.get('compressed') else raw
        man[k] = {**v, 'data': base64.b64encode(data).decode()}
    tpl = open(os.path.join(src, 'template.html'), encoding='utf-8').read()
    # </script> inside the JSON islands must stay escaped, as the bundler wrote them
    man_json = json.dumps(man, separators=(',', ':')).replace('</', '<\\u002F')
    tpl_json = json.dumps(tpl).replace('</', '<\\u002F')
    s = MAN_RE.sub(lambda m: m.group(1) + man_json + m.group(3), s, count=1)
    s = TPL_RE.sub(lambda m: m.group(1) + tpl_json + m.group(3), s, count=1)
    open(INDEX, 'w', encoding='utf-8').write(s)
    print('packed', len(names), 'resources into index.html (%d bytes)' % len(s.encode()))


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('unpack', 'pack'):
        sys.exit(__doc__)
    (unpack if sys.argv[1] == 'unpack' else pack)(sys.argv[2])
