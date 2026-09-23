// Главная функция обновления
function update() {
  const filtered = getFiltered();
  renderFilters();
  renderActiveTags();
  renderMap(filtered);
  updateStats(filtered);
  
  // Подгонка карты под найденные усадьбы
  fitToEstates(16, true);
}

function fitToEstates(maxZoom, animate) {
  if (!estateLayer || !window.map || !estateLayer.getLayers().length) return;
  const bounds = estateLayer.getBounds();
  if (!bounds.isValid()) return;
  const opts = getResponsiveFitOptions(maxZoom);
  opts.animate = animate;
  window.map.fitBounds(bounds, opts);
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
  initGlossary();
  initOrientationWarning();
  initSidebarDrag();
  renderInfographics();
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
  
  // Проверяем сохранённую тему
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
    
    // Подложка перекрашивается сама (следит за классом dark-theme)
  });
}



// Запуск приложения после загрузки DOM
document.addEventListener("DOMContentLoaded", initApp);



