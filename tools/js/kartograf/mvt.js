/* =====================================================================
   Картограф — собственный движок карты «ГИС Екатеринбург».
   mvt.js: декодер векторных тайлов Mapbox Vector Tile (protobuf).
   Без зависимостей; работает и в Web Worker, и в основном потоке.
   ===================================================================== */
(function (root) {
  "use strict";

  const utf8 = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

  function Reader(buf) {
    this.buf = buf;
    this.pos = 0;
    this.len = buf.length;
    this.view = null;
  }

  Reader.prototype.varint = function () {
    const b = this.buf;
    let val = 0, shift = 0, byte;
    do {
      byte = b[this.pos++];
      if (shift < 28) val |= (byte & 0x7f) << shift;
      else val += (byte & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (byte >= 0x80);
    return val >>> 0 === val ? val : val; // допускаем значения > 2^31
  };

  Reader.prototype.svarint = function () {
    const n = this.varint();
    return n % 2 === 1 ? (n + 1) / -2 : n / 2;
  };

  Reader.prototype.bytesEnd = function () {
    const l = this.varint();
    return this.pos + l;
  };

  Reader.prototype.string = function () {
    const end = this.bytesEnd();
    const s = utf8 ? utf8.decode(this.buf.subarray(this.pos, end)) : decodeUtf8(this.buf, this.pos, end);
    this.pos = end;
    return s;
  };

  Reader.prototype.double = function () {
    if (!this.view) this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  };

  Reader.prototype.float = function () {
    if (!this.view) this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  };

  Reader.prototype.skip = function (wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos = this.bytesEnd();
    else if (wire === 5) this.pos += 4;
    else throw new Error("MVT: неизвестный тип поля " + wire);
  };

  function decodeUtf8(buf, pos, end) {
    let s = "";
    while (pos < end) {
      let c = buf[pos++];
      if (c > 0xbf) {
        if (c > 0xdf) {
          if (c > 0xef) {
            c = ((c & 7) << 18) | ((buf[pos++] & 63) << 12) | ((buf[pos++] & 63) << 6) | (buf[pos++] & 63);
          } else c = ((c & 15) << 12) | ((buf[pos++] & 63) << 6) | (buf[pos++] & 63);
        } else c = ((c & 31) << 6) | (buf[pos++] & 63);
      }
      s += String.fromCodePoint(c);
    }
    return s;
  }

  function readValue(r) {
    const end = r.bytesEnd();
    let v = null;
    while (r.pos < end) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 1) v = r.string();
      else if (f === 2) v = r.float();
      else if (f === 3) v = r.double();
      else if (f === 4 || f === 5) v = r.varint();
      else if (f === 6) v = r.svarint();
      else if (f === 7) v = Boolean(r.varint());
      else r.skip(w);
    }
    return v;
  }

  /* Геометрия -> массив колец/линий Int16Array [x0,y0,x1,y1,...] и bbox */
  function readGeometry(r, end, type) {
    const parts = [];
    let x = 0, y = 0, cur = null, n = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cmd = 0, count = 0;
    const tmp = [];
    const flush = () => {
      if (tmp.length) {
        parts.push(Int16Array.from(tmp));
        tmp.length = 0;
      }
    };
    while (r.pos < end) {
      if (count === 0) {
        const ci = r.varint();
        cmd = ci & 7;
        count = ci >> 3;
      }
      count--;
      if (cmd === 1 || cmd === 2) {
        x += r.svarint();
        y += r.svarint();
        if (cmd === 1 && type !== 1) flush();
        tmp.push(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (cmd === 7) {
        // ClosePath: рисуем closePath при отрисовке, точку не дублируем
      } else {
        throw new Error("MVT: неизвестная команда " + cmd);
      }
    }
    flush();
    return { parts, bbox: [minX, minY, maxX, maxY] };
  }

  function readFeature(r, keys, values) {
    const end = r.bytesEnd();
    const f = { type: 0, props: {}, parts: null, bbox: null };
    let geomStart = -1, geomEnd = -1;
    while (r.pos < end) {
      const tag = r.varint(), fld = tag >> 3, w = tag & 7;
      if (fld === 2) {
        const e = r.bytesEnd();
        while (r.pos < e) {
          const k = keys[r.varint()];
          f.props[k] = values[r.varint()];
        }
      } else if (fld === 3) {
        f.type = r.varint();
      } else if (fld === 4) {
        geomEnd = r.bytesEnd();
        geomStart = r.pos;
        r.pos = geomEnd;
      } else r.skip(w);
    }
    if (geomStart >= 0) {
      const save = r.pos;
      r.pos = geomStart;
      const g = readGeometry(r, geomEnd, f.type);
      f.parts = g.parts;
      f.bbox = g.bbox;
      r.pos = save;
    }
    return f;
  }

  function readLayer(r) {
    const end = r.bytesEnd();
    const layer = { name: "", extent: 4096, features: [] };
    const keys = [], values = [], featurePos = [];
    while (r.pos < end) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 1) layer.name = r.string();
      else if (f === 2) { featurePos.push(r.pos); r.skip(2); }
      else if (f === 3) keys.push(r.string());
      else if (f === 4) values.push(readValue(r));
      else if (f === 5) layer.extent = r.varint();
      else r.skip(w);
    }
    const save = r.pos;
    for (const p of featurePos) {
      r.pos = p;
      layer.features.push(readFeature(r, keys, values));
    }
    r.pos = save;
    return layer;
  }

  /**
   * Декодирует тайл. Возвращает { layers: {name: {extent, features}} }.
   * Каждая фича: { type: 1|2|3, props, parts: Int16Array[], bbox }
   */
  function decode(arrayBuffer) {
    const r = new Reader(new Uint8Array(arrayBuffer));
    const layers = {};
    while (r.pos < r.len) {
      const tag = r.varint(), f = tag >> 3, w = tag & 7;
      if (f === 3) {
        const l = readLayer(r);
        layers[l.name] = l;
      } else r.skip(w);
    }
    return { layers };
  }

  root.KartografMVT = { decode };
})(typeof self !== "undefined" ? self : this);
