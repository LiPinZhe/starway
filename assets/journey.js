(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new RoadScene($('roadCanvas'), $('skyCanvas'));
  const monitors = new RoadMonitors(scene);
  const reticle = $('reticle');
  const dots = [...document.querySelectorAll('.route-stop')];
  // The scroll range only changes on resize; reading scrollHeight per event could force layout.
  let scrollRange = 1;
  const measureScroll = () => { scrollRange = Math.max(1, document.documentElement.scrollHeight - innerHeight); };
  const maxScroll = () => scrollRange;
  const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
  // Look limits in radians: yaw either way, pitch up / down.
  const maxLook = 1.1, maxUp = .42, maxDown = .3;
  let target = 0, camera = 0, lookTarget = 0, look = 0, pitchTarget = 0, pitch = 0;
  let paused = reducedQuery.matches, reduced = reducedQuery.matches;
  let auto = false, autoTop = 0, scenery = false, raf = 0, last = 0, time = 0, dirty = true;
  let touch = null, aiming = false, overControls = false, band = { top: 0, bottom: innerHeight }, reticleState = '', renderMs = 0;

  function controls() {
    $('autoButton').setAttribute('aria-pressed', String(auto));
    $('autoButton').setAttribute('aria-label', auto ? '停止自动前进' : '自动前进');
    $('autoButton').classList.toggle('is-running', auto);
    $('motionButton').setAttribute('aria-pressed', String(paused));
    $('motionButton').setAttribute('aria-label', paused ? '继续动态' : '暂停动态');
    $('motionButton').textContent = paused ? '▶' : 'Ⅱ';
    $('sceneryButton').setAttribute('aria-pressed', String(scenery));
    $('sceneryButton').setAttribute('aria-label', scenery ? '显示路牌' : '隐藏路牌');
  }
  // Last values written to the DOM, so a frame only touches what actually changed.
  const shown = { fill: '', text: '', current: -1, intro: -1 };
  function ui() {
    const fill = `scaleX(${target.toFixed(3)})`, text = `${Math.round(target * 100)}%`, current = Math.round(target * 3);
    if (fill !== shown.fill) $('progressFill').style.transform = shown.fill = fill;
    if (text !== shown.text) $('progressText').textContent = shown.text = text;
    if (current !== shown.current) {
      shown.current = current;
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-current', i === current);
        if (i === current) dot.setAttribute('aria-current', 'step'); else dot.removeAttribute('aria-current');
      });
    }
    // The title is a screen overlay: it gives way once the view turns well away or travel begins.
    const alpha = Math.round(clamp(1 - camera * 12) * clamp(1.3 - Math.abs(look) * 3.2) * clamp(1.25 - Math.abs(pitch) * 2.2) * 100) / 100;
    if (alpha !== shown.intro) {
      const intro = $('intro'); shown.intro = alpha;
      intro.style.opacity = String(alpha); intro.inert = alpha < .1; intro.style.visibility = alpha < .01 ? 'hidden' : 'visible';
    }
    const state = overControls ? 'idle' : monitors.aim;
    if (state !== reticleState) { reticle.dataset.state = reticleState = state; }
  }
  function wake() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
  const costs = new Float32Array(240), gaps = new Float32Array(240); let costAt = 0, gapAt = 0, chained = false;
  // Frame pacing: drawn frames land on a whole number of display refreshes (about
  // 55–90 fps), so a 165 Hz panel gets evenly spaced frames at 82.5 fps instead of
  // a GPU running flat out and missing refreshes unevenly.
  // With no input for a while, only ambient light moves, drawn every ~18 ms (55 fps on
  // 165 Hz, unchanged on 60 Hz) so the GPU can cool between interactions.
  const PACE_MIN = 11.5, PACE_MAX = 20.5, IDLE_MS = 18, ticks = [];
  let refresh = 0, pace = 1, lastTick = 0, tickCount = 0, paceAt = 0, lateAvg = 1, inputAt = 0;
  // Callbacks arrive once per display refresh; a low percentile of their spacing is the
  // refresh interval even while some frames run long. Re-checked every 60 callbacks.
  function estimateRefresh() {
    const r = [...ticks].sort((a, b) => a - b)[Math.floor(ticks.length * .1)];
    if (!refresh || Math.abs(r - refresh) / refresh > .15) {
      refresh = r; pace = Math.max(1, Math.ceil(PACE_MIN / refresh - .05)); lateAvg = 1;
    }
  }
  function frame(now) {
    raf = 0;
    if (lastTick && now - lastTick < 40) { ticks.push(now - lastTick); if (ticks.length > 60) ticks.shift(); }
    lastTick = now;
    if (ticks.length >= 24 && (!refresh || ++tickCount % 60 === 0)) estimateRefresh();
    const calm = !auto && now - inputAt > 2500 && Math.abs(camera - target) < .00001 && look === lookTarget && pitch === pitchTarget;
    const step = refresh ? (calm ? Math.max(pace, Math.round(IDLE_MS / refresh)) : pace) : 1;
    if (refresh && last && now - last < refresh * (step - .5)) { raf = requestAnimationFrame(frame); return; }
    const begin = performance.now();
    const interval = last ? now - last : 16, dt = Math.min(45, interval); last = now;
    if (chained) gaps[gapAt++ % gaps.length] = interval;
    // Only back-to-back drawn frames say anything about rendering speed. When they run
    // late, a lower (still even) frame rate is tried first, then a smaller backing store.
    if (chained && !reduced) {
      const budget = refresh ? refresh * step : 1000 / 60;
      lateAvg += (interval / budget - lateAvg) * .06;
      if (step !== pace) { /* calm pacing: nothing to learn about interactive speed */ }
      else if (refresh && refresh * (pace + 1) <= PACE_MAX) {
        if (lateAvg > 1.3 && now - paceAt > 1500) { pace += 1; paceAt = now; lateAvg = 1; }
      } else scene.adapt(interval, budget, now);
    }
    if (auto && !paused) {
      // Keep native scroll in sync so stopping auto travel never jumps backward.
      target = clamp(target + dt / 75000 * (monitors.focused >= 0 ? .18 : 1));
      autoTop = target * maxScroll();
      window.scrollTo({ top: autoTop, behavior: 'instant' });
      if (target >= 1) { auto = false; controls(); }
    }
    // Travel always follows the visitor; pausing only freezes ambient animation.
    camera = reduced ? target : camera + (target - camera) * (1 - Math.exp(-dt / 140));
    if (Math.abs(camera - target) < .000005) camera = target;
    const ease = reduced ? 1 : 1 - Math.exp(-dt / 100);
    look += (lookTarget - look) * ease; pitch += (pitchTarget - pitch) * ease;
    if (Math.abs(look - lookTarget) < .00001) look = lookTarget;
    if (Math.abs(pitch - pitchTarget) < .00001) pitch = pitchTarget;
    const changing = Math.abs(camera - target) > .00001 || look !== lookTarget || pitch !== pitchTarget;
    if (!paused) time += dt / 1000;
    const settling = monitors.candidate !== monitors.focused || monitors.items.some(m => m.opening > .001 && m.opening < .999);
    if (dirty || !paused || changing || settling) {
      scene.lookYaw = look; scene.lookPitch = pitch;
      const t0 = performance.now();
      scene.render(camera, time);
      monitors.hidden = scenery;
      monitors.update(dt, reduced);
      monitors.drawStands();
      renderMs += (performance.now() - t0 - renderMs) * .1;
      ui(); dirty = false;
    }
    chained = !paused || changing || settling;
    if (chained) wake();
    costs[costAt++ % costs.length] = performance.now() - begin;
  }
  function stopAuto() { auto = false; controls(); }
  function go(index) {
    stopAuto();
    const station = monitors.items[clamp(Number(index), 0, 3)].station;
    window.scrollTo({ top: station * maxScroll(), behavior: reduced ? 'instant' : 'smooth' });
  }
  function aim(yaw, up = pitchTarget) {
    lookTarget = clamp(yaw, -maxLook, maxLook);
    pitchTarget = clamp(up, -maxDown, maxUp);
    dirty = true; wake();
  }
  function toggleAuto() {
    auto = !auto;
    if (auto) {
      paused = false; reduced = false;
      if (target >= .999) { target = 0; camera = 0; window.scrollTo(0, 0); }
      autoTop = target * maxScroll();
    }
    controls(); dirty = true; last = 0; wake();
  }
  // The pointer steers only between the header and the travel bar.
  function measureBand() {
    const top = document.querySelector('.masthead').getBoundingClientRect().bottom;
    const bottom = document.querySelector('.travel-bar').getBoundingClientRect().top;
    band = { top, bottom: Math.max(top + 40, bottom) };
  }
  $('autoButton').addEventListener('click', toggleAuto);
  $('motionButton').addEventListener('click', () => {
    paused = !paused;
    if (paused) stopAuto(); else reduced = false;
    controls(); dirty = true; wake();
  });
  $('sceneryButton').addEventListener('click', () => {
    scenery = !scenery;
    document.body.classList.toggle('scenery', scenery);
    $('sceneContent').inert = scenery;
    controls(); dirty = true; wake();
  });
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', e => {
    e.preventDefault(); go(button.dataset.go);
  }));
  const onControl = target => target instanceof Element && target.closest('.masthead,.travel-bar');
  // Any input ends calm pacing at once.
  for (const type of ['pointermove', 'pointerdown', 'wheel', 'scroll', 'keydown'])
    window.addEventListener(type, () => { inputAt = performance.now(); }, { passive: true, capture: true });
  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') {
      if (touch && event.pointerId === touch.id)
        aim(touch.look + (event.clientX - touch.x) / innerWidth * 1.9, touch.pitch - (event.clientY - touch.y) / innerHeight * 1.2);
      return;
    }
    // A mouse turns the page into free look: the cursor hides and a centre crosshair aims.
    if (!aiming) { aiming = true; document.body.classList.add('aim-mode'); }
    const over = !!onControl(event.target);
    if (over !== overControls) { overControls = over; dirty = true; wake(); }
    if (over) return;
    monitors.keyboard = -1;
    // Absolute mapping: where the pointer sits in the scene is where the camera looks.
    // Right looks right, up looks up; the crosshair stays in the middle of the screen.
    const v = clamp((event.clientY - band.top) / (band.bottom - band.top)) * 2 - 1;
    aim((event.clientX / innerWidth * 2 - 1) * maxLook, v < 0 ? -v * maxUp : -v * maxDown);
  }, { passive: true });
  window.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || onControl(event.target)) return;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, look: lookTarget, pitch: pitchTarget };
    monitors.keyboard = -1;
  }, { passive: true });
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { touch = null; }, { passive: true });
  // With the cursor hidden, a click acts on whatever link sits under the crosshair.
  window.addEventListener('click', event => {
    if (!aiming || onControl(event.target) || event.target.closest?.('a')) return;
    const link = monitors.aimedLink;
    if (link) { event.preventDefault(); link.click(); }
  });
  window.addEventListener('wheel', () => { if (auto) stopAuto(); }, { passive: true });
  window.addEventListener('scroll', () => {
    // A scroll the auto driver did not make (touch, keys, scrollbar) hands travel back.
    if (auto && Math.abs(scrollY - autoTop) > 3) stopAuto();
    if (!auto) target = clamp(scrollY / maxScroll());
    dirty = true; wake();
  }, { passive: true });
  monitors.items.forEach(item => item.element.addEventListener('focus', event => {
    if (event.target !== item.element) return;
    monitors.keyboard = item.index;
    const dx = item.anchor.x - scene.cameraX, dz = item.anchor.z - scene.camera;
    // Face the screen and put the crosshair on the middle of its opened panel.
    const up = Math.atan2(monitors.openMiddle(item) - 3.6, Math.hypot(dx, dz)) - Math.atan((scene.baseHorizon - scene.aimY) / scene.focal);
    aim(Math.atan2(dx, dz) - scene.heading, up);
  }));
  document.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); monitors.keyboard = -1;
      aim(lookTarget + (event.key === 'ArrowRight' ? .12 : -.12));
    }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); go(event.key === 'Home' ? 0 : 3); }
    if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); toggleAuto(); }
  });
  window.addEventListener('resize', () => {
    scene.resize(); monitors.measure(); measureBand(); measureScroll();
    // The window may now sit on a screen with another refresh rate: estimate again.
    refresh = 0; pace = 1; lateAvg = 1; ticks.length = 0; tickCount = 0;
    target = clamp(scrollY / maxScroll()); dirty = true; wake();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else { last = 0; dirty = true; wake(); }
  });
  reducedQuery.addEventListener('change', event => {
    reduced = event.matches; paused = reduced; stopAuto(); measureScroll(); dirty = true; wake();
  });
  scene.onready = () => { dirty = true; wake(); };
  // Read-only diagnostics used by local regression checks; no user data or APIs.
  window.__routeDiagnostics = () => ({ progress: target, camera, look, lookTarget, pitch, pitchTarget, auto, paused, time,
    view: { x: scene.cameraX, z: scene.camera, yaw: scene.yaw, heading: scene.heading, pitch: scene.pitch, focal: scene.focal,
      horizon: scene.horizon, baseHorizon: scene.baseHorizon, aimX: scene.aimX, aimY: scene.aimY },
    aiming, reticle: reticleState, aimedLink: monitors.aimedLink?.href || null, renderMs, band,
    costs: Array.from(costs.slice(0, Math.min(costAt, costs.length))), dpr: scene.dpr, refresh, pace,
    gaps: Array.from(gaps.slice(0, Math.min(gapAt, gaps.length))), renders: window.__roadRenderCount || 0,
    skyPaints: scene.skyPaints, skyReady: scene.skyReady, skyLayout: scene.skyLayout, monitors: monitors.snapshot(),
    roadPoint: scene.projectWorld(scene.center(90), 0, 90) });
  window.__skySample = (axis, at) => scene.sky.sample(axis, at);
  measureBand(); measureScroll();
  target = clamp(scrollY / maxScroll()); controls(); wake();
})();
