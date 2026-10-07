// Загружает опубликованный снимок данных с backend до инициализации приложения.
// При открытии старого статического файла без сервера оставляет пустой набор с понятной ошибкой.
var allData = [];
var ekbPolygons = {};
var niPolygons = {};
var uktPolygons = {};
var publicPlotsById = new Map();
var publicSettlements = [];
var publicBootstrapError = null;

async function loadPublicData() {
  try {
    const response = await fetch('/api/public/bootstrap', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`API: ${response.status}`);
    const payload = await response.json();

    publicSettlements = payload.settlements || [];
    publicPlotsById = new Map((payload.plots || []).map(plot => [Number(plot.id), plot]));

    allData = (payload.records || []).map(record => {
      const settlement = publicSettlements.find(item => item.id === record.settlementId);
      return { ...record, settlement: settlement?.name || record.settlementId };
    });

    // Совместимый адаптер для текущего «Картографа».
    // Источник теперь API, а не data-polygons.js.
    for (const plot of publicPlotsById.values()) {
      const target = plot.settlementId === 'ekb' ? ekbPolygons : plot.settlementId === 'ni' ? niPolygons : uktPolygons;
      target[String(plot.legacyKey)] = {
        coords: plot.geometry.coordinates[0],
        clat: plot.focusLat,
        clng: plot.focusLng,
        plotId: plot.id
      };
    }

    if (payload.releaseId) document.documentElement.dataset.releaseId = payload.releaseId;
    if (typeof refreshAreaBounds === 'function') refreshAreaBounds();
  } catch (error) {
    publicBootstrapError = error;
    console.error('Не удалось загрузить опубликованные данные:', error);
    const notice = document.createElement('div');
    notice.textContent = 'Не удалось загрузить данные сервера. Проверьте, что backend запущен.';
    notice.style.cssText = 'position:fixed;z-index:99999;top:0;left:0;right:0;padding:10px 16px;background:#8b1e1e;color:#fff;text-align:center;font:14px system-ui';
    document.addEventListener('DOMContentLoaded', () => document.body.prepend(notice), { once: true });
  }
}
