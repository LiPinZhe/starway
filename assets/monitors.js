/* Fixed world-space mounts; the screen alone rotates around its bottom hinge.
   A screen opens when the centre crosshair rests on it (or it has keyboard focus). */
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  class RoadMonitors {
    constructor(scene) {
      this.scene = scene;
      this.focused = -1;
      this.candidate = -1;
      this.dwell = 0;
      this.keyboard = -1;
      this.hidden = false;
      this.aimedLink = null;
      this.aim = 'none';
      this.items = [...document.querySelectorAll('.world-sign')].map((element, i) => {
        const station = Number(element.dataset.station);
        const side = Number(element.dataset.side);
        const z = 28 + station * scene.routeLength;
        const anchor = Object.freeze({ x: scene.center(z) + side * 13.2, z, height: 2.5 });
        element.querySelector('.sign-post')?.remove();
        element.querySelector('.sign-action')?.remove();
        const details = element.querySelector('.sign-expand');
        details.inert = true;
        return { element, details, anchor, station, side, index: i, opening: 0,
          rotation: -side * 1.02, width: 292, height: 151, closedHeight: 151, openHeight: 151,
          visible: false, matrix: [], dom: {} };
      });
      this.measure();
    }
    widths() {
      const narrow = this.scene.mobile, short = this.scene.shortView;
      return { closed: narrow ? 264 : 292, open: short ? 560 : narrow ? Math.min(340, this.scene.w - 36) : 382 };
    }
    // Screen heights follow the rendered text, since fonts differ between devices.
    // Runs synchronously inside layout, so no intermediate size is ever painted.
    measure() {
      const { closed, open } = this.widths();
      for (const item of this.items) {
        const el = item.element, summary = el.querySelector('.sign-summary'), cs = getComputedStyle(el);
        const frame = parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        el.style.height = 'auto';
        el.style.width = `${closed}px`;
        item.closedHeight = Math.max(151, Math.ceil(summary.offsetTop + summary.offsetHeight + frame));
        el.style.width = `${open}px`;
        const details = item.details.offsetTop + item.details.offsetHeight + frame;
        item.openHeight = Math.max(item.closedHeight, Math.ceil(Math.max(el.offsetHeight, details)));
        el.style.width = item.dom.width = `${item.width.toFixed(1)}px`;
        el.style.height = item.dom.height = `${item.height.toFixed(1)}px`;
      }
    }
    // World elevation of the middle of an item's fully opened panel.
    openMiddle(item) {
      const unit = this.scene.shortView ? .073 : this.scene.mobile ? .058 : .035;
      return item.anchor.height + item.openHeight * unit / 2;
    }
    // Screen-space corners of an item's last placed quad.
    corners(item) {
      const m = item.matrix;
      return [[0, 0], [item.width, 0], [item.width, item.height], [0, item.height]].map(([x, y]) => {
        const w = m[3] * x + m[7] * y + m[15];
        return { x: (m[0] * x + m[4] * y + m[12]) / w, y: (m[1] * x + m[5] * y + m[13]) / w };
      });
    }
    choose(dt) {
      if (this.hidden) {
        this.focused = this.candidate = this.keyboard = -1;
        this.dwell = 0;
        return;
      }
      const ax = this.scene.aimX, ay = this.scene.aimY;
      let candidate = -1, best = Infinity;
      for (const item of this.items) {
        const p = this.scene.toCamera(item.anchor.x, item.anchor.z);
        if (!item.visible || item.matrix.length !== 16 || p.z <= 7 || Math.hypot(p.x, p.z) >= 67) continue;
        const q = this.corners(item), foot = this.scene.projectWorld(item.anchor.x, 0, item.anchor.z);
        const x0 = Math.min(...q.map(v => v.x)), x1 = Math.max(...q.map(v => v.x));
        const y0 = Math.min(...q.map(v => v.y)), y1 = Math.max(foot.y, ...q.map(v => v.y));
        // The crosshair may rest on the screen or its post; an open screen holds a wider margin.
        const pad = (item.index === this.focused ? .14 : .22) * Math.max(24, x1 - x0) + 10;
        const hit = ax > x0 - pad && ax < x1 + pad && ay > y0 - pad && ay < y1 + pad;
        if (hit || item.index === this.keyboard) {
          const score = item.index === this.keyboard ? -1 : Math.hypot(ax - (x0 + x1) / 2, ay - (y0 + y1) / 2) / Math.max(1, x1 - x0);
          if (score < best) { candidate = item.index; best = score; }
        }
      }
      if (candidate !== this.candidate) { this.candidate = candidate; this.dwell = 0; }
      this.dwell += dt;
      if (candidate === -1 || this.dwell > 160 || candidate === this.keyboard) this.focused = candidate;
    }
    // Which link, if any, sits under the crosshair on the open screen.
    aimLinks() {
      const item = this.items[this.focused], ax = this.scene.aimX, ay = this.scene.aimY;
      let link = null;
      if (item && item.opening > .9) for (const a of item.details.querySelectorAll('a')) {
        const r = a.getBoundingClientRect();
        if (ax >= r.left - 6 && ax <= r.right + 6 && ay >= r.top - 6 && ay <= r.bottom + 6) link = a;
      }
      if (link !== this.aimedLink) { this.aimedLink?.classList.remove('is-aimed'); link?.classList.add('is-aimed'); this.aimedLink = link; }
      this.aim = link ? 'link' : this.focused >= 0 || this.candidate >= 0 ? 'target' : 'none';
    }
    update(dt, instant = false) {
      this.choose(dt);
      const ease = instant ? 1 : 1 - Math.exp(-dt / 170);
      const { closed, open } = this.widths(), short = this.scene.shortView;
      for (const item of this.items) {
        const focused = item.index === this.focused && !this.hidden;
        item.opening += ((focused ? 1 : 0) - item.opening) * ease;
        const face = Math.atan2(this.scene.cameraX - item.anchor.x, item.anchor.z - this.scene.camera);
        const desired = focused ? face : -item.side * 1.02;
        item.rotation += wrap(desired - item.rotation) * ease;
        item.width = closed + (open - closed) * item.opening;
        item.height = item.closedHeight + (item.openHeight - item.closedHeight) * item.opening;
        item.unit = short ? .035 + .038 * item.opening : this.scene.mobile ? .058 : .035;
        this.place(item, focused);
      }
      this.aimLinks();
    }
    // Each value is written only when it differs from the last one written, so a
    // steady screen costs one transform per frame and no style or layout work.
    place(item, focused) {
      const s = this.scene, p = s.projectWorld(item.anchor.x, item.anchor.height, item.anchor.z);
      const el = item.element, st = el.style, dom = item.dom;
      const radius = item.width * item.unit * p.scale;
      const shown = p.depth > 7 && p.depth < 180 && p.x + radius > 0 && p.x - radius < s.w;
      const live = shown && !this.hidden, state = `${live}|${focused}|${shown}`;
      item.visible = shown;
      if (dom.state !== state) {
        dom.state = state;
        el.classList.toggle('is-visible', live);
        el.classList.toggle('is-focused', focused && shown);
        el.setAttribute('aria-expanded', String(focused));
        el.setAttribute('aria-hidden', String(!live));
        el.inert = !live;
        el.tabIndex = live ? 0 : -1;
        item.details.inert = !focused;
        item.details.setAttribute('aria-hidden', String(!focused));
      }
      if (!shown) return;
      item.matrix = this.matrix(item);
      const width = `${item.width.toFixed(1)}px`, height = `${item.height.toFixed(1)}px`;
      if (dom.width !== width) st.width = dom.width = width;
      if (dom.height !== height) st.height = dom.height = height;
      const transform = `matrix3d(${item.matrix.map(n => n.toFixed(8)).join(',')})`;
      if (dom.transform !== transform) st.transform = dom.transform = transform;
      const z = String(500 - Math.round(p.depth));
      if (dom.z !== z) st.zIndex = dom.z = z;
      const opening = item.opening.toFixed(2), alpha = clamp(1.25 - p.depth / 190, .26, 1).toFixed(2);
      if (dom.opening !== opening) st.setProperty('--opening', dom.opening = opening);
      if (dom.alpha !== alpha) st.setProperty('--distance-alpha', dom.alpha = alpha);
    }
    drawStands() {
      if (this.hidden) return;
      for (const item of [...this.items].reverse()) this.scene.drawMonitorStand(item.anchor, item.index === this.focused, item.side);
    }
    snapshot() {
      return this.items.map(item => ({ index: item.index, anchor: item.anchor, visible: item.visible,
        focused: item.index === this.focused, opening: item.opening, rotation: item.rotation, middle: this.openMiddle(item), unit: item.unit,
        hinge: this.scene.projectWorld(item.anchor.x, item.anchor.height, item.anchor.z),
        base: this.scene.projectWorld(item.anchor.x, 0, item.anchor.z),
        width: item.width, height: item.height, matrix: item.matrix }));
    }
    // Convert the physical screen plane to a CSS projective matrix. The local
    // point (width/2,height) always maps exactly to the same mounted hinge.
    matrix(item) {
      const s = this.scene, a = item.anchor, k = item.unit;
      const angle = item.rotation + s.yaw;
      const ax = k * Math.cos(angle), az = k * Math.sin(angle);
      const p = s.toCamera(a.x, a.z);
      const cx = p.x - item.width * .5 * ax;
      const cz = p.z - item.width * .5 * az;
      const cy = 3.6 - a.height - item.height * k;
      const divisor = Math.max(1, p.z);
      return [ (s.focal * ax + s.vanX * az) / divisor, s.horizon * az / divisor, 0, az / divisor,
        0, s.focal * k / divisor, 0, 0, 0, 0, 1, 0,
        (s.focal * cx + s.vanX * cz) / divisor, (s.focal * cy + s.horizon * cz) / divisor, 0, cz / divisor ];
    }
  }
  window.RoadMonitors = RoadMonitors;
})();
