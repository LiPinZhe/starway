/* 2.5D road environment. sky-panorama.js supplies the panoramic sky; this
   canvas adds bright stars and planets, mid-distance pylons and rings, and the
   road with its light effects, all through one camera with yaw and pitch.
   Pitch is a vertical horizon shift, shared by the CSS monitor matrices.
   Performance (measured, work/road-design/perf): strokes wider than one device
   pixel are Canvas 2D's slow path, so every line here is either a hairline
   (exactly one device pixel) or a filled strip built in world space; fills,
   fillRect runs and a few sprites are cheap. The backing store follows a pixel
   budget that is probed downwards only if frames stay long and it helps.
   No external libraries, requests, inference, or API credentials. */
(() => {
  'use strict';
  const TAU = Math.PI * 2, NEAR = .8, NO_SKIP = new Set(), BUDGET = 2.2e6;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // Arrival timeline (seconds): out of hyperspace, then a power front lights the road from near to far.
  const BOOT_END = 2.4;
  const mod = (n, d) => ((n % d) + d) % d;
  const toNear = (a, b) => { const t = (NEAR - a.z) / (b.z - a.z); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR }; };
  let seed = 290927;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  // Road sample depths: dense near the camera, sparse towards the horizon.
  const STEPS = [];
  for (let d = -30; d <= 246; d += d < 20 ? 2 : d < 80 ? 3 : 6) STEPS.push(d);
  // Offset an open 2D polyline sideways (normals averaged at the joints).
  const offset2 = (pts, t) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - (b[1] - a[1]) / l * t, p[1] + (b[0] - a[0]) / l * t];
  });
  // Gate outlines in their own vertical plane (x across the road, y up), and filled bodies.
  const ARCH = Array.from({ length: 41 }, (_, i) => { const a = Math.PI - i / 40 * Math.PI; return [Math.cos(a) * 11.2, Math.sin(a) * 11.8]; });
  const FRAME = [[-11, 0], [-11, 7.4], [-8.4, 10.6], [8.4, 10.6], [11, 7.4], [11, 0]];
  const ARCH_BODY = offset2(ARCH, .28).concat(offset2(ARCH, -.28).reverse());
  const FRAME_BODY = offset2(FRAME, .22).concat(offset2(FRAME, -.22).reverse());
  const BAR = [[-6, 10.3], [6, 10.3], [6, 10.1], [-6, 10.1]];
  // Radial glow sprites, drawn scaled with globalAlpha instead of per-frame gradients.
  const SPRITES = new Map();
  function glow(rgb, core = false) {
    const key = rgb + core;
    if (!SPRITES.has(key)) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, `rgba(${rgb},1)`); if (core) rg.addColorStop(.1, `rgba(${rgb},.4)`); rg.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64); SPRITES.set(key, cv);
    }
    return SPRITES.get(key);
  }
  const AMBER = '236,170,100', WARM = '255,210,150', COOL = '150,180,196', GOLD = '255,229,172';

  class RoadScene {
    constructor(canvas, skyCanvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      window.__roadSkyReady = false;
      this.sky = new SkyPanorama(skyCanvas);
      this.sky.onready = () => { window.__roadSkyReady = true; this.onready?.(); };
      this.routeLength = 180;
      this.lookYaw = 0; this.lookPitch = 0; this.pitch = 0; this.yaw = 0;
      this.stepCenter = new Float64Array(STEPS.length);
      this.camera = 0; this.cameraX = this.center(0);
      this.velocity = 0; this.lastCamera = 0; this.lastClock = 0;
      this.frameAvg = 16.7; this.lastAdapt = 0; this.probe = null; this.locked = false;
      // Effects state: boot clock (journey.js advances it), hyperspace factor, lit reach of the road.
      this.boot = BOOT_END; this.bootEnd = BOOT_END; this.calm = false;
      this.warp = 0; this.speedWarp = 0; this.warpDir = 1; this.reach = 250; this.skyBright = 1; this.far = 1; this.foeX = 0;
      // Sorted by colour so each run shares one fill style.
      this.points = Array.from({ length: 1650 }, () => ({ x: (random() * 2 - 1) * 8.1, z: random() * 262, r: .012 + random() * .028, light: random() }))
        .sort((a, b) => (a.light > .84) - (b.light > .84));
      this.dust = Array.from({ length: 420 }, () => ({ x: (random() * 2 - 1) * 34, y: -5 + random() * 18, z: random() * 200, r: random(), drift: random() * TAU }));
      this.pylons = [];
      for (let z = -70; z < 540; z += 24 + random() * 22) {
        this.pylons.push({ z, side: random() > .5 ? 1 : -1, off: 44 + random() * 120, height: 18 + random() * 62, width: 2.6 + random() * 4.2,
          bands: Array.from({ length: 2 + Math.floor(random() * 3) }, () => random()), blink: random() * TAU, rate: .35 + random() * .5 });
      }
      this.rings = [
        { x: -300, y: 46, z: 250, r: 66, spin: .018 },
        { x: 380, y: 64, z: 260, r: 88, spin: -.012 },
      ].map(r => {
        const n = [-r.x, 150, -r.z * .35], l = Math.hypot(...n), nn = n.map(v => v / l);
        const e1 = [nn[2], 0, -nn[0]].map(v => v / Math.hypot(nn[2], nn[0]));
        const e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
        const band = r.r * .035;
        const pts = [r.r + band, r.r - band, r.r].map(k => Array.from({ length: 65 }, (_, i) => {
          const a = i / 64 * TAU, ca = Math.cos(a) * k, sa = Math.sin(a) * k;
          return [r.x + e1[0] * ca + e2[0] * sa, r.y + e1[1] * ca + e2[1] * sa, r.z + e1[2] * ca + e2[2] * sa];
        }));
        return { ...r, e1, e2, pts };
      });
      this.resize();
    }
    resize() {
      this.w = window.innerWidth; this.h = window.innerHeight;
      this.mobile = this.w < 761;
      this.maxScale = Math.min(window.devicePixelRatio || 1, 1.5);
      this.budget = BUDGET; this.probe = null; this.locked = false;
      this.applyScale();
      this.shortView = this.w > this.h && this.h < 550;
      this.baseFocal = this.focal = Math.min(this.w * 1.1, this.h * .94);
      this.sky.pxPerRad = Math.min(this.dpr, 1) * .85 * this.baseFocal; // sizes the panorama texture
      this.baseHorizon = this.h * (this.shortView ? .75 : this.mobile ? .51 : .47);
      this.vanX = this.w * .5;
      this.aimX = this.w / 2; this.aimY = this.h / 2;
      this.horizon = this.baseHorizon + this.focal * Math.tan(this.pitch);
    }
    // Backing-store scale from the pixel budget, never above the screen's own ratio.
    // The sky holds only soft nebulae, so it renders at a lower scale still.
    applyScale() {
      const scale = Math.round(Math.sqrt(this.budget / (this.w * this.h)) * 20) / 20;
      this.dpr = clamp(scale, .75, this.maxScale);
      this.hair = .98 / this.dpr; // one device pixel: Canvas 2D's fast hairline path
      this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.sky.resize(this.w, this.h, Math.min(this.dpr, 1) * .85);
    }
    // Fed with every drawn-frame interval and its budget. Sustained long frames try a smaller
    // backing store; if that does not help, the old size returns and stays.
    adapt(interval, budget, now) {
      if (window.__fixedScale || this.locked) return; // (flag: profiling aid only)
      this.frameAvg += (clamp(interval, 0, 100) - this.frameAvg) * .06;
      if (this.probe && now - this.probe.at > 1500) {
        if (this.frameAvg > this.probe.before * .9) { this.budget = this.probe.budget; this.applyScale(); this.locked = true; }
        this.probe = null; this.lastAdapt = now;
      }
      if (this.probe || now - this.lastAdapt < 1500 || this.frameAvg < budget * 1.3 || this.dpr <= .75) return;
      this.probe = { at: now, before: this.frameAvg, budget: this.budget };
      this.budget *= .8; this.applyScale();
    }
    get skyPaints() { return this.sky.paints; }
    get skyReady() { return this.sky.ready; }
    get skyLayout() { return this.sky.mode; }
    // Road centre line. Consecutive calls often repeat one depth (every point of a gate outline,
    // both ends of a seam), so the last value is kept; along() reads a per-frame table instead.
    center(z) {
      if (z !== this.lastZ) { this.lastZ = z; this.lastC = Math.sin(z * .013) * 2.6 + Math.sin(z * .033) * .6; }
      return this.lastC;
    }
    setCamera(progress) {
      this.camera = progress * this.routeLength;
      this.cameraX = this.center(this.camera);
      this.heading = Math.atan2(this.center(this.camera + 28) - this.cameraX, 28);
      this.yaw = this.heading + this.lookYaw;
      this.pitch = this.lookPitch;
      this.cosYaw = Math.cos(this.yaw); this.sinYaw = Math.sin(this.yaw);
      this.horizon = this.baseHorizon + this.focal * Math.tan(this.pitch);
      for (let i = 0; i < STEPS.length; i++) this.stepCenter[i] = this.center(this.camera + STEPS[i]);
    }
    toCamera(worldX, worldZ) {
      const dx = worldX - this.cameraX, dz = worldZ - this.camera;
      return { x: dx * this.cosYaw - dz * this.sinYaw, z: dx * this.sinYaw + dz * this.cosYaw };
    }
    // Camera space: x right, y = drop below the eye (eye height 3.6), z forward.
    cam(worldX, elevation, worldZ) { const p = this.toCamera(worldX, worldZ); p.y = 3.6 - elevation; return p; }
    rp(x, elevation, d) { const z = this.camera + d; return this.cam(x + this.center(z), elevation, z); }
    screen(p) { const s = this.focal / p.z; return { x: this.vanX + p.x * s, y: this.horizon + p.y * s, scale: s, depth: p.z }; }
    projectWorld(worldX, elevation, worldZ) {
      const p = this.toCamera(worldX, worldZ), scale = this.focal / Math.max(.7, p.z);
      return { x: this.vanX + p.x * scale, y: this.horizon + (3.6 - elevation) * scale, scale, depth: p.z };
    }
    project(x, elevation, depth) { const worldZ = this.camera + depth; return this.projectWorld(x + this.center(worldZ), elevation, worldZ); }
    // Samples along the road; while the road powers on, nothing beyond the lit reach exists yet.
    along(x, elevation, from = -30, to = 246) {
      const pts = [], end = Math.min(to, this.reach), cs = this.stepCenter;
      for (let i = 0; i < STEPS.length; i++) {
        const d = STEPS[i]; if (d > end) break;
        if (d >= from) pts.push(this.cam(x + cs[i], elevation, this.camera + d));
      }
      if (end < to && end > from) pts.push(this.rp(x, elevation, end));
      return pts;
    }
    // Boot timeline and hyperspace. Fast travel (a flick of the wheel, a jump between stops)
    // widens the view by up to 13% and streaks the stars; it eases back once travel slows.
    effects(dt) {
      const b = this.boot;
      this.skyBright = smooth(0, .8, b);
      this.far = smooth(1.2, 2.3, b);
      this.reach = b >= BOOT_END ? 250 : -30 + 280 * clamp((b - .45) / 1.55, 0, 1) ** 1.6;
      const arrive = (1 - clamp(b / 1.35, 0, 1)) ** 2, want = this.calm ? 0 : smooth(26, 95, Math.abs(this.velocity));
      this.speedWarp += (want - this.speedWarp) * clamp(dt * (want > this.speedWarp ? 8 : 3.3), 0, 1);
      if (this.speedWarp < .01 && want === 0) this.speedWarp = 0;
      this.warp = this.calm ? 0 : Math.max(arrive, this.speedWarp);
      this.warpDir = arrive >= this.speedWarp ? 1 : Math.sign(this.velocity) || 1;
      if (window.__hold?.warp != null) { this.warp = window.__hold.warp; this.warpDir = 1; } // capture aid only
      this.focal = this.baseFocal * (1 - .13 * this.warp * (2 - this.warp));
    }
    // Polyline through camera-space points, clipped at the near plane (adds to the current path).
    trace(pts) {
      const c = this.ctx; let pen = false;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        if (a.z >= NEAR) {
          const s = this.screen(a);
          if (pen) c.lineTo(s.x, s.y);
          else if (i) { const q = this.screen(toNear(pts[i - 1], a)); c.moveTo(q.x, q.y); c.lineTo(s.x, s.y); }
          else c.moveTo(s.x, s.y);
          pen = true;
        } else if (pen) { const q = this.screen(toNear(pts[i - 1], a)); c.lineTo(q.x, q.y); pen = false; }
      }
    }
    // Strokes the current path as a one-device-pixel hairline.
    hairStroke(color) { const c = this.ctx; c.strokeStyle = color; c.lineWidth = this.hair; c.stroke(); }
    hairline(pts, color) { this.ctx.beginPath(); this.trace(pts); this.hairStroke(color); }
    // Closed polygon clipped at the near plane; leaves the path ready to fill.
    shape(pts) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (a.z >= NEAR) out.push(a);
        if ((a.z >= NEAR) !== (b.z >= NEAR)) out.push(toNear(a, b));
      }
      if (out.length < 3) return false;
      const c = this.ctx; c.beginPath();
      out.forEach((p, i) => { const s = this.screen(p); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
      c.closePath(); return true;
    }
    fillShape(pts, color) { if (this.shape(pts)) { this.ctx.fillStyle = color; this.ctx.fill(); } }
    // A strip lying along the road between lateral offsets x0 and x1.
    ribbon(x0, x1, elevation, from, to) { return this.shape(this.along(x0, elevation, from, to).concat(this.along(x1, elevation, from, to).reverse())); }
    // A short lit segment on the road surface, as a filled quad.
    dash(x, half, elevation, d0, d1) { return this.shape([this.rp(x - half, elevation, d0), this.rp(x + half, elevation, d0), this.rp(x + half, elevation, d1), this.rp(x - half, elevation, d1)]); }
    // Points of a shape given in a gate's vertical plane at road depth d.
    plane(pts, d) { return pts.map(([x, y]) => this.rp(x, y, d)); }
    // A glow sprite centred on a camera-space point.
    sprite(img, p, radius, alpha) {
      if (p.z < NEAR || alpha < .005) return;
      const s = this.screen(p);
      if (s.x + radius < 0 || s.x - radius > this.w || s.y + radius < 0 || s.y - radius > this.h) return;
      this.ctx.globalAlpha = alpha; this.ctx.drawImage(img, s.x - radius, s.y - radius, radius * 2, radius * 2);
    }
    // Soft light pool lying on the deck: a sprite squashed to the ground's perspective.
    pool(x, d, rx, rz, rgb, alpha) {
      const p = this.rp(x, 0, d); if (p.z < NEAR + 1 || alpha < .005) return;
      const s = this.screen(p), sx = rx * s.scale, sy = Math.max(1, 3.6 * this.focal * rz / (p.z * p.z));
      if (s.x + sx < 0 || s.x - sx > this.w || s.y + sy < 0 || s.y - sy > this.h) return;
      this.ctx.globalAlpha = alpha; this.ctx.drawImage(glow(rgb), s.x - sx, s.y - sy, sx * 2, sy * 2);
    }
    drawMonitorStand(anchor, focused, side = 1) {
      const c = this.ctx, foot = this.cam(anchor.x, 0, anchor.z), hinge = this.cam(anchor.x, anchor.height, anchor.z);
      if (foot.z < 2 || foot.z > 190 || anchor.z - this.camera > this.reach) return;
      const alpha = clamp(1.15 - foot.z / 230, .12, .95);
      // A small bay bolted to the road edge carries each display.
      const bay = [[-4.8, -2.3], [1.8, -2.3], [2.8, -1.3], [2.8, 1.3], [1.8, 2.3], [-4.8, 2.3]]
        .map(([x, z]) => this.cam(anchor.x + side * x, 0, anchor.z + z));
      if (this.shape(bay)) { c.fillStyle = `rgba(9,14,21,${(.72 * alpha + .2).toFixed(2)})`; c.fill(); this.hairStroke(`rgba(160,178,188,${(alpha * .32).toFixed(2)})`); }
      c.globalCompositeOperation = 'lighter';
      this.pool(anchor.x - this.center(anchor.z), anchor.z - this.camera, 2.2, 1.6, focused ? '232,196,150' : COOL, focused ? .3 : .13);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      // The post: a thin filled column facing the camera, with a light hairline down its middle.
      const across = this.cosYaw * .1, deep = -this.sinYaw * .1;
      this.fillShape([this.cam(anchor.x - across, 0, anchor.z - deep), this.cam(anchor.x + across, 0, anchor.z + deep),
        this.cam(anchor.x + across, anchor.height, anchor.z + deep), this.cam(anchor.x - across, anchor.height, anchor.z - deep)], '#1a2630');
      this.hairline([foot, hinge], `rgba(168,190,196,${(alpha * .75).toFixed(2)})`);
      const hs = this.screen(hinge), radius = clamp(hs.scale * .13, 1, 4);
      c.fillStyle = focused ? '#e8cba8' : '#9db4bf';
      c.fillRect(hs.x - radius, hs.y - radius, radius * 2, radius * 2);
    }
    render(progress, time) {
      window.__roadRenderCount = (window.__roadRenderCount || 0) + 1;
      const c = this.ctx, { w, h } = this;
      const skip = window.__skipLayers || NO_SKIP; // profiling aid only
      const clock = performance.now() / 1000, dt = this.lastClock ? clamp(clock - this.lastClock, 0, .1) : 0, at = progress * this.routeLength;
      if (dt > 0) this.velocity += ((at - this.lastCamera) / dt - this.velocity) * clamp(dt * 8, 0, 1);
      this.lastClock = clock; this.lastCamera = at;
      this.effects(dt);
      this.setCamera(progress);
      // Focus of expansion: where the road heading sits on screen; hyperspace rays leave from here.
      this.foeX = this.vanX - this.focal * Math.tan(this.lookYaw);
      if (!skip.has('sky')) this.sky.render({ w, h, yaw: this.yaw, vanX: this.vanX, horizon: this.horizon, focal: this.focal,
        time, bright: this.skyBright, warp: this.warp * this.warpDir, foe: this.foeX });
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      c.clearRect(0, 0, w, h);
      if (!skip.has('bodies')) this.sky.drawBodies(c, this, time);
      if (!skip.has('rings')) this.drawRings(time);
      if (!skip.has('pylons')) this.drawPylons(time);
      if (!skip.has('deck')) this.drawDeck(time);
      if (!skip.has('rails')) this.drawRails(time);
      if (this.reach < 246) this.drawFront();
      if (!skip.has('gates')) this.drawGates(time);
      if (!skip.has('particles')) this.drawParticles();
      if (!skip.has('dust')) this.drawDust(time);
      if (!skip.has('horizon')) this.drawHorizon();
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    }
    drawRings(time) {
      const c = this.ctx, far = this.far; if (far <= 0) return;
      for (const r of this.rings) {
        const mid = this.cam(r.x, r.y, r.z); if (mid.z < 20) continue;
        // The ring's body is an annulus in its own plane: two circles, filled even-odd.
        const [outer, inner, pts] = r.pts.map(ring => ring.map(([x, y, z]) => this.cam(x, y, z)));
        // Filled only when wholly in front of the camera (the hairline below clips itself).
        c.globalAlpha = far;
        if (outer.every(p => p.z > NEAR)) {
          c.beginPath();
          for (const ring of [outer, inner]) ring.forEach((p, i) => { const s = this.screen(p); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
          c.fillStyle = 'rgba(14,20,29,.92)'; c.fill('evenodd');
        }
        this.hairline(pts, 'rgba(150,168,184,.22)');
        c.fillStyle = 'rgb(236,192,128)';
        for (let i = 0; i < 16; i++) {
          const p = pts[Math.floor(mod(i * 4 + time * r.spin * 64 / TAU * 4, 64))];
          if (p.z < NEAR) continue;
          const q = this.screen(p), sz = clamp(q.scale * .9, .8, 2.2);
          c.globalAlpha = far * (.34 + .41 * Math.max(0, Math.sin(time * 1.3 + i * 1.7))); c.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz);
        }
        c.globalAlpha = 1;
      }
    }
    drawPylons(time) {
      const c = this.ctx, list = [], beacons = []; if (this.far <= 0) return;
      c.globalAlpha = this.far;
      for (const p of this.pylons) {
        const x = this.center(p.z) + p.side * p.off, q = this.cam(x, 0, p.z);
        if (q.z > -8 && q.z < 560) list.push({ p, x, dist: q.z });
      }
      list.sort((a, b) => b.dist - a.dist);
      for (const { p, x, dist } of list) {
        const half = p.width / 2, ix = x - p.side * half, ox = x + p.side * half, fz = p.z - half, bz = p.z + half;
        const top = p.height, low = -38, fade = clamp(1.3 - dist / 480, .3, 1);
        const faces = [[[ix, fz], [ix, bz]]];
        if (this.camera < fz) faces.push([[ox, fz], [ix, fz]]); else if (this.camera > bz) faces.push([[ix, bz], [ox, bz]]);
        for (const [[x0, z0], [x1, z1]] of faces) {
          const quad = [this.cam(x0, top, z0), this.cam(x1, top, z1), this.cam(x1, low, z1), this.cam(x0, low, z0)];
          if (!this.shape(quad)) continue;
          const lit = z0 === z1 ? '30,38,50' : '21,28,38';
          if (dist < 260) {
            // Near towers fade into the void below; far ones are too small to need it.
            const t = this.screen(this.cam(x, top, p.z)), b = this.screen(this.cam(x, low * .4, p.z));
            const g = c.createLinearGradient(0, t.y, 0, Math.max(t.y + 1, b.y));
            g.addColorStop(0, `rgba(${lit},.96)`); g.addColorStop(.72, `rgba(${lit},.9)`); g.addColorStop(1, `rgba(${lit},0)`);
            c.fillStyle = g;
          } else c.fillStyle = `rgba(${lit},.9)`;
          c.fill();
        }
        const edgeZ = this.camera < fz ? fz : bz;
        this.hairline([this.cam(ix, top, edgeZ), this.cam(ix, top * .15, edgeZ)], `rgba(228,176,112,${(.55 * fade).toFixed(2)})`);
        c.beginPath();
        for (const band of p.bands) { const y = top * (.22 + band * .7); this.trace([this.cam(ox, y, edgeZ), this.cam(ix, y, edgeZ), this.cam(ix, y, edgeZ === fz ? bz : fz)]); }
        this.hairStroke(`rgba(168,196,212,${(.26 * fade).toFixed(2)})`);
        beacons.push(this.cam(x, top + .8, p.z), .2 + .7 * Math.max(0, Math.sin(time * p.rate * TAU + p.blink)) ** 3);
      }
      const img = glow('255,184,124');
      for (let i = 0; i < beacons.length; i += 2) this.sprite(img, beacons[i], 7, beacons[i + 1] * this.far);
      c.globalAlpha = 1;
    }
    drawDeck(time) {
      const c = this.ctx;
      if (this.ribbon(-8.5, 8.5, 0)) {
        const g = c.createLinearGradient(0, this.horizon, 0, this.horizon + this.h * .9);
        g.addColorStop(0, 'rgba(40,31,26,.36)'); g.addColorStop(.3, 'rgba(14,16,23,.8)'); g.addColorStop(1, 'rgba(6,9,15,.93)');
        c.fillStyle = g; c.fill();
      }
      // Transverse seams fixed in the world, batched into distance bands.
      for (const [d0, d1, a] of [[-20, 50, .14], [50, 110, .09], [110, 200, .045]]) {
        c.beginPath();
        for (let z = Math.ceil((this.camera + d0) / 6) * 6; z < this.camera + Math.min(d1, this.reach); z += 6) { const d = z - this.camera; this.trace([this.rp(-8.5, 0, d), this.rp(8.5, 0, d)]); }
        this.hairStroke(`rgba(176,140,102,${a})`);
      }
      c.globalCompositeOperation = 'lighter';
      // Centre energy spine: a soft band with a hot core, fading out towards the camera.
      const fadeSpine = (a0, a1) => {
        const g = c.createLinearGradient(0, this.horizon, 0, this.horizon + this.h * .38);
        g.addColorStop(0, `rgba(230,160,86,${a0})`); g.addColorStop(.4, `rgba(230,160,86,${a1})`); g.addColorStop(1, 'rgba(230,160,86,0)');
        return g;
      };
      if (this.ribbon(-.8, .8, .01, 3, 240)) { c.fillStyle = fadeSpine(.07 + .015 * Math.sin(time * 1.3), .025); c.fill(); }
      if (this.ribbon(-.16, .16, .01, 3, 240)) { c.fillStyle = fadeSpine(.16, .06); c.fill(); }
      // Lane dividers: dashes fixed in the world, grouped by distance band.
      for (const [d0, d1, a] of [[-20, 45, .3], [45, 110, .19], [110, 210, .1]]) {
        c.beginPath();
        for (let z = Math.ceil((this.camera + d0) / 5) * 5; z < this.camera + Math.min(d1, this.reach); z += 5)
          for (const x of [-4.25, 4.25]) this.trace([this.rp(x, .01, z - this.camera), this.rp(x, .01, z - this.camera + 1.8)]);
        this.hairStroke(`rgba(178,202,214,${a})`);
      }
      // Chevrons point down the road; a travelling wave lights a few of them as filled strokes.
      c.beginPath();
      const lit = [];
      for (let z = Math.ceil((this.camera + 3) / 9) * 9; z < this.camera + Math.min(150, this.reach); z += 9) {
        const d = z - this.camera, wave = Math.max(0, Math.sin(z * .23 - time * 3.2)) ** 6;
        if (wave > .12) lit.push(d, (.07 + wave * .55) * clamp(1.1 - d / 150, 0, 1), .05 + wave * .07);
        else this.trace([this.rp(-1.3, .02, d), this.rp(0, .02, d + 1.3), this.rp(1.3, .02, d)]);
      }
      this.hairStroke('rgba(255,198,130,.08)');
      c.fillStyle = 'rgb(255,198,130)';
      for (let i = 0; i < lit.length; i += 3) {
        const d = lit[i], t = lit[i + 2];
        if (this.shape([this.rp(-1.3 - t, .02, d), this.rp(0, .02, d + 1.3 + t * 1.4), this.rp(1.3 + t, .02, d), this.rp(1.3 - t, .02, d),
          this.rp(0, .02, d + 1.3 - t * 1.4), this.rp(-1.3 + t, .02, d)])) { c.globalAlpha = lit[i + 1]; c.fill(); }
      }
      // Data pulses race along the spine, each with a fading tail of widening quads.
      c.fillStyle = 'rgb(255,222,176)';
      const base = this.camera - 12;
      for (let i = 0; i < 6; i++) {
        const z = base + mod(i * 41 + time * 34 - base, 250), d = z - this.camera;
        if (d < -10 || d > Math.min(235, this.reach)) continue;
        const fade = clamp(1.1 - d / 230, 0, 1);
        for (let k = 0; k < 3; k++) if (this.dash(0, .04 + k * .035, .02, d - 7 + k * 2.4, d - 4.8 + k * 2.4)) { c.globalAlpha = (.18 + k * .3) * fade; c.fill(); }
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    drawRails(time) {
      const c = this.ctx;
      c.globalCompositeOperation = 'lighter';
      for (const side of [-1, 1]) {
        // The glow is a luminous strip on the deck (wider near, thinner far), not a wide stroke.
        const x = side * 8.5;
        if (this.ribbon(x - .24, x + .24, .005)) { c.fillStyle = 'rgba(236,158,72,.075)'; c.fill(); }
        if (this.ribbon(x - .06, x + .06, .01)) { c.fillStyle = 'rgba(246,186,112,.34)'; c.fill(); }
      }
      c.globalCompositeOperation = 'source-over';
      for (const side of [-1, 1]) {
        this.hairline(this.along(side * 8.5, .02), 'rgba(250,196,124,.92)');
        this.hairline(this.along(side * 7.7, .01, -30, 240), 'rgba(226,170,110,.3)');
        // Low guard rail with posts, replacing the old free-standing light bars.
        this.hairline(this.along(side * 9.5, .8, -30, 236), 'rgba(158,186,202,.32)');
        c.beginPath();
        for (let z = Math.ceil((this.camera - 24) / 6) * 6; z < this.camera + Math.min(150, this.reach); z += 6)
          this.trace([this.rp(side * 9.5, 0, z - this.camera), this.rp(side * 9.5, .8, z - this.camera)]);
        this.hairStroke('rgba(140,166,182,.24)');
      }
      c.globalCompositeOperation = 'lighter';
      for (const side of [-1, 1]) {
        // Chasing nodes on the rail and small lamps on the guard rail: fixed colours, varying alpha.
        const lamps = [];
        c.fillStyle = 'rgb(255,214,172)';
        for (let z = Math.ceil((this.camera - 24) / 6) * 6; z < this.camera + Math.min(170, this.reach); z += 6) {
          const d = z - this.camera, p = this.rp(side * 8.5, .05, d); if (p.z < NEAR + .5) continue;
          const s = this.screen(p); if (s.x < -10 || s.x > this.w + 10 || s.y > this.h + 10) continue;
          const wave = Math.max(0, Math.sin(z * .19 - time * 2.6 + side)) ** 8, fade = clamp(1.1 - d / 170, 0, 1);
          const size = clamp(s.scale * .09, .9, 3.4) * (1 + wave * .6);
          c.globalAlpha = (.2 + wave * .8) * fade; c.fillRect(s.x - size / 2, s.y - size / 2, size, size);
          const lamp = this.rp(side * 9.5, .85, d);
          if (lamp.z > NEAR + .5) lamps.push(this.screen(lamp), (.12 + wave * .4) * fade);
        }
        c.fillStyle = 'rgb(190,220,236)';
        for (let i = 0; i < lamps.length; i += 2) {
          const q = lamps[i], sz = clamp(q.scale * .05, .6, 2);
          c.globalAlpha = lamps[i + 1]; c.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz);
        }
        // Light pulses travel along the edge rails as short widening quads.
        c.fillStyle = 'rgb(255,214,160)';
        const base = this.camera - 16;
        for (let i = 0; i < 5; i++) {
          const z = base + mod(i * 53 + side * 19 + time * 27 - base, 262), d = z - this.camera;
          if (d < -14 || d > Math.min(240, this.reach)) continue;
          const fade = clamp(1.15 - d / 240, 0, 1);
          for (let k = 0; k < 3; k++) if (this.dash(side * 8.5, .05 + k * .04, .02, d - 9 + k * 3, d - 6 + k * 3)) { c.globalAlpha = (.14 + k * .3) * fade; c.fill(); }
        }
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    // The arrival's power front: a bright seam racing down the deck with a faint scanning wall
    // above it and sparks on both rails. Everything behind it is already lit.
    drawFront() {
      const c = this.ctx, R = this.reach; if (R < -6) return;
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
      const base = this.screen(this.rp(0, 0, Math.max(R, 2.5))), wake = this.screen(this.rp(0, 0, Math.max(R - 16, 2)));
      if (this.dash(0, 8.5, .02, R - 16, R)) {
        const g = c.createLinearGradient(0, wake.y, 0, Math.min(wake.y - .5, base.y));
        g.addColorStop(0, 'rgba(255,196,130,0)'); g.addColorStop(1, 'rgba(255,214,160,.26)');
        c.fillStyle = g; c.fill();
      }
      if (this.shape([this.rp(-8.5, 0, R), this.rp(8.5, 0, R), this.rp(8.5, 5.5, R), this.rp(-8.5, 5.5, R)])) {
        const top = this.screen(this.rp(0, 5.5, Math.max(R, 2.5))), g = c.createLinearGradient(0, base.y, 0, Math.min(base.y - .5, top.y));
        g.addColorStop(0, 'rgba(255,206,146,.2)'); g.addColorStop(1, 'rgba(255,206,146,0)');
        c.fillStyle = g; c.fill();
      }
      if (this.dash(0, 8.6, .03, R - .5, R)) { c.fillStyle = 'rgba(255,226,186,.8)'; c.fill(); }
      this.hairline([this.rp(-8.6, .03, R), this.rp(8.6, .03, R)], 'rgba(255,238,210,.95)');
      const spark = glow(WARM, true);
      for (const x of [-8.5, 8.5]) { const p = this.rp(x, .2, R); if (p.z >= NEAR) this.sprite(spark, p, clamp(this.screen(p).scale * 1.4, 3, 60), .95); }
      const mid = this.rp(0, .4, R); if (mid.z >= NEAR) this.sprite(glow(GOLD), mid, clamp(this.screen(mid).scale * 5, 8, 160), .35);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    drawGates(time) {
      const c = this.ctx, list = [];
      for (let z = Math.ceil((this.camera - 10 - 26) / 30) * 30 + 26; z < this.camera + 246; z += 30) list.push({ z, kind: Math.round((z - 26) / 30) % 2 === 0 ? 'arch' : 'frame' });
      for (let z = Math.ceil((this.camera - 10 - 41) / 60) * 60 + 41; z < this.camera + 246; z += 60) list.push({ z, kind: 'ring' });
      for (const g of list) { g.d = g.z - this.camera; g.fade = clamp((g.d + 10) / 22, 0, 1) * clamp(1.15 - g.d / 240, .04, 1); }
      // While the road powers on, gates exist only behind the front and flare as it passes.
      const booting = this.boot < BOOT_END, gates = list.filter(g => g.d < this.reach).sort((a, b) => b.d - a.d);
      for (const g of gates) g.flash = booting ? clamp(1 - (this.reach - g.d) / 45, 0, 1) : 0;
      // Pass 1: structures. Dark bodies are filled outlines in each gate's plane.
      for (const g of gates) {
        const { d, fade } = g;
        if (g.kind === 'ring') {
          // Thin portal ring enclosing the whole road, drawn as turning dashes in one path.
          c.beginPath();
          for (let k = 0; k < 18; k++) {
            const a0 = k / 18 * TAU + time * .35;
            this.trace([0, .5, 1].map(t => { const a = a0 + t * .17; return this.rp(Math.cos(a) * 14.5, 4.4 + Math.sin(a) * 14.5, d); }));
          }
          this.hairStroke(`rgba(170,208,226,${(.24 * fade * (1 + 2 * g.flash)).toFixed(3)})`);
          continue;
        }
        const apex = this.rp(0, g.kind === 'arch' ? 11.8 : 10.6, d); if (apex.z < NEAR) continue;
        g.lit = true;
        if (d < 150) this.fillShape(this.plane(g.kind === 'arch' ? ARCH_BODY : FRAME_BODY, d), `rgba(16,22,31,${(.9 * fade).toFixed(3)})`);
        this.hairline(this.plane(g.kind === 'arch' ? ARCH : FRAME, d), g.kind === 'arch' ? `rgba(236,178,104,${(.6 * fade).toFixed(3)})` : `rgba(218,172,116,${(.55 * fade).toFixed(3)})`);
        if (g.kind === 'frame') this.hairline([this.rp(-8.4, 9.7, d), this.rp(8.4, 9.7, d)], `rgba(150,184,200,${(.34 * fade).toFixed(3)})`);
      }
      // Pass 2: light, all additive.
      c.globalCompositeOperation = 'lighter';
      const warm = glow(WARM);
      for (const g of gates) {
        const { d } = g, fade = g.fade * (1 + 1.8 * g.flash);
        if (!g.lit) continue;
        if (g.kind === 'arch') {
          // Three running lights: short filled sections of the arch body.
          if (d < 170) {
            c.fillStyle = 'rgb(255,214,160)';
            for (let k = 0; k < 3; k++) {
              const i0 = Math.floor(mod(time * .18 + k / 3, 1) * 35), seg = ARCH.slice(i0, i0 + 7);
              if (this.shape(this.plane(offset2(seg, .12).concat(offset2(seg, -.12).reverse()), d))) { c.globalAlpha = .55 * fade; c.fill(); }
            }
          }
        } else {
          if (this.shape(this.plane(BAR, d))) { c.fillStyle = 'rgb(255,226,188)'; c.globalAlpha = .7 * fade; c.fill(); }
          // A faint curtain of light falls from the bar onto the deck.
          if (d > 12 && d < 140 && this.shape([this.rp(-6, 10.2, d), this.rp(6, 10.2, d), this.rp(7.8, 0, d), this.rp(-7.8, 0, d)])) {
            const top = this.screen(this.rp(0, 10.2, d)), bottom = this.screen(this.rp(0, 0, d));
            const grad = c.createLinearGradient(0, top.y, 0, Math.max(top.y + 1, bottom.y));
            grad.addColorStop(0, 'rgba(255,206,150,.11)'); grad.addColorStop(1, 'rgba(255,196,140,0)');
            c.fillStyle = grad; c.globalAlpha = fade; c.fill();
          }
        }
        if (d > 6 && d < 170) this.pool(0, d, 7.5, 3.4, AMBER, .1 * fade * clamp((d - 6) / 20, 0, 1));
        for (const x of [-11.2, 11.2]) { const p = this.rp(x, .2, d); if (p.z >= NEAR) this.sprite(warm, p, clamp(this.screen(p).scale * .35, 1.5, 14), .8 * fade); }
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    drawParticles() {
      const c = this.ctx, step = this.mobile ? 2 : 1, base = this.camera - 20, bright = [];
      c.globalCompositeOperation = 'lighter';
      let hot = -1;
      for (let i = 0; i < this.points.length; i += step) {
        const p = this.points[i], z = base + mod(p.z - base, 262), d = z - this.camera;
        if (d > 190 || d > this.reach) continue; // sub-pixel and faint by here; the horizon glow carries the far end
        if (p.cz !== z) { p.cz = z; p.cx = this.center(z); }
        const q = this.cam(p.x + p.cx, .018, z); if (q.z < 1) continue;
        const pos = this.screen(q); if (pos.y > this.h + 5 || pos.x < -5 || pos.x > this.w + 5) continue;
        const a = (.18 + p.light * .46) * clamp(1 - d / 260, 0, 1), size = clamp(p.r * pos.scale, .25, 2.1);
        const warm = p.light > .84 ? 1 : 0;
        if (warm !== hot) { hot = warm; c.fillStyle = warm ? 'rgb(247,217,163)' : 'rgb(216,139,68)'; }
        c.globalAlpha = a; c.fillRect(pos.x - size, pos.y - size, size * 2, size * 2);
        if (p.light > .99 && size > .65) bright.push(q, size * 4, a * .6);
      }
      const img = glow('247,217,163');
      for (let i = 0; i < bright.length; i += 3) this.sprite(img, bright[i], bright[i + 1], bright[i + 2]);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    drawDust(time) {
      const c = this.ctx, step = this.mobile ? 2 : 1, base = this.camera - 20;
      const span = 6 + 10 * this.warp, streak = clamp(this.velocity * .05, -span, span), moving = Math.abs(streak) > .15;
      // Streaks are hairlines batched per colour and distance band; in hyperspace each streak
      // gets a longer, blueshifted tail.
      const bands = moving ? [0, 1, 2, 3, 4, 5].map(() => new Path2D()) : null, doppler = this.warp > .05 ? new Path2D() : null;
      c.globalCompositeOperation = 'lighter';
      let cool = -1;
      for (let i = 0; i < this.dust.length; i += step) {
        const m = this.dust[i], z = base + mod(m.z - base, 200), d = z - this.camera, y = m.y + Math.sin(time * .3 + m.drift) * .5;
        if (d > this.reach) continue;
        if (m.cz !== z) { m.cz = z; m.cx = this.center(z); }
        const p = this.cam(m.x + m.cx, y, z); if (p.z < 1.2) continue;
        const s = this.screen(p); if (s.x < -20 || s.x > this.w + 20 || s.y < -20 || s.y > this.h + 20) continue;
        const warm = m.r > .8 ? 1 : 0;
        if (moving) {
          const q = this.rp(m.x, y, d + streak);
          if (q.z > NEAR) {
            const e = this.screen(q), path = bands[warm * 3 + (p.z < 40 ? 0 : p.z < 100 ? 1 : 2)]; path.moveTo(s.x, s.y); path.lineTo(e.x, e.y);
            if (doppler) { const r = this.rp(m.x, y, d + streak * (1 + 1.6 * this.warp)); if (r.z > NEAR) { const f = this.screen(r); doppler.moveTo(e.x, e.y); doppler.lineTo(f.x, f.y); } }
            continue;
          }
        }
        if (warm !== cool) { cool = warm; c.fillStyle = warm ? 'rgb(240,214,176)' : 'rgb(170,196,214)'; }
        const size = clamp(s.scale * .035, .5, 2.2);
        c.globalAlpha = (.1 + m.r * .3) * clamp(1.1 - p.z / 180, 0, 1); c.fillRect(s.x - size / 2, s.y - size / 2, size, size);
      }
      if (moving) {
        c.globalAlpha = 1; c.lineWidth = this.hair;
        bands.forEach((path, i) => {
          c.strokeStyle = i < 3 ? `rgba(170,196,214,${[.42, .26, .12][i % 3]})` : `rgba(240,214,176,${[.5, .32, .15][i % 3]})`;
          c.stroke(path);
        });
        if (doppler) { c.strokeStyle = `rgba(130,168,255,${(.45 * this.warp).toFixed(3)})`; c.stroke(doppler); }
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    drawHorizon() {
      const p = this.rp(0, 0, 246); if (p.z < NEAR) return;
      this.ctx.globalCompositeOperation = 'lighter';
      this.sprite(glow(GOLD, true), p, 70, .36 * this.far);
      this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over';
    }
  }
  window.RoadScene = RoadScene;
})();
