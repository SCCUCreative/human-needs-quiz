// quiz-share.jsx — "Share your archetype": personalised, Scott Free-branded post
// templates (Story, Post 4:5, Square, Link card) rendered client-side on a canvas,
// plus share actions for Instagram, Facebook, LinkedIn, X and WhatsApp.
//
// Why canvas: the first name and age band never leave the browser, the embedded
// Comfortaa/Nunito fonts are used as-is, and there are no image-service credits.
//
// Globals used: React, NEED_META, MASCOT_ARCHETYPE_BY_COMBO, mascotForArchetype,
// MASCOT_AGE_BANDS, LOGO_WHITE.  Exposes: window.ShareSection
//
// Everything lives inside one IIFE so names never collide with the other scripts.
(function () {
  const { useState, useEffect, useRef } = React;

  // ── Config ────────────────────────────────────────────────────────────────
  // Link people land on from a shared post. Leave null to use the page the quiz is
  // served from (falls back to nubuverse.com when embedded somewhere without a URL).
  const SHARE_URL_OVERRIDE = null; // e.g. 'https://nubuverse.com/human-needs-quiz/'
  const CLOUD = 'https://res.cloudinary.com/humanneeds/image/upload/';
  const PAIR_AGE_SLUGS = ['10-20', '20-30', '30-40', '40-50', '50plus']; // band 1..5

  const FORMATS = [
    { id: 'story',  label: 'Story',     sub: '9:16',   w: 1080, h: 1920 },
    { id: 'post',   label: 'Post',      sub: '4:5',    w: 1080, h: 1350 },
    { id: 'square', label: 'Square',    sub: '1:1',    w: 1080, h: 1080 },
    { id: 'card',   label: 'Link card', sub: '1.91:1', w: 1200, h: 630 },
  ];

  const COL = {
    bg: '#3B4230', olive: '#4A5436', fg: '#E9EBDB', sand: '#E3DED2',
    ink: '#2F2E2C', brown: '#8C5E4A', soft: 'rgba(233,235,219,0.72)',
  };
  const HEAD = "'Comfortaa', 'Nunito', sans-serif";
  const BODY = "'Nunito', -apple-system, 'Segoe UI', sans-serif";

  function shareUrl() {
    if (SHARE_URL_OVERRIDE) return SHARE_URL_OVERRIDE;
    try {
      if (/^https?:$/.test(location.protocol) && location.origin && location.origin !== 'null') {
        return location.origin + location.pathname.replace(/index\.html?$/i, '');
      }
    } catch (e) {}
    return 'https://nubuverse.com';
  }
  function hostLabel(u) { return u.replace(/^https?:\/\//, '').replace(/\/$/, ''); }

  // ── Image helpers ─────────────────────────────────────────────────────────
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      if (!/^data:/.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('load failed: ' + src));
      im.src = src;
    });
  }
  async function firstImg(list) {
    for (const s of list) {
      if (!s) continue;
      try { return await loadImg(s); } catch (e) { /* try next */ }
    }
    return null;
  }
  function slimHero(url) {
    // Ask Cloudinary for a web-sized copy (the originals are 5504px wide); the full
    // original is the fallback if transformations are ever restricted.
    return url.replace('/image/upload/', '/image/upload/w_1800,q_auto:good,f_jpg/');
  }
  function pairCandidates(archetype, ageBand) {
    const key = archetype && archetype.combo ? archetype.combo.join('|') : '';
    const single = (window.MASCOT_ARCHETYPE_BY_COMBO || {})[key];
    if (!single) return [];
    const b = Math.min(5, Math.max(1, Math.round(Number(ageBand)) || 3));
    const slug = PAIR_AGE_SLUGS[b - 1];
    return [
      `${CLOUD}v1/pair_${single}_${slug}.png`,
      `${CLOUD}v1/pair_${single.toLowerCase()}_${slug}.png`,
    ];
  }

  // ── Canvas helpers ────────────────────────────────────────────────────────
  function rrect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function cover(ctx, img, x, y, w, h, focusY) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) * (focusY == null ? 0.5 : focusY);
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
  // Draws img fully inside the box, centred horizontally, sitting on the bottom edge.
  function containBottom(ctx, img, x, y, w, h) {
    const s = Math.min(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    const dx = x + (w - dw) / 2, dy = y + h - dh;
    ctx.drawImage(img, dx, dy, dw, dh);
    return { x: dx, y: dy, w: dw, h: dh };
  }
  function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      kept[maxLines - 1] = last.replace(/[\s.,;:!?]+$/, '') + '…';
      return kept;
    }
    return lines;
  }
  function fitPx(ctx, text, weight, family, maxW, maxPx, minPx) {
    for (let px = maxPx; px >= minPx; px -= 2) {
      ctx.font = `${weight} ${px}px ${family}`;
      if (ctx.measureText(text).width <= maxW) return px;
    }
    return minPx;
  }
  function kicker(ctx, text, x, y, size, color, align) {
    ctx.save();
    ctx.font = `700 ${size}px ${BODY}`;
    ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'alphabetic';
    setSpacing(ctx, size * 0.18);
    ctx.fillText(text.toUpperCase(), x + (align === 'center' || !align ? size * 0.09 : 0), y);
    ctx.restore();
  }
  // Two-line pill: small label over a bold value (matches the results-page badges).
  function badgeSize(ctx, b, scale) {
    ctx.font = `700 ${Math.round(15 * scale)}px ${BODY}`;
    const kw = ctx.measureText(b.label.toUpperCase()).width + b.label.length * 15 * scale * 0.12;
    ctx.font = `700 ${Math.round(26 * scale)}px ${HEAD}`;
    const vw = ctx.measureText(b.value).width;
    return { w: Math.max(kw, vw) + 56 * scale, h: 74 * scale };
  }
  function drawBadge(ctx, b, x, y, scale) {
    const s = badgeSize(ctx, b, scale);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 16 * scale; ctx.shadowOffsetY = 4 * scale;
    ctx.fillStyle = b.color; rrect(ctx, x, y, s.w, s.h, s.h / 2); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.font = `700 ${Math.round(15 * scale)}px ${BODY}`;
    setSpacing(ctx, 15 * scale * 0.12);
    ctx.fillText(b.label.toUpperCase(), x + s.w / 2 + 1, y + 30 * scale);
    setSpacing(ctx, 0);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(26 * scale)}px ${HEAD}`;
    ctx.fillText(b.value, x + s.w / 2, y + 60 * scale);
    return s;
  }
  function badgeRow(ctx, badges, cx, y, scale, gap) {
    const sizes = badges.map(b => badgeSize(ctx, b, scale));
    const total = sizes.reduce((a, s) => a + s.w, 0) + gap * (badges.length - 1);
    let x = cx - total / 2;
    badges.forEach((b, i) => { drawBadge(ctx, b, x, y, scale); x += sizes[i].w + gap; });
    return sizes[0].h;
  }
  function drawLogo(ctx, logo, x, y, w, align) {
    if (!logo) return 0;
    const h = w * (logo.height / logo.width);
    const dx = align === 'left' ? x : x - w / 2;
    ctx.drawImage(logo, dx, y, w, h);
    return h;
  }
  function drawGlance(ctx, items, x, y, w, rowH, size, dot, color) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    items.forEach((g, i) => {
      const cy = y + i * rowH + rowH / 2;
      ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(x + 9, cy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      const px = fitPx(ctx, g, 700, HEAD, w - 44, size, Math.round(size * 0.7));
      ctx.font = `700 ${px}px ${HEAD}`;
      ctx.fillText(g, x + 36, cy + 1);
    });
    ctx.textBaseline = 'alphabetic';
  }
  function bgGradient(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4A5436'); g.addColorStop(0.55, COL.bg); g.addColorStop(1, '#2F3626');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawArt(ctx, art, x, y, w, h) {
    // art: { pair } or { f, m } (two-mascot fallback until pair images are live)
    ctx.save();
    ctx.shadowColor = 'rgba(15,10,5,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    if (art.pair) {
      containBottom(ctx, art.pair, x, y, w, h);
    } else if (art.f || art.m) {
      const imgs = [art.f, art.m].filter(Boolean);
      const each = Math.min(h, (w / imgs.length) * 1.5);
      const dims = imgs.map(im => ({ im, s: Math.min(each / im.height, (w * 0.56) / im.width) }));
      const totalW = dims.reduce((a, d) => a + d.im.width * d.s, 0) - (dims.length > 1 ? 24 : 0);
      let cx = x + (w - totalW) / 2;
      dims.forEach(d => {
        const dw = d.im.width * d.s, dh = d.im.height * d.s;
        ctx.drawImage(d.im, cx, y + h - dh, dw, dh);
        cx += dw - 24;
      });
    }
    ctx.restore();
  }

  // ── Layouts ───────────────────────────────────────────────────────────────
  // Story: Scott Free olive, pair image, small report-style "at a glance" card.
  // Instagram/Facebook/WhatsApp UI covers ~250px top and ~340px bottom of a Story,
  // so everything that matters sits between y=250 and y=1580.
  function layoutStory(ctx, d) {
    const W = 1080, H = 1920;
    bgGradient(ctx, W, H);
    ctx.fillStyle = 'rgba(233,235,219,0.045)';
    ctx.beginPath(); ctx.arc(W - 120, 520, 520, 0, Math.PI * 2); ctx.fill();
    drawLogo(ctx, d.logo, W / 2, 262, 250, 'center');
    drawArt(ctx, d.art, 90, 372, W - 180, 530);
    const ky = 962;

    kicker(ctx, d.kicker, W / 2, ky, 24, 'rgba(233,235,219,0.6)');
    ctx.textAlign = 'center';
    const np = fitPx(ctx, d.archetype, 700, HEAD, W - 140, 104, 52);
    ctx.font = `700 ${np}px ${HEAD}`; ctx.fillStyle = '#fff';
    ctx.fillText(d.archetype, W / 2, ky + 24 + np);
    ctx.font = `300 italic 33px ${BODY}`; ctx.fillStyle = 'rgba(255,255,255,0.84)';
    const tl = wrap(ctx, d.tagline, W - 220, 2);
    tl.forEach((l, i) => ctx.fillText(l, W / 2, ky + 24 + np + 56 + i * 42));
    const by = ky + 24 + np + 56 + tl.length * 42 + 22;
    badgeRow(ctx, d.badges, W / 2, by, 1, 18);

    const cy = by + 74 + 34;
    const ch = 90 + d.glance.length * 56;
    ctx.fillStyle = COL.sand; rrect(ctx, 70, cy, W - 140, ch, 40); ctx.fill();
    kicker(ctx, `${d.archetype} — at a glance`, 70 + 44, cy + 56, 19, COL.brown, 'left');
    drawGlance(ctx, d.glance, 70 + 44, cy + 78, W - 140 - 88, 56, 29, d.pColor, '#3a3936');

    kicker(ctx, 'Find your archetype  ·  ' + d.host, W / 2, H - 150, 20, 'rgba(233,235,219,0.55)');
  }

  // Post / Square: scene (group photo) header, olive body, glance card.
  function layoutPost(ctx, d, W, H, compact) {
    const heroH = compact ? 500 : 612;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    if (d.hero) cover(ctx, d.hero, 0, 0, W, heroH, compact ? 0.85 : 0.6);
    else { const g = ctx.createLinearGradient(0, 0, W, heroH); g.addColorStop(0, '#566B3D'); g.addColorStop(1, COL.olive); ctx.fillStyle = g; ctx.fillRect(0, 0, W, heroH); }
    const sc = ctx.createLinearGradient(0, 0, 0, 220);
    sc.addColorStop(0, 'rgba(20,24,14,0.62)'); sc.addColorStop(1, 'rgba(20,24,14,0)');
    ctx.fillStyle = sc; ctx.fillRect(0, 0, W, 220);
    const fade = ctx.createLinearGradient(0, heroH - 70, 0, heroH);
    fade.addColorStop(0, 'rgba(59,66,48,0)'); fade.addColorStop(1, COL.bg);
    ctx.fillStyle = fade; ctx.fillRect(0, heroH - 70, W, 70);
    drawLogo(ctx, d.logo, 56, 50, 210, 'left');

    let y = heroH + (compact ? 20 : 34);
    kicker(ctx, d.kicker, W / 2, y, compact ? 21 : 23, 'rgba(233,235,219,0.62)');
    ctx.textAlign = 'center';
    const np = fitPx(ctx, d.archetype, 700, HEAD, W - 120, compact ? 80 : 96, 48);
    ctx.font = `700 ${np}px ${HEAD}`; ctx.fillStyle = '#fff';
    y += 16 + np;
    ctx.fillText(d.archetype, W / 2, y);
    ctx.font = `300 italic ${compact ? 28 : 31}px ${BODY}`; ctx.fillStyle = 'rgba(255,255,255,0.84)';
    const tl = wrap(ctx, d.tagline, W - 200, compact ? 1 : 2);
    tl.forEach((l, i) => ctx.fillText(l, W / 2, y + 46 + i * 40));
    y += 46 + tl.length * 40 - 14;
    const bs = compact ? 0.84 : 1;
    y += 22;
    badgeRow(ctx, d.badges, W / 2, y, bs, 16);
    y += 74 * bs + (compact ? 22 : 30);

    const rowH = compact ? 44 : 52;
    const items = d.glance;
    const ch = (compact ? 30 : 84) + items.length * rowH;
    const cy = Math.min(y, H - ch - (compact ? 28 : 60));
    ctx.fillStyle = COL.sand; rrect(ctx, 56, cy, W - 112, ch, 36); ctx.fill();
    let gy = cy + (compact ? 15 : 22);
    if (!compact) { kicker(ctx, `${d.archetype} — at a glance`, 56 + 40, cy + 50, 18, COL.brown, 'left'); gy = cy + 66; }
    drawGlance(ctx, items, 56 + 40, gy, W - 112 - 80, rowH, compact ? 25 : 27, d.pColor, '#3a3936');
    kicker(ctx, 'Find yours  ·  ' + d.host, W / 2, H - (compact ? 22 : 26), 16, 'rgba(233,235,219,0.5)');
  }

  // Link card: full-bleed scene; text sits in the clear upper area so the group stays visible.
  function layoutCard(ctx, d) {
    const W = 1200, H = 630;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    if (d.hero) cover(ctx, d.hero, 0, 0, W, H, 0.6);
    else { const g0 = ctx.createLinearGradient(0, 0, W, H); g0.addColorStop(0, '#566B3D'); g0.addColorStop(1, COL.olive); ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H); }
    const gv = ctx.createLinearGradient(0, 0, 0, H * 0.56);
    gv.addColorStop(0, 'rgba(34,40,24,0.86)'); gv.addColorStop(0.7, 'rgba(34,40,24,0.5)'); gv.addColorStop(1, 'rgba(34,40,24,0)');
    ctx.fillStyle = gv; ctx.fillRect(0, 0, W, H * 0.56);
    const gh = ctx.createLinearGradient(0, 0, W * 0.7, 0);
    gh.addColorStop(0, 'rgba(34,40,24,0.55)'); gh.addColorStop(1, 'rgba(34,40,24,0)');
    ctx.fillStyle = gh; ctx.fillRect(0, 0, W * 0.7, H * 0.56);

    drawLogo(ctx, d.logo, 56, 38, 170, 'left');
    kicker(ctx, d.kicker, 56, 150, 17, 'rgba(255,255,255,0.78)', 'left');
    ctx.textAlign = 'left';
    const np = fitPx(ctx, d.archetype, 700, HEAD, 760, 84, 44);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 22;
    ctx.font = `700 ${np}px ${HEAD}`; ctx.fillStyle = '#fff';
    ctx.fillText(d.archetype, 56, 150 + 12 + np);
    ctx.restore();
    let x = 56; const by = 150 + 12 + np + 22;
    d.badges.forEach(b => { const sz = drawBadge(ctx, b, x, by, 0.74); x += sz.w + 12; });
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10;
    kicker(ctx, 'Find yours  ·  ' + d.host, W - 40, H - 28, 15, 'rgba(255,255,255,0.8)', 'right');
    ctx.restore();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([
        document.fonts.load(`700 40px Comfortaa`), document.fonts.load(`700 20px Nunito`),
        document.fonts.load(`300 italic 30px Nunito`), document.fonts.load(`400 20px Nunito`),
      ]);
    } catch (e) {}
  }
  const imgCache = {};
  function cached(key, fn) { return imgCache[key] || (imgCache[key] = fn()); }

  async function renderTemplate(fmt, data) {
    await ensureFonts();
    const { archetype, ageBand, name } = data;
    const [logo, hero, pair, f, m] = await Promise.all([
      cached('logo', () => firstImg([window.LOGO_WHITE])),
      archetype.hero ? cached('hero' + archetype.hero, () => firstImg([slimHero(archetype.hero), archetype.hero])) : null,
      fmt.id === 'story' ? cached('pair' + archetype.name + ageBand, () => firstImg(pairCandidates(archetype, ageBand))) : null,
      fmt.id === 'story' ? cached('mf' + archetype.name + ageBand, () => firstImg([window.mascotForArchetype && window.mascotForArchetype(archetype, 'F', ageBand)])) : null,
      fmt.id === 'story' ? cached('mm' + archetype.name + ageBand, () => firstImg([window.mascotForArchetype && window.mascotForArchetype(archetype, 'M', ageBand)])) : null,
    ]);
    const pm = NEED_META[data.primary], sm = NEED_META[data.secondary];
    const shortName = name ? (name.length > 18 ? name.slice(0, 17) + '…' : name) : '';
    const d = {
      logo, hero, art: pair ? { pair } : { f, m },
      archetype: archetype.name,
      kicker: shortName ? `${shortName}’s archetype` : 'My archetype',
      tagline: String((archetype.innerWorld && archetype.innerWorld.together) || '').replace(/\s*\n\s*/g, ' ').trim(),
      glance: (archetype.glance || []).slice(0, 3),
      badges: [{ label: 'Primary need', value: pm.label, color: pm.color }, { label: 'Secondary need', value: sm.label, color: sm.color }],
      pColor: pm.color, host: hostLabel(shareUrl()),
    };
    const canvas = document.createElement('canvas');
    canvas.width = fmt.w; canvas.height = fmt.h;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    if (fmt.id === 'story') layoutStory(ctx, d);
    else if (fmt.id === 'post') layoutPost(ctx, d, 1080, 1350, false);
    else if (fmt.id === 'square') layoutPost(ctx, d, 1080, 1080, true);
    else layoutCard(ctx, d);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    return { blob, usedPair: !!pair, hasHero: !!hero };
  }

  // ── xAPI-ready event ──────────────────────────────────────────────────────
  // Emits a statement-shaped payload (no name, no actor — the LMS wrapper adds the
  // actor). Listen with window.addEventListener('hnq:shared', e => e.detail), or
  // define window.HNQ_XAPI_SEND(statement) and it will be called directly.
  function emitShared(archetypeName, channel, format, mode) {
    const statement = {
      verb: { id: 'http://adlnet.gov/expapi/verbs/shared', display: { 'en-GB': 'shared' } },
      object: {
        id: shareUrl().replace(/\/$/, '') + '#result',
        definition: { type: 'http://adlnet.gov/expapi/activities/interaction', name: { 'en-GB': 'The Six Human Needs Quiz — result' } },
      },
      result: { extensions: { 'urn:hnq:archetype': archetypeName, 'urn:hnq:channel': channel, 'urn:hnq:format': format, 'urn:hnq:mode': mode } },
    };
    try { window.dispatchEvent(new CustomEvent('hnq:shared', { detail: statement })); } catch (e) {}
    try { if (typeof window.HNQ_XAPI_SEND === 'function') window.HNQ_XAPI_SEND(statement); } catch (e) {}
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'hnq:shared', statement }, '*'); } catch (e) {}
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  const PLATFORMS = [
    { id: 'instagram', label: 'Instagram' },
    { id: 'facebook',  label: 'Facebook' },
    { id: 'linkedin',  label: 'LinkedIn' },
    { id: 'x',         label: 'X' },
    { id: 'whatsapp',  label: 'WhatsApp' },
  ];

  function composerUrl(id, caption, url) {
    const e = encodeURIComponent;
    switch (id) {
      case 'facebook': return 'https://www.facebook.com/sharer/sharer.php?u=' + e(url);
      case 'linkedin': return 'https://www.linkedin.com/sharing/share-offsite/?url=' + e(url);
      case 'x':        return 'https://x.com/intent/post?text=' + e(caption) + '&url=' + e(url);
      case 'whatsapp': return 'https://wa.me/?text=' + e(caption + ' ' + url);
      default:         return null; // Instagram has no web composer
    }
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function ShareSection({ results, userName, ageBand }) {
    const archetype = results && results.archetype;
    const [fmtId, setFmtId] = useState('story');
    const [useName, setUseName] = useState(!!(userName && userName.trim()));
    const [previewUrl, setPreviewUrl] = useState(null);
    const [meta, setMeta] = useState({ usedPair: false, hasHero: true });
    const [rendering, setRendering] = useState(true);
    const [toast, setToast] = useState('');
    const [canFiles, setCanFiles] = useState(false);
    const defaultCaption = archetype
      ? `I just found out I'm ${archetype.name} — ${NEED_META[results.primary].label} + ${NEED_META[results.secondary].label}. What drives you?`
      : '';
    const [caption, setCaption] = useState(defaultCaption);
    const blobRef = useRef(null);
    const tokenRef = useRef(0);
    const toastTimer = useRef(null);
    const fmt = FORMATS.find(f => f.id === fmtId);
    const fileName = `my-archetype-${slug(archetype && archetype.name)}-${fmt.id}.png`;

    useEffect(() => {
      if (!archetype) return;
      const token = ++tokenRef.current;
      setRendering(true);
      renderTemplate(fmt, {
        archetype, ageBand, primary: results.primary, secondary: results.secondary,
        name: useName ? (userName || '').trim() : '',
      }).then(({ blob, usedPair, hasHero }) => {
        if (token !== tokenRef.current) return;
        blobRef.current = blob;
        setMeta({ usedPair, hasHero });
        setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        try {
          const file = new File([blob], fileName, { type: 'image/png' });
          setCanFiles(!!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })));
        } catch (e) { setCanFiles(false); }
        setRendering(false);
      }).catch(() => { if (token === tokenRef.current) { setRendering(false); say('Sorry — the image could not be created. Please try again.'); } });
    }, [fmtId, useName, archetype && archetype.name, ageBand]);

    useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); clearTimeout(toastTimer.current); }, []);

    function say(msg) { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 7000); }
    function fullText() { return caption.trim() + '\n' + shareUrl(); }
    function download() {
      const blob = blobRef.current; if (!blob) return false;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return true;
    }
    async function copyCaption() {
      try { await navigator.clipboard.writeText(fullText()); return true; } catch (e) { return false; }
    }
    async function nativeShare(channel) {
      const blob = blobRef.current; if (!blob) return;
      const file = new File([blob], fileName, { type: 'image/png' });
      try {
        await navigator.share({ files: [file], text: fullText(), title: archetype.name });
        emitShared(archetype.name, channel, fmt.id, 'native');
      } catch (e) {
        if (e && e.name !== 'AbortError') {
          download();
          say('Sharing was blocked here — the image has been saved instead.');
        }
      }
    }
    async function onPlatform(id) {
      if (!blobRef.current) return;
      if (canFiles) { await nativeShare(id); return; }            // phones & some desktops: OS share sheet
      const link = composerUrl(id, caption.trim(), shareUrl());
      if (link) window.open(link, '_blank', 'noopener');           // opened first, while the click is still "fresh"
      download();
      const copied = await copyCaption();
      emitShared(archetype.name, id, fmt.id, 'composer');
      const where = PLATFORMS.find(p => p.id === id).label;
      say(id === 'instagram'
        ? 'Image saved' + (copied ? ' and caption copied' : '') + ' — open Instagram on your phone and add it to a post or story.'
        : `Image saved${copied ? ' and caption copied' : ''} — attach it in the ${where} window that just opened.`);
    }
    async function onPrimary() {
      if (canFiles) { await nativeShare('device'); return; }
      if (download()) { emitShared(archetype.name, 'download', fmt.id, 'download'); say('Image saved to your device.'); }
    }
    if (!archetype) return null;

    return (
      <div className="shr-root">
        <div className="shr-head">
          <h2 className="shr-h2">Share your archetype</h2>
          <p className="shr-lead">Ready-made Scott Free posts with your result. Pick a shape, then share.</p>
        </div>

        <div className="shr-tabs" role="group" aria-label="Post shape">
          {FORMATS.map(f => (
            <button key={f.id} type="button" className={'shr-tab' + (f.id === fmtId ? ' on' : '')}
              aria-pressed={f.id === fmtId} onClick={() => setFmtId(f.id)}>
              {f.label}<span>{f.sub}</span>
            </button>
          ))}
        </div>

        <div className={'shr-stage shr-' + fmt.id}>
          <div className="shr-frame" aria-busy={rendering}>
            {previewUrl && <img src={previewUrl} alt={`Your ${archetype.name} share image`} className="shr-img" style={{ opacity: rendering ? 0.35 : 1 }} />}
            {rendering && <div className="shr-spin" aria-hidden="true"></div>}
          </div>
        </div>

        {userName && userName.trim() && (
          <label className="shr-check">
            <input type="checkbox" checked={useName} onChange={e => setUseName(e.target.checked)} />
            <span>Show my first name on the image</span>
          </label>
        )}

        <label className="shr-cap-l" htmlFor="shr-cap">Caption (edit it if you like)</label>
        <textarea id="shr-cap" className="shr-cap" rows={3} value={caption} onChange={e => setCaption(e.target.value)} maxLength={240} />

        <button type="button" className="shr-primary" onClick={onPrimary} disabled={rendering}>
          {canFiles ? 'Share…' : 'Download image'}
        </button>
        <p className="shr-or">{canFiles ? 'Opens your phone’s share sheet — pick any app.' : 'Or post straight to:'}</p>
        <div className="shr-plats">
          {PLATFORMS.map(p => (
            <button key={p.id} type="button" className="shr-plat" onClick={() => onPlatform(p.id)} disabled={rendering}>{p.label}</button>
          ))}
        </div>
        {canFiles && <p className="shr-note">Tapping a network opens the share sheet with your image and caption ready.</p>}
        {!canFiles && <p className="shr-note">On a computer, your image is saved and your caption copied, then the network opens so you can attach it.</p>}
        <p className="shr-sr" role="status" aria-live="polite">{toast}</p>
        {toast && <div className="shr-toast" aria-hidden="true">{toast}</div>}

        <style>{`
          .shr-root { margin: 0 0 clamp(40px,7vh,72px); }
          .shr-h2 { font-family:'Comfortaa',cursive; font-weight:700; font-size:clamp(24px,3.4vw,30px); color:#EAEFDD; margin:0 0 8px; }
          .shr-lead { font-family:'Nunito',sans-serif; font-size:15px; font-weight:300; color:rgba(233,235,219,0.55); margin:0 0 22px; }
          .shr-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
          .shr-tab { font-family:'Nunito',sans-serif; font-weight:700; font-size:14px; color:rgba(233,235,219,0.75); background:rgba(0,0,0,0.22); border:1px solid rgba(233,235,219,0.16); border-radius:100px; padding:10px 18px; cursor:pointer; display:flex; gap:8px; align-items:baseline; }
          .shr-tab span { font-weight:400; font-size:12px; opacity:0.6; }
          .shr-tab.on { background:#E3DED2; color:#2F2E2C; border-color:#E3DED2; }
          .shr-tab:focus-visible, .shr-plat:focus-visible, .shr-primary:focus-visible { outline:3px solid #C9D6A8; outline-offset:2px; }
          .shr-stage { display:flex; justify-content:center; margin-bottom:18px; }
          .shr-frame { position:relative; width:100%; background:rgba(0,0,0,0.22); border-radius:22px; padding:clamp(10px,2vw,16px); box-shadow:0 12px 34px rgba(0,0,0,0.3); }
          .shr-story .shr-frame { max-width:300px; }
          .shr-post .shr-frame { max-width:420px; }
          .shr-square .shr-frame { max-width:440px; }
          .shr-card .shr-frame { max-width:560px; }
          .shr-img { display:block; width:100%; height:auto; border-radius:12px; transition:opacity .2s; }
          .shr-frame[aria-busy="true"] { min-height:180px; }
          .shr-spin { position:absolute; left:50%; top:50%; width:30px; height:30px; margin:-15px 0 0 -15px; border:3px solid rgba(233,235,219,0.25); border-top-color:#E9EBDB; border-radius:50%; animation:shrspin .8s linear infinite; }
          @keyframes shrspin { to { transform:rotate(360deg); } }
          @media (prefers-reduced-motion: reduce){ .shr-spin{ animation:none; } }
          .shr-check { display:flex; gap:10px; align-items:center; justify-content:center; font-family:'Nunito',sans-serif; font-size:14px; color:rgba(233,235,219,0.8); margin-bottom:18px; cursor:pointer; }
          .shr-check input { width:18px; height:18px; accent-color:#C9D6A8; }
          .shr-cap-l { display:block; font-family:'Nunito',sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:rgba(233,235,219,0.55); margin-bottom:8px; }
          .shr-cap { width:100%; box-sizing:border-box; font-family:'Nunito',sans-serif; font-size:15px; line-height:1.5; color:#EAEFDD; background:rgba(0,0,0,0.25); border:1px solid rgba(233,235,219,0.18); border-radius:14px; padding:14px 16px; resize:vertical; margin-bottom:20px; }
          .shr-primary { display:block; width:100%; max-width:360px; margin:0 auto 14px; font-family:'Comfortaa',cursive; font-weight:700; font-size:17px; color:#fff; background:#9E6B49; border:none; border-radius:100px; padding:17px 40px; cursor:pointer; box-shadow:0 6px 22px rgba(0,0,0,0.28); }
          .shr-primary:hover:not(:disabled) { background:#AE774F; }
          .shr-primary:disabled, .shr-plat:disabled { opacity:0.5; cursor:default; }
          .shr-or { text-align:center; font-family:'Nunito',sans-serif; font-size:13px; color:rgba(233,235,219,0.55); margin:0 0 12px; }
          .shr-plats { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; }
          .shr-plat { font-family:'Nunito',sans-serif; font-weight:700; font-size:14px; color:#EAEFDD; background:rgba(0,0,0,0.25); border:1px solid rgba(233,235,219,0.2); border-radius:100px; padding:11px 22px; cursor:pointer; min-height:44px; }
          .shr-plat:hover:not(:disabled) { background:rgba(233,235,219,0.12); }
          .shr-note { text-align:center; font-family:'Nunito',sans-serif; font-size:12.5px; font-weight:300; color:rgba(233,235,219,0.5); margin:14px auto 0; max-width:420px; line-height:1.5; }
          .shr-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
          .shr-toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); max-width:min(92vw,460px); background:#E3DED2; color:#2F2E2C; font-family:'Nunito',sans-serif; font-size:14px; font-weight:600; line-height:1.4; padding:14px 20px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.4); z-index:50; text-align:center; }
        `}</style>
      </div>
    );
  }

  window.ShareSection = ShareSection;
  window.HNQ_SHARE = { FORMATS, renderTemplate, shareUrl };
})();
