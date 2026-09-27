/* =====================================================================
   Картограф — стиль подложки и отрисовка одного тайла.
   Используется в Web Worker (OffscreenCanvas) и в основном потоке
   (запасной режим для старых браузеров).
   ===================================================================== */
(function (root) {
  "use strict";

  /* ---------- Палитры ------------------------------------------------ */
  // Светлая: тёплая «бумажная» гамма сайта, приглушённая, чтобы
  // золотые усадьбы и исторические слои читались поверх неё.
  const LIGHT = {
    land: "#F1EEE8",
    landcover: {
      industrial: "#EAE6E0", institution: "#EFE8DE", farm: "#ECEADF", sand: "#EEE7D6",
      grass: "#E3E8D9", park: "#DAE4CF", sport: "#E0E6D6", cemetery: "#DDE1D4",
      scrub: "#DFE5D4", wood: "#D5DFCB", wetland: "#D9E2DA", parking: "#E8E4DD",
      apron: "#E3E0DA", pedestrian: "#F7F5F1"
    },
    water: "#BCCFDA",
    waterway: "#AFC5D2",
    building: "#E2DBD0", buildingLine: "#D1C7B9", buildingShadow: "#D6CDBF",
    road: {
      motorway: ["#FFFBF3", "#D2C4AC"], trunk: ["#FFFBF3", "#D2C4AC"],
      primary: ["#FFFFFF", "#D6CBB9"], secondary: ["#FFFFFF", "#DAD0C1"],
      tertiary: ["#FFFFFF", "#DDD5C8"], minor: ["#FFFFFF", "#E0D9CE"],
      service: ["#FBFAF7", "#E3DDD3"], pedestrian: ["#F8F6F1", "#E2DBCF"],
      path: ["#D8CFC2", null], steps: ["#CFC5B6", null], track: ["#D6CBB8", null]
    },
    tunnelAlpha: 0.45,
    rail: "#B9B1A5", railDash: "#F1EEE8", railMinor: "#CBC4B9", tram: "#C2B9AC",
    runway: "#DCD7CF", taxiway: "#E2DED7",
    // подписи
    text: "#6E6457", textHalo: "rgba(241,238,232,0.92)",
    place: "#6B5F50", placeMinor: "#857A6B",
    roadText: "#7D7263", roadHalo: "rgba(255,255,255,0.95)",
    waterText: "#557689", parkText: "#62765A", station: "#8C5E4B"
  };

  // Тёмная: в тон тёмной теме сайта (--bg #1a1a1a, акцент #C49A5C)
  const DARK = {
    land: "#1D1D1C",
    landcover: {
      industrial: "#222120", institution: "#24221F", farm: "#222420", sand: "#26241F",
      grass: "#212620", park: "#20271F", sport: "#222720", cemetery: "#212420",
      scrub: "#20251F", wood: "#1C241C", wetland: "#1D2423", parking: "#232220",
      apron: "#242321", pedestrian: "#262523"
    },
    water: "#1A2A33",
    waterway: "#223642",
    building: "#2A2927", buildingLine: "#34322F", buildingShadow: "#171716",
    road: {
      motorway: ["#4A443B", "#141413"], trunk: ["#4A443B", "#141413"],
      primary: ["#433F39", "#151514"], secondary: ["#3D3A35", "#161615"],
      tertiary: ["#383632", "#171716"], minor: ["#33312E", "#181817"],
      service: ["#2E2D2B", "#191918"], pedestrian: ["#2F2E2B", "#191918"],
      path: ["#3A3834", null], steps: ["#403D38", null], track: ["#3B3833", null]
    },
    tunnelAlpha: 0.5,
    rail: "#4C4944", railDash: "#1D1D1C", railMinor: "#3A3835", tram: "#45423D",
    runway: "#2F2E2C", taxiway: "#2A2927",
    text: "#A69D90", textHalo: "rgba(29,29,28,0.92)",
    place: "#B3A796", placeMinor: "#948A7D",
    roadText: "#9D9486", roadHalo: "rgba(29,29,28,0.95)",
    waterText: "#7C9FB3", parkText: "#8FA184", station: "#C49A5C"
  };

  const PALETTES = { light: LIGHT, dark: DARK };

  /* Что из современной подложки не рисовать: на исторической карте
     железная дорога, трамвай, метро и аэродром только отвлекают. */
  const HIDE = { rail: true, aeroway: true };

  /* ---------- Ширины линий по зуму (CSS-пиксели) --------------------- */
  // Экспоненциальная интерполяция между опорными точками, как в
  // картографических стилях: на крупных зумах ширина растёт быстрее.
  function interp(stops, z, base) {
    base = base || 1.55;
    if (z <= stops[0][0]) return stops[0][1];
    const last = stops[stops.length - 1];
    if (z >= last[0]) {
      // экстраполяция вверх по последнему отрезку
      const prev = stops[stops.length - 2];
      const ratio = last[1] / prev[1];
      return last[1] * Math.pow(ratio, (z - last[0]) / (last[0] - prev[0]));
    }
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (z <= b[0]) {
        const t = (Math.pow(base, z - a[0]) - 1) / (Math.pow(base, b[0] - a[0]) - 1);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return last[1];
  }

  const ROAD_W = {
    motorway: [[10, 1.4], [12, 2.3], [14, 5], [16, 11], [18, 26]],
    trunk: [[10, 1.4], [12, 2.3], [14, 5], [16, 11], [18, 26]],
    primary: [[10, 1.0], [12, 2], [14, 4.4], [16, 10], [18, 24]],
    secondary: [[11, 0.8], [12, 1.5], [14, 3.8], [16, 9], [18, 22]],
    tertiary: [[12, 0.9], [14, 3.2], [16, 8], [18, 20]],
    minor: [[12, 0.45], [13, 0.9], [14, 2.1], [16, 6.5], [18, 17]],
    service: [[14, 0.8], [16, 3.2], [18, 8.5]],
    pedestrian: [[14, 1.1], [16, 3.8], [18, 9.5]],
    track: [[14, 0.6], [16, 1.3], [18, 2.2]],
    path: [[15, 0.6], [16, 1.0], [18, 1.9]],
    steps: [[15, 0.8], [16, 1.8], [18, 3]]
  };
  const ROAD_ORDER = ["track", "path", "steps", "service", "pedestrian", "minor", "tertiary",
    "secondary", "primary", "trunk", "motorway"];
  const CASED_MINZ = { motorway: 11, trunk: 11, primary: 12, secondary: 12, tertiary: 13,
    minor: 14, service: 15, pedestrian: 15 };

  const LANDCOVER_ORDER = ["industrial", "institution", "farm", "sand", "grass", "park",
    "sport", "cemetery", "scrub", "wood", "wetland", "parking", "apron", "pedestrian"];

  /* ---------- Разбор данных тайла под отрисовку ---------------------- */
  // Раскладываем фичи по стилевым группам один раз после декодирования.
  function prepare(decoded) {
    const L = decoded.layers;
    const groups = {
      landcover: {}, water: [], waterway: { river: [], stream: [], drain: [] },
      building: [], road: { "-1": {}, "0": {}, "1": {} }, rail: { "0": {}, "1": {} },
      aeroway: { runway: [], taxiway: [] }
    };
    const push = (obj, key, f) => { (obj[key] || (obj[key] = [])).push(f); };
    if (L.landcover) for (const f of L.landcover.features) push(groups.landcover, f.props.c, f);
    if (L.water) groups.water = L.water.features;
    if (L.waterway) for (const f of L.waterway.features) push(groups.waterway, f.props.c, f);
    if (L.building) groups.building = L.building.features;
    if (L.road) for (const f of L.road.features) push(groups.road[String(f.props.b || 0)], f.props.c, f);
    if (L.rail) for (const f of L.rail.features) push(groups.rail[f.props.b ? "1" : "0"], f.props.c, f);
    if (L.aeroway) for (const f of L.aeroway.features) push(groups.aeroway, f.props.c, f);
    const labels = [];
    if (L.label) {
      for (const f of L.label.features) {
        if (!f.parts || !f.parts[0]) continue;
        const p = f.props;
        labels.push({ x: f.parts[0][0], y: f.parts[0][1], k: p.k, c: p.c, t: p.t, a: p.a, z: p.z, r: p.r });
      }
    }
    return { groups, labels, extent: 4096 };
  }

  /* ---------- Отрисовка ---------------------------------------------- */
  function pathOf(features, close, cull) {
    const p = new Path2D();
    let n = 0;
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const b = f.bbox;
      if (cull && (b[2] < cull[0] || b[0] > cull[2] || b[3] < cull[1] || b[1] > cull[3])) continue;
      const parts = f.parts;
      for (let j = 0; j < parts.length; j++) {
        const r = parts[j];
        if (r.length < 4) continue;
        p.moveTo(r[0], r[1]);
        for (let k = 2; k < r.length; k += 2) p.lineTo(r[k], r[k + 1]);
        if (close) p.closePath();
        n++;
      }
    }
    return n ? p : null;
  }

  /**
   * Рисует тайл отображения (z, x, y) из тайла данных (dz, dx, dy).
   * ctx — 2D-контекст холста size×size (size = 256·dpr).
   */
  function renderTile(ctx, data, o) {
    const pal = PALETTES[o.theme] || LIGHT;
    const size = o.size, dpr = size / 256;
    const k = Math.pow(2, o.z - o.dz);                // во сколько раз увеличиваем данные
    const span = data.extent / k;                     // размер тайла отображения в единицах данных
    const ox = (o.x - o.dx * k) * span, oy = (o.y - o.dy * k) * span;
    const s = size / span;                            // пикселей холста на единицу данных
    const px = dpr / s;                               // одна CSS-точка в единицах данных
    const z = o.z;
    const cull = k > 1 ? [ox - 48 * px, oy - 48 * px, ox + span + 48 * px, oy + span + 48 * px] : null;
    const G = data.groups;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.land;
    ctx.fillRect(0, 0, size, size);
    ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 1. Покров (леса, парки, промзоны…) — одной заливкой на класс, без швов
    for (const c of LANDCOVER_ORDER) {
      const fs = G.landcover[c];
      if (!fs) continue;
      const p = pathOf(fs, true, cull);
      if (!p) continue;
      ctx.fillStyle = pal.landcover[c];
      ctx.fill(p);
    }

    // 2. Реки линиями — под площадными водоёмами, чтобы не просвечивали в прудах
    const wwW = { river: [[10, 0.8], [13, 1.6], [15, 3], [17, 7]], stream: [[13, 0.5], [15, 1], [17, 2.2]],
      drain: [[15, 0.5], [17, 1.2]] };
    ctx.strokeStyle = pal.waterway;
    for (const c of ["drain", "stream", "river"]) {
      const fs = G.waterway[c];
      if (!fs || !fs.length) continue;
      const p = pathOf(fs, false, cull);
      if (!p) continue;
      ctx.lineWidth = interp(wwW[c], z) * px;
      ctx.stroke(p);
    }
    // 3. Водоёмы
    if (G.water.length) {
      const p = pathOf(G.water, true, cull);
      if (p) { ctx.fillStyle = pal.water; ctx.fill(p); }
    }

    // 4. Аэродром (скрыт — см. HIDE)
    for (const c of HIDE.aeroway ? [] : ["taxiway", "runway"]) {
      const fs = G.aeroway[c];
      if (!fs || !fs.length) continue;
      const p = pathOf(fs, false, cull);
      if (!p) continue;
      ctx.strokeStyle = pal[c];
      ctx.lineCap = "butt";
      ctx.lineWidth = interp(c === "runway" ? [[11, 1.5], [13, 5], [15, 18], [17, 60]] : [[13, 1], [15, 4], [17, 14]], z) * px;
      ctx.stroke(p);
      ctx.lineCap = "round";
    }

    // 5. Здания; с 16-го зума — лёгкая «тень» для объёма
    if (G.building.length && z >= 14) {
      const p = pathOf(G.building, true, cull);
      if (p) {
        if (z >= 16) {
          const off = (z >= 18 ? 2.2 : z >= 17 ? 1.6 : 1.1) * px;
          ctx.save();
          ctx.translate(off * 0.6, off);
          ctx.fillStyle = pal.buildingShadow;
          ctx.fill(p);
          ctx.restore();
        }
        ctx.fillStyle = pal.building;
        ctx.globalAlpha = z === 14 ? 0.75 : 1;
        ctx.fill(p);
        ctx.globalAlpha = 1;
        if (z >= 15) {
          ctx.strokeStyle = pal.buildingLine;
          ctx.lineWidth = (z >= 16 ? 0.8 : 0.5) * px;
          ctx.stroke(p);
        }
      }
    }

    // 6. Дороги: тоннели → обычные (обводка, заливка) → ж/д → мосты
    const roadPaths = (level) => {
      const out = {};
      const R = G.road[level];
      for (const c of ROAD_ORDER) if (R[c] && R[c].length) out[c] = pathOf(R[c], false, cull);
      return out;
    };
    const drawRoads = (paths, alpha, dashed) => {
      ctx.globalAlpha = alpha;
      // обводка
      for (const c of ROAD_ORDER) {
        const p = paths[c];
        const col = pal.road[c];
        if (!p || !col[1] || z < (CASED_MINZ[c] || 99)) continue;
        const w = interp(ROAD_W[c], z);
        ctx.strokeStyle = col[1];
        ctx.lineWidth = (w + (z >= 15 ? 2 : 1.4)) * px;
        if (dashed) ctx.setLineDash([3 * px, 2 * px]);
        ctx.stroke(p);
        if (dashed) ctx.setLineDash([]);
      }
      // заливка
      for (const c of ROAD_ORDER) {
        const p = paths[c];
        if (!p) continue;
        const col = pal.road[c];
        const w = interp(ROAD_W[c], z);
        ctx.strokeStyle = col[0];
        ctx.lineWidth = w * px;
        if (c === "path" || c === "track") {
          if (z >= 16) ctx.setLineDash([(c === "track" ? 4 : 2.5) * px, 2 * px]);
          ctx.lineCap = z >= 16 ? "butt" : "round";
        } else if (c === "steps") {
          ctx.setLineDash([0.8 * px, 1.2 * px]);
          ctx.lineCap = "butt";
        }
        ctx.stroke(p);
        ctx.setLineDash([]);
        ctx.lineCap = "round";
      }
      ctx.globalAlpha = 1;
    };
    drawRoads(roadPaths("-1"), pal.tunnelAlpha, true);
    drawRoads(roadPaths("0"), 1, false);

    const drawRail = (R) => {
      if (HIDE.rail) return;               // железная дорога, трамвай — скрыты (см. HIDE)
      if (R.minor && R.minor.length && z >= 13) {
        const p = pathOf(R.minor, false, cull);
        if (p) { ctx.strokeStyle = pal.railMinor; ctx.lineWidth = interp([[13, 0.5], [16, 1], [18, 1.6]], z) * px; ctx.stroke(p); }
      }
      if (R.tram && R.tram.length) {
        const p = pathOf(R.tram, false, cull);
        if (p) { ctx.strokeStyle = pal.tram; ctx.lineWidth = interp([[12, 0.5], [15, 1], [18, 1.8]], z) * px; ctx.stroke(p); }
      }
      if (R.rail && R.rail.length) {
        const p = pathOf(R.rail, false, cull);
        if (p) {
          const w = interp([[10, 0.7], [13, 1.2], [15, 2.2], [18, 4]], z);
          ctx.strokeStyle = pal.rail;
          ctx.lineWidth = w * px;
          ctx.stroke(p);
          if (z >= 14) {
            ctx.strokeStyle = pal.railDash;
            ctx.lineWidth = w * 0.45 * px;
            ctx.lineCap = "butt";
            ctx.setLineDash([6 * px, 6 * px]);
            ctx.stroke(p);
            ctx.setLineDash([]);
            ctx.lineCap = "round";
          }
        }
      }
    };
    drawRail(G.rail["0"]);

    // мосты — поверх всего, каждый класс со своей обводкой
    const B = roadPaths("1");
    if (Object.keys(B).length) {
      for (const c of ROAD_ORDER) {
        const p = B[c];
        if (!p) continue;
        const w = interp(ROAD_W[c], z);
        const col = pal.road[c];
        ctx.strokeStyle = col[1] || pal.buildingLine;
        ctx.lineCap = "butt";
        ctx.lineWidth = (w + (z >= 14 ? 2.6 : 1.4)) * px;
        ctx.stroke(p);
        ctx.strokeStyle = col[0];
        ctx.lineWidth = w * px;
        ctx.stroke(p);
        ctx.lineCap = "round";
      }
    }
    drawRail(G.rail["1"]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  root.KartografRender = { prepare, renderTile, interp, PALETTES };
})(typeof self !== "undefined" ? self : this);
