#!/usr/bin/env python3
"""Makes cards/<archetype>-card-wa.jpg (1200x630, under ~300 KB) from the 2400x1260 cards, because
WhatsApp drops link-preview images that are too large.   Usage (repo root):  python3 tools/make_wa_cards.py
Needs Pillow."""
import glob, io, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMIT = 280 * 1024
for f in sorted(glob.glob(os.path.join(ROOT, 'cards', '*-card.jpg'))):
    im = Image.open(f).convert('RGB').resize((1200, 630), Image.LANCZOS)
    for q in range(92, 40, -3):
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
        if buf.tell() <= LIMIT: break
    out = f.replace('-card.jpg', '-card-wa.jpg'); open(out, 'wb').write(buf.getvalue())
    print(os.path.basename(out), buf.tell() // 1024, 'KB (q%d)' % q)
