// quiz-share.jsx — "Share to socials": generic, Scott Free-branded archetype cards.
// Two shapes per archetype (15 archetypes x 2 = 30 images, no personal data on them):
//   • Link card  1200x630  — scene fills the card, soft olive wash with the text on the left
//   • Story      1080x1920 — scene across the top fading into solid olive, text underneath
//
// The same canvas code renders the images in the browser (so sharing needs no hosting) and
// in tools/card-studio.html, which exports the 30 static files used for link previews
// (the share/<archetype>/ pages point their og:image at those files).
//
// Globals used: React, NEED_META, LOGO_WHITE.  Exposes: window.ShareSection, window.ShareButton, window.HNQ_SHARE
// Everything lives inside one IIFE so names never collide with the other scripts.
(function () {
  const { useState, useEffect, useRef } = React;

  // ── Config ────────────────────────────────────────────────────────────────
  // Public address of the quiz. Shared links, link-card pages and the static card images
  // all hang off it:  <base>share/<archetype>/   and   <base>cards/<archetype>-card.jpg
  const SHARE_URL_OVERRIDE = null; // null = use QUIZ_URL below
  const QUIZ_URL = 'https://www.nubuverse.com/human-needs-quiz/';
  const HERO_W = 2200; // width asked from Cloudinary for the scene art

  const FORMATS = [
    { id: 'card',  label: 'Landscape card', sub: '1.91:1', w: 1200, h: 630 },
    { id: 'story', label: 'Story',          sub: '9:16',   w: 1080, h: 1920 },
  ];

  // Tweak points for the portrait story (px on the 1080x1920 canvas).
  const STORY = { heroH: 960, fadeFrom: 560, focusX: 0.5, focusY: 0.35 };

  const COL = {
    bg: '#3B4230', olive: '#4A5436', fg: '#E9EBDB', sand: '#E3DED2',
    ink: '#2F2E2C', brown: '#8C5E4A', wash: '34,40,24',
  };
  const HEAD = "'Comfortaa', 'Nunito', sans-serif";
  const BODY = "'Nunito', -apple-system, 'Segoe UI', sans-serif";

  function shareUrl() { return SHARE_URL_OVERRIDE || QUIZ_URL; }
  function hostLabel(u) { return u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); }
  function slug(s) { return String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  // Page whose link preview shows the generic card (see share/<archetype>/index.html).
  function pageUrl(archetype) { return shareUrl() + 'share/' + slug(archetype.name) + '/'; }
  function cardImageUrl(archetype, fmtId) { return shareUrl() + 'cards/' + slug(archetype.name) + '-' + fmtId + '.jpg'; }

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
    return url.replace('/image/upload/', '/image/upload/w_' + HERO_W + ',q_auto:good,f_jpg/');
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
  function cover(ctx, img, x, y, w, h, focusY, focusX) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;
    const sx = (img.width - sw) * (focusX == null ? 0.5 : focusX);
    const sy = (img.height - sh) * (focusY == null ? 0.5 : focusY);
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
  function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }
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
  function badgeRow(ctx, badges, x0, y, scale, gap, centred) {
    const sizes = badges.map(b => badgeSize(ctx, b, scale));
    const total = sizes.reduce((a, s) => a + s.w, 0) + gap * (badges.length - 1);
    let x = centred ? x0 - total / 2 : x0;
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
  // Three short "at a glance" lines with a dot in the primary need colour.
  // centred = the block is centred as a whole (dots line up), text stays left-aligned.
  function drawGlance(ctx, items, x, y, w, rowH, size, dot, color, centred) {
    ctx.textBaseline = 'middle';
    const px = Math.min(...items.map(g => fitPx(ctx, g, 700, HEAD, w - 44, size, Math.round(size * 0.7))));
    ctx.font = `700 ${px}px ${HEAD}`;
    const widest = Math.max(...items.map(g => ctx.measureText(g).width)) + 36;
    const left = centred ? x + (w - widest) / 2 : x;
    items.forEach((g, i) => {
      const cy = y + i * rowH + rowH / 2;
      ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(left + 9, cy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.font = `700 ${px}px ${HEAD}`;
      ctx.fillText(g, left + 36, cy + 1);
    });
    ctx.textBaseline = 'alphabetic';
  }
  function sceneFallback(ctx, x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#566B3D'); g.addColorStop(1, COL.olive);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }

  // ── Layouts ───────────────────────────────────────────────────────────────
  // Landscape card: the whole scene fills the card; a low-opacity olive wash fades in from
  // the left so the text reads, like the full report page.
  function layoutCard(ctx, d) {
    const W = 1200, H = 630, L = 60;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    if (d.hero) cover(ctx, d.hero, 0, 0, W, H, 0.5, 0.5); else sceneFallback(ctx, 0, 0, W, H);
    ctx.fillStyle = `rgba(${COL.wash},0.14)`; ctx.fillRect(0, 0, W, H);
    const gh = ctx.createLinearGradient(0, 0, W * 0.7, 0);
    gh.addColorStop(0, `rgba(${COL.wash},0.93)`); gh.addColorStop(0.5, `rgba(${COL.wash},0.76)`); gh.addColorStop(1, `rgba(${COL.wash},0)`);
    ctx.fillStyle = gh; ctx.fillRect(0, 0, W * 0.7, H);

    drawLogo(ctx, d.logo, L, 40, 176, 'left');
    kicker(ctx, 'The Six Human Needs', L, 172, 17, 'rgba(233,235,219,0.72)', 'left');
    ctx.textAlign = 'left';
    const np = fitPx(ctx, d.archetype, 700, HEAD, 540, 80, 40);
    ctx.font = `700 ${np}px ${HEAD}`; ctx.fillStyle = '#fff';
    const ny = 172 + 14 + np;
    ctx.fillText(d.archetype, L, ny);
    const by = ny + 24;
    badgeRow(ctx, d.badges, L, by, 0.72, 12, false);
    drawGlance(ctx, d.glance, L, by + 55 + 20, 640, 40, 24, d.pColor, 'rgba(255,255,255,0.92)', false);
    kicker(ctx, 'Find yours  ·  ' + d.host, L, H - 34, 14, 'rgba(233,235,219,0.7)', 'left');
  }

  // Portrait story: scene across the top (edges cropped, group kept), fading into solid
  // olive; the text sits on the solid colour. Instagram/Facebook/WhatsApp UI covers ~250px at the
  // top and ~340px at the bottom, so the text sits between y=250 and y=1580.
  function layoutStory(ctx, d) {
    const W = 1080, H = 1920, hh = STORY.heroH;
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    if (d.hero) cover(ctx, d.hero, 0, 0, W, hh, STORY.focusY, STORY.focusX); else sceneFallback(ctx, 0, 0, W, hh);
    const fade = ctx.createLinearGradient(0, STORY.fadeFrom, 0, hh + 2);
    fade.addColorStop(0, 'rgba(59,66,48,0)'); fade.addColorStop(0.55, 'rgba(59,66,48,0.72)'); fade.addColorStop(1, COL.bg);
    ctx.fillStyle = fade; ctx.fillRect(0, STORY.fadeFrom, W, hh - STORY.fadeFrom + 2);

    const ky = hh + 52;
    kicker(ctx, 'The Six Human Needs', W / 2, ky, 24, 'rgba(233,235,219,0.66)');
    ctx.textAlign = 'center';
    const np = fitPx(ctx, d.archetype, 700, HEAD, W - 140, 108, 56);
    ctx.font = `700 ${np}px ${HEAD}`; ctx.fillStyle = '#fff';
    const ny = ky + 26 + np;
    ctx.fillText(d.archetype, W / 2, ny);
    const by = ny + 34;
    badgeRow(ctx, d.badges, W / 2, by, 1, 18, true);
    drawGlance(ctx, d.glance, 120, by + 74 + 34, W - 240, 56, 31, d.pColor, 'rgba(255,255,255,0.92)', true);
    const ly = by + 74 + 34 + 3 * 56 + 34;
    drawLogo(ctx, d.logo, W / 2, ly, 150, 'center');
    kicker(ctx, 'Find yours  ·  ' + d.host, W / 2, ly + 84 + 40, 20, 'rgba(233,235,219,0.6)');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([
        document.fonts.load(`700 40px Comfortaa`), document.fonts.load(`700 20px Nunito`),
      ]);
    } catch (e) {}
  }
  const imgCache = {};
  function cached(key, fn) { return imgCache[key] || (imgCache[key] = fn()); }

  // → { blob (JPEG), hasHero }
  async function renderCard(fmtId, archetype) {
    await ensureFonts();
    const fmt = FORMATS.find(f => f.id === fmtId);
    const [logo, hero] = await Promise.all([
      cached('logo', () => firstImg([window.LOGO_WHITE])),
      archetype.hero ? cached('hero' + archetype.hero, () => firstImg([slimHero(archetype.hero), archetype.hero])) : null,
    ]);
    const pm = NEED_META[archetype.combo[0]], sm = NEED_META[archetype.combo[1]];
    const d = {
      logo, hero, archetype: archetype.name,
      glance: (archetype.glance || []).slice(0, 3),
      badges: [{ label: 'Driving need', value: pm.label, color: pm.color }, { label: 'Driving need', value: sm.label, color: sm.color }],
      pColor: pm.color, host: hostLabel(shareUrl()),
    };
    const canvas = document.createElement('canvas');
    canvas.width = fmt.w; canvas.height = fmt.h;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    if (fmt.id === 'story') layoutStory(ctx, d); else layoutCard(ctx, d);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    return { blob, hasHero: !!hero };
  }

  // Some embeds/viewers (and strict CSPs) refuse blob: images, so previews use data: URLs.
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
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
    "whatsapp": "M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232",
    "share": "M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3",
  };

  // formats[0] is the tab shown first on a phone; on desktop the landscape card comes first
  // because it is the one that turns into a link preview.
  const PLATFORMS = [
    { id: 'instagram', label: 'Instagram', formats: ['story', 'card'] },
    { id: 'facebook',  label: 'Facebook',  formats: ['card', 'story'] },
    { id: 'linkedin',  label: 'LinkedIn',  formats: ['card', 'story'] },
    { id: 'x',         label: 'X',         formats: ['card', 'story'] },
    { id: 'whatsapp',  label: 'WhatsApp',  formats: ['card', 'story'] },
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
  // Can this device hand an image file to the OS share sheet? (phones / some tablets)
  function deviceCanShareFiles() {
    try {
      const f = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' });
      return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] }));
    } catch (e) { return false; }
  }

  function Icon({ id, size }) {
    return <svg viewBox="0 0 16 16" width={size || 24} height={size || 24} fill="currentColor" aria-hidden="true" focusable="false"><path d={ICON_PATHS[id]} /></svg>;
  }

  // Lock page scroll + Escape to close + keep Tab inside the panel while a pop-up is open.
  // (Counted, because the picker and the network pop-up are mounted at the same time.)
  let lockCount = 0, savedOverflow = '';
  function useModal(panelRef, closeRef, onClose) {
    useEffect(() => {
      if (lockCount++ === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
      if (closeRef.current) closeRef.current.focus();
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        if (e.key !== 'Tab' || !panelRef.current) return;
        const items = panelRef.current.querySelectorAll('button:not([disabled]), input, textarea, a[href]');
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
        if (--lockCount === 0) document.body.style.overflow = savedOverflow;
      };
    }, []);
  }

  // The pop-up for one network: pick a shape, see the card, share.
  function ShareDialog({ platform, results, onClose, onBack }) {
    const archetype = results.archetype;
    const [fmtId, setFmtId] = useState(() => {
      const phone = deviceCanShareFiles();
      return phone ? platform.formats[0] : (platform.id === 'instagram' ? 'story' : 'card');
    });
    const [previewUrl, setPreviewUrl] = useState(null);
    const [rendering, setRendering] = useState(true);
    const [msg, setMsg] = useState('');
    const [canFiles] = useState(deviceCanShareFiles);
    const [caption, setCaption] = useState(
      `I just found out I'm ${archetype.name} — ${NEED_META[archetype.combo[0]].label} + ${NEED_META[archetype.combo[1]].label}. What drives you?`);
    const blobRef = useRef(null);
    const tokenRef = useRef(0);
    const closeRef = useRef(null);
    const panelRef = useRef(null);
    const urlRef = useRef(null);
    const fmt = FORMATS.find(f => f.id === fmtId);
    const fileName = `${slug(archetype.name)}-${fmt.id}.jpg`;
    const formats = platform.formats.map(id => FORMATS.find(f => f.id === id));
    // Desktop + landscape card + a network with a web composer: share the link, the card builds itself.
    const linkMode = !canFiles && fmt.id === 'card' && !!composerUrl(platform.id, '', 'x');

    useModal(panelRef, closeRef, onClose);

    useEffect(() => {
      const token = ++tokenRef.current;
      setRendering(true); setMsg('');
      renderCard(fmt.id, archetype).then(async ({ blob }) => {
        const dataUrl = await blobToDataUrl(blob);
        if (token !== tokenRef.current) return;
        blobRef.current = blob;
        setPreviewUrl(dataUrl);
        setRendering(false);
      }).catch(() => { if (token === tokenRef.current) { setRendering(false); setMsg('Sorry — the image could not be created. Please try again.'); } });
    }, [fmtId]);

    function fullText() { return caption.trim() + '\n' + shareUrl(); }
    function download() {
      const blob = blobRef.current; if (!blob) return false;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return true;
    }
    async function copyText(t) {
      try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
    }
    async function onCopyCaption() { setMsg((await copyText(fullText())) ? 'Caption and link copied.' : 'Couldn’t copy automatically — select the caption and copy it.'); }

    async function onShare() {
      const blob = blobRef.current; if (!blob || rendering) return;
      if (canFiles) {                                   // phones: OS share sheet with image + caption
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        try {
          await navigator.share({ files: [file], text: fullText(), title: archetype.name });
          emitShared(archetype.name, platform.id, fmt.id, 'native');
        } catch (e) {
          if (e && e.name !== 'AbortError') { download(); setMsg('Sharing was blocked here — your image has been saved instead.'); }
        }
        return;
      }
      if (linkMode) {                                   // desktop: composer with the link; the card is built from the link
        const link = composerUrl(platform.id, caption.trim(), pageUrl(archetype));
        const needsCaption = platform.id === 'facebook' || platform.id === 'linkedin';
        const copied = needsCaption ? await copyText(caption.trim()) : false;
        window.open(link, '_blank', 'noopener');
        emitShared(archetype.name, platform.id, fmt.id, 'link');
        setMsg(copied ? `${platform.label} is open with your card attached. Your caption is copied — paste it in if you’d like it.`
          : `${platform.label} is open with your card attached — just add a few words and post.`);
        return;
      }
      // Desktop with no composer (Instagram) or a Story: save the image, copy the caption.
      download(); const c = await copyText(fullText());
      emitShared(archetype.name, platform.id, fmt.id, 'download');
      setMsg('Image saved' + (c ? ' and caption copied' : '') + (platform.id === 'instagram'
        ? ' — open Instagram on your phone and add it to a post or story.' : ` — add it to your ${platform.label} post or story.`));
    }

    const primaryLabel = canFiles ? `Share to ${platform.label}` : linkMode ? `Open ${platform.label}` : 'Save image';
    const help = canFiles
      ? 'Opens your share sheet with the image and caption ready — choose ' + platform.label + '.'
      : linkMode ? `Opens ${platform.label} with this card already attached.`
      : platform.id === 'instagram' ? 'Saves the image and copies your caption. Then add it in the Instagram app.'
      : 'Saves the image and copies your caption. Then add it to your story.';

    return (
      <div className="shr-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="shr-panel" role="dialog" aria-modal="true" aria-label={`Share to ${platform.label}`} ref={panelRef}>
          <div className="shr-ph">
            {onBack && <button type="button" className="shr-x shr-back" onClick={onBack} aria-label="Back to networks">‹</button>}
            <h3 className="shr-ptitle"><Icon id={platform.id} size={22} /> Share to {platform.label}</h3>
            <button type="button" className="shr-x" onClick={onClose} ref={closeRef} aria-label="Close">×</button>
          </div>

          <div className="shr-tabs" role="group" aria-label="Image shape">
            {formats.map(f => (
              <button key={f.id} type="button" className={'shr-tab' + (f.id === fmtId ? ' on' : '')}
                aria-pressed={f.id === fmtId} onClick={() => setFmtId(f.id)}>{f.label}<span>{f.sub}</span></button>
            ))}
          </div>

          <div className={'shr-stage shr-' + fmt.id}>
            <div className="shr-frame" aria-busy={rendering}>
              {previewUrl && <img src={previewUrl} alt={`${archetype.name} share image`} className="shr-img" style={{ opacity: rendering ? 0.35 : 1 }} />}
              {rendering && <div className="shr-spin" aria-hidden="true"></div>}
            </div>
          </div>

          <label className="shr-cap-l" htmlFor="shr-cap">Caption</label>
          <textarea id="shr-cap" className="shr-cap" rows={3} value={caption} onChange={e => setCaption(e.target.value)} maxLength={240} />

          <button type="button" className="shr-primary" onClick={onShare} disabled={rendering}>{primaryLabel}</button>
          <p className="shr-help">{help}</p>
          <div className="shr-links">
            <button type="button" className="shr-link" onClick={onCopyCaption}>Copy caption + link</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="shr-link" onClick={() => { if (download()) { emitShared(archetype.name, 'download', fmt.id, 'download'); setMsg('Image saved to your device.'); } }} disabled={rendering}>Download image</button>
          </div>
          <p className="shr-msg" role="status" aria-live="polite">{msg}</p>
        </div>
      </div>
    );
  }

  // Picker used by the toolbar button: five icons, then the same pop-up as the bottom section.
  function ShareLauncher({ results, onClose }) {
    const [pid, setPid] = useState(null);
    const panelRef = useRef(null), closeRef = useRef(null);
    useModal(panelRef, closeRef, onClose);
    const platform = PLATFORMS.find(p => p.id === pid);
    if (platform) return <ShareDialog key={platform.id} platform={platform} results={results} onClose={onClose} onBack={() => setPid(null)} />;
    return (
      <div className="shr-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="shr-panel shr-pick" role="dialog" aria-modal="true" aria-label="Share to socials" ref={panelRef}>
          <div className="shr-ph">
            <h3 className="shr-ptitle">Share to socials</h3>
            <button type="button" className="shr-x" onClick={onClose} ref={closeRef} aria-label="Close">×</button>
          </div>
          <p className="shr-sub">Pick where you’d like to share your {results.archetype.name} card.</p>
          <div className="shr-icons shr-pick-icons">
            {PLATFORMS.map(p => (
              <button key={p.id} type="button" className="shr-pick-btn" onClick={() => setPid(p.id)} aria-label={`Share to ${p.label}`}>
                <span className="shr-icon"><Icon id={p.id} size={26} /></span>
                <span className="shr-pick-l">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Toolbar button (next to Retake). Opens the picker above.
  function ShareButton({ results }) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    if (!results || !results.archetype) return null;
    function close() { setOpen(false); if (btnRef.current) { try { btnRef.current.focus(); } catch (e) {} } }
    return (
      <>
        <button type="button" className="rpt-tb-ghost shr-tb-btn no-print" ref={btnRef} onClick={() => setOpen(true)} aria-label="Share to socials" aria-haspopup="dialog">
          <Icon id="share" size={14} /><span className="rpt-tb-long">Share</span>
        </button>
        {open && <ShareLauncher results={results} onClose={close} />}
        <ShareStyles />
      </>
    );
  }

  // The section at the end of the report: a heading and five icons. Everything else lives in the pop-up.
  function ShareSection({ results }) {
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
        {platform && <ShareDialog key={platform.id} platform={platform} results={results} onClose={close} />}
        <ShareStyles />
      </div>
    );
  }

  function ShareStyles() {
    return (
      <style>{`
        .shr-root { max-width:760px; margin:0 auto; padding:clamp(40px,7vh,72px) clamp(20px,5vw,32px) clamp(48px,8vh,84px); text-align:center; }
        .shr-h2 { font-family:'Comfortaa',cursive; font-weight:700; font-size:clamp(22px,3vw,28px); color:#EAEFDD; margin:0 0 22px; }
        .shr-icons { display:flex; gap:clamp(10px,2.4vw,18px); justify-content:center; flex-wrap:wrap; }
        .shr-icon { width:56px; height:56px; border-radius:50%; border:none; background:#E3DED2; color:#2F2E2C; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,0.28); transition:transform .15s ease, background .15s ease; }
        .shr-icon:hover { transform:translateY(-3px); background:#F1EDE4; }
        .shr-icon:focus-visible, .shr-tab:focus-visible, .shr-primary:focus-visible, .shr-x:focus-visible, .shr-link:focus-visible, .shr-pick-btn:focus-visible, .shr-tb-btn:focus-visible { outline:3px solid #C9D6A8; outline-offset:2px; }
        .shr-tb-btn { display:inline-flex; align-items:center; gap:7px; }
        .shr-tb-btn svg { flex:none; }
        @media (max-width:520px){ .shr-tb-btn { gap:0; padding:6px 10px; } }
        .shr-overlay { position:fixed; inset:0; z-index:400; background:rgba(20,24,14,0.74); display:flex; align-items:center; justify-content:center; padding:16px; -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); text-align:left; }
        .shr-panel { background:#3B4230; color:#E9EBDB; width:100%; max-width:520px; max-height:calc(100vh - 32px); max-height:calc(100dvh - 32px); overflow-y:auto; border-radius:24px; padding:clamp(18px,3vw,26px); box-shadow:0 24px 60px rgba(0,0,0,0.5); border:1px solid rgba(233,235,219,0.12); }
        .shr-panel.shr-pick { max-width:460px; }
        .shr-ph { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
        .shr-ptitle { display:flex; align-items:center; gap:10px; font-family:'Comfortaa',cursive; font-weight:700; font-size:19px; color:#EAEFDD; margin:0; flex:1; min-width:0; }
        .shr-x { width:40px; height:40px; flex:none; border-radius:50%; border:1px solid rgba(233,235,219,0.2); background:rgba(0,0,0,0.2); color:#EAEFDD; font-size:24px; line-height:1; cursor:pointer; }
        .shr-back { font-size:26px; padding-bottom:3px; }
        .shr-sub { font-family:'Nunito',sans-serif; font-size:14.5px; line-height:1.5; color:rgba(233,235,219,0.72); margin:0 0 20px; }
        .shr-pick-icons { gap:4px; flex-wrap:nowrap; }
        .shr-pick-btn { background:none; border:none; padding:4px 0; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:8px; flex:1 1 0; min-width:0; color:#E9EBDB; }
        .shr-pick-btn:hover .shr-icon { transform:translateY(-3px); background:#F1EDE4; }
        .shr-pick-l { font-family:'Nunito',sans-serif; font-weight:700; font-size:12.5px; }
        .shr-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
        .shr-tab { font-family:'Nunito',sans-serif; font-weight:700; font-size:13.5px; color:rgba(233,235,219,0.78); background:rgba(0,0,0,0.22); border:1px solid rgba(233,235,219,0.16); border-radius:100px; padding:9px 16px; cursor:pointer; display:flex; gap:8px; align-items:baseline; }
        .shr-tab span { font-weight:400; font-size:12px; opacity:0.6; }
        .shr-tab.on { background:#E3DED2; color:#2F2E2C; border-color:#E3DED2; }
        .shr-stage { display:flex; justify-content:center; margin-bottom:14px; }
        .shr-frame { position:relative; width:100%; background:rgba(0,0,0,0.22); border-radius:18px; padding:10px; }
        .shr-story .shr-frame { max-width:230px; }
        .shr-card .shr-frame { max-width:100%; }
        .shr-img { display:block; width:100%; height:auto; border-radius:10px; transition:opacity .2s; }
        .shr-frame[aria-busy="true"] { min-height:160px; }
        .shr-spin { position:absolute; left:50%; top:50%; width:30px; height:30px; margin:-15px 0 0 -15px; border:3px solid rgba(233,235,219,0.25); border-top-color:#E9EBDB; border-radius:50%; animation:shrspin .8s linear infinite; }
        @keyframes shrspin { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce){ .shr-spin{ animation:none; } .shr-icon{ transition:none; } }
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
        @media print { .shr-root, .shr-overlay, .shr-tb-btn { display:none !important; } }
      `}</style>
    );
  }

  window.ShareSection = ShareSection;
  window.ShareButton = ShareButton;
  window.HNQ_SHARE = { FORMATS, STORY, renderCard, blobToDataUrl, shareUrl, pageUrl, cardImageUrl, slug };
})();
