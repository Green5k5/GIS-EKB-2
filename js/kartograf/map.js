/* =====================================================================
   Картограф — собственный движок карты «ГИС Екатеринбург».
   map.js: проекция, вид, цикл отрисовки, жесты (мышь, колесо, тачпад,
   касания, щипок), анимации перелёта, попапы и элементы управления.

   Координаты «мира» — нормированная веб-меркаторская плоскость [0..1].
   Экранная точка: sx = (x − cx)·256·2^zoom + W/2.
   ===================================================================== */
(function () {
  "use strict";

  const K = window.Kartograf = window.Kartograf || {};
  const TILE = 256;
  const MAX_LAT = 85.0511287798;
  const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- Проекция ------------------------------------------------ */
  function project(lat, lng) {
    const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
    return {
      x: (lng + 180) / 360,
      y: (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2
    };
  }
  function unproject(x, y) {
    const n = Math.PI - 2 * Math.PI * y;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: x * 360 - 180 };
  }
  function toLatLng(v) {
    if (Array.isArray(v)) return { lat: +v[0], lng: +v[1] };
    return { lat: +v.lat, lng: +(v.lng != null ? v.lng : v.lon) };
  }

  /* ---------- Границы (совместимы по смыслу с L.LatLngBounds) ---------- */
  class LatLngBounds {
    constructor(a, b) {
      this.south = Infinity; this.west = Infinity; this.north = -Infinity; this.east = -Infinity;
      if (Array.isArray(a) && Array.isArray(a[0])) a.forEach(p => this.extend(p));
      else if (a) { this.extend(a); if (b) this.extend(b); }
    }
    extend(p) {
      if (p instanceof LatLngBounds) {
        if (!p.isValid()) return this;
        this.extend([p.south, p.west]); this.extend([p.north, p.east]);
        return this;
      }
      const ll = toLatLng(p);
      if (!isFinite(ll.lat) || !isFinite(ll.lng)) return this;
      this.south = Math.min(this.south, ll.lat); this.north = Math.max(this.north, ll.lat);
      this.west = Math.min(this.west, ll.lng); this.east = Math.max(this.east, ll.lng);
      return this;
    }
    isValid() { return this.south <= this.north && this.west <= this.east; }
    intersects(o) {
      o = o instanceof LatLngBounds ? o : new LatLngBounds(o);
      return !(o.east < this.west || o.west > this.east || o.north < this.south || o.south > this.north);
    }
    contains(p) {
      const ll = toLatLng(p);
      return ll.lat >= this.south && ll.lat <= this.north && ll.lng >= this.west && ll.lng <= this.east;
    }
    getCenter() { return { lat: (this.south + this.north) / 2, lng: (this.west + this.east) / 2 }; }
    toArray() { return [[this.south, this.west], [this.north, this.east]]; }
  }

  /* ---------- Мини-шина событий --------------------------------------- */
  class Emitter {
    constructor() { this._ev = {}; }
    on(types, fn) { types.split(/\s+/).forEach(t => (this._ev[t] = this._ev[t] || []).push(fn)); return this; }
    off(types, fn) {
      types.split(/\s+/).forEach(t => { if (this._ev[t]) this._ev[t] = this._ev[t].filter(f => f !== fn); });
      return this;
    }
    fire(type, data) { (this._ev[type] || []).slice().forEach(fn => fn.call(this, data || {})); return this; }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* =====================================================================
     Карта
     ===================================================================== */
  class KMap extends Emitter {
    constructor(container, opts) {
      super();
      opts = opts || {};
      this.container = typeof container === "string" ? document.getElementById(container) : container;
      this.options = opts;
      this.minZoomOpt = opts.minZoom != null ? opts.minZoom : 10;
      this.maxZoom = opts.maxZoom != null ? opts.maxZoom : 19;
      this.theme = opts.theme || "light";
      const c = toLatLng(opts.center || [56.83, 60.6]);
      const p = project(c.lat, c.lng);
      this.cx = p.x; this.cy = p.y;
      this.zoom = opts.zoom || 12;
      this.maxBounds = opts.maxBounds ? new LatLngBounds(opts.maxBounds) : null;
      this.layers = [];
      this._anim = null;
      this._dirty = false;
      this._raf = 0;
      this._moving = false;
      this._lastZoomFired = this.zoom;
      this._pointers = new Map();

      this._buildDom();
      this._resize();
      this._bindEvents();
      if (opts.basemap && K.Basemap) this.basemap = new K.Basemap(this, opts.basemap);
      this.requestRender();
    }

    /* ---------- DOM и холст ---------- */
    _buildDom() {
      const root = this.container;
      root.classList.add("kg-map");
      if (!root.hasAttribute("tabindex")) root.tabIndex = 0;
      root.setAttribute("role", "region");
      root.setAttribute("aria-roledescription", "карта");
      if (!root.getAttribute("aria-label")) root.setAttribute("aria-label", "Карта. Стрелки — перемещение, плюс и минус — масштаб");
      this.canvas = el("canvas", "kg-canvas", root);
      this.ctx = this.canvas.getContext("2d", { alpha: false });
      this.popupPane = el("div", "kg-popup-pane", root);
      this.tooltipEl = el("div", "kg-tooltip", root);
      // невидимый «щуп»: узнаём, сколько карты закрыто шторкой/панелью
      // (CSS-переменные --kg-bottom-inset и --kg-left-inset)
      this._insetProbe = el("div", "kg-inset-probe", root);
      this.tooltipEl.setAttribute("role", "tooltip");

      // Управление масштабом
      const zc = el("div", "kg-control kg-zoom", root);
      this.zoomInBtn = el("button", "kg-zoom-in", zc, "+");
      this.zoomOutBtn = el("button", "kg-zoom-out", zc, "−");
      this.zoomInBtn.type = this.zoomOutBtn.type = "button";
      this.zoomInBtn.setAttribute("aria-label", "Приблизить");
      this.zoomOutBtn.setAttribute("aria-label", "Отдалить");
      this.zoomInBtn.title = "Приблизить";
      this.zoomOutBtn.title = "Отдалить";
      this.zoomInBtn.addEventListener("click", e => { e.stopPropagation(); this.zoomIn(); });
      this.zoomOutBtn.addEventListener("click", e => { e.stopPropagation(); this.zoomOut(); });

      // Масштабная линейка: метры и сажени — мера, которой пользуются ведомости 1809 г.
      const sc = el("div", "kg-control kg-scale", root);
      sc.setAttribute("aria-hidden", "true");
      this.scaleM = el("div", "kg-scale-line", sc);
      this.scaleS = el("div", "kg-scale-line kg-scale-sazh", sc);

      this.attribution = el("div", "kg-control kg-attribution", root);
      this.setAttribution(this.options.attribution || "");

      [zc, sc, this.attribution].forEach(n => {
        n.addEventListener("pointerdown", e => e.stopPropagation());
        n.addEventListener("dblclick", e => e.stopPropagation());
        n.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
      });
    }

    setAttribution(html) {
      this.attribution.innerHTML = html;
    }

    _resize() {
      const r = this.container.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const probe = this._insetProbe;
      const insets = { left: probe ? probe.offsetWidth : 0, bottom: probe ? probe.offsetHeight : 0 };
      const insetsChanged = !this.insets || insets.left !== this.insets.left || insets.bottom !== this.insets.bottom;
      this.insets = insets;
      if (W === this.W && H === this.H && dpr === this.dpr) return insetsChanged;
      this.W = W; this.H = H; this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = W + "px";
      this.canvas.style.height = H + "px";
      return true;
    }

    invalidateSize() {
      if (this._resize()) {
        this.zoom = clamp(this.zoom, this._minZ(), this.maxZoom);
        this._constrain();
        this.requestRender();
      }
      return this;
    }

    setTheme(theme) {
      if (theme === this.theme) return;
      this.theme = theme;
      if (this.basemap) this.basemap.setTheme(theme);
      this.requestRender();
    }

    /* ---------- Вид ---------- */
    get worldSize() { return TILE * Math.pow(2, this.zoom); }
    getZoom() { return this.zoom; }
    getCenter() { return unproject(this.cx, this.cy); }
    getSize() { return { x: this.W, y: this.H }; }

    worldToScreen(x, y) {
      const ws = this.worldSize;
      return { x: (x - this.cx) * ws + this.W / 2, y: (y - this.cy) * ws + this.H / 2 };
    }
    screenToWorld(sx, sy) {
      const ws = this.worldSize;
      return { x: this.cx + (sx - this.W / 2) / ws, y: this.cy + (sy - this.H / 2) / ws };
    }
    latLngToContainerPoint(ll) {
      ll = toLatLng(ll);
      const p = project(ll.lat, ll.lng);
      return this.worldToScreen(p.x, p.y);
    }
    containerPointToLatLng(pt) {
      const w = this.screenToWorld(pt.x, pt.y);
      return unproject(w.x, w.y);
    }
    getBounds() {
      const a = this.containerPointToLatLng({ x: 0, y: this.H });
      const b = this.containerPointToLatLng({ x: this.W, y: 0 });
      return new LatLngBounds([a.lat, a.lng], [b.lat, b.lng]);
    }

    _setView(cx, cy, zoom) {
      this.zoom = clamp(zoom, this._minZ(), this.maxZoom);
      this.cx = cx; this.cy = cy;
      this._constrain();
      this._moving = true;
      this.requestRender();
    }

    /* Минимальный зум: не меньше заданного и такой, чтобы область с
       данными целиком закрывала экран — пустых полей за краем не видно. */
    _minZ() {
      let z = this.minZoomOpt;
      const b = this.maxBounds;
      if (b && b.isValid() && this.W) {
        const nw = project(b.north, b.west), se = project(b.south, b.east);
        const cover = Math.log2(Math.max(this.W / ((se.x - nw.x) * TILE), this.H / ((se.y - nw.y) * TILE)));
        z = Math.max(z, cover);
      }
      return Math.min(z, this.maxZoom);
    }
    get minZoom() { return this._minZ(); }

    setMaxBounds(bounds) {
      this.maxBounds = bounds ? new LatLngBounds(bounds) : null;
      this.zoom = clamp(this.zoom, this._minZ(), this.maxZoom);
      this._constrain();
      this.requestRender();
      return this;
    }

    _constrain() {
      if (!this.maxBounds || !this.maxBounds.isValid()) return;
      const nw = project(this.maxBounds.north, this.maxBounds.west);
      const se = project(this.maxBounds.south, this.maxBounds.east);
      const ws = this.worldSize;
      const hw = this.W / 2 / ws, hh = this.H / 2 / ws;
      // центр держим в пределах границ; если вид шире границ — по центру
      const minX = nw.x + Math.min(hw, (se.x - nw.x) / 2), maxX = se.x - Math.min(hw, (se.x - nw.x) / 2);
      const minY = nw.y + Math.min(hh, (se.y - nw.y) / 2), maxY = se.y - Math.min(hh, (se.y - nw.y) / 2);
      this.cx = minX > maxX ? (nw.x + se.x) / 2 : clamp(this.cx, minX, maxX);
      this.cy = minY > maxY ? (nw.y + se.y) / 2 : clamp(this.cy, minY, maxY);
    }

    _zoomAround(sx, sy, zoom) {
      const w = this.screenToWorld(sx, sy);
      this.zoom = clamp(zoom, this._minZ(), this.maxZoom);
      const ws = this.worldSize;
      this._setView(w.x - (sx - this.W / 2) / ws, w.y - (sy - this.H / 2) / ws, this.zoom);
    }

    stop() {
      this._anim = null;
      this._inertia = null;
      this._wheel = null;
    }

    setView(center, zoom, opts) {
      const ll = toLatLng(center);
      const p = project(ll.lat, ll.lng);
      zoom = zoom == null ? this.zoom : zoom;
      if (opts && opts.animate) return this._easeTo(p.x, p.y, zoom, opts.duration || 0.45);
      this.stop();
      this._setView(p.x, p.y, zoom);
      return this;
    }
    setZoom(z, opts) { return this.setView(this.getCenter(), z, opts); }
    zoomIn(d) { return this._zoomBy(d || 1); }
    zoomOut(d) { return this._zoomBy(-(d || 1)); }
    _zoomBy(d, sx, sy) {
      const target = clamp(Math.round((this._animTargetZoom() + d) * 4) / 4, this._minZ(), this.maxZoom);
      if (sx == null) return this._easeTo(this.cx, this.cy, target, 0.3);
      const w = this.screenToWorld(sx, sy);
      const ws = TILE * Math.pow(2, target);
      return this._easeTo(w.x - (sx - this.W / 2) / ws, w.y - (sy - this.H / 2) / ws, target, 0.3);
    }
    _animTargetZoom() { return this._anim ? this._anim.z1 : this.zoom; }
    panBy(dx, dy, opts) {
      const ws = this.worldSize;
      const x = this.cx + dx / ws, y = this.cy + dy / ws;
      if (opts && opts.animate === false) { this.stop(); this._setView(x, y, this.zoom); return this; }
      return this._easeTo(x, y, this.zoom, 0.3);
    }

    _easeTo(x, y, z, duration) {
      this.stop();
      z = clamp(z, this._minZ(), this.maxZoom);
      if (REDUCED_MOTION && REDUCED_MOTION.matches) duration = 0;
      if (!duration) { this._setView(x, y, z); return this; }
      this._anim = { kind: "ease", t0: now(), dur: duration * 1000, x0: this.cx, y0: this.cy, z0: this.zoom, x1: x, y1: y, z1: z };
      this.requestRender();
      return this;
    }

    /* Перелёт по оптимальной траектории (van Wijk & Nuij, как во flyTo) */
    flyTo(center, zoom, opts) {
      opts = opts || {};
      const ll = toLatLng(center);
      const to = project(ll.lat, ll.lng);
      zoom = clamp(zoom == null ? this.zoom : zoom, this._minZ(), this.maxZoom);
      if (REDUCED_MOTION && REDUCED_MOTION.matches) return this.setView(center, zoom);
      this.stop();
      const z0 = this.zoom, ws0 = TILE * Math.pow(2, z0);
      const fx = this.cx * ws0, fy = this.cy * ws0, tx = to.x * ws0, ty = to.y * ws0;
      const w0 = Math.max(this.W, this.H), w1 = w0 * Math.pow(2, z0 - zoom);
      const u1 = Math.hypot(tx - fx, ty - fy) || 1;
      const rho = 1.42, rho2 = rho * rho;
      const r = i => {
        const s1 = i ? -1 : 1, s2 = i ? w1 : w0;
        const t1 = w1 * w1 - w0 * w0 + s1 * rho2 * rho2 * u1 * u1;
        const b1 = 2 * s2 * rho2 * u1, b = t1 / b1, sq = Math.sqrt(b * b + 1) - b;
        return sq < 1e-9 ? -18 : Math.log(sq);
      };
      const sinh = n => (Math.exp(n) - Math.exp(-n)) / 2, cosh = n => (Math.exp(n) + Math.exp(-n)) / 2;
      const tanh = n => sinh(n) / cosh(n);
      const r0 = r(0);
      const S = (r(1) - r0) / rho;
      if (!isFinite(S) || u1 < 2) return this._easeTo(to.x, to.y, zoom, opts.duration || 0.6);
      const dur = (opts.duration ? opts.duration * 1000 : clamp(S * 800, 500, 2000));
      this._anim = {
        kind: "fly", t0: now(), dur, z1: zoom,
        step: t => {
          const s = (1 - Math.pow(1 - t, 1.5)) * S;
          const u = w0 * (cosh(r0) * tanh(r0 + rho * s) - sinh(r0)) / rho2;
          const w = w0 * (cosh(r0) / cosh(r0 + rho * s));
          const k = u / u1;
          const z = z0 + Math.log2(w0 / w);
          return { x: (fx + (tx - fx) * k) / ws0, y: (fy + (ty - fy) * k) / ws0, z };
        },
        end: { x: to.x, y: to.y, z: zoom }
      };
      this.requestRender();
      return this;
    }

    getBoundsZoom(bounds, opts) {
      bounds = bounds instanceof LatLngBounds ? bounds : new LatLngBounds(bounds);
      const o = this._padding(opts);
      const nw = project(bounds.north, bounds.west), se = project(bounds.south, bounds.east);
      const dx = Math.max(se.x - nw.x, 1e-9), dy = Math.max(se.y - nw.y, 1e-9);
      const availW = Math.max(40, this.W - o.l - o.r), availH = Math.max(40, this.H - o.t - o.b);
      let z = Math.log2(Math.min(availW / (dx * TILE), availH / (dy * TILE)));
      z = Math.floor(z * 4) / 4;   // шаг 0.25 — тайлы остаются чёткими
      return clamp(Math.min(z, opts && opts.maxZoom != null ? opts.maxZoom : this.maxZoom), this._minZ(), this.maxZoom);
    }
    _padding(opts) {
      opts = opts || {};
      const tl = opts.paddingTopLeft || opts.padding || [0, 0];
      const br = opts.paddingBottomRight || opts.padding || [0, 0];
      return { l: tl[0], t: tl[1], r: br[0], b: br[1] };
    }
    _boundsTarget(bounds, opts) {
      bounds = bounds instanceof LatLngBounds ? bounds : new LatLngBounds(bounds);
      if (!bounds.isValid()) return null;
      const z = this.getBoundsZoom(bounds, opts);
      const o = this._padding(opts);
      const nw = project(bounds.north, bounds.west), se = project(bounds.south, bounds.east);
      const ws = TILE * Math.pow(2, z);
      // смещение центра с учётом несимметричных отступов
      const x = (nw.x + se.x) / 2 + ((o.r - o.l) / 2) / ws;
      const y = (nw.y + se.y) / 2 + ((o.b - o.t) / 2) / ws;
      return { x, y, z };
    }
    fitBounds(bounds, opts) {
      const t = this._boundsTarget(bounds, opts);
      if (!t) return this;
      if (opts && opts.animate === false) { this.stop(); this._setView(t.x, t.y, t.z); return this; }
      return this._easeTo(t.x, t.y, t.z, opts && opts.duration != null ? opts.duration : 0.4);
    }
    flyToBounds(bounds, opts) {
      const t = this._boundsTarget(bounds, opts);
      if (!t) return this;
      const ll = unproject(t.x, t.y);
      return this.flyTo(ll, t.z, opts);
    }

    /* ---------- Слои ---------- */
    addLayer(layer) {
      if (this.layers.includes(layer)) return this;
      this.layers.push(layer);
      this.layers.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
      layer._map = this;
      if (layer.onAdd) layer.onAdd(this);
      this.requestRender();
      return this;
    }
    removeLayer(layer) {
      const i = this.layers.indexOf(layer);
      if (i < 0) return this;
      this.layers.splice(i, 1);
      if (layer.onRemove) layer.onRemove(this);
      layer._map = null;
      this.requestRender();
      return this;
    }
    hasLayer(layer) { return this.layers.includes(layer); }

    /* ---------- Цикл отрисовки ---------- */
    requestRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(t => { this._raf = 0; this._frame(t); });
    }

    _frame() {
      const t = now();
      const dt = this._lastFrame ? Math.min(64, t - this._lastFrame) : 16;
      this._lastFrame = t;
      let active = false;

      // анимации
      const a = this._anim;
      if (a) {
        const k = clamp((t - a.t0) / a.dur, 0, 1);
        if (a.kind === "ease") {
          const e = easeInOut(k);
          // зум интерполируем линейно, центр — в экранной метрике
          const z = a.z0 + (a.z1 - a.z0) * e;
          const s0 = Math.pow(2, a.z0), s1 = Math.pow(2, a.z1), s = Math.pow(2, z);
          const w = s0 === s1 ? e : (1 / s0 - 1 / s) / (1 / s0 - 1 / s1);
          this._setView(a.x0 + (a.x1 - a.x0) * w, a.y0 + (a.y1 - a.y0) * w, z);
        } else {
          const p = k >= 1 ? a.end : a.step(k);
          this._setView(p.x, p.y, p.z);
        }
        if (k >= 1) this._anim = null; else active = true;
      }
      // плавный зум колесом
      if (this._wheel) {
        const w = this._wheel;
        const diff = w.target - this.zoom;
        if (Math.abs(diff) < 0.002) { this._zoomAround(w.x, w.y, w.target); this._wheel = null; }
        else { this._zoomAround(w.x, w.y, this.zoom + diff * Math.min(1, dt / 70)); active = true; }
      }
      // инерция после перетаскивания
      if (this._inertia) {
        const v = this._inertia;
        const decay = Math.exp(-dt / 320);
        const ws = this.worldSize;
        this._setView(this.cx - v.vx * dt / ws, this.cy - v.vy * dt / ws, this.zoom);
        v.vx *= decay; v.vy *= decay;
        if (Math.hypot(v.vx, v.vy) < 0.02) this._inertia = null; else active = true;
      }
      if (this._constrainPending) { this._constrain(); this._constrainPending = false; }

      this._draw();

      const interacting = this._pointers.size > 0;
      if (active) this.requestRender();
      if (this._moving) {
        this.fire("move");
        if (!active && !interacting) {
          this._moving = false;
          this.fire("moveend");
          if (Math.abs(this._lastZoomFired - this.zoom) > 1e-6) {
            this._lastZoomFired = this.zoom;
            this.fire("zoomend");
          }
        }
      }
    }

    _view() {
      return {
        cx: this.cx, cy: this.cy, zoom: this.zoom, ws: this.worldSize,
        W: this.W, H: this.H, dpr: this.dpr, theme: this.theme,
        insets: this.insets || { left: 0, bottom: 0 }
      };
    }

    _draw() {
      const ctx = this.ctx, v = this._view();
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      ctx.globalAlpha = 1;
      const pal = window.KartografRender && KartografRender.PALETTES[this.theme];
      ctx.fillStyle = pal ? pal.land : "#F1EEE8";
      ctx.fillRect(0, 0, v.W, v.H);
      let pending = false;
      if (this.basemap) {
        pending = this.basemap.draw(ctx, v) || pending;
        this.basemap.drawLabels(ctx, v);
      }
      for (const layer of this.layers) {
        if (layer.draw) {
          ctx.save();
          if (layer.draw(ctx, v)) pending = true;
          ctx.restore();
        }
      }
      this._updatePopup();
      this._updateScale();
      this._updateZoomButtons();
      if (pending) this._pendingTimer = this._pendingTimer || setTimeout(() => { this._pendingTimer = 0; this.requestRender(); }, 120);
    }

    _updateZoomButtons() {
      const zi = this.zoom >= this.maxZoom - 1e-6, zo = this.zoom <= this._minZ() + 1e-6;
      if (this._zi !== zi) { this._zi = zi; this.zoomInBtn.disabled = zi; }
      if (this._zo !== zo) { this._zo = zo; this.zoomOutBtn.disabled = zo; }
    }

    _updateScale() {
      const lat = this.getCenter().lat;
      const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / this.worldSize;
      const key = Math.round(mpp * 1000);
      if (key === this._scaleKey) return;
      this._scaleKey = key;
      const maxPx = this.W < 480 ? 80 : 110;
      const nice = (maxUnits) => {
        const p = Math.pow(10, Math.floor(Math.log10(maxUnits)));
        const d = maxUnits / p;
        return p * (d >= 5 ? 5 : d >= 2 ? 2 : 1);
      };
      const m = nice(mpp * maxPx);
      this.scaleM.style.width = Math.round(m / mpp) + "px";
      this.scaleM.textContent = m >= 1000 ? (m / 1000) + " км" : m + " м";
      const SAZH = 2.1336;   // казённая сажень, м
      const s = nice(mpp * maxPx / SAZH);
      this.scaleS.style.width = Math.round(s * SAZH / mpp) + "px";
      this.scaleS.textContent = s.toLocaleString("ru-RU") + " саж.";
    }

    /* ---------- Попап ---------- */
    openPopup(latlng, html, opts) {
      this.closePopup();
      opts = opts || {};
      const ll = toLatLng(latlng);
      const root = el("div", "kg-popup " + (opts.className || ""), this.popupPane);
      const wrap = el("div", "kg-popup-content-wrapper", root);
      const content = el("div", "kg-popup-content", wrap, html);
      if (opts.maxWidth) content.style.maxWidth = opts.maxWidth + "px";
      el("div", "kg-popup-tip-container", root, '<div class="kg-popup-tip"></div>');
      const close = el("button", "kg-popup-close", wrap, "×");
      close.type = "button";
      close.setAttribute("aria-label", "Закрыть");
      close.addEventListener("click", e => { e.stopPropagation(); this.closePopup(); });
      root.addEventListener("pointerdown", e => e.stopPropagation());
      root.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
      root.addEventListener("dblclick", e => e.stopPropagation());
      const p = project(ll.lat, ll.lng);
      this._popup = { el: root, x: p.x, y: p.y, opts };
      this._updatePopup();
      // Автопанорамирование: попап целиком в кадре
      requestAnimationFrame(() => {
        if (!this._popup || this._popup.el !== root) return;
        const r = root.getBoundingClientRect(), c = this.container.getBoundingClientRect();
        const pad = 16;
        let dx = 0, dy = 0;
        if (r.top < c.top + pad) dy = r.top - c.top - pad;
        if (r.left < c.left + pad) dx = r.left - c.left - pad;
        else if (r.right > c.right - pad) dx = r.right - c.right + pad;
        if (dx || dy) this.panBy(dx, dy);
      });
      this.fire("popupopen");
      return this;
    }
    closePopup() {
      if (this._popup) {
        this._popup.el.remove();
        this._popup = null;
        this.fire("popupclose");
      }
      return this;
    }
    _updatePopup() {
      const p = this._popup;
      if (!p) return;
      const s = this.worldToScreen(p.x, p.y);
      p.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
    }

    showTooltip(text, sx, sy) {
      const t = this.tooltipEl;
      if (t.textContent !== text) t.textContent = text;
      t.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy - 12)}px) translate(-50%, -100%)`;
      t.classList.add("show");
    }
    hideTooltip() { this.tooltipEl.classList.remove("show"); }

    /* ---------- Попадание по объектам слоёв ---------- */
    _hit(sx, sy, touch) {
      for (let i = this.layers.length - 1; i >= 0; i--) {
        const l = this.layers[i];
        if (l.interactive === false || !l.hitTest) continue;
        const h = l.hitTest(sx, sy, touch ? 14 : 5, this._view());
        if (h) return { layer: l, hit: h };
      }
      return null;
    }

    /* ---------- События ввода ---------- */
    _bindEvents() {
      const c = this.container, cv = this.canvas;
      cv.style.touchAction = "none";

      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(() => this.invalidateSize());
        this._ro.observe(c);
      } else window.addEventListener("resize", () => this.invalidateSize());
      if (window.matchMedia) {
        // смена плотности пикселей (перенос окна на другой монитор)
        const mq = () => {
          const m = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
          const h = () => { m.removeEventListener("change", h); this.invalidateSize(); mq(); };
          if (m.addEventListener) m.addEventListener("change", h);
        };
        mq();
      }

      cv.addEventListener("pointerdown", e => this._onDown(e));
      cv.addEventListener("pointermove", e => this._onMove(e));
      cv.addEventListener("pointerup", e => this._onUp(e));
      cv.addEventListener("pointercancel", e => this._onUp(e, true));
      cv.addEventListener("pointerleave", e => {
        if (e.pointerType === "mouse" && !this._pointers.size) { this.hideTooltip(); cv.style.cursor = ""; }
      });
      cv.addEventListener("wheel", e => this._onWheel(e), { passive: false });
      cv.addEventListener("dblclick", e => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        this._zoomBy(e.shiftKey ? -1 : 1, e.clientX - r.left, e.clientY - r.top);
      });
      cv.addEventListener("contextmenu", e => { if (this._suppressContext) e.preventDefault(); });
      // Safari: жесты трекпада
      cv.addEventListener("gesturestart", e => e.preventDefault());
      c.addEventListener("keydown", e => this._onKey(e));
    }

    _local(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* синтетические события */ }
      const p = this._local(e);
      this.stop();
      this._pointers.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, type: e.pointerType });
      const n = this._pointers.size;
      if (n === 1) {
        this._gesture = { moved: false, t0: now(), start: p, samples: [{ t: now(), x: p.x, y: p.y }], type: e.pointerType };
      } else if (n === 2) {
        const [a, b] = [...this._pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this._pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.zoom, anchor: this.screenToWorld(mid.x, mid.y), t0: now(), moved: false };
        if (this._gesture) this._gesture.moved = true;   // двухпальцевый жест — не тап
        this.hideTooltip();
      }
    }

    _onMove(e) {
      const p = this._local(e);
      const ptr = this._pointers.get(e.pointerId);
      if (!ptr) {
        // наведение мышью: курсор и подсказки
        if (e.pointerType === "mouse") this._hover(p);
        return;
      }
      const dx = p.x - ptr.x, dy = p.y - ptr.y;
      ptr.x = p.x; ptr.y = p.y;
      if (this._pointers.size >= 2 && this._pinch) {
        const [a, b] = [...this._pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = clamp(this._pinch.z0 + Math.log2(d / this._pinch.d0), this._minZ(), this.maxZoom);
        if (Math.abs(z - this._pinch.z0) > 0.02) this._pinch.moved = true;
        this.zoom = z;
        const ws = this.worldSize;
        this._setView(this._pinch.anchor.x - (mid.x - this.W / 2) / ws, this._pinch.anchor.y - (mid.y - this.H / 2) / ws, z);
        return;
      }
      const g = this._gesture;
      if (!g) return;
      const thr = g.type === "mouse" ? 3 : 7;
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < thr) return;
      if (!g.moved) { g.moved = true; this.container.classList.add("kg-dragging"); this.hideTooltip(); }
      const ws = this.worldSize;
      this._setView(this.cx - dx / ws, this.cy - dy / ws, this.zoom);
      g.samples.push({ t: now(), x: p.x, y: p.y });
      if (g.samples.length > 8) g.samples.shift();
    }

    _onUp(e, cancelled) {
      const ptr = this._pointers.get(e.pointerId);
      if (!ptr) return;
      this._pointers.delete(e.pointerId);
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* уже снят */ }
      const p = this._local(e);

      if (this._pinch) {
        if (this._pointers.size === 1) {
          // двухпальцевый тап без движения — отдалить
          const quick = now() - this._pinch.t0 < 260 && !this._pinch.moved;
          const rest = [...this._pointers.values()][0];
          if (quick && Math.hypot(rest.x - rest.x0, rest.y - rest.y0) < 10) {
            this._twoFingerTap = true;
          }
          this._pinch = null;
          this._gesture = { moved: true, t0: now(), start: { x: rest.x, y: rest.y }, samples: [{ t: now(), x: rest.x, y: rest.y }], type: rest.type };
        }
        return;
      }
      if (this._pointers.size) return;
      const g = this._gesture;
      this._gesture = null;
      this.container.classList.remove("kg-dragging");
      if (this._twoFingerTap) {
        this._twoFingerTap = false;
        this.zoomOut();
        return;
      }
      if (!g || cancelled) { this.requestRender(); return; }
      if (g.moved) {
        // инерция по скорости последних ~100 мс
        const t = now();
        const s = g.samples.filter(q => t - q.t < 110);
        if (s.length >= 2 && !(REDUCED_MOTION && REDUCED_MOTION.matches)) {
          const a = s[0], b = s[s.length - 1];
          const dtm = Math.max(16, b.t - a.t);
          const vx = (b.x - a.x) / dtm, vy = (b.y - a.y) / dtm;
          const sp = Math.hypot(vx, vy);
          if (sp > 0.25 && t - b.t < 60) {
            const k = Math.min(1, 2.2 / sp);   // ограничиваем «бросок»
            this._inertia = { vx: vx * k, vy: vy * k };
          }
        }
        this.requestRender();
        return;
      }
      // Тап / клик
      const touch = g.type !== "mouse";
      if (touch) {
        const last = this._lastTap;
        if (last && now() - last.t < 300 && Math.hypot(p.x - last.x, p.y - last.y) < 30) {
          this._lastTap = null;
          this._zoomBy(1, p.x, p.y);
          return;
        }
        this._lastTap = { t: now(), x: p.x, y: p.y };
      }
      this._click(p, touch, e);
    }

    _click(p, touch, e) {
      const h = this._hit(p.x, p.y, touch);
      const ll = this.containerPointToLatLng(p);
      if (h && h.layer.onHit) {
        h.layer.onHit(h.hit, { latlng: ll, point: p, originalEvent: e, touch });
        return;
      }
      this.closePopup();
      this.hideTooltip();
      this.fire("click", { latlng: ll, point: p, originalEvent: e, touch });
    }

    _hover(p) {
      if (this._hoverRaf) { this._hoverPt = p; return; }
      this._hoverPt = p;
      this._hoverRaf = requestAnimationFrame(() => {
        this._hoverRaf = 0;
        const q = this._hoverPt;
        const h = this._hit(q.x, q.y, false);
        this.canvas.style.cursor = h && h.layer.cursor !== false ? "pointer" : "";
        const label = h && h.layer.tooltipFor ? h.layer.tooltipFor(h.hit) : "";
        if (label) this.showTooltip(label, q.x, q.y); else this.hideTooltip();
      });
    }

    _onWheel(e) {
      e.preventDefault();
      const p = this._local(e);
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= this.H;
      // щипок на тачпаде приходит как wheel c ctrlKey
      let delta = -dy * (e.ctrlKey ? 0.012 : Math.abs(dy) >= 40 ? 0.0036 : 0.006);
      delta = clamp(delta, -1, 1);
      this._anim = null; this._inertia = null;
      const base = this._wheel ? this._wheel.target : this.zoom;
      this._wheel = { target: clamp(base + delta, this._minZ(), this.maxZoom), x: p.x, y: p.y };
      this.hideTooltip();
      this.requestRender();
    }

    _onKey(e) {
      if (e.target !== this.container) return;
      const step = 90;
      const k = e.key;
      if (k === "ArrowLeft") this.panBy(-step, 0);
      else if (k === "ArrowRight") this.panBy(step, 0);
      else if (k === "ArrowUp") this.panBy(0, -step);
      else if (k === "ArrowDown") this.panBy(0, step);
      else if (k === "+" || k === "=") this.zoomIn();
      else if (k === "-" || k === "_") this.zoomOut();
      else if (k === "Escape") this.closePopup();
      else return;
      e.preventDefault();
    }
  }

  K.Map = KMap;
  K.LatLngBounds = LatLngBounds;
  K.project = project;
  K.unproject = unproject;
  K.toLatLng = toLatLng;
  K.Emitter = Emitter;
  K.TILE = TILE;
})();
