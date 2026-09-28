/* Text decode: characters flicker through look-alike glyphs (CJK for CJK, letters for
   letters, digits for digits, so line widths never change), then lock with a warm flash.
   Used for the arrival title and for each roadside screen as it opens. The original markup
   comes back when a decode ends; screen readers get the real text throughout. Disabled
   under prefers-reduced-motion. No libraries or requests. */
(() => {
  'use strict';
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const CJK = '光星路视觉像素深度维探索数据模型感知世界图谱信号频率轨迹坐标观测', UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz', DIGIT = '0123456789';
  const pick = set => set[Math.floor(Math.random() * set.length)];
  const glyph = ch => /[一-鿿]/.test(ch) ? pick(CJK) : /[A-Z]/.test(ch) ? pick(UPPER)
    : /[a-z]/.test(ch) ? pick(LOWER) : /[0-9]/.test(ch) ? pick(DIGIT) : ch;
  const jobs = new Map();
  let raf = 0, last = 0;

  // Every text run becomes one inline <fx-s> holding a hidden <fx-g> per character. Custom
  // tags keep page rules such as `.eyebrow span` off them, and one wrapper per run keeps flex
  // layouts (one item per run) unchanged. The decode starts on play().
  function prepare(el, { delay = 0, stagger = .05, span = .4 } = {}) {
    if (!el || reducedQuery.matches) return null;
    if (jobs.has(el)) finish(jobs.get(el));
    const html = el.innerHTML, text = el.textContent.replace(/\s+/g, ' ').trim(), glyphs = [];
    const walk = node => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          if (!child.data.trim()) continue;
          const run = document.createElement('fx-s'); run.setAttribute('aria-hidden', 'true');
          for (const ch of child.data) {
            if (/\s/.test(ch)) { run.append(ch); continue; }
            const g = document.createElement('fx-g'); g.className = 'fx-wait'; g.textContent = ch;
            run.append(g); glyphs.push({ s: g, ch, at: 0, state: 0 });
          }
          child.replaceWith(run);
        } else if (child.nodeType === 1) walk(child);
      }
    };
    walk(el);
    const sr = document.createElement('fx-s'); sr.className = 'fx-sr'; sr.textContent = text;
    el.append(sr); el.classList.add('fx-decoding', 'fx-seen');
    let end = 0;
    glyphs.forEach((g, i) => { g.start = delay + i * stagger; g.lock = g.start + span * (.55 + Math.random() * .9); end = Math.max(end, g.lock); });
    const job = { el, html, glyphs, t: 0, rate: 1, running: false, end: end + .7 };
    jobs.set(el, job);
    return job;
  }
  function play(job) {
    for (const j of job ? [job] : jobs.values()) j.running = true;
    if (!raf && jobs.size) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function decode(el, options) { const job = prepare(el, options); if (job) play(job); return job; }
  // Restores the original markup exactly.
  function finish(job) {
    jobs.delete(job.el);
    job.el.innerHTML = job.html; job.el.classList.remove('fx-decoding');
  }
  // Fast-forward everything (any input during the arrival).
  function hurry() { for (const job of jobs.values()) { job.rate = 7; job.running = true; } play(); }
  function tick(now) {
    raf = 0;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    for (const job of [...jobs.values()]) {
      if (!job.running) continue;
      job.t += dt * job.rate;
      for (const g of job.glyphs) {
        // Every glyph shows (scrambled) from the first frame, so the line has its full size at
        // once (it paints as one element: an early Largest Contentful Paint); glyphs then lock in turn.
        if (g.state === 2) continue;
        if (job.t < g.lock) {
          // Glyphs change about 18 times a second while scrambling.
          if (g.state === 0) { g.state = 1; g.s.className = 'fx-scram'; }
          if (now - g.at > 55) { g.s.textContent = glyph(g.ch); g.at = now; }
        } else { g.state = 2; g.s.textContent = g.ch; g.s.className = 'fx-lock'; }
      }
      if (job.t >= job.end) finish(job);
    }
    if (jobs.size && [...jobs.values()].some(j => j.running)) raf = requestAnimationFrame(tick);
  }
  // Switching to reduced motion mid-decode shows the plain text at once.
  reducedQuery.addEventListener('change', event => { if (event.matches) for (const job of [...jobs.values()]) finish(job); });
  window.RoadFx = { prepare, play, decode, hurry, get busy() { return jobs.size > 0; } };
})();
