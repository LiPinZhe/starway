/* Panoramic sky. assets/space-panorama.jpg is an equirectangular star/nebula
   panorama baked procedurally (work/road-design/panorama). WebGL maps every
   pixel with exactly the road camera's projection, so the sky turns with the
   view and with the road's heading; a 2D strip renderer is the fallback.
   Crisp bright stars and distant planets are drawn per frame on the road
   canvas; the planets sit at finite distance and drift slightly with travel. */
(() => {
  'use strict';
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const dir = (phi, theta) => [Math.sin(phi) * Math.cos(theta), Math.sin(theta), Math.cos(phi) * Math.cos(theta)];
  const norm = v => { const l = Math.hypot(...v); return v.map(n => n / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Mirrors generator.js: galactic band plane and the quiet corridor down the road.
  const BAND = norm(cross(dir(100 * DEG, -4 * DEG), dir(10 * DEG, 38 * DEG)));
  const STAR_COLORS = ['rgb(205,220,255)', 'rgb(240,238,232)', 'rgb(255,221,178)'];
  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D tex;uniform vec2 res;uniform float dpr,yaw,vanX,horizon,focal;
void main(){
  vec2 css=vec2(gl_FragCoord.x,res.y-gl_FragCoord.y)/dpr;
  float a=atan((css.x-vanX)/focal);
  float th=atan((horizon-css.y)*cos(a)/focal);
  vec2 uv=vec2(fract((yaw+a)/6.2831853+.5),.5-th/3.1415927);
  gl_FragColor=vec4(texture2D(tex,uv).rgb,1.);
}`;
  let seed = 7310927;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

  function planetSprite(r, { lit, dark, bands, ring, rim }) {
    const pad = ring ? 2.45 : 1.25, size = Math.ceil(r * pad * 2), cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d'), o = size / 2, lx = .62, ly = -.5;
    const ringPass = front => {
      if (!ring) return;
      c.save(); c.translate(o, o); c.rotate(-.32); c.scale(1, .28);
      c.beginPath(); c.rect(-r * 3, front ? 0 : -r * 3, r * 6, r * 3); c.clip();
      for (const [k, a, wdt] of [[1.45, .22, .10], [1.62, .34, .12], [1.86, .16, .18], [2.08, .1, .06]]) {
        c.beginPath(); c.arc(0, 0, r * k, 0, TAU); c.lineWidth = r * wdt; c.strokeStyle = `rgba(${ring},${a})`; c.stroke();
      }
      c.restore();
    };
    ringPass(false);
    c.save(); c.beginPath(); c.arc(o, o, r, 0, TAU); c.clip();
    const body = c.createRadialGradient(o + lx * r * .5, o + ly * r * .5, r * .1, o, o, r * 1.15);
    body.addColorStop(0, `rgb(${lit})`); body.addColorStop(1, `rgb(${dark})`);
    c.fillStyle = body; c.fillRect(0, 0, size, size);
    for (let i = 0; i < bands; i++) {
      const y = o - r + (i + .5) * (2 * r / bands) + Math.sin(i * 2.3) * r * .05;
      c.fillStyle = `rgba(${i % 2 ? '255,245,230' : '20,24,32'},${.035 + (i % 3) * .018})`;
      c.beginPath(); c.ellipse(o, y, r * 1.2, r / bands * (.6 + (i % 2) * .5), -.08, 0, TAU); c.fill();
    }
    const shade = c.createLinearGradient(o + lx * r, o + ly * r, o - lx * r, o - ly * r);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(.52, 'rgba(2,4,8,.45)'); shade.addColorStop(1, 'rgba(2,4,8,.94)');
    c.fillStyle = shade; c.fillRect(0, 0, size, size);
    c.restore();
    const halo = c.createRadialGradient(o, o, r * .96, o, o, r * 1.16);
    halo.addColorStop(0, `rgba(${rim},.30)`); halo.addColorStop(1, `rgba(${rim},0)`);
    c.save(); c.beginPath(); c.arc(o, o, r * 1.2, 0, TAU); c.arc(o, o, r * .99, 0, TAU, true); c.clip();
    c.globalAlpha = .9; c.fillStyle = halo; c.fillRect(0, 0, size, size);
    c.restore();
    c.save(); c.beginPath(); c.arc(o, o, r * .995, -1.9, .35); c.lineWidth = Math.max(1, r * .025);
    c.strokeStyle = `rgba(${rim},.55)`; c.stroke(); c.restore();
    ringPass(true);
    return cv;
  }

  class SkyPanorama {
    constructor(canvas) {
      this.canvas = canvas;
      this.ready = false;
      this.paints = 0;
      this.last = '';
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
      this.mode = this.gl && this.initGL() ? 'webgl' : '2d';
      if (this.mode === '2d') this.ctx = canvas.getContext('2d');
      // A lost GPU context (driver reset) falls back to the 2D renderer rather than a black sky.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (this.mode === 'webgl') { this.toFallback(); this.onready?.(); } });
      this.image = new Image();
      this.image.onload = () => {
        if (this.mode === 'webgl') { try { this.upload(); } catch (error) { this.toFallback(); } }
        this.ready = true; this.last = ''; this.onready?.();
      };
      // Embedded data URI keeps WebGL usable when the page is opened from disk.
      this.image.src = window.SPACE_PANORAMA || 'assets/space-panorama.jpg';
      // Every star is drawn crisply per frame; 72 azimuth bins keep the loop to the view.
      this.bins = Array.from({ length: 72 }, () => []);
      for (let made = 0, count = window.innerWidth < 761 ? 5000 : 8000; made < count;) {
        const z = random() * 2 - 1, phi = random() * TAU - Math.PI, theta = Math.asin(z);
        if (theta < -1) continue;
        const d = dir(phi, theta), band = Math.exp(-(((d[0] * BAND[0] + d[1] * BAND[1] + d[2] * BAND[2]) / .2) ** 2));
        const forward = Math.exp(-((phi / .44) ** 2) - ((theta - .1) / .36) ** 2);
        if (random() > (.28 + .72 * band) * (1 - .5 * forward)) continue;
        const mag = Math.pow(random(), 4.2), t = random();
        this.bins[Math.floor((phi + Math.PI) / TAU * 72) % 72].push({ phi, tan: Math.tan(theta), mag: .1 + mag * .9,
          size: .55 + mag * 1.5, color: t < .25 ? 0 : t < .82 ? 1 : 2, phase: random() * TAU, rate: .6 + random() * 1.4 });
        made += 1;
      }
      for (const bin of this.bins) bin.sort((p, q) => p.color - q.color);
      const bodies = [
        { phi: -33, theta: 15, dist: 1400, deg: 7.2, style: { lit: '186,170,148', dark: '17,19,26', bands: 11, rim: '212,198,176' } },
        { phi: -23.5, theta: 25, dist: 1100, deg: 1.05, style: { lit: '150,148,146', dark: '14,16,22', bands: 0, rim: '190,188,184' } },
        { phi: 31, theta: 14, dist: 2600, deg: 3.1, style: { lit: '150,164,178', dark: '12,16,24', bands: 7, rim: '184,200,214', ring: '176,166,150' } },
      ];
      this.bodies = bodies.map(b => {
        const [x, y, z] = dir(b.phi * DEG, b.theta * DEG).map(n => n * b.dist);
        return { x, y, z, radius: Math.tan(b.deg * DEG) * b.dist, style: b.style, sprite: null, spriteR: 0 };
      });
      this.glow = document.createElement('canvas'); this.glow.width = this.glow.height = 32;
      const g = this.glow.getContext('2d'), rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      rg.addColorStop(0, 'rgba(255,255,255,.9)'); rg.addColorStop(.18, 'rgba(255,255,255,.28)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    }
    initGL() {
      const gl = this.gl, sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
      const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; for (const n of ['tex', 'res', 'dpr', 'yaw', 'vanX', 'horizon', 'focal']) this.u[n] = gl.getUniformLocation(prog, n);
      gl.clearColor(.012, .024, .043, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return true;
    }
    upload() {
      const gl = this.gl, tex = gl.createTexture(), max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      let source = this.image;
      if (source.naturalWidth > max) {
        source = document.createElement('canvas'); source.width = max; source.height = max / 2;
        source.getContext('2d').drawImage(this.image, 0, 0, max, max / 2);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.u.tex, 0);
    }
    // If WebGL refuses the texture, swap in a fresh canvas for the 2D strip renderer.
    toFallback() {
      const old = this.canvas, cv = document.createElement('canvas');
      cv.id = old.id; cv.className = old.className; cv.width = old.width; cv.height = old.height;
      old.replaceWith(cv);
      this.canvas = cv; this.gl = null; this.mode = '2d'; this.ctx = cv.getContext('2d'); this.last = '';
    }
    resize(w, h, dpr) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      if (this.mode === 'webgl') this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.last = '';
    }
    // view: { w, h, dpr, yaw, vanX, horizon, focal } in CSS pixels / radians.
    render(v) {
      const key = `${v.w}|${v.h}|${v.yaw.toFixed(5)}|${v.horizon.toFixed(2)}|${v.focal}`;
      this.view = v;
      if (key === this.last || !this.ready) return;
      this.last = key; this.paints += 1;
      if (this.mode === 'webgl') {
        const gl = this.gl, u = this.u;
        gl.uniform2f(u.res, this.canvas.width, this.canvas.height); gl.uniform1f(u.dpr, this.canvas.width / v.w);
        gl.uniform1f(u.yaw, v.yaw); gl.uniform1f(u.vanX, v.vanX); gl.uniform1f(u.horizon, v.horizon); gl.uniform1f(u.focal, v.focal);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }
      // Fallback: vertical strips; elevation is linearised around the horizon.
      const c = this.ctx, img = this.image, W = img.naturalWidth, H = img.naturalHeight, strips = 32;
      c.setTransform(this.canvas.width / v.w, 0, 0, this.canvas.height / v.h, 0, 0);
      c.fillStyle = '#03060b'; c.fillRect(0, 0, v.w, v.h);
      for (let i = 0; i < strips; i++) {
        const x0 = v.w * i / strips, x1 = v.w * (i + 1) / strips;
        const a0 = Math.atan((x0 - v.vanX) / v.focal), a1 = Math.atan((x1 - v.vanX) / v.focal);
        const k = v.focal / Math.cos((a0 + a1) / 2) * Math.PI / H, du = (a1 - a0) / TAU * W;
        const u0 = (((v.yaw + a0) / TAU + .5) % 1 + 1) % 1 * W, dy = v.horizon - H / 2 * k, dh = H * k, dw = x1 - x0 + .75;
        if (u0 + du <= W) c.drawImage(img, u0, 0, du, H, x0, dy, dw, dh);
        else {
          const f = (W - u0) / du;
          c.drawImage(img, u0, 0, W - u0, H, x0, dy, dw * f, dh);
          c.drawImage(img, 0, 0, du - (W - u0), H, x0 + (x1 - x0) * f, dy, dw * (1 - f), dh);
        }
      }
    }
    // Test hook: sky-only luminance along one CSS row or column (device-pixel samples).
    sample(axis, at) {
      if (!this.view || !this.ready) return null;
      this.last = ''; this.render(this.view);
      const cw = this.canvas.width, ch = this.canvas.height, k = cw / this.view.w, row = axis === 'row', values = [];
      let data;
      if (this.mode === 'webgl') {
        const gl = this.gl; data = new Uint8Array((row ? cw : ch) * 4);
        if (row) gl.readPixels(0, ch - 1 - Math.round(at * k), cw, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
        else gl.readPixels(Math.round(at * k), 0, 1, ch, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else data = row ? this.ctx.getImageData(0, Math.round(at * k), cw, 1).data : this.ctx.getImageData(Math.round(at * k), 0, 1, ch).data;
      for (let i = 0; i < data.length; i += 4) values.push(data[i] + data[i + 1] + data[i + 2]);
      if (!row && this.mode === 'webgl') values.reverse();
      return { k, values };
    }
    // Bright stars and planets share the road camera (drawn before the road).
    drawBodies(c, s, time) {
      const limit = Math.atan(s.w / 2 / s.focal) + .05, first = Math.floor((s.yaw - limit + Math.PI) / TAU * 72);
      const last = Math.floor((s.yaw + limit + Math.PI) / TAU * 72), bright = [];
      c.globalCompositeOperation = 'lighter';
      for (let b = first; b <= last; b++) {
        let color = -1;
        for (const st of this.bins[((b % 72) + 72) % 72]) {
          let a = st.phi - s.yaw; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU;
          if (Math.abs(a) > limit) continue;
          const x = s.vanX + s.focal * Math.tan(a), y = s.horizon - s.focal * st.tan / Math.cos(a);
          if (y < -6 || y > s.h + 6) continue;
          if (st.color !== color) { color = st.color; c.fillStyle = STAR_COLORS[color]; }
          c.globalAlpha = st.mag > .45 ? st.mag * (.78 + .22 * Math.sin(time * st.rate + st.phase)) : st.mag;
          c.fillRect(x - st.size / 2, y - st.size / 2, st.size, st.size);
          if (st.mag > .72) bright.push(x, y, st.mag, color);
        }
      }
      for (let i = 0; i < bright.length; i += 4) {
        const [x, y, mag] = [bright[i], bright[i + 1], bright[i + 2]], g = 9 + mag * 10;
        c.globalAlpha = (mag - .62) * .9; c.drawImage(this.glow, x - g / 2, y - g / 2, g, g);
        if (mag > .9) { c.fillStyle = STAR_COLORS[bright[i + 3]]; c.fillRect(x - g * .55, y - .25, g * 1.1, .5); c.fillRect(x - .25, y - g * .55, .5, g * 1.1); }
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      for (const b of [...this.bodies].sort((p, q) => Math.hypot(q.x - s.cameraX, q.z - s.camera) - Math.hypot(p.x - s.cameraX, p.z - s.camera))) {
        const p = s.projectWorld(b.x, b.y + 3.6, b.z); if (p.depth < 10) continue;
        const r = b.radius * p.scale, pad = b.style.ring ? 2.45 : 1.25;
        if (p.x + r * pad < 0 || p.x - r * pad > s.w || p.y + r * pad < 0 || p.y - r * pad > s.h) continue;
        const want = Math.min(420, Math.ceil(r * s.dpr * 1.08));
        // Rendered with headroom so travel (planets grow ~10%) never triggers a rebuild mid-journey.
        if (!b.sprite || want > b.spriteR || want < b.spriteR * .45) { b.spriteR = Math.min(460, Math.ceil(want * 1.25)); b.sprite = planetSprite(b.spriteR, b.style); }
        const size = b.sprite.width * r / b.spriteR;
        c.drawImage(b.sprite, p.x - size / 2, p.y - size / 2, size, size);
      }
    }
  }
  window.SkyPanorama = SkyPanorama;
})();
