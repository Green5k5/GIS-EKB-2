// Главная функция обновления
function update() {
  const filtered = getFiltered();
  renderFilters();
  renderActiveTags();
  renderMap(filtered);
  updateStats(filtered);
  renderMapTable(filtered);
  renderDatabaseMapFilter(filtered);
  if (typeof renderInfographics === "function") renderInfographics();

  // Filtering redraws the data and preserves the user's current map view.
}

function fitToEstates(maxZoom, animate) {
  if (!estateLayer || !window.map || !estateLayer.getLayers().length) return;
  const bounds = estateLayer.getBounds();
  if (!bounds.isValid()) return;
  const opts = getResponsiveFitOptions(maxZoom);
  opts.animate = animate;
  window.map.fitBounds(bounds, opts);
}

// Приближает карту к текущей выборке усадеб (после фильтра, перехода из глоссария).
// invalidateSize нужен, потому что страница карты могла быть скрыта и холст
// мог иметь нулевой/устаревший размер — без этого рамка считалась неверно.
function zoomToSelection(animate) {
  if (!window.map) return;
  window.map.invalidateSize();
  fitToEstates(18, animate !== false);
}

function getResponsiveFitOptions(maxZoom) {
  const mobile = window.matchMedia("(max-width: 768px)").matches;
  return {
    paddingTopLeft: [30, 30],
    paddingBottomRight: [30, mobile ? 96 : 30],
    maxZoom
  };
}

// Инициализация приложения
function initApp() {
  initFiltersState();
  initMap();
  initNavigation();
  initBurger();
  initSearch();
  initTable();
  initMapTable();
  initGlossary();
  initOrientationWarning();
  initSidebarDrag();
  initSourcesPanel();
  update();
  initThemeToggle();

  // Стартовый вид: все усадьбы в кадре, без анимации
  if (window.map) window.map.invalidateSize();
  fitToEstates(14, false);
}

// Переключение тёмной темы
function initThemeToggle() {
  const toggle = document.getElementById("themeToggle");
  if (!toggle) return;

  const lightIcon = toggle.querySelector(".theme-icon-light");
  const darkIcon = toggle.querySelector(".theme-icon-dark");

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-theme");
    if (lightIcon) lightIcon.style.display = "none";
    if (darkIcon) darkIcon.style.display = "block";
  }

  toggle.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-theme");

    if (isDark) {
      if (lightIcon) lightIcon.style.display = "none";
      if (darkIcon) darkIcon.style.display = "block";
      localStorage.setItem("theme", "dark");
    } else {
      if (lightIcon) lightIcon.style.display = "block";
      if (darkIcon) darkIcon.style.display = "none";
      localStorage.setItem("theme", "light");
    }
  });
}

// Запуск приложения после загрузки DOM
document.addEventListener("DOMContentLoaded", initApp);
