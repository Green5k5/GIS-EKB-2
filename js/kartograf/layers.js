/* =====================================================================
   Картограф — слои поверх подложки:
   ImageOverlay  — привязанные растры (исторические планы);
   LineLayer     — векторные линии (крепость, улицы, реки 1809 г.);
   FeatureLayer  — усадьбы: полигоны и кружки, выбор касанием/кликом.
   ===================================================================== */
(function () {
  "use strict";

  const K = window.Kartograf;
  const project = K.project;

  /* ---------- Привязанный растр --------------------------------------- */
  class ImageOverlay {
    constructor(url, bounds, opts) {
      opts = opts || {};
      this.url = url;
      this.bounds = new K.LatLngBounds(bounds);
      this.opacity = opts.opacity != null ? opts.opacity : 1;
      this.visible = opts.visible !== false;
      this.zIndex = opts.zIndex || 100;
      this.interactive = false;
      this.nw = project(this.bounds.north, this.bounds.west);
      this.se = project(this.bounds.south, this.bounds.east);
      this.img = null;
      this.state = "idle";
    }
    getBounds() { return this.bounds; }
    setOpacity(v) { this.opacity = v; if (this._map) this._map.requestRender(); return this; }
    setVisible(v) { this.visible = v; if (this._map) this._map.requestRender(); return this; }
    _load() {
      this.state = "loading";
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const finish = () => { this.img = img; this.state = "ready"; if (this._map) this._map.requestRender(); };
        img.decode ? img.decode().then(finish, finish) : finish();
      };
      img.onerror = () => { this.state = "error"; };
      img.src = this.url;
    }
    draw(ctx, v) {
      if (!this.visible || this.opacity <= 0) return false;
      const x0 = (this.nw.x - v.cx) * v.ws + v.W / 2, y0 = (this.nw.y - v.cy) * v.ws + v.H / 2;
      const x1 = (this.se.x - v.cx) * v.ws + v.W / 2, y1 = (this.se.y - v.cy) * v.ws + v.H / 2;
      if (x1 < 0 || y1 < 0 || x0 > v.W || y0 > v.H) return false;
      if (this.state === "idle") this._load();
      if (this.state !== "ready") return this.state === "loading";
      ctx.globalAlpha = this.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.img, x0, y0, x1 - x0, y1 - y0);
      return false;
    }
  }

  /* ---------- Линии с подсказками --------------------------------------- */
  // features: [{ lines: [[[lat,lng],...], ...], label, style: {color, weight, opacity, dash} }]
  class LineLayer {
    constructor(features, opts) {
      opts = opts || {};
      this.zIndex = opts.zIndex || 200;
      this.visible = opts.visible !== false;
      this.cursor = false;
      this.features = features.map(f => {
        const lines = f.lines.map(line => {
          const a = new Float64Array(line.length * 2);
          line.forEach((p, i) => { const q = project(p[0], p[1]); a[i * 2] = q.x; a[i * 2 + 1] = q.y; });
          return a;
        });
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        lines.forEach(a => { for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); } });
        return Object.assign({}, f, { lines, label: f.label || "", bbox: [x0, y0, x1, y1] });
      });
    }
    setVisible(v) { this.visible = v; if (this._map) this._map.requestRender(); }
    get interactive() { return this.visible; }
    draw(ctx, v) {
      if (!this.visible) return false;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const f of this.features) {
        const st = f.style;
        const b = f.bbox, m = 20 / v.ws;
        if (b[2] < v.cx - v.W / 2 / v.ws - m || b[0] > v.cx + v.W / 2 / v.ws + m ||
            b[3] < v.cy - v.H / 2 / v.ws - m || b[1] > v.cy + v.H / 2 / v.ws + m) continue;
        ctx.beginPath();
        for (const a of f.lines) {
          for (let i = 0; i < a.length; i += 2) {
            const x = (a[i] - v.cx) * v.ws + v.W / 2, y = (a[i + 1] - v.cy) * v.ws + v.H / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
        }
        // светлая подложка под линией — читается и поверх растровых планов
        if (st.halo) {
          ctx.strokeStyle = st.halo;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = st.weight + 2.5;
          ctx.setLineDash([]);
          ctx.stroke();
        }
        ctx.strokeStyle = st.color;
        ctx.globalAlpha = st.opacity != null ? st.opacity : 1;
        ctx.lineWidth = st.weight;
        ctx.setLineDash(st.dash || []);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return false;
    }
    hitTest(sx, sy, tol, v) {
      if (!this.visible) return null;
      let best = null, bestD = Infinity;
      for (const f of this.features) {
        const lim = tol + f.style.weight / 2;
        for (const a of f.lines) {
          let px = (a[0] - v.cx) * v.ws + v.W / 2, py = (a[1] - v.cy) * v.ws + v.H / 2;
          for (let i = 2; i < a.length; i += 2) {
            const qx = (a[i] - v.cx) * v.ws + v.W / 2, qy = (a[i + 1] - v.cy) * v.ws + v.H / 2;
            const d = segDist(sx, sy, px, py, qx, qy);
            if (d < lim && d < bestD) { bestD = d; best = f; }
            px = qx; py = qy;
          }
        }
      }
      return best && best.label ? best : null;
    }
    tooltipFor(f) { return f.label; }
    onHit(f, e) {
      // касание: подсказка появляется в точке касания на пару секунд
      const map = this._map;
      if (!map) return;
      map.closePopup();
      map.showTooltip(f.label, e.point.x, e.point.y);
      clearTimeout(this._tt);
      this._tt = setTimeout(() => map.hideTooltip(), e.touch ? 2200 : 1600);
    }
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* ---------- Усадьбы --------------------------------------------------- */
  // feature: { id, rings: [[[lat,lng],...]] | null, center: [lat,lng], radius (px),
  //            color, fillOpacity, weight, opacity, data }
  class FeatureLayer extends K.Emitter {
    constructor(opts) {
      super();
      opts = opts || {};
      this.zIndex = opts.zIndex || 300;
      this.features = [];
      this.selectedId = null;
      this.selectedColor = opts.selectedColor || "#2C2418";
      this.interactive = true;
    }
    setFeatures(list) {
      this.features = list.map(f => {
        const out = Object.assign({}, f);
        if (f.rings) {
          out.w = f.rings.map(r => {
            const a = new Float64Array(r.length * 2);
            r.forEach((p, i) => { const q = project(p[0], p[1]); a[i * 2] = q.x; a[i * 2 + 1] = q.y; });
            return a;
          });
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          out.w.forEach(a => { for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); } });
          out.bbox = [x0, y0, x1, y1];
        } else {
          const q = project(f.center[0], f.center[1]);
          out.px = q.x; out.py = q.y;
          out.bbox = [q.x, q.y, q.x, q.y];
        }
        return out;
      });
      this.byId = new Map(this.features.map(f => [f.id, f]));
      this._ver = (this._ver || 0) + 1;
      if (this._map) this._map.requestRender();
      return this;
    }
    getLayers() { return this.features; }
    getBounds() {
      const b = new K.LatLngBounds();
      for (const f of this.features) {
        if (f.rings) f.rings.forEach(r => r.forEach(p => b.extend(p)));
        else b.extend(f.center);
      }
      return b;
    }
    setSelected(id) {
      this.selectedId = id;
      if (this._map) this._map.requestRender();
    }

    /* Рисование с растровым кэшем: при перемещении карты усадьбы не
       перерисовываются заново, а сдвигается готовая картинка; во время
       зума кэш масштабируется, чёткая перерисовка — когда жест закончен. */
    draw(ctx, v) {
      const M = Math.round(Math.max(128, Math.min(320, 0.2 * Math.max(v.W, v.H))));
      const map = this._map;
      const c = this._cache;
      const busy = map && (map._pointers.size > 0 || map._wheel || map._anim);
      let blit = null;
      if (c && c.ver === this._ver && c.dpr === v.dpr) {
        const k = Math.pow(2, v.zoom - c.zoom);
        const sx = (c.x0 - v.cx) * v.ws + v.W / 2, sy = (c.y0 - v.cy) * v.ws + v.H / 2;
        const w = c.w * k, h = c.h * k;
        const covers = sx <= 0.5 && sy <= 0.5 && sx + w >= v.W - 0.5 && sy + h >= v.H - 0.5;
        const same = Math.abs(v.zoom - c.zoom) < 1e-9;
        if (covers && (same || (busy && k > 0.6 && k < 1.7))) {
          blit = [sx, sy, w, h];
          if (!same) this._scheduleSharp();
        }
      }
      if (!blit) {
        this._rebuild(v, M);
        blit = [-M, -M, this._cache.w, this._cache.h];
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this._cache.canvas, blit[0], blit[1], blit[2], blit[3]);

      const sel = this.selectedId != null && this.byId && this.byId.get(this.selectedId);
      if (sel) {
        ctx.beginPath();
        this._trace(ctx, sel, v, 3);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = sel.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = this.selectedColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return false;
    }

    _scheduleSharp() {
      clearTimeout(this._sharpT);
      this._sharpT = setTimeout(() => { if (this._map) this._map.requestRender(); }, 140);
    }

    _rebuild(v, M) {
      const W = v.W + 2 * M, H = v.H + 2 * M;
      let c = this._cache;
      if (!c) c = this._cache = { canvas: document.createElement("canvas") };
      const pw = Math.round(W * v.dpr), ph = Math.round(H * v.dpr);
      if (c.canvas.width !== pw || c.canvas.height !== ph) { c.canvas.width = pw; c.canvas.height = ph; }
      const x = c.canvas.getContext("2d");
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, pw, ph);
      x.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      const vv = { cx: v.cx, cy: v.cy, zoom: v.zoom, ws: v.ws, W, H, dpr: v.dpr };
      this._paint(x, vv);
      c.w = W; c.h = H; c.zoom = v.zoom; c.dpr = v.dpr; c.ver = this._ver;
      c.x0 = v.cx - W / 2 / v.ws; c.y0 = v.cy - H / 2 / v.ws;
    }

    _paint(ctx, v) {
      const left = v.cx - v.W / 2 / v.ws, right = v.cx + v.W / 2 / v.ws;
      const top = v.cy - v.H / 2 / v.ws, bottom = v.cy + v.H / 2 / v.ws;
      const m = 12 / v.ws;
      // группируем по стилю: одна заливка на цвет — быстрее и без
      // потемнения в местах наложения полупрозрачных участков
      const groups = new Map();
      for (const f of this.features) {
        const b = f.bbox;
        if (b[2] < left - m || b[0] > right + m || b[3] < top - m || b[1] > bottom + m) continue;
        const key = f.color + "|" + f.fillOpacity + "|" + f.weight + "|" + f.opacity + "|" + (f.dashed ? 1 : 0);
        let g = groups.get(key);
        if (!g) { g = { f, list: [] }; groups.set(key, g); }
        g.list.push(f);
      }
      ctx.lineJoin = "round";
      for (const { f: st, list } of groups.values()) {
        ctx.beginPath();
        for (const f of list) this._trace(ctx, f, v);
        ctx.fillStyle = st.color;
        ctx.globalAlpha = st.fillOpacity;
        ctx.fill("nonzero");
        ctx.strokeStyle = st.color;
        ctx.globalAlpha = st.opacity;
        ctx.lineWidth = st.weight;
        ctx.setLineDash(st.dashed ? [3, 2.5] : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    _trace(ctx, f, v, extraR) {
      if (f.w) {
        for (const a of f.w) {
          for (let i = 0; i < a.length; i += 2) {
            const x = (a[i] - v.cx) * v.ws + v.W / 2, y = (a[i + 1] - v.cy) * v.ws + v.H / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      } else {
        const x = (f.px - v.cx) * v.ws + v.W / 2, y = (f.py - v.cy) * v.ws + v.H / 2;
        const r = f.radius + (extraR || 0);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }

    hitTest(sx, sy, tol, v) {
      const wx = v.cx + (sx - v.W / 2) / v.ws, wy = v.cy + (sy - v.H / 2) / v.ws;
      const tw = tol / v.ws;
      let inside = null, insideArea = Infinity, near = null, nearD = Infinity;
      for (const f of this.features) {
        const b = f.bbox;
        if (wx < b[0] - tw - (f.radius || 0) / v.ws || wx > b[2] + tw + (f.radius || 0) / v.ws ||
            wy < b[1] - tw - (f.radius || 0) / v.ws || wy > b[3] + tw + (f.radius || 0) / v.ws) continue;
        if (f.w) {
          if (pointInRings(wx, wy, f.w)) {
            const area = (b[2] - b[0]) * (b[3] - b[1]);
            if (area < insideArea) { insideArea = area; inside = f; }
            continue;
          }
          for (const a of f.w) {
            for (let i = 0; i < a.length; i += 2) {
              const j = (i + 2) % a.length;
              const d = segDist(sx, sy,
                (a[i] - v.cx) * v.ws + v.W / 2, (a[i + 1] - v.cy) * v.ws + v.H / 2,
                (a[j] - v.cx) * v.ws + v.W / 2, (a[j + 1] - v.cy) * v.ws + v.H / 2);
              if (d < nearD) { nearD = d; near = f; }
            }
          }
        } else {
          const x = (f.px - v.cx) * v.ws + v.W / 2, y = (f.py - v.cy) * v.ws + v.H / 2;
          const d = Math.max(0, Math.hypot(sx - x, sy - y) - f.radius);
          if (d < nearD) { nearD = d; near = f; }
        }
      }
      if (inside) return inside;
      return nearD <= tol ? near : null;
    }
    onHit(f, e) { this.fire("click", { feature: f, latlng: e.latlng, point: e.point, touch: e.touch }); }
  }

  function pointInRings(x, y, rings) {
    let inside = false;
    for (const a of rings) {
      const n = a.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = a[i * 2], yi = a[i * 2 + 1], xj = a[j * 2], yj = a[j * 2 + 1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  }

  K.ImageOverlay = ImageOverlay;
  K.LineLayer = LineLayer;
  K.FeatureLayer = FeatureLayer;
})();
