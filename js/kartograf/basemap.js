/* =====================================================================
   Картограф — подложка: загрузка тайлов через фоновые потоки,
   кэш растров, подмена недогруженных тайлов соседними уровнями,
   расстановка подписей без наложений.
   ===================================================================== */
(function () {
  "use strict";

  const K = window.Kartograf;
  const TILE = 256;

  /* ---------- Запасной «поток» в основном потоке --------------------- */
  // Для браузеров без OffscreenCanvas в воркере. Интерфейс как у Worker.
  class MainThreadRenderer {
    constructor(loader) {
      this.loader = loader || (m => fetch(m.url).then(r => r.status === 404 ? null :
        (r.ok ? r.arrayBuffer() : Promise.reject(new Error("HTTP " + r.status)))));
      this.onmessage = null;
      this.cache = new Map();
      this.queue = [];
      this.busy = false;
    }
    _data(m) {
      const url = m.url;
      let p = this.cache.get(url);
      if (p) return p;
      p = Promise.resolve(this.loader(m))
        .then(b => b ? KartografRender.prepare(KartografMVT.decode(b)) : null);
      p.catch(() => this.cache.delete(url));
      this.cache.set(url, p);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
      return p;
    }
    postMessage(m) {
      if (m.type === "init") { setTimeout(() => this.onmessage({ data: { type: "ready", ok: true } })); return; }
      this.queue.push(m);
      this._pump();
    }
    _pump() {
      if (this.busy || !this.queue.length) return;
      this.busy = true;
      const m = this.queue.shift();
      this._data(m).then(data => {
        // рисуем в отдельной задаче, чтобы не блокировать кадр
        setTimeout(() => {
          try {
            if (m.type === "labels") {
              this.onmessage({ data: { type: "labels", key: m.key, labels: data ? data.labels : [] } });
            } else if (!data) {
              this.onmessage({ data: { type: "tile", id: m.id, empty: true } });
            } else {
              const c = document.createElement("canvas");
              c.width = c.height = m.size;
              KartografRender.renderTile(c.getContext("2d"), data, m);
              this.onmessage({ data: { type: "tile", id: m.id, bitmap: c } });
            }
          } catch (err) {
            this.onmessage({ data: { type: m.type === "labels" ? "labels" : "tile", id: m.id, key: m.key, error: String(err) } });
          }
          this.busy = false;
          this._pump();
        }, 0);
      }, err => {
        this.onmessage({ data: { type: m.type === "labels" ? "labels" : "tile", id: m.id, key: m.key, error: String(err) } });
        this.busy = false;
        this._pump();
      });
    }
    terminate() { this.queue.length = 0; }
  }

  /* ---------- Автономный комплект (просмотр без сервера) ------------ */
  // На file:// браузер запрещает fetch, но разрешает <script>. Поэтому
  // тайлы упакованы в скрипты-«пачки» по 8×8 тайлов (tools/basemap/
  // make_offline.py); пачка вызывает KartografOfflinePack(ключ, тайлы).
  const PACK_SHIFT = 3;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = src;
      sc.onload = () => { sc.remove(); resolve(); };
      sc.onerror = () => { sc.remove(); reject(new Error("не загрузился " + src)); };
      document.head.appendChild(sc);
    });
  }
  class OfflinePacks {
    constructor(base) {
      this.base = base;
      this.packs = new Map();
      window.KartografOfflinePack = (key, tiles) => {
        const p = this.packs.get(key);
        if (p) p.tiles = tiles;
      };
    }
    get(z, x, y) {
      const px = x >> PACK_SHIFT, py = y >> PACK_SHIFT;
      const key = z + "/" + px + "/" + py;
      let p = this.packs.get(key);
      if (!p) {
        const inline = window.KartografOffline && window.KartografOffline.packs;
        if (inline) {
          // однофайловая сборка (tools/build_single.py): пачки уже в странице
          p = { tiles: inline[key] || null, ready: Promise.resolve() };
        } else {
          p = { tiles: null };
          p.ready = loadScript(this.base + z + "/" + px + "_" + py + ".js").catch(() => {});
        }
        this.packs.set(key, p);
      }
      return p.ready.then(() => {
        const b64 = p.tiles && p.tiles[x + "/" + y];
        if (!b64) return null;
        const bin = atob(b64);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return u.buffer;
      });
    }
  }

  /* ---------- Подложка ---------------------------------------------- */
  class Basemap {
    constructor(map, opts) {
      this.map = map;
      this.opts = opts;
      this.theme = map.theme;
      this.tiles = new Map();         // "z/x/y" -> запись
      this.labels = new Map();        // "dz/dx/dy" -> [подписи] | "loading"
      this.inflight = 0;
      this.nextId = 1;
      this.requests = new Map();      // id -> запись тайла
      this.sprites = new Map();       // кэш отрисованных подписей
      this.labelSeen = new Map();     // id подписи -> время появления (плавное проявление)
      this.ready = false;
      this.maxCache = window.matchMedia("(max-width: 768px)").matches ? 90 : 180;
      this._init();
    }

    async _init() {
      const fromFile = location.protocol === "file:";
      try {
        if (fromFile) throw new Error("file://");
        const r = await fetch(this.opts.url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        this.meta = await r.json();
      } catch (err) {
        // нет сервера — пробуем автономный комплект тайлов
        try {
          // в однофайловой сборке комплект уже встроен в страницу
          if (!window.KartografOffline) await loadScript(this.opts.offlineUrl + "basemap-offline.js");
          if (!window.KartografOffline) throw new Error("пустой комплект");
          this.meta = window.KartografOffline.meta;
          this.offline = new OfflinePacks(this.opts.offlineUrl);
        } catch (err2) {
          console.error("Картограф: не удалось загрузить подложку", err, err2);
          this.failed = true;
          this.map.fire("basemaperror", { error: err2 });
          return;
        }
      }
      const base = new URL(this.opts.url, location.href);
      // шаблон собираем строкой: new URL() экранировал бы фигурные скобки
      this.tileUrl = new URL(".", base).href + this.meta.tiles;
      // Точечные подписи (районы, водоёмы, станции) — один список на весь
      // город: не зависят от подгрузки тайлов и поэтому не пропадают.
      // Современные станции метро и железной дороги, ЖК, кварталы и урочища
      // на исторической карте не подписываем; остаются районы, воды и парки.
      const HIDE_LABEL = l => l[2] === "station" ||
        (l[2] === "place" && (l[3] === "quarter" || l[3] === "neighbourhood" || l[3] === "locality"));
      this.pointLabels = (this.meta.labels || []).filter(l => !HIDE_LABEL(l)).map((l, i) => {
        const p = K.project(l[1], l[0]);
        return { id: "p" + i, wx: p.x, wy: p.y, k: l[2], c: l[3], t: l[4], r: l[5], minz: l[6], a: 0 };
      });
      if (this.meta.bounds && this.map.setMaxBounds) {
        const b = this.meta.bounds, pad = 0.003;
        this.map.setMaxBounds([[b[1] + pad, b[0] + pad], [b[3] - pad, b[2] - pad]]);
      }
      this.version = this.meta.built || "1";
      this.minData = this.meta.minzoom;
      this.maxData = this.meta.maxzoom;
      this.extent = this.meta.extent || 4096;
      // индекс существующих тайлов: не запрашиваем пустые места
      this.index = {};
      for (const z in this.meta.index) {
        const m = new Map();
        for (const x in this.meta.index[z]) m.set(+x, this.meta.index[z][x]);
        this.index[z] = m;
      }
      if (this.meta.attribution && !this.opts.keepAttribution) {
        this.map.setAttribution(`<a href="${this.meta.attribution_url}" target="_blank" rel="noopener">${this.meta.attribution}</a>`);
      }
      await this._startWorkers();
      this.ready = true;
      this.map.requestRender();
    }

    _startWorkers() {
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      const url = this.opts.workerUrl;
      const useMain = () => {
        this.workers.forEach(w => w.terminate());
        const mw = new MainThreadRenderer(this.offline ? (m => this.offline.get(m.dz, m.dx, m.dy)) : null);
        mw.inflight = 0;
        mw.onmessage = e => this._onMessage(e.data, mw);
        this.workers = [mw];
        this.mode = "main";
      };
      this.workers = [];
      return new Promise(resolve => {
        let settled = false, ok = 0;
        const done = (good) => {
          if (settled) return;
          settled = true;
          if (!good) useMain(); else this.mode = "worker";
          resolve();
        };
        if (!url || typeof Worker === "undefined" || this.opts.forceMainThread || this.offline) { done(false); return; }
        try {
          for (let i = 0; i < n; i++) {
            const w = new Worker(url);
            w.inflight = 0;
            w.onmessage = e => {
              if (e.data.type === "ready") {
                if (!e.data.ok) done(false);
                else if (++ok === n) done(true);
                return;
              }
              this._onMessage(e.data, w);
            };
            w.onerror = () => done(false);
            w.postMessage({ type: "init" });
            this.workers.push(w);
          }
        } catch (err) {
          done(false);
          return;
        }
        setTimeout(() => done(ok > 0 ? true : false), 4000);
      }).then(() => {
        if (this.mode === "worker") this.workers = this.workers.filter(Boolean);
      });
    }

    setTheme(theme) {
      this.theme = theme;
      this.sprites.clear();
      this.map.requestRender();
    }

    /* ---------- Индекс ---------- */
    hasData(dz, dx, dy) {
      const zi = this.index[dz];
      if (!zi) return false;
      const ranges = zi.get(dx);
      if (!ranges) return false;
      for (let i = 0; i < ranges.length; i++) if (dy >= ranges[i][0] && dy <= ranges[i][1]) return true;
      return false;
    }
    url(dz, dx, dy) {
      return this.tileUrl.replace("{z}", dz).replace("{x}", dx).replace("{y}", dy) + "?v=" + this.version;
    }
    _worker(key) {
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
      return this.workers[Math.abs(h) % this.workers.length];
    }

    /* ---------- Приём результатов ---------- */
    _onMessage(m, worker) {
      if (m.type === "labels") {
        if (m.labels) this.labels.set(m.key, this._labelsToWorld(m.key, m.labels));
        else this.labels.delete(m.key);
        this.map.requestRender();
        return;
      }
      const rec = this.requests.get(m.id);
      this.requests.delete(m.id);
      this.inflight--;
      if (worker) worker.inflight--;
      if (!rec) { if (m.bitmap && m.bitmap.close) m.bitmap.close(); return; }
      rec.loading = false;
      if (m.error) {
        rec.retryAt = performance.now() + 4000;
      } else if (m.empty) {
        rec.empty = true;
      } else {
        if (rec.bitmap && rec.bitmap.close) rec.bitmap.close();
        rec.bitmap = m.bitmap;
        rec.theme = rec.reqTheme;
        rec.size = rec.reqSize;
      }
      this.map.requestRender();
    }

    _labelsToWorld(key, list) {
      const [dz, dx, dy] = key.split("/").map(Number);
      const n = Math.pow(2, dz), ext = this.extent;
      return list.map((l, i) => ({
        id: key + "#" + i,
        wx: (dx + l.x / ext) / n, wy: (dy + l.y / ext) / n,
        k: l.k, c: l.c, t: l.t, a: l.a || 0, z: l.z, r: l.r == null ? 9 : l.r
      }));
    }

    /* ---------- Кадр: тайлы ---------- */
    draw(ctx, v) {
      if (!this.ready) return true;
      const tz = Math.max(this.minData, Math.min(this.map.maxZoom, Math.round(v.zoom)));
      const scale = Math.pow(2, v.zoom - tz);
      const n = Math.pow(2, tz);
      const size = TILE * scale;
      const cxp = v.cx * n * TILE, cyp = v.cy * n * TILE;
      const x0 = Math.max(0, Math.floor((cxp - v.W / 2 / scale) / TILE));
      const x1 = Math.min(n - 1, Math.floor((cxp + v.W / 2 / scale) / TILE));
      const y0 = Math.max(0, Math.floor((cyp - v.H / 2 / scale) / TILE));
      const y1 = Math.min(n - 1, Math.floor((cyp + v.H / 2 / scale) / TILE));
      const rsize = Math.round(TILE * Math.min(2, Math.max(1, v.dpr)));
      const t = performance.now();
      const need = [];
      const fallbacks = new Map();
      const exact = [];
      this.frameId = (this.frameId || 0) + 1;
      let pending = false;

      const screenRect = (z, x, y) => {
        const k = Math.pow(2, tz - z);             // во сколько тайлов текущего зума укладывается
        const sx = (x * k * TILE - cxp) * scale + v.W / 2;
        const sy = (y * k * TILE - cyp) * scale + v.H / 2;
        const l = Math.round(sx), tp = Math.round(sy);
        return [l, tp, Math.round(sx + size * k) - l, Math.round(sy + size * k) - tp];
      };

      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const dz = Math.min(tz, this.maxData);
          const sh = tz - dz;
          if (!this.hasData(dz, x >> sh, y >> sh)) continue;
          const key = tz + "/" + x + "/" + y;
          let rec = this.tiles.get(key);
          if (!rec) { rec = { z: tz, x, y, key }; this.tiles.set(key, rec); }
          rec.used = t;
          rec.frame = this.frameId;
          const fresh = rec.bitmap && rec.theme === this.theme && rec.size === rsize;
          if (rec.bitmap) exact.push(rec);
          if (!fresh && !rec.empty) {
            if (!rec.loading && (!rec.retryAt || t > rec.retryAt)) need.push(rec);
            pending = true;
          }
          if (!rec.bitmap && !rec.empty) {
            // временная подмена: ближайший готовый предок…
            let found = false;
            for (let pz = tz - 1; pz >= Math.max(this.minData, tz - 6); pz--) {
              const s = tz - pz, pk = pz + "/" + (x >> s) + "/" + (y >> s);
              const pr = this.tiles.get(pk);
              if (pr && pr.bitmap) { pr.used = t; pr.frame = this.frameId; fallbacks.set(pk, pr); found = true; break; }
            }
            // …или готовые потомки (при отдалении)
            if (!found && tz + 1 <= this.map.maxZoom) {
              for (let i = 0; i < 4; i++) {
                const ck = (tz + 1) + "/" + (x * 2 + (i & 1)) + "/" + (y * 2 + (i >> 1));
                const cr = this.tiles.get(ck);
                if (cr && cr.bitmap) { cr.used = t; cr.frame = this.frameId; fallbacks.set(ck, cr); }
              }
            }
          }
        }
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const drawRec = (rec) => {
        const [l, tp, w, h] = screenRect(rec.z, rec.x, rec.y);
        ctx.drawImage(rec.bitmap, l, tp, w, h);
      };
      [...fallbacks.values()].sort((a, b) => a.z - b.z).forEach(rec => {
        if (rec.z > tz) {
          const [l, tp, w, h] = screenRect(rec.z, rec.x, rec.y);
          ctx.drawImage(rec.bitmap, l, tp, w, h);
        } else drawRec(rec);
      });
      exact.forEach(drawRec);

      // очередь: ближние к центру — первыми
      if (need.length) {
        const ccx = cxp / TILE, ccy = cyp / TILE;
        need.sort((a, b) => Math.hypot(a.x + 0.5 - ccx, a.y + 0.5 - ccy) - Math.hypot(b.x + 0.5 - ccx, b.y + 0.5 - ccy));
        const perWorker = this.mode === "main" ? 2 : 3;
        const limit = perWorker * this.workers.length;
        for (const rec of need) {
          if (this.inflight >= limit) break;
          this._request(rec, rsize, perWorker);
        }
      }
      this._prune();
      return pending || this.inflight > 0;
    }

    _request(rec, rsize, perWorker) {
      const dz = Math.min(rec.z, this.maxData);
      const sh = rec.z - dz;
      const dx = rec.x >> sh, dy = rec.y >> sh;
      const dkey = dz + "/" + dx + "/" + dy;
      const w = this._worker(dkey);
      if (w.inflight >= perWorker) return;
      const id = this.nextId++;
      rec.loading = true;
      rec.reqTheme = this.theme;
      rec.reqSize = rsize;
      this.requests.set(id, rec);
      this.inflight++;
      w.inflight = (w.inflight || 0) + 1;
      w.postMessage({ type: "render", id, url: this.url(dz, dx, dy), z: rec.z, x: rec.x, y: rec.y, dz, dx, dy, size: rsize, theme: this.theme });
    }

    _prune() {
      if (this.tiles.size <= this.maxCache) return;
      const list = [...this.tiles.values()].filter(r => r.frame !== this.frameId && !r.loading);
      list.sort((a, b) => a.used - b.used);
      let excess = this.tiles.size - this.maxCache;
      for (const r of list) {
        if (excess-- <= 0) break;
        if (r.bitmap && r.bitmap.close) r.bitmap.close();
        this.tiles.delete(r.key);
      }
    }

    /* ---------- Кадр: подписи ---------- */
    drawLabels(ctx, v) {
      if (!this.ready) return;
      const fz = Math.floor(v.zoom + 1e-6);
      const lz = Math.max(this.minData, Math.min(this.maxData, fz));
      const az = Math.min(fz, 17);
      const n = Math.pow(2, lz);
      const margin = 160 / v.ws;     // подписи чуть за краем — чтобы не «выпрыгивали»
      const wx0 = v.cx - v.W / 2 / v.ws - margin, wx1 = v.cx + v.W / 2 / v.ws + margin;
      const wy0 = v.cy - v.H / 2 / v.ws - margin, wy1 = v.cy + v.H / 2 / v.ws + margin;
      const tx0 = Math.max(0, Math.floor(wx0 * n)), tx1 = Math.min(n - 1, Math.floor(wx1 * n));
      const ty0 = Math.max(0, Math.floor(wy0 * n)), ty1 = Math.min(n - 1, Math.floor(wy1 * n));
      const cands = [];
      // 1) точечные подписи — из общего списка
      for (const l of this.pointLabels) {
        if (l.minz > fz || l.wx < wx0 || l.wx > wx1 || l.wy < wy0 || l.wy > wy1) continue;
        if (l.k === "place" && l.c === "city" && fz > 12) continue;
        if (l.k === "place" && (l.c === "suburb" || l.c === "village" || l.c === "town") && fz > 16) continue;
        cands.push(l);
      }
      // 2) подписи улиц и рек — из тайлов текущего зума
      const visibleKeys = new Set();
      for (let x = tx0; x <= tx1; x++) {
        for (let y = ty0; y <= ty1; y++) {
          if (!this.hasData(lz, x, y)) continue;
          const key = lz + "/" + x + "/" + y;
          visibleKeys.add(key);
          const L = this.labels.get(key);
          if (!L) {
            this.labels.set(key, "loading");
            this._worker(key).postMessage({ type: "labels", key, url: this.url(lz, x, y), dz: lz, dx: x, dy: y });
            continue;
          }
          if (L === "loading") continue;
          for (let i = 0; i < L.length; i++) {
            const l = L[i];
            if (l.k !== "road" && l.k !== "river") continue;   // точечные берём из общего списка
            if (l.wx < wx0 || l.wx > wx1 || l.wy < wy0 || l.wy > wy1) continue;
            if (l.z != null && l.z !== (lz === this.maxData ? az : lz)) continue;
            cands.push(l);
          }
        }
      }
      if (this.labels.size > 300) {
        // уборка кэша подписей: не трогаем то, что сейчас в кадре
        for (const k of this.labels.keys()) {
          if (this.labels.size <= 200) break;
          if (!visibleKeys.has(k) && this.labels.get(k) !== "loading") this.labels.delete(k);
        }
      }
      // Устойчивость: при равном приоритете вперёд идут подписи, которые
      // уже были на экране в прошлом кадре, — меньше «перескоков».
      const seen = this.labelSeen;
      cands.sort((p, q) => (p.r - q.r) || ((seen.has(q.id) ? 1 : 0) - (seen.has(p.id) ? 1 : 0)));

      const pal = KartografRender.PALETTES[this.theme];
      const placed = [];
      const grid = new Map();
      const G = 96;
      const collides = (b) => {
        const gx0 = Math.floor(b[0] / G), gx1 = Math.floor(b[2] / G), gy0 = Math.floor(b[1] / G), gy1 = Math.floor(b[3] / G);
        for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
          const cell = grid.get(gx * 100003 + gy);
          if (!cell) continue;
          for (const o of cell) if (!(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3])) return true;
        }
        return false;
      };
      const insert = (b) => {
        const gx0 = Math.floor(b[0] / G), gx1 = Math.floor(b[2] / G), gy0 = Math.floor(b[1] / G), gy1 = Math.floor(b[3] / G);
        for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
          const k = gx * 100003 + gy;
          (grid.get(k) || grid.set(k, []).get(k)).push(b);
        }
      };
      // Панели поверх карты (масштаб, «Слои карты», кнопка темы) — тоже
      // препятствия: подпись не прячется под ними наполовину.
      const obstacles = this._obstacles();
      for (const r of obstacles) insert(r);
      const lastByText = new Map();
      const t = performance.now();
            let animating = false;

      for (const l of cands) {
        const sx = (l.wx - v.cx) * v.ws + v.W / 2, sy = (l.wy - v.cy) * v.ws + v.H / 2;
        if (sx < -200 || sx > v.W + 200 || sy < -60 || sy > v.H + 60) continue;
        const sp = this._sprite(l, fz, pal, v.dpr);
        if (!sp) continue;
        const a = (l.k === "road" || l.k === "river") ? l.a * Math.PI / 180 : 0;
        const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
        const hw = (sp.w * cos + sp.h * sin) / 2 + 2, hh = (sp.w * sin + sp.h * cos) / 2 + 2;
        const ax = sx + sp.ox, ay = sy + sp.oy;
        const box = [ax - hw, ay - hh, ax + hw, ay + hh];
        // подпись показываем только целиком: обрезанные краем экрана
        // (или нижней шторкой на телефоне) названия выглядят неряшливо
        const ins = v.insets || { left: 0, bottom: 0 };
        if (box[0] < ins.left + 1 || box[1] < 1 || box[2] > v.W - 1 || box[3] > v.H - ins.bottom - 1) continue;
        if (l.k === "road" || l.k === "river") {
          const prev = lastByText.get(l.t);
          if (prev && prev.some(p => Math.hypot(p[0] - sx, p[1] - sy) < 200)) continue;
        }
        if (collides(box)) continue;
        insert(box);
        if (l.k === "road" || l.k === "river") (lastByText.get(l.t) || lastByText.set(l.t, []).get(l.t)).push([sx, sy]);
        const prev = this.labelSeen.get(l.id);
        let t0 = prev && t - prev.last < 600 ? prev.t0 : t;
        const alpha = Math.min(1, (t - t0) / 220);
        if (alpha < 1) animating = true;
        placed.push([l, sp, ax, ay, a, alpha, t0]);
      }
      // помним и недавно скрытые подписи — вернувшись, они не мигают
      const nextSeen = new Map();
      for (const [id, v] of this.labelSeen) if (t - v.last < 600) nextSeen.set(id, v);
      for (const p of placed) nextSeen.set(p[0].id, { t0: p[6], last: t });
      this.labelSeen = nextSeen;

      for (const [, sp, ax, ay, a, alpha] of placed) {
        ctx.globalAlpha = alpha;
        if (a) {
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(a);
          ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
          ctx.restore();
        } else {
          ctx.drawImage(sp.canvas, Math.round(ax - sp.w / 2), Math.round(ay - sp.h / 2), sp.w, sp.h);
        }
      }
      ctx.globalAlpha = 1;
      if (animating) this.map.requestRender();
    }

    _obstacles() {
      const now = performance.now();
      if (this._obsCache && now - this._obsCache.t < 250) return this._obsCache.list;
      const root = this.map.container, cr = root.getBoundingClientRect();
      const sel = ".kg-control" + (this.opts.obstacles ? ", " + this.opts.obstacles : "");
      const list = [];
      document.querySelectorAll(sel).forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).display === "none") return;
        const x0 = r.left - cr.left - 4, y0 = r.top - cr.top - 4, x1 = r.right - cr.left + 4, y1 = r.bottom - cr.top + 4;
        if (x1 < 0 || y1 < 0 || x0 > cr.width || y0 > cr.height) return;
        list.push([x0, y0, x1, y1]);
      });
      this._obsCache = { t: now, list };
      return list;
    }

    _font(l, z) {
      const SANS = "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";
      const SERIF = "Georgia, 'Times New Roman', serif";
      const big = z >= 17 ? 1 : 0;
      switch (l.k) {
        case "place":
          if (l.c === "city") return { font: `700 ${z <= 10 ? 15 : 17}px ${SERIF}`, color: "place", ls: 1.5 };
          if (l.c === "town") return { font: `600 14px ${SERIF}`, color: "place", ls: 0.6 };
          if (l.c === "suburb") return { font: `600 ${z >= 13 ? 13.5 : 12.5}px ${SERIF}`, color: "place", ls: 0.8 };
          if (l.c === "village") return { font: `600 12.5px ${SERIF}`, color: "place", ls: 0.4 };
          if (l.c === "quarter") return { font: `500 12px ${SERIF}`, color: "placeMinor", ls: 0.3 };
          if (l.c === "locality") return { font: `italic 11.5px ${SERIF}`, color: "placeMinor" };
          return { font: `500 11.5px ${SERIF}`, color: "placeMinor" };
        case "water":
          return { font: `italic ${l.r <= 3 ? 13.5 : 12}px ${SERIF}`, color: "waterText", ls: 0.4 };
        case "park":
          return { font: `italic 11.5px ${SERIF}`, color: "parkText" };
        case "river":
          return { font: `italic ${12.5 + big}px ${SERIF}`, color: "waterText", ls: 0.6 };
        case "station":
          return { font: `500 11.5px ${SANS}`, color: "text", icon: l.c };
        default: {
          const fs = ({ motorway: 12.5, trunk: 12.5, primary: 12, secondary: 12, tertiary: 11.5 }[l.c] || 11) + big;
          return { font: `${l.c === "minor" || l.c === "pedestrian" ? 400 : 500} ${fs}px ${SANS}`, color: "roadText", halo: "roadHalo" };
        }
      }
    }

    _sprite(l, z, pal, dpr) {
      const f = this._font(l, z);
      const key = l.k + "|" + f.font + "|" + (f.icon || "") + "|" + l.t;
      let sp = this.sprites.get(key);
      if (sp) return sp;
      const c = document.createElement("canvas");
      const x = c.getContext("2d");
      x.font = f.font;
      if (f.ls && "letterSpacing" in x) x.letterSpacing = f.ls + "px";
      const text = l.t || "";
      const tw = Math.ceil(x.measureText(text).width);
      const fs = parseFloat(f.font.match(/([\d.]+)px/)[1]);
      const halo = 2.6;
      const icon = f.icon ? 14 : 0;
      const w = tw + icon + halo * 2 + 2, h = Math.ceil(fs * 1.35 + halo * 2);
      const scale = Math.min(2, Math.max(1, dpr));
      c.width = Math.ceil(w * scale);
      c.height = Math.ceil(h * scale);
      x.scale(scale, scale);
      x.font = f.font;
      if (f.ls && "letterSpacing" in x) x.letterSpacing = f.ls + "px";
      x.textBaseline = "middle";
      x.lineJoin = "round";
      const tx = halo + 1 + icon, ty = h / 2 + 0.5;
      x.strokeStyle = pal[f.halo || "textHalo"];
      x.lineWidth = halo * 2;
      x.strokeText(text, tx, ty);
      x.fillStyle = pal[f.color];
      x.fillText(text, tx, ty);
      if (f.icon) {
        // значок станции: метро — кружок с «М», ж/д — квадрат
        x.fillStyle = pal.station;
        x.strokeStyle = pal.textHalo;
        x.lineWidth = 2;
        x.beginPath();
        if (f.icon === "metro") x.arc(halo + 6, ty, 6, 0, Math.PI * 2);
        else x.rect(halo + 0.5, ty - 5.5, 11, 11);
        x.stroke();
        x.fill();
        x.fillStyle = pal.land;
        x.font = "700 8px 'Segoe UI', system-ui, sans-serif";
        x.textAlign = "center";
        if ("letterSpacing" in x) x.letterSpacing = "0px";
        x.fillText(f.icon === "metro" ? "М" : "Ж", halo + 6, ty + 0.5);
      }
      // смещение: у станции подпись справа от значка, якорь — значок
      sp = { canvas: c, w, h, ox: f.icon ? (w / 2 - halo - 6) : 0, oy: 0 };
      if (this.sprites.size > 1500) this.sprites.clear();
      this.sprites.set(key, sp);
      return sp;
    }
  }

  K.Basemap = Basemap;
})();
