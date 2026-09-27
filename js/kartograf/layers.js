/* =====================================================================
   Картограф — слои поверх подложки:
   ImageOverlay  — привязанные растры (исторические планы);
   LineLayer     — простые векторные линии;
   HistoricLayer — крепость, улицы и реки 1809 г. в оформлении старого плана;
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

  /* ---------- Исторический план: улицы, реки, крепость ---------------- */
  /* Оформление в духе гравированного плана начала XIX века:
     — ширина задаётся в метрах на местности и растёт с зумом, как у
       настоящих улиц; на мелких зумах есть минимальная толщина в пикселях;
     — улицы — ленты с тёмной обводкой, перекрёстки без швов (все улицы
       одного вида обводятся и заливаются одним контуром);
     — реки — берега, заливка и «водяные линии» вдоль берегов;
     — крепость — земляной вал, стена и зубцы, обращённые наружу;
     — подписи идут вдоль линий, курсивом, без наложений.
     Всё рисуется в растровый кэш слоя (отдельный холст): при перемещении
     карты сдвигается готовая картинка, а в режиме «поверх исторических
     планов» заливку можно сделать полупрозрачной без двойного затемнения
     на перекрёстках. */
  const M_PER_PX_Z0 = 156543.03392;   // метров в пикселе на экваторе при зуме 0

  function stopsAt(stops, z) {
    if (!stops) return 0;
    if (z <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (z <= b[0]) return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]);
    }
    return stops[stops.length - 1][1];
  }
  const clamp01 = t => Math.max(0, Math.min(1, t));

  const HIT_RANK = { street: 0, fortress: 1, river: 2, riverbed: 3 };

  /* Растровый кэш слоя (тот же приём, что у усадеб): картинка рисуется
     с запасом за краями экрана; при перемещении карты сдвигается готовая
     картинка, во время зума — масштабируется, чёткая перерисовка —
     когда жест закончен или изменилось оформление (ver). */
  class RasterCache {
    constructor() { this.c = null; this._t = 0; }
    draw(ctx, v, ver, map, paint) {
      const M = Math.round(Math.max(128, Math.min(320, 0.2 * Math.max(v.W, v.H))));
      const busy = map && (map._pointers.size > 0 || map._wheel || map._anim);
      const c = this.c;
      let blit = null;
      if (c && c.ver === ver && c.dpr === v.dpr) {
        const k = Math.pow(2, v.zoom - c.zoom);
        const sx = (c.x0 - v.cx) * v.ws + v.W / 2, sy = (c.y0 - v.cy) * v.ws + v.H / 2;
        const w = c.w * k, h = c.h * k;
        const covers = sx <= 0.5 && sy <= 0.5 && sx + w >= v.W - 0.5 && sy + h >= v.H - 0.5;
        const same = Math.abs(v.zoom - c.zoom) < 1e-9;
        if (covers && (same || (busy && k > 0.6 && k < 1.7))) {
          blit = [sx, sy, w, h];
          if (!same) {
            clearTimeout(this._t);
            this._t = setTimeout(() => { if (map) map.requestRender(); }, 140);
          }
        }
      }
      if (!blit) {
        this._rebuild(v, M, ver, paint);
        blit = [-M, -M, this.c.w, this.c.h];
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.c.canvas, blit[0], blit[1], blit[2], blit[3]);
    }
    _rebuild(v, M, ver, paint) {
      const W = v.W + 2 * M, H = v.H + 2 * M;
      let c = this.c;
      if (!c) c = this.c = { canvas: document.createElement("canvas") };
      const pw = Math.round(W * v.dpr), ph = Math.round(H * v.dpr);
      if (c.canvas.width !== pw || c.canvas.height !== ph) { c.canvas.width = pw; c.canvas.height = ph; }
      const x = c.canvas.getContext("2d");
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, pw, ph);
      x.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      x.lineCap = "round";
      x.lineJoin = "round";
      paint(x, { cx: v.cx, cy: v.cy, zoom: v.zoom, ws: v.ws, W, H, dpr: v.dpr });
      c.w = W; c.h = H; c.zoom = v.zoom; c.dpr = v.dpr; c.ver = ver;
      c.x0 = v.cx - W / 2 / v.ws; c.y0 = v.cy - H / 2 / v.ws;
    }
  }

  const EARTH_M = 40075016.686;       // длина экватора, м (мир = 1 единица)

  /* Скругляет изломы ломаной: каждый угол заменяется плавной дугой
     (квадратичная кривая Безье с вершиной угла в роли опорной точки).
     Отступ от вершины — не больше r и не больше половины соседних
     отрезков, чтобы соседние дуги не налезали друг на друга. Концы
     линии остаются на месте. a — [x0, y0, x1, y1, …] в мировых единицах. */
  function roundCorners(a, r) {
    const n = a.length / 2;
    if (n < 3) return a;
    const out = [a[0], a[1]];
    for (let i = 1; i < n - 1; i++) {
      const px = a[i * 2 - 2], py = a[i * 2 - 1];
      const cx = a[i * 2], cy = a[i * 2 + 1];
      const nx = a[i * 2 + 2], ny = a[i * 2 + 3];
      const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy);
      if (l1 < 1e-12 || l2 < 1e-12) continue;
      const u1x = (cx - px) / l1, u1y = (cy - py) / l1, u2x = (nx - cx) / l2, u2y = (ny - cy) / l2;
      const turn = Math.acos(Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y)));
      if (turn < 0.02) { out.push(cx, cy); continue; }    // почти прямо — точку оставляем как есть
      // крайние точки линии не двигаются, поэтому у первого и последнего
      // отрезка можно брать его целиком только с одной стороны
      const d1 = Math.min(r, i === 1 ? l1 * 0.9 : l1 / 2);
      const d2 = Math.min(r, i === n - 2 ? l2 * 0.9 : l2 / 2);
      const ax = cx - u1x * d1, ay = cy - u1y * d1;
      const bx = cx + u2x * d2, by = cy + u2y * d2;
      const steps = Math.max(3, Math.min(14, Math.ceil(turn * 9)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, mt = 1 - t;
        out.push(mt * mt * ax + 2 * mt * t * cx + t * t * bx, mt * mt * ay + 2 * mt * t * cy + t * t * by);
      }
    }
    out.push(a[a.length - 2], a[a.length - 1]);
    return new Float64Array(out);
  }

  class HistoricLayer {
    // features: [{ kind: "street"|"river"|"fortress", lines: [[[lat,lng],...]], label, widthM? }]
    // opts.theme: { light: {...}, dark: {...} } — цвета; opts.spec — ширины по видам
    constructor(features, opts) {
      opts = opts || {};
      this.zIndex = opts.zIndex || 200;
      this.visible = opts.visible !== false;
      this.cursor = false;
      this.spec = opts.spec;
      this.palettes = opts.palettes;
      this.look = opts.look || {};
      this.dark = false;
      this.planMode = false;       // поверх растровых планов — заливка прозрачнее
      this._ver = 1;
      this._cache = new RasterCache();
      this._labelCache = new RasterCache();
      this._measure = new Map();
      this.features = features.map((f, idx) => {
        let cx = 0, cy = 0, n = 0, lat = 0;
        const lines = f.lines.map(line => {
          const a = new Float64Array(line.length * 2);
          line.forEach((p, i) => {
            const q = project(p[0], p[1]); a[i * 2] = q.x; a[i * 2 + 1] = q.y;
            cx += q.x; cy += q.y; lat += p[0]; n++;
          });
          return a;
        });
        // скругление изломов: радиус в метрах по виду объекта (opts.smooth)
        const rM = opts.smooth && opts.smooth[f.kind];
        if (rM) {
          const cosLat = Math.cos((lat / Math.max(1, n)) * Math.PI / 180);
          const rW = rM / (EARTH_M * cosLat);            // метры → мировые единицы
          for (let i = 0; i < lines.length; i++) lines[i] = roundCorners(lines[i], rW);
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        lines.forEach(a => { for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); } });
        // длина в мировых единицах — для порядка подписей
        let len = 0;
        lines.forEach(a => { for (let i = 2; i < a.length; i += 2) len += Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]); });
        return Object.assign({}, f, {
          id: idx, lines, label: f.label || "", bbox: [x0, y0, x1, y1], len,
          cosLat: Math.cos((lat / Math.max(1, n)) * Math.PI / 180), cx: cx / n, cy: cy / n
        });
      });
      // стороны «наружу» для стен крепости: центр — среднее всех точек стен
      const walls = this.features.filter(f => f.kind === "fortress");
      if (walls.length) {
        let sx = 0, sy = 0, k = 0;
        walls.forEach(f => f.lines.forEach(a => { for (let i = 0; i < a.length; i += 2) { sx += a[i]; sy += a[i + 1]; k++; } }));
        const C = [sx / k, sy / k];
        walls.forEach(f => {
          f.side = f.lines.map(a => {
            let s = 0;
            for (let i = 2; i < a.length; i += 2) {
              const dx = a[i] - a[i - 2], dy = a[i + 1] - a[i - 1];
              const mx = (a[i] + a[i - 2]) / 2 - C[0], my = (a[i + 1] + a[i - 1]) / 2 - C[1];
              s += -dy * mx + dx * my;          // нормаль (-dy, dx) · (середина − центр)
            }
            return s >= 0 ? 1 : -1;
          });
        });
      }
      // порядок подписей: крепость, реки, затем длинные улицы
      const rank = { fortress: 0, river: 1, street: 2 };
      this._labelOrder = this.features.filter(f => f.label && rank[f.kind] != null)
        .sort((a, b) => (rank[a.kind] - rank[b.kind]) || (b.len - a.len));
      // подписи — отдельным слоем над усадьбами, чтобы их не закрывали участки
      this._labelLayer = {
        zIndex: opts.labelZIndex || 310, interactive: false,
        draw: (ctx, v) => {
          if (!this.visible) return false;
          const P = this.palettes[this.dark ? "dark" : "light"];
          this._labelCache.draw(ctx, v, this._ver, this._map, (x, vv) => this._labels(x, vv, P));
          return false;
        }
      };
    }
    onAdd(map) { map.addLayer(this._labelLayer); }
    onRemove(map) { map.removeLayer(this._labelLayer); }

    _changed() { this._ver++; if (this._map) this._map.requestRender(); }
    setVisible(v) { this.visible = v; this._changed(); }
    setTheme(dark) { if (this.dark !== !!dark) { this.dark = !!dark; this._changed(); } }
    // сменить оформление целиком: { spec, palettes, look }
    setStyle(st) {
      this.spec = st.spec; this.palettes = st.palettes; this.look = st.look || {};
      this._measure.clear();
      this._changed();
    }
    setPlanMode(on) { if (this.planMode !== !!on) { this.planMode = !!on; this._changed(); } }
    get interactive() { return this.visible; }

    /* ширина линии в CSS-пикселях: метры на местности, но не тоньше минимума */
    _width(f, z, key) {
      const sp = this.spec[f.kind];
      const k = key || "";
      const meters = (!k && sp.byName && sp.byName[f.name]) || f[k + "widthM"] || sp[k + "widthM"] || 0;
      const mpp = M_PER_PX_Z0 * f.cosLat / Math.pow(2, z);
      let w = Math.max(stopsAt(sp[k + "minPx"], z), meters / mpp);
      if (sp[k + "maxPx"]) w = Math.min(w, sp[k + "maxPx"]);
      return w;
    }

    _visibleIn(f, v, m) {
      const b = f.bbox, mm = m / v.ws;
      return !(b[2] < v.cx - v.W / 2 / v.ws - mm || b[0] > v.cx + v.W / 2 / v.ws + mm ||
               b[3] < v.cy - v.H / 2 / v.ws - mm || b[1] > v.cy + v.H / 2 / v.ws + mm);
    }

    _trace(ctx, f, v) {
      for (const a of f.lines) {
        for (let i = 0; i < a.length; i += 2) {
          const x = (a[i] - v.cx) * v.ws + v.W / 2, y = (a[i + 1] - v.cy) * v.ws + v.H / 2;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
    }

    /* обводит список фич одним контуром, толщина — по каждой фиче отдельно
       (разные ширины → группируем по округлённой ширине) */
    _strokeGroups(ctx, v, list, widthOf, style, alpha) {
      const groups = new Map();
      for (const f of list) {
        const w = Math.round(widthOf(f) * 4) / 4;
        if (w <= 0) continue;
        let g = groups.get(w); if (!g) groups.set(w, g = []);
        g.push(f);
      }
      ctx.strokeStyle = style;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      for (const [w, g] of groups) {
        ctx.beginPath();
        for (const f of g) this._trace(ctx, f, v);
        ctx.lineWidth = w;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    draw(ctx, v) {
      if (!this.visible) return false;
      this._cache.draw(ctx, v, this._ver, this._map, (x, vv) => this._paint(x, vv));
      return false;
    }

    _paint(x, v) {
      const P = this.palettes[this.dark ? "dark" : "light"];
      const look = this.look || {};
      const z = v.zoom;
      const vis = this.features.filter(f => this._visibleIn(f, v, 80));
      if (!vis.length) return;
      const rivers = vis.filter(f => f.kind === "river");
      const beds = vis.filter(f => f.kind === "riverbed");
      const streets = vis.filter(f => f.kind === "street");
      const walls = vis.filter(f => f.kind === "fortress");

      /* ---- старое русло под прудом: пунктир без берегов ---- */
      if (beds.length) {
        x.setLineDash([7, 5]);
        x.lineCap = "butt";
        this._strokeGroups(x, v, beds, f => this._width(f, z), P.riverBed, 0.9);
        x.setLineDash([]);
        x.lineCap = "round";
      }

      /* ---- реки ---- */
      if (rivers.length) {
        const W = f => this._width(f, z);
        if (look.riverBank !== false) {
          const bank = f => W(f) + 2 * Math.max(0.7, Math.min(1.4, W(f) * 0.07));
          this._strokeGroups(x, v, rivers, bank, P.riverBank, look.riverBankAlpha);
        }
        this._strokeGroups(x, v, rivers, W, P.riverFill, look.riverAlpha);
        // «водяные линии» — тонкие линии вдоль берегов, как на гравюрах
        const nLines = look.waterlines == null ? 2 : look.waterlines;
        if (!this.planMode && nLines > 0) {
          const lines = [[3.2, 1.0, 11], [8.5, 1.0, 22]].slice(0, nLines);
          for (const [inset, th, minW] of lines) {
            const big = rivers.filter(f => W(f) >= minW);
            if (!big.length) continue;
            this._strokeGroups(x, v, big, f => W(f) - 2 * inset + 2 * th, P.riverLine, 1);
            this._strokeGroups(x, v, big, f => W(f) - 2 * inset, P.riverFill);
          }
        }
        if (this.planMode) this._fade(x, v, rivers, W, 0.55);
      }

      /* ---- улицы ---- */
      if (streets.length) {
        const W = f => this._width(f, z);
        x.lineCap = look.cap || "round";
        if (look.street === "line") {
          // тонкая линия с ореолом
          this._strokeGroups(x, v, streets, f => W(f) + 3, P.streetHalo, 0.85);
          this._strokeGroups(x, v, streets, W, P.streetLine, 1);
        } else if (look.street === "wash") {
          // полупрозрачная отмывка без обводки
          this._strokeGroups(x, v, streets, W, P.streetFill, this.planMode ? 0.35 : look.washAlpha || 0.5);
        } else {
          // лента с обводкой; на мелких зумах — сплошная линия
          const t = clamp01((W(streets[0]) - (look.ribbonFrom || 3)) / (look.ribbonSpan || 2.5));
          if (t < 1) this._strokeGroups(x, v, streets, f => W(f) + (look.solidExtra != null ? look.solidExtra : 0.6), P.streetLine, 1);
          if (t > 0) {
            const edge = look.edge || (w => Math.max(0.9, Math.min(2.2, w * 0.1)));
            this._strokeGroups(x, v, streets, f => W(f) + 2 * edge(W(f)), P.streetCasing, t);
            this._strokeGroups(x, v, streets, W, P.streetFill, t);
            if (look.inner !== false && W(streets[0]) >= 9 && !this.planMode) {
              this._strokeGroups(x, v, streets, f => W(f) * 0.62, P.streetInner, 0.9);
            }
            if (this.planMode) this._fade(x, v, streets, W, 0.6);
          }
        }
        x.lineCap = "round";
      }

      /* ---- крепость ---- */
      if (walls.length) {
        const W = f => this._width(f, z);
        const band = f => this._width(f, z, "band");
        if (look.band !== false) this._strokeGroups(x, v, walls, band, P.rampart, this.planMode ? 0.5 : 1);
        this._strokeGroups(x, v, walls, f => W(f) + (look.wallHaloPx != null ? look.wallHaloPx : 2), P.wallHalo, 0.9);
        this._strokeGroups(x, v, walls, W, P.wall);
        if (look.teeth !== false && z >= 13.6) {
          this._teeth(x, walls, v, W, P.wall, clamp01((z - 13.6) / 0.8), look.teethScale || 1);
        }
      }
    }

    /* делает середину лент полупрозрачной, края остаются чёткими */
    _fade(x, v, list, W, amount) {
      x.globalCompositeOperation = "destination-out";
      this._strokeGroups(x, v, list, f => Math.max(0, W(f) - 1.5), "#000", amount);
      x.globalCompositeOperation = "source-over";
    }

    /* зубцы стены: прямоугольники с внешней стороны через равные промежутки */
    _teeth(x, walls, v, W, color, alpha, scale) {
      scale = scale || 1;
      x.fillStyle = color;
      x.globalAlpha = alpha;
      x.beginPath();
      for (const f of walls) {
        const w = W(f);
        const tp = this.look && this.look.teethPx;                       // заданы явно — тонкая штриховка
        const tl = tp ? tp.l : Math.max(2.2, Math.min(7, w * 1.05)) * scale;         // вылет зубца
        const tw = tp ? tp.w : Math.max(2, Math.min(6, w * 0.95)) * Math.sqrt(scale); // ширина зубца
        const sp = tp ? tp.sp : Math.max(7, Math.min(20, w * 3.2)) / scale;           // шаг
        f.lines.forEach((a, li) => {
          const s = f.side[li];
          let carry = sp / 2;
          for (let i = 2; i < a.length; i += 2) {
            const ax = (a[i - 2] - v.cx) * v.ws + v.W / 2, ay = (a[i - 1] - v.cy) * v.ws + v.H / 2;
            const bx = (a[i] - v.cx) * v.ws + v.W / 2, by = (a[i + 1] - v.cy) * v.ws + v.H / 2;
            const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
            if (L < 1e-6) continue;
            const ux = dx / L, uy = dy / L;
            const nx = -uy * s, ny = ux * s;               // наружу
            let d = carry;
            // изломы скруглены заранее (roundCorners), поэтому шаг штриховки
            // идёт сквозь вершины без пропусков
            for (; d <= L; d += sp) {
              const px = ax + ux * d, py = ay + uy * d;
              if (px < -20 || py < -20 || px > v.W + 20 || py > v.H + 20) continue;
              const r0 = w / 2 - 0.3, r1 = w / 2 + tl;
              const hx = ux * tw / 2, hy = uy * tw / 2;
              x.moveTo(px - hx + nx * r0, py - hy + ny * r0);
              x.lineTo(px + hx + nx * r0, py + hy + ny * r0);
              x.lineTo(px + hx + nx * r1, py + hy + ny * r1);
              x.lineTo(px - hx + nx * r1, py - hy + ny * r1);
              x.closePath();
            }
            carry = d - L;
          }
        });
      }
      x.fill();
      x.globalAlpha = 1;
    }

    /* ---------- подписи вдоль линий ---------- */
    _labelStyle(f, z, P) {
      const SERIF = "Georgia, 'Times New Roman', serif";
      if (f.kind === "street") {
        if (z < 14.8) return null;
        const lk = this.look || {};
        const fs = (z >= 17 ? 13.5 : z >= 16 ? 12.5 : 11.5) + (lk.labelDelta || 0);
        const beside = this.look && this.look.labelBeside;
        return { font: `italic ${fs}px ${SERIF}`, fs, color: P.streetText, halo: P.streetLabelHalo || P.streetHalo, ls: 0.3,
                 text: f.label, repeat: 620, above: !!beside };
      }
      if (f.kind === "river") {
        if (z < 13.5) return null;
        const fs = (z >= 16 ? 14 : 12.5) + ((this.look && this.look.labelDelta) || 0);
        return { font: `italic ${fs}px ${SERIF}`, fs, color: P.riverText, halo: P.riverHalo, ls: 1.6, text: f.label, repeat: 700 };
      }
      if (f.kind === "fortress") {
        if (z < 13.8 || z > 17.5) return null;
        const fs = z >= 15.5 ? 11.5 : 10.5;
        return { font: `600 ${fs}px ${SERIF}`, fs, color: P.wallText, halo: P.wallHalo, ls: 2.4,
                 text: f.label.toUpperCase(), repeat: 1400, outside: true };
      }
      return null;
    }

    _textWidth(ctx, st) {
      const key = st.font + "|" + st.ls + "|" + st.text;
      let r = this._measure.get(key);
      if (!r) {
        ctx.font = st.font;
        const chars = Array.from(st.text);
        const ws = chars.map(c => ctx.measureText(c).width + st.ls);
        r = { chars, ws, total: ws.reduce((s, w) => s + w, 0) - st.ls };
        this._measure.set(key, r);
      }
      return r;
    }

    _labels(ctx, v, P) {
      const z = v.zoom;
      const placed = [];   // [x, y, r] — точки уже поставленных подписей
      const hits = (pts) => {
        for (const p of pts) for (const q of placed) {
          const dx = p[0] - q[0], dy = p[1] - q[1], rr = p[2] + q[2];
          if (dx * dx + dy * dy < rr * rr) return true;
        }
        return false;
      };
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const f of this._labelOrder) {
        const st = this._labelStyle(f, z, P);
        if (!st || !this._visibleIn(f, v, 0)) continue;
        const m = this._textWidth(ctx, st);
        const offset = st.outside ? (this._width(f, z) / 2 + Math.max(2.2, Math.min(7, this._width(f, z) * 1.05)) + st.fs * 0.75)
          : st.above ? (this._width(f, z) / 2 + st.fs * 0.62 + 1.5) : 0;
        f.lines.forEach((a, li) => {
          // экранные точки линии
          const pts = [];
          for (let i = 0; i < a.length; i += 2) pts.push([(a[i] - v.cx) * v.ws + v.W / 2, (a[i + 1] - v.cy) * v.ws + v.H / 2]);
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const L = cum[cum.length - 1];
          const need = m.total + 24;
          if (L < need) return;
          const n = Math.max(1, Math.floor(L / Math.max(st.repeat, need * 2)));
          const side = st.outside ? f.side[li] : st.above ? "above" : 0;
          for (let k = 0; k < n; k++) {
            const mid = L * (k + 0.5) / n;
            const g = this._placeGlyphs(pts, cum, mid, m, side, offset);
            if (!g) continue;
            // хотя бы середина — в кадре
            const c = g[Math.floor(g.length / 2)];
            if (c[0] < 0 || c[1] < 0 || c[0] > v.W || c[1] > v.H) continue;
            const probe = [];
            for (let i = 0; i < g.length; i += 2) probe.push([g[i][0], g[i][1], st.fs * 0.62]);
            if (hits(probe)) continue;
            placed.push(...probe);
            this._drawGlyphs(ctx, g, m, st);
          }
        });
      }
      ctx.globalAlpha = 1;
    }

    /* раскладывает буквы по линии вокруг точки mid; null — слишком крутой изгиб */
    _placeGlyphs(pts, cum, mid, m, side, offset) {
      const at = d => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const a = pts[i - 1], b = pts[i];
        const seg = cum[i] - cum[i - 1] || 1;
        const t = (d - cum[i - 1]) / seg;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
      };
      // читаем слева направо: если линия идёт справа налево — разворачиваем
      const p0 = at(mid - m.total / 2), p1 = at(mid + m.total / 2);
      const flip = p1[0] < p0[0];
      const out = [];
      let d = flip ? mid + m.total / 2 : mid - m.total / 2;
      let prevA = null, maxTurn = 0;
      for (let i = 0; i < m.chars.length; i++) {
        const cw = m.ws[i];
        const dc = flip ? d - (cw - 0) / 2 : d + cw / 2;
        const p = at(dc);
        let ang = p[2] + (flip ? Math.PI : 0);
        if (prevA != null) {
          let dA = ang - prevA;
          while (dA > Math.PI) dA -= 2 * Math.PI;
          while (dA < -Math.PI) dA += 2 * Math.PI;
          maxTurn = Math.max(maxTurn, Math.abs(dA));
        }
        prevA = ang;
        let x = p[0], y = p[1];
        if (side === "above") {
          // над линией по ходу чтения: «верхняя» нормаль к направлению текста
          x += Math.sin(ang) * offset; y -= Math.cos(ang) * offset;
        } else if (side) {
          // сдвиг наружу от стены: нормаль (-uy, ux)·side в направлении линии
          const ux = Math.cos(p[2]), uy = Math.sin(p[2]);
          x += -uy * side * offset; y += ux * side * offset;
        }
        out.push([x, y, ang]);
        d += flip ? -cw : cw;
      }
      if (maxTurn > 0.5) return null;
      return out;
    }

    _drawGlyphs(ctx, g, m, st) {
      ctx.font = st.font;
      for (let pass = 0; pass < 2; pass++) {
        if (pass === 0) { ctx.strokeStyle = st.halo; ctx.lineWidth = 3.2; }
        else ctx.fillStyle = st.color;
        for (let i = 0; i < g.length; i++) {
          const c = m.chars[i];
          if (c === " ") continue;
          ctx.save();
          ctx.translate(g[i][0], g[i][1]);
          ctx.rotate(g[i][2]);
          if (pass === 0) ctx.strokeText(c, 0, 0); else ctx.fillText(c, 0, 0);
          ctx.restore();
        }
      }
    }

    hitTest(sx, sy, tol, v) {
      if (!this.visible) return null;
      let best = null, bestD = Infinity;
      for (const f of this.features) {
        if (!f.label || !this._visibleIn(f, v, 20)) continue;
        const lim = tol + this._width(f, v.zoom) / 2;
        for (const a of f.lines) {
          let px = (a[0] - v.cx) * v.ws + v.W / 2, py = (a[1] - v.cy) * v.ws + v.H / 2;
          for (let i = 2; i < a.length; i += 2) {
            const qx = (a[i] - v.cx) * v.ws + v.W / 2, qy = (a[i + 1] - v.cy) * v.ws + v.H / 2;
            const d = segDist(sx, sy, px, py, qx, qy);
            // улица поверх реки: при попадании в обе выигрывает улица, затем стена
            const score = HIT_RANK[f.kind] * 1000 + d;
            if (d < lim && score < bestD) { bestD = score; best = f; }
            px = qx; py = qy;
          }
        }
      }
      return best;
    }
    tooltipFor(f) { return f.label; }
    onHit(f, e) {
      const map = this._map;
      if (!map) return;
      map.closePopup();
      map.showTooltip(f.label, e.point.x, e.point.y);
      clearTimeout(this._tt);
      this._tt = setTimeout(() => map.hideTooltip(), e.touch ? 2200 : 1600);
    }
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
  K.HistoricLayer = HistoricLayer;
})();
