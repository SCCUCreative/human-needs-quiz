// quiz-share.jsx — "Share your archetype": personalised, Scott Free-branded post
// templates (Story, Post 4:5, Square, Link card) rendered client-side on a canvas,
// behind a row of Instagram, Facebook, LinkedIn, X and WhatsApp icons (each opens its own pop-up).
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
  const ICON_PATHS = {
    "instagram": "M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599s.453.546.598.92c.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.5 2.5 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.233-.047c-.78-.036-1.203-.166-1.485-.276a2.5 2.5 0 0 1-.92-.598 2.5 2.5 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233s.008-2.388.046-3.231c.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92s.546-.453.92-.598c.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92m-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217m0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334",
    "facebook": "M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951",
    "linkedin": "M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z",
    "x": "M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z",
    "whatsapp": "M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"
  };

  // formats[0] is the default tab for that network.
  const PLATFORMS = [
    { id: 'instagram', label: 'Instagram', formats: ['story', 'post', 'square'] },
    { id: 'facebook',  label: 'Facebook',  formats: ['post', 'square', 'card'] },
    { id: 'linkedin',  label: 'LinkedIn',  formats: ['square', 'post', 'card'] },
    { id: 'x',         label: 'X',         formats: ['card', 'square'] },
    { id: 'whatsapp',  label: 'WhatsApp',  formats: ['story', 'square'] },
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
  function isMac() { try { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); } catch (e) { return false; } }

  // Puts the image itself on the clipboard so it can be pasted straight into a composer.
  async function copyImage(blob) {
    try {
      if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) return false;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) { return false; }
  }

  function Icon({ id, size }) {
    return <svg viewBox="0 0 16 16" width={size || 24} height={size || 24} fill="currentColor" aria-hidden="true" focusable="false"><path d={ICON_PATHS[id]} /></svg>;
  }

  // The pop-up for one network: pick a shape, tweak, share.
  function ShareDialog({ platform, results, userName, ageBand, onClose }) {
    const archetype = results.archetype;
    const [fmtId, setFmtId] = useState(platform.formats[0]);
    const [useName, setUseName] = useState(!!(userName && userName.trim()));
    const [previewUrl, setPreviewUrl] = useState(null);
    const [rendering, setRendering] = useState(true);
    const [msg, setMsg] = useState('');
    const [canFiles, setCanFiles] = useState(false);
    const [caption, setCaption] = useState(
      `I just found out I'm ${archetype.name} — ${NEED_META[results.primary].label} + ${NEED_META[results.secondary].label}. What drives you?`);
    const blobRef = useRef(null);
    const tokenRef = useRef(0);
    const closeRef = useRef(null);
    const panelRef = useRef(null);
    const urlRef = useRef(null);
    const fmt = FORMATS.find(f => f.id === fmtId);
    const fileName = `my-archetype-${slug(archetype.name)}-${fmt.id}.png`;
    const formats = platform.formats.map(id => FORMATS.find(f => f.id === id));

    useEffect(() => {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      if (closeRef.current) closeRef.current.focus();
      function onKey(e) {
        if (e.key === 'Escape') { onClose(); return; }
        if (e.key !== 'Tab' || !panelRef.current) return;
        const items = panelRef.current.querySelectorAll('button:not([disabled]), input, textarea, a[href]');
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey);
      return () => { document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
    }, []);

    useEffect(() => {
      const token = ++tokenRef.current;
      setRendering(true); setMsg('');
      renderTemplate(fmt, {
        archetype, ageBand, primary: results.primary, secondary: results.secondary,
        name: useName ? (userName || '').trim() : '',
      }).then(({ blob }) => {
        if (token !== tokenRef.current) return;
        blobRef.current = blob;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setPreviewUrl(urlRef.current);
        try {
          const file = new File([blob], fileName, { type: 'image/png' });
          setCanFiles(!!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })));
        } catch (e) { setCanFiles(false); }
        setRendering(false);
      }).catch(() => { if (token === tokenRef.current) { setRendering(false); setMsg('Sorry — the image could not be created. Please try again.'); } });
    }, [fmtId, useName]);

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
    async function onCopyCaption() { setMsg((await copyCaption()) ? 'Caption copied.' : 'Couldn’t copy automatically — select the caption and copy it.'); }

    async function onShare() {
      const blob = blobRef.current; if (!blob || rendering) return;
      if (canFiles) {                                   // phones: OS share sheet with image + caption
        const file = new File([blob], fileName, { type: 'image/png' });
        try {
          await navigator.share({ files: [file], text: fullText(), title: archetype.name });
          emitShared(archetype.name, platform.id, fmt.id, 'native');
        } catch (e) {
          if (e && e.name !== 'AbortError') { download(); setMsg('Sharing was blocked here — your image has been saved instead.'); }
        }
        return;
      }
      if (platform.id === 'instagram') {                // no web composer: save + caption for the phone
        download(); const c = await copyCaption();
        emitShared(archetype.name, platform.id, fmt.id, 'download');
        setMsg('Image saved' + (c ? ' and caption copied' : '') + ' — open Instagram on your phone and add it to a post or story.');
        return;
      }
      // Desktop: copy the image first (needs the click), then open the composer.
      const copying = copyImage(blob);
      const link = composerUrl(platform.id, caption.trim(), shareUrl());
      if (link) window.open(link, '_blank', 'noopener');
      const copied = await copying;
      if (!copied) download();
      emitShared(archetype.name, platform.id, fmt.id, 'composer');
      setMsg(copied
        ? `Image copied — in the ${platform.label} window press ${isMac() ? '⌘' : 'Ctrl'}+V to add it to your post.`
        : `Image saved — add it to your ${platform.label} post.`);
    }

    const primaryLabel = canFiles ? `Share to ${platform.label}` : platform.id === 'instagram' ? 'Save image' : `Open ${platform.label}`;
    const help = canFiles
      ? 'Opens your share sheet with the image and caption ready — choose ' + platform.label + '.'
      : platform.id === 'instagram'
        ? 'Saves the image and copies your caption. Then add it in the Instagram app.'
        : `Copies your image and opens ${platform.label}. Paste it into the post.`;

    return (
      <div className="shr-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="shr-panel" role="dialog" aria-modal="true" aria-label={`Share to ${platform.label}`} ref={panelRef}>
          <div className="shr-ph">
            <h3 className="shr-ptitle"><Icon id={platform.id} size={22} /> Share to {platform.label}</h3>
            <button type="button" className="shr-x" onClick={onClose} ref={closeRef} aria-label="Close">×</button>
          </div>

          {formats.length > 1 && (
            <div className="shr-tabs" role="group" aria-label="Post shape">
              {formats.map(f => (
                <button key={f.id} type="button" className={'shr-tab' + (f.id === fmtId ? ' on' : '')}
                  aria-pressed={f.id === fmtId} onClick={() => setFmtId(f.id)}>{f.label}<span>{f.sub}</span></button>
              ))}
            </div>
          )}

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

          <label className="shr-cap-l" htmlFor="shr-cap">Caption</label>
          <textarea id="shr-cap" className="shr-cap" rows={3} value={caption} onChange={e => setCaption(e.target.value)} maxLength={240} />

          <button type="button" className="shr-primary" onClick={onShare} disabled={rendering}>{primaryLabel}</button>
          <p className="shr-help">{help}</p>
          <div className="shr-links">
            <button type="button" className="shr-link" onClick={onCopyCaption}>Copy caption</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="shr-link" onClick={() => { if (download()) { emitShared(archetype.name, 'download', fmt.id, 'download'); setMsg('Image saved to your device.'); } }} disabled={rendering}>Download image</button>
          </div>
          <p className="shr-msg" role="status" aria-live="polite">{msg}</p>
        </div>
      </div>
    );
  }

  // The section itself: a heading and five icons. Everything else lives in the pop-up.
  function ShareSection({ results, userName, ageBand }) {
    const [open, setOpen] = useState(null);
    const openerRef = useRef(null);
    if (!results || !results.archetype) return null;
    const platform = PLATFORMS.find(p => p.id === open);
    function close() { setOpen(null); if (openerRef.current) { try { openerRef.current.focus(); } catch (e) {} } }
    return (
      <div className="shr-root no-print">
        <h2 className="shr-h2">Share to socials</h2>
        <div className="shr-icons">
          {PLATFORMS.map(p => (
            <button key={p.id} type="button" className="shr-icon" aria-label={`Share to ${p.label}`} title={p.label}
              onClick={e => { openerRef.current = e.currentTarget; setOpen(p.id); }}>
              <Icon id={p.id} size={26} />
            </button>
          ))}
        </div>
        {platform && <ShareDialog key={platform.id} platform={platform} results={results} userName={userName} ageBand={ageBand} onClose={close} />}

        <style>{`
          .shr-root { max-width:760px; margin:0 auto; padding:clamp(40px,7vh,72px) clamp(20px,5vw,32px) clamp(48px,8vh,84px); text-align:center; }
          .shr-h2 { font-family:'Comfortaa',cursive; font-weight:700; font-size:clamp(22px,3vw,28px); color:#EAEFDD; margin:0 0 22px; }
          .shr-icons { display:flex; gap:clamp(10px,2.4vw,18px); justify-content:center; flex-wrap:wrap; }
          .shr-icon { width:56px; height:56px; border-radius:50%; border:none; background:#E3DED2; color:#2F2E2C; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,0.28); transition:transform .15s ease, background .15s ease; }
          .shr-icon:hover { transform:translateY(-3px); background:#F1EDE4; }
          .shr-icon:focus-visible, .shr-tab:focus-visible, .shr-primary:focus-visible, .shr-x:focus-visible, .shr-link:focus-visible { outline:3px solid #C9D6A8; outline-offset:2px; }
          .shr-overlay { position:fixed; inset:0; z-index:400; background:rgba(20,24,14,0.74); display:flex; align-items:center; justify-content:center; padding:16px; -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); text-align:left; }
          .shr-panel { background:#3B4230; color:#E9EBDB; width:100%; max-width:520px; max-height:calc(100vh - 32px); max-height:calc(100dvh - 32px); overflow-y:auto; border-radius:24px; padding:clamp(18px,3vw,26px); box-shadow:0 24px 60px rgba(0,0,0,0.5); border:1px solid rgba(233,235,219,0.12); }
          .shr-ph { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
          .shr-ptitle { display:flex; align-items:center; gap:10px; font-family:'Comfortaa',cursive; font-weight:700; font-size:19px; color:#EAEFDD; margin:0; }
          .shr-x { width:40px; height:40px; border-radius:50%; border:1px solid rgba(233,235,219,0.2); background:rgba(0,0,0,0.2); color:#EAEFDD; font-size:24px; line-height:1; cursor:pointer; }
          .shr-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
          .shr-tab { font-family:'Nunito',sans-serif; font-weight:700; font-size:13.5px; color:rgba(233,235,219,0.78); background:rgba(0,0,0,0.22); border:1px solid rgba(233,235,219,0.16); border-radius:100px; padding:9px 16px; cursor:pointer; display:flex; gap:8px; align-items:baseline; }
          .shr-tab span { font-weight:400; font-size:12px; opacity:0.6; }
          .shr-tab.on { background:#E3DED2; color:#2F2E2C; border-color:#E3DED2; }
          .shr-stage { display:flex; justify-content:center; margin-bottom:14px; }
          .shr-frame { position:relative; width:100%; background:rgba(0,0,0,0.22); border-radius:18px; padding:10px; }
          .shr-story .shr-frame { max-width:230px; }
          .shr-post .shr-frame { max-width:340px; }
          .shr-square .shr-frame { max-width:340px; }
          .shr-card .shr-frame { max-width:100%; }
          .shr-img { display:block; width:100%; height:auto; border-radius:10px; transition:opacity .2s; }
          .shr-frame[aria-busy="true"] { min-height:160px; }
          .shr-spin { position:absolute; left:50%; top:50%; width:30px; height:30px; margin:-15px 0 0 -15px; border:3px solid rgba(233,235,219,0.25); border-top-color:#E9EBDB; border-radius:50%; animation:shrspin .8s linear infinite; }
          @keyframes shrspin { to { transform:rotate(360deg); } }
          @media (prefers-reduced-motion: reduce){ .shr-spin{ animation:none; } .shr-icon{ transition:none; } }
          .shr-check { display:flex; gap:10px; align-items:center; font-family:'Nunito',sans-serif; font-size:14px; color:rgba(233,235,219,0.85); margin-bottom:14px; cursor:pointer; }
          .shr-check input { width:18px; height:18px; accent-color:#C9D6A8; }
          .shr-cap-l { display:block; font-family:'Nunito',sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:rgba(233,235,219,0.55); margin-bottom:6px; }
          .shr-cap { width:100%; box-sizing:border-box; font-family:'Nunito',sans-serif; font-size:15px; line-height:1.5; color:#EAEFDD; background:rgba(0,0,0,0.25); border:1px solid rgba(233,235,219,0.18); border-radius:14px; padding:12px 14px; resize:vertical; margin-bottom:16px; }
          .shr-primary { display:block; width:100%; font-family:'Comfortaa',cursive; font-weight:700; font-size:17px; color:#fff; background:#9E6B49; border:none; border-radius:100px; padding:16px 24px; cursor:pointer; box-shadow:0 6px 22px rgba(0,0,0,0.28); }
          .shr-primary:hover:not(:disabled) { background:#AE774F; }
          .shr-primary:disabled { opacity:0.5; cursor:default; }
          .shr-help { text-align:center; font-family:'Nunito',sans-serif; font-size:13px; font-weight:300; color:rgba(233,235,219,0.6); margin:10px 0 4px; line-height:1.5; }
          .shr-links { display:flex; gap:10px; justify-content:center; align-items:center; color:rgba(233,235,219,0.4); }
          .shr-link { background:none; border:none; color:rgba(233,235,219,0.8); font-family:'Nunito',sans-serif; font-weight:700; font-size:13px; text-decoration:underline; cursor:pointer; padding:8px 4px; }
          .shr-link:disabled { opacity:0.5; cursor:default; }
          .shr-msg { min-height:1.4em; margin:6px 0 0; text-align:center; font-family:'Nunito',sans-serif; font-size:13.5px; font-weight:600; color:#C9D6A8; line-height:1.4; }
          @media print { .shr-root, .shr-overlay { display:none !important; } }
        `}</style>
      </div>
    );
  }

  window.ShareSection = ShareSection;
  window.HNQ_SHARE = { FORMATS, renderTemplate, shareUrl };
})();
