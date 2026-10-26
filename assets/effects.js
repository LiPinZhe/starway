/* A brief whole-label reveal, without per-character DOM nodes or a second RAF loop. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const jobs = new Map();
  function finish(el) { clearTimeout(jobs.get(el)); jobs.delete(el); el.classList.remove('fx-reveal'); }
  function decode(el) {
    if (!el || reduced.matches || document.hidden) return;
    if (jobs.has(el)) finish(el);
    el.classList.add('fx-reveal');
    jobs.set(el, setTimeout(() => finish(el), 450));
  }
  function hurry() { for (const el of jobs.keys()) finish(el); }
  reduced.addEventListener('change', event => { if (event.matches) hurry(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hurry(); });
  document.addEventListener('research:open', hurry);
  window.RoadFx = { decode, hurry, get busy() { return jobs.size > 0; } };
})();
