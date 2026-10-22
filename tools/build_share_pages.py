#!/usr/bin/env python3
"""Builds share/<archetype>/index.html: one tiny page per archetype whose only job is to
carry Open Graph / Twitter tags so a pasted link turns into the Scott Free card on
Facebook, LinkedIn, X and WhatsApp. People who click the link are sent on to the quiz.

Usage (from the repo root):   python3 tools/build_share_pages.py
Needs node (reads the archetype copy straight from the quiz bundle's data file).
Card images are expected at cards/<archetype>-card.jpg (export them with tools/card-studio.html).
"""
import html, json, os, re, subprocess, sys

QUIZ_URL = 'https://www.nubuverse.com/human-needs-quiz/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'archetypes-data.js')

def slug(name):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', re.sub(r'^the\s+', '', name.lower())))

js = "const fs=require('fs');const src=fs.readFileSync(process.argv[1],'utf8');" \
     "const D=new Function(src+';return ARCHETYPE_DATA;')();" \
     "console.log(JSON.stringify(Object.values(D).map(a=>({name:a.name,glance:a.glance,combo:a.combo}))));"
data = json.loads(subprocess.check_output(['node', '-e', js, SRC]))
assert len(data) == 15, len(data)

PAGE = '''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Scott Free Group · The Six Human Needs Quiz">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{img}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{img}">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#3B4230;color:#E9EBDB;font-family:Nunito,system-ui,sans-serif;text-align:center;padding:24px}}a{{color:#fff;font-weight:700}}</style>
</head>
<body>
<p>Taking you to the Six Human Needs Quiz…<br><a href="{quiz}">Continue to the quiz</a></p>
<script>location.replace({quiz_js});</script>
</body>
</html>
'''
e = html.escape
for a in data:
    s = slug(a['name'])
    d = os.path.join(ROOT, 'share', s)
    os.makedirs(d, exist_ok=True)
    glance = '. '.join(g.rstrip('.') for g in a['glance'][:2]) + '.'
    page = PAGE.format(
        title=e("I’m %s — what drives you?" % a['name']),
        desc=e("%s Take the Six Human Needs Quiz to find your archetype." % glance),
        url=QUIZ_URL + 'share/%s/' % s, img=QUIZ_URL + 'cards/%s-card.jpg' % s,
        alt=e("%s — Six Human Needs Quiz by Scott Free Group" % a['name']),
        quiz=QUIZ_URL, quiz_js=json.dumps(QUIZ_URL))
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(page)
print('wrote', len(data), 'pages to share/')
