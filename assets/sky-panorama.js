/* Panoramic sky. assets/space-panorama.jpg is an equirectangular star/nebula
   panorama baked procedurally (work/road-design/panorama). WebGL maps every
   pixel with exactly the road camera's projection, so the sky turns with the
   view and with the road's heading; a 2D strip renderer is the fallback.
   Crisp bright stars and distant planets are drawn per frame on the road
   canvas; the planets sit at finite distance and drift slightly with travel. */
(() => {
  'use strict';
  const TAU = Math.PI * 2, DEG = Math.PI / 180, clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const dir = (phi, theta) => [Math.sin(phi) * Math.cos(theta), Math.sin(theta), Math.cos(phi) * Math.cos(theta)];
  const norm = v => { const l = Math.hypot(...v); return v.map(n => n / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Mirrors generator.js: galactic band plane and the quiet corridor down the road.
  const BAND = norm(cross(dir(100 * DEG, -4 * DEG), dir(10 * DEG, 38 * DEG)));
  const STAR_COLORS = ['rgb(205,220,255)', 'rgb(240,238,232)', 'rgb(255,221,178)'];
  // Nebula centres (generator.js clouds) that host the occasional light echo.
  const ECHOES = [[-62, 8], [54, 2], [118, 18], [-20, 40]].map(([p, t]) => dir(p * DEG, t * DEG));
  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D tex;uniform vec2 res,foe;uniform float dpr,yaw,vanX,horizon,focal,time,bright,warp;uniform vec4 echo;
vec2 lookup(vec2 css,out vec3 d){
  float a=atan((css.x-vanX)/focal);
  float th=atan((horizon-css.y)*cos(a)/focal),lon=yaw+a;
  d=vec3(sin(lon)*cos(th),sin(th),cos(lon)*cos(th));
  return vec2(fract(lon/6.2831853+.5),.5-th/3.1415927);
}
float h3(vec3 p){p=fract(p*vec3(.1031,.103,.0973));p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z);}
float n3(vec3 x){
  vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main(){
  vec2 css=vec2(gl_FragCoord.x,res.y-gl_FragCoord.y)/dpr;
  vec3 d;vec2 uv=lookup(css,d);
  // Living nebula: a slow flow field nudges the lookup (seamless: noise over the view
  // direction, not the texture), and a second field lets the gas brighten and dim.
  vec3 q=d*2.3+vec3(0.,time*.021,time*.013);
  vec2 flow=vec2(n3(q),n3(q+vec3(7.1,3.3,1.7)))-.5;
  vec3 col=texture2D(tex,uv+flow*vec2(.0012,.0016)).rgb;
  float gas=smoothstep(.025,.2,dot(col,vec3(.3,.55,.15)));
  float breath=n3(d*3.1+flow.xyx*1.4+vec3(time*.05,-time*.034,time*.04))*.66+n3(d*6.7-vec3(time*.06,0.,time*.045))*.34;
  col*=1.+(breath-.5)*.6*gas;
  // Light echo: a shell of light expanding through one nebula now and then.
  if(echo.w>.001){float ang=acos(clamp(dot(d,echo.xyz),-1.,1.)),r=(ang-echo.w*.8)/.055;col*=1.+exp(-r*r)*(1.-echo.w)*smoothstep(0.,.05,echo.w)*1.1*gas;}
  // Hyperspace: a zoom smear along the rays from the direction of travel, faintly blueshifted.
  if(abs(warp)>.004){
    vec3 acc=col,dd;
    for(int i=1;i<6;i++)acc+=texture2D(tex,lookup(foe+(css-foe)*(1.-warp*.032*float(i)),dd)).rgb;
    float r=length(css-foe)/focal;
    col=acc/6.*mix(vec3(1.),vec3(.9,.98,1.16)*(1.+.35*exp(-r*r*3.)),abs(warp));
  }
  gl_FragColor=vec4(col*bright,1.);
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
      this.gl = null; this.mode = 'pending';
      // Embedded data URI keeps WebGL usable when the page is opened from disk.
      this.src = window.SPACE_PANORAMA || 'assets/space-panorama.jpg';
      this.image = null;
      // The first GPU context handshake (~50–150 ms) and the star generation each run as their
      // own task right after startup, so neither lengthens the script-evaluation task.
      this.bins = Array.from({ length: 72 }, () => []);
      setTimeout(() => this.init(), 0);
      setTimeout(() => this.makeStars(), 0);
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
    init() {
      const canvas = this.canvas;
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
      this.mode = this.gl && this.initGL() ? 'webgl' : '2d';
      if (this.mode === 'webgl') { this.gl.viewport(0, 0, canvas.width, canvas.height); this.parallel = this.gl.getExtension('KHR_parallel_shader_compile'); }
      else this.ctx = canvas.getContext('2d');
      // A lost GPU context (driver reset) falls back to the 2D renderer rather than a black sky.
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (this.mode === 'webgl') { this.toFallback(); this.onready?.(); } });
      this.load();
    }
    // Every star is drawn crisply per frame; 72 azimuth bins keep the loop to the view.
    makeStars() {
      for (let made = 0, count = window.innerWidth < 761 ? 5000 : 8000; made < count;) {
        const z = random() * 2 - 1, phi = random() * TAU - Math.PI, theta = Math.asin(z);
        if (theta < -1) continue;
        const d = dir(phi, theta), band = Math.exp(-(((d[0] * BAND[0] + d[1] * BAND[1] + d[2] * BAND[2]) / .2) ** 2));
        const forward = Math.exp(-((phi / .44) ** 2) - ((theta - .1) / .36) ** 2);
        if (random() > (.28 + .72 * band) * (1 - .5 * forward)) continue;
        const mag = Math.pow(random(), 4.2), t = random();
        this.bins[Math.floor((phi + Math.PI) / TAU * 72) % 72].push({ phi, tan: Math.tan(theta), mag: .1 + mag * .9,
          size: .55 + mag * 1.5, color: t < .25 ? 0 : t < .82 ? 1 : 2, phase: random() * TAU, rate: .6 + random() * 1.4,
          cp: Math.cos(phi), sp: Math.sin(phi) });
        made += 1;
      }
      for (const bin of this.bins) bin.sort((p, q) => p.color - q.color);
    }
    // Shaders compile while the panorama downloads and decodes: nothing queries the program
    // (which would wait for the compiler) until finishGL(), so startup is not blocked.
    initGL() {
      const gl = this.gl, sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog); this.prog = prog;
      gl.clearColor(.012, .024, .043, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return true;
    }
    // Resolves once the program has linked, polling without blocking (KHR_parallel_shader_compile):
    // the D3D shader compiler can take a few hundred milliseconds. Without the extension the
    // status query in finishGL() simply waits.
    linked() {
      const gl = this.gl, ext = this.parallel;
      if (!ext) return Promise.resolve();
      return new Promise(resolve => {
        const poll = () => (this.gl !== gl || gl.isContextLost() || gl.getProgramParameter(this.prog, ext.COMPLETION_STATUS_KHR)) ? resolve() : setTimeout(poll, 16);
        poll();
      });
    }
    finishGL() {
      const gl = this.gl, prog = this.prog;
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; for (const n of ['tex', 'res', 'dpr', 'yaw', 'vanX', 'horizon', 'focal', 'time', 'bright', 'warp', 'foe', 'echo']) this.u[n] = gl.getUniformLocation(prog, n);
      return true;
    }
    // WebGL path: data URI → Blob → createImageBitmap, which decodes (and scales) off the main
    // thread, at the width the screen can use: sky pixels per radian × 2π, i.e. 2048 on phones
    // and 4096 on larger screens. No <img> is made unless the 2D fallback needs one.
    async load() {
      if (this.mode === 'webgl' && window.createImageBitmap && window.fetch) {
        try {
          const blob = await (await fetch(this.src)).blob();
          const width = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), (this.pxPerRad || 700) * TAU > 2600 ? 4096 : 2048);
          const bitmap = await createImageBitmap(blob, width < 4096 ? { resizeWidth: width, resizeHeight: width / 2, resizeQuality: 'high' } : undefined);
          await this.linked();
          if (this.mode === 'webgl') {
            if (!this.finishGL()) throw new Error('shader');
            this.upload(bitmap); this.textureWidth = bitmap.width;
            bitmap.close(); this.ready = true; this.last = ''; this.onready?.();
            return;
          }
          bitmap.close();
        } catch (error) { if (this.mode === 'webgl') this.toFallback(); }
      }
      this.loadImage();
    }
    // <img> path: the 2D fallback, or WebGL where createImageBitmap is missing.
    loadImage() {
      if (this.image) return;
      this.ready = false;
      this.image = new Image();
      this.image.onload = () => {
        if (this.mode === 'webgl') { try { if (!this.finishGL()) throw new Error('shader'); this.upload(this.image); } catch (error) { this.toFallback(); } }
        this.ready = true; this.last = ''; this.onready?.();
      };
      this.image.src = this.src;
    }
    upload(source) {
      const gl = this.gl, tex = gl.createTexture(), max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if ((source.naturalWidth || source.width) > max) {
        const cv = document.createElement('canvas'); cv.width = max; cv.height = max / 2;
        cv.getContext('2d').drawImage(source, 0, 0, max, max / 2); source = cv;
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
      this.loadImage();
    }
    resize(w, h, dpr) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      if (this.mode === 'webgl') this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.last = '';
    }
    // view: { w, h, yaw, vanX, horizon, focal, time, bright, warp, foe } in CSS pixels / radians / seconds.
    // The nebula animates at 30 Hz at most; a still view with frozen time is never repainted.
    render(v) {
      const key = `${v.w}|${v.h}|${v.yaw.toFixed(5)}|${v.horizon.toFixed(2)}|${v.focal.toFixed(2)}|${Math.floor(v.time * 30)}|${v.bright.toFixed(3)}|${v.warp.toFixed(3)}|${v.foe.toFixed(1)}`;
      this.view = v;
      if (key === this.last || !this.ready) return;
      this.last = key; this.paints += 1;
      if (this.mode === 'webgl') {
        const gl = this.gl, u = this.u;
        gl.uniform2f(u.res, this.canvas.width, this.canvas.height); gl.uniform1f(u.dpr, this.canvas.width / v.w);
        gl.uniform1f(u.yaw, v.yaw); gl.uniform1f(u.vanX, v.vanX); gl.uniform1f(u.horizon, v.horizon); gl.uniform1f(u.focal, v.focal);
        gl.uniform1f(u.time, v.time % 2000); gl.uniform1f(u.bright, v.bright); gl.uniform1f(u.warp, v.warp); gl.uniform2f(u.foe, v.foe, v.horizon);
        // Light echoes: every 17 s a shell of light sweeps through one nebula for 9 s, in turn.
        const phase = (v.time % 17) / 9, e = ECHOES[Math.floor(v.time / 17) % ECHOES.length];
        gl.uniform4f(u.echo, e[0], e[1], e[2], phase < 1 ? phase : 0);
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
      if (v.bright < 1) { c.globalAlpha = 1 - v.bright; c.fillStyle = '#000'; c.fillRect(0, 0, v.w, v.h); c.globalAlpha = 1; }
    }
    // Test hook: sky-only luminance along one CSS row or column (device-pixel samples).
    sample(axis, at) {
      if (!this.view || !this.ready) return null;
      // Pinned animation time: two samples differ only by the camera, as the checks expect.
      this.last = ''; this.render({ ...this.view, time: 0, warp: 0, bright: 1 });
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
    // Bright stars and planets share the road camera (drawn before the road). In hyperspace the
    // stars stretch into hairline streaks along the rays from the direction of travel.
    drawBodies(c, s, time) {
      const fade = s.skyBright; if (fade <= 0) { this.warm(s); return; }
      const limit = Math.atan(s.w / 2 / s.focal) + .05, first = Math.floor((s.yaw - limit + Math.PI) / TAU * 72);
      const last = Math.floor((s.yaw + limit + Math.PI) / TAU * 72), bright = [];
      const warp = s.warp, streak = warp > .03, tailK = 1 - .3 * warp * s.warpDir, fx = s.foeX, fy = s.horizon;
      const paths = streak ? STAR_COLORS.map(() => new Path2D()) : null, faint = streak ? clamp(1 - warp / .35, 0, 1) : 1;
      // cos / sin of (phi − yaw) from each star's stored cos / sin of phi: no trigonometry per star.
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cosLimit = Math.cos(limit);
      c.globalCompositeOperation = 'lighter';
      for (let b = first; b <= last; b++) {
        let color = -1;
        for (const st of this.bins[((b % 72) + 72) % 72]) {
          const ca = st.cp * cy + st.sp * sy; if (ca < cosLimit) continue;
          const x = s.vanX + s.focal * (st.sp * cy - st.cp * sy) / ca, y = s.horizon - s.focal * st.tan / ca;
          if (y < -6 || y > s.h + 6) continue;
          if (streak && st.mag > .22) { const path = paths[st.color]; path.moveTo(x, y); path.lineTo(fx + (x - fx) * tailK, fy + (y - fy) * tailK); }
          else if (faint <= 0) continue;
          if (st.color !== color) { color = st.color; c.fillStyle = STAR_COLORS[color]; }
          c.globalAlpha = (st.mag > .45 ? st.mag * (.78 + .22 * Math.sin(time * st.rate + st.phase)) : st.mag) * fade * (st.mag > .22 ? 1 : faint);
          c.fillRect(x - st.size / 2, y - st.size / 2, st.size, st.size);
          if (st.mag > .72) bright.push(x, y, st.mag, color);
        }
      }
      if (streak) {
        c.lineWidth = s.hair; c.globalAlpha = fade * clamp(warp * 2.2, 0, .85);
        paths.forEach((path, i) => { c.strokeStyle = STAR_COLORS[i]; c.stroke(path); });
      }
      for (let i = 0; i < bright.length; i += 4) {
        const [x, y, mag] = [bright[i], bright[i + 1], bright[i + 2]], g = 9 + mag * 10;
        c.globalAlpha = (mag - .62) * .9 * fade; c.drawImage(this.glow, x - g / 2, y - g / 2, g, g);
        if (mag > .9) { c.fillStyle = STAR_COLORS[bright[i + 3]]; c.fillRect(x - g * .55, y - .25, g * 1.1, .5); c.fillRect(x - .25, y - g * .55, .5, g * 1.1); }
      }
      this.drawMeteor(c, s, time);
      c.globalAlpha = fade; c.globalCompositeOperation = 'source-over';
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
      c.globalAlpha = 1;
    }
    // Before the arrival (nothing drawn yet) the planet sprites are made one per frame, so the
    // arrival's first frame does not have to build them.
    warm(s) {
      const b = this.bodies.find(body => !body.sprite && !body.far); if (!b) return;
      const p = s.projectWorld(b.x, b.y + 3.6, b.z); if (p.depth < 10) { b.far = true; return; }
      b.spriteR = Math.min(460, Math.ceil(Math.min(420, Math.ceil(b.radius * p.scale * s.dpr * 1.08)) * 1.25));
      b.sprite = planetSprite(b.spriteR, b.style);
    }
    // A shooting star every 4–9 s: anchored in the sky (it turns with the view), a tapered
    // gradient tail and a small glowing head. None while the scene is calm or in hyperspace.
    drawMeteor(c, s, time) {
      if (s.calm || s.boot < s.bootEnd) { this.meteor = null; this.nextMeteor = time + 2.5; return; }
      if (!this.nextMeteor || this.nextMeteor > time + 12) this.nextMeteor = time + 2.5 + random() * 3;
      if (!this.meteor && time >= this.nextMeteor && s.warp < .05) {
        const sign = random() < .5 ? -1 : 1;
        this.meteor = { born: time, life: .6 + random() * .5, phi: s.yaw + (random() - .5) * 1.5, theta: .16 + random() * .34,
          dphi: sign * (.2 + random() * .22), dtheta: -(.06 + random() * .1), big: random() < .2 };
        this.nextMeteor = time + 4 + random() * 5;
      }
      const m = this.meteor; if (!m) return;
      const u = (time - m.born) / m.life;
      if (u < 0 || u >= 1) { this.meteor = null; return; }
      const at = t => {
        let a = m.phi + m.dphi * t - s.yaw; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU;
        if (Math.abs(a) > 1.35) return null;
        return [s.vanX + s.focal * Math.tan(a), s.horizon - s.focal * Math.tan(m.theta + m.dtheta * t) / Math.cos(a)];
      };
      const head = at(u), tail = at(Math.max(0, u - .45));
      if (!head || !tail) return;
      const dx = head[0] - tail[0], dy = head[1] - tail[1], len = Math.hypot(dx, dy); if (len < 1) return;
      const w = m.big ? 1.5 : .9, nx = -dy / len * w, ny = dx / len * w, alpha = Math.sin(Math.PI * u) ** .6 * s.skyBright;
      const g = c.createLinearGradient(tail[0], tail[1], head[0], head[1]);
      g.addColorStop(0, 'rgba(190,210,255,0)'); g.addColorStop(.6, 'rgba(220,230,255,.4)'); g.addColorStop(1, 'rgba(255,248,236,1)');
      c.globalAlpha = alpha; c.fillStyle = g;
      c.beginPath(); c.moveTo(tail[0], tail[1]); c.lineTo(head[0] + nx, head[1] + ny); c.lineTo(head[0] - nx, head[1] - ny); c.closePath(); c.fill();
      const r = m.big ? 13 : 7;
      c.globalAlpha = alpha * .9; c.drawImage(this.glow, head[0] - r, head[1] - r, r * 2, r * 2);
    }
  }
  window.SkyPanorama = SkyPanorama;
})();
