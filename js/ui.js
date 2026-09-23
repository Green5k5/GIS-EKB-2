// Навигация между страницами
function initNavigation() {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", function(e) {
      e.preventDefault();
      const pg = this.dataset.page;
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      document.querySelectorAll(`.nav-item[data-page="${pg}"]`).forEach(n => n.classList.add("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      document.getElementById("page-" + pg).classList.add("active");
      closeMobile();
      if (pg !== "map" && typeof setMobileSidebar === "function") setMobileSidebar(false);
      
      const navCounter = document.getElementById("navCounter");
      if (navCounter) navCounter.style.display = pg === "map" ? "block" : "none";
      
      const mapEl = document.getElementById("map");
      const sidebar = document.querySelector(".sidebar");
      if (pg === "map") {
        if (mapEl) mapEl.style.visibility = "visible";
        if (sidebar) sidebar.style.visibility = "visible";
        setTimeout(() => {
          if (window.map) window.map.invalidateSize();
        }, 100);
      } else {
        if (mapEl) mapEl.style.visibility = "hidden";
        if (sidebar) sidebar.style.visibility = "hidden";
      }
    });
  });
}

// Бургер-меню
function initBurger() {
  const burgerBtn = document.getElementById("burgerBtn");
  if (burgerBtn) {
    burgerBtn.addEventListener("click", () => {
      const mobileMenu = document.getElementById("mobileMenu");
      if (!mobileMenu) return;
      const isOpen = mobileMenu.classList.toggle("show");
      mobileMenu.setAttribute("aria-hidden", String(!isOpen));
      burgerBtn.setAttribute("aria-expanded", String(isOpen));
      burgerBtn.setAttribute("aria-label", isOpen ? "Закрыть меню" : "Открыть меню");
      document.body.classList.toggle("mobile-menu-open", isOpen);
      document.querySelectorAll(".page").forEach(page => page.toggleAttribute("inert", isOpen));
    });
  }
}

// Поиск с выпадающим списком
function initSearch() {
  const inp = document.getElementById("searchInput");
  const clr = document.getElementById("searchClear");
  const res = document.getElementById("searchResults");
  
  if (!inp) return;
  
  inp.addEventListener("input", function() {
    if (clr) clr.className = "search-clear" + (this.value ? " show" : "");
    showSearchResults(this.value);
    searchQuery = this.value.trim();
    if (typeof update === 'function') update();
  });
}

function showSearchResults(q) {
  const res = document.getElementById("searchResults");
  if (!res) return;
  if (!q || q.length < 2) {
    res.className = "search-results";
    res.innerHTML = "";
    return;
  }
  q = q.toLowerCase();
  const matches = allData.filter(d => matchesSearch(d, q)).slice(0, 15);
  if (!matches.length) {
    res.className = "search-results";
    res.innerHTML = "";
    return;
  }
  let html = "";
  matches.forEach(d => {
    const fn = [d.surname, d.name, d.patronymic].filter(Boolean).join(" ");
    html += `<div class="search-result" onclick="focusOnItem(${d.id})">
              <b>${esc(fn)}</b> <span style="color:var(--muted);font-size:10px">${esc(d.settlement)}, №${esc(d.num)}</span>
            </div>`;
  });
  res.innerHTML = html;
  res.className = "search-results show";
}

const scanView = {
  zoom: 1,
  x: 0,
  y: 0,
  pointers: new Map(),
  dragStart: null,
  pinchDistance: 0
};

function applyScanTransform() {
  const modal = document.getElementById("scanModal");
  const image = modal?.querySelector(".scan-modal-image");
  const zoomLabel = modal?.querySelector(".scan-zoom-label");
  if (!image) return;
  image.style.transform = `translate(${scanView.x}px, ${scanView.y}px) scale(${scanView.zoom})`;
  if (zoomLabel) zoomLabel.textContent = `${Math.round(scanView.zoom * 100)}%`;
  modal.classList.toggle("is-zoomed", scanView.zoom > 1.01);
}

function zoomScanAt(nextZoom, clientX, clientY) {
  const body = document.querySelector("#scanModal .scan-modal-body");
  if (!body) return;
  nextZoom = Math.min(5, Math.max(1, nextZoom));
  const rect = body.getBoundingClientRect();
  const pointX = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
  const pointY = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
  const ratio = nextZoom / scanView.zoom;
  scanView.x = pointX + (scanView.x - pointX) * ratio;
  scanView.y = pointY + (scanView.y - pointY) * ratio;
  scanView.zoom = nextZoom;
  if (nextZoom === 1) scanView.x = scanView.y = 0;
  applyScanTransform();
}

function initScanGestures(modal) {
  const body = modal.querySelector(".scan-modal-body");

  body.addEventListener("wheel", e => {
    e.preventDefault();
    if (e.ctrlKey) {
      zoomScanAt(scanView.zoom * Math.exp(-e.deltaY * 0.012), e.clientX, e.clientY);
    } else if (scanView.zoom > 1) {
      scanView.x -= e.deltaX;
      scanView.y -= e.deltaY;
      applyScanTransform();
    } else {
      zoomScanAt(scanView.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    }
  }, { passive: false });

  body.addEventListener("dblclick", e => {
    zoomScanAt(scanView.zoom > 1 ? 1 : 2, e.clientX, e.clientY);
  });

  body.addEventListener("pointerdown", e => {
    if (!e.isPrimary && e.pointerType === "mouse") return;
    body.setPointerCapture(e.pointerId);
    scanView.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    scanView.dragStart = { x: e.clientX, y: e.clientY, viewX: scanView.x, viewY: scanView.y };
    if (scanView.pointers.size === 2) {
      const points = [...scanView.pointers.values()];
      scanView.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }
    body.classList.add("is-dragging");
  });

  body.addEventListener("pointermove", e => {
    if (!scanView.pointers.has(e.pointerId)) return;
    scanView.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (scanView.pointers.size === 2) {
      const points = [...scanView.pointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const centerX = (points[0].x + points[1].x) / 2;
      const centerY = (points[0].y + points[1].y) / 2;
      if (scanView.pinchDistance) zoomScanAt(scanView.zoom * distance / scanView.pinchDistance, centerX, centerY);
      scanView.pinchDistance = distance;
    } else if (scanView.zoom > 1 && scanView.dragStart) {
      scanView.x = scanView.dragStart.viewX + e.clientX - scanView.dragStart.x;
      scanView.y = scanView.dragStart.viewY + e.clientY - scanView.dragStart.y;
      applyScanTransform();
    }
  });

  const endPointer = e => {
    scanView.pointers.delete(e.pointerId);
    scanView.pinchDistance = 0;
    if (scanView.pointers.size === 1) {
      const point = [...scanView.pointers.values()][0];
      scanView.dragStart = { x: point.x, y: point.y, viewX: scanView.x, viewY: scanView.y };
    } else {
      scanView.dragStart = null;
      body.classList.remove("is-dragging");
    }
  };
  body.addEventListener("pointerup", endPointer);
  body.addEventListener("pointercancel", endPointer);
}

function ensureScanModal() {
  let modal = document.getElementById("scanModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "scanModal";
  modal.className = "scan-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Просмотр скана ведомости");
  modal.innerHTML = `
    <div class="scan-modal-dialog">
      <div class="scan-modal-toolbar">
        <div class="scan-modal-title">Скан ведомости</div>
        <div class="scan-modal-actions">
          <button type="button" onclick="changeScanZoom(-0.25)" aria-label="Уменьшить">−</button>
          <button type="button" class="scan-zoom-label" onclick="resetScanZoom()" aria-label="Исходный масштаб">100%</button>
          <button type="button" onclick="changeScanZoom(0.25)" aria-label="Увеличить">+</button>
          <button type="button" class="scan-modal-close" onclick="closeScan()" aria-label="Закрыть">×</button>
        </div>
      </div>
      <div class="scan-modal-body">
        <div class="scan-modal-status">Загрузка скана…</div>
        <img class="scan-modal-image" alt="Скан ведомости" referrerpolicy="no-referrer" />
        <div class="scan-modal-hint">Колесо или щипок — масштаб · перетаскивание — перемещение · двойной клик — увеличить</div>
      </div>
    </div>`;
  modal.addEventListener("click", e => { if (e.target === modal) closeScan(); });
  document.body.appendChild(modal);
  initScanGestures(modal);
  return modal;
}

async function openScan(url) {
  if (!url) return;
  const modal = ensureScanModal();
  const image = modal.querySelector(".scan-modal-image");
  const status = modal.querySelector(".scan-modal-status");
  image.removeAttribute("src");
  image.style.display = "none";
  status.style.display = "block";
  status.textContent = "Загрузка скана…";
  modal.classList.remove("image-ready");
  modal.classList.add("open");
  document.body.classList.add("scan-modal-open");
  resetScanZoom();

  try {
    const endpoint = "https://cloud-api.yandex.net/v1/disk/public/resources?fields=preview&preview_size=XXXL&public_key=" + encodeURIComponent(url);
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error("Yandex Disk API: " + response.status);
    const data = await response.json();
    let imageUrl = data.preview;

    if (!imageUrl) {
      const downloadEndpoint = "https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + encodeURIComponent(url);
      const downloadResponse = await fetch(downloadEndpoint);
      if (!downloadResponse.ok) throw new Error("Yandex Disk download API: " + downloadResponse.status);
      const downloadData = await downloadResponse.json();
      imageUrl = downloadData.href;
    }

    if (!imageUrl) throw new Error("Ссылка на изображение не получена");
    image.onload = () => {
      status.style.display = "none";
      image.style.display = "block";
      modal.classList.add("image-ready");
    };
    image.onerror = () => showScanError(status, image, url);
    image.src = imageUrl;
  } catch (error) {
    console.error("Не удалось загрузить скан", error);
    showScanError(status, image, url);
  }
}

function showScanError(status, image, url) {
  image.style.display = "none";
  status.style.display = "block";
  status.innerHTML = `Не удалось показать скан.<br><a href="${esc(url)}" target="_blank" rel="noopener">Открыть его на Яндекс Диске</a>`;
}

function closeScan() {
  const modal = document.getElementById("scanModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.classList.remove("image-ready", "is-zoomed");
  document.body.classList.remove("scan-modal-open");
  const image = modal.querySelector(".scan-modal-image");
  if (image) image.removeAttribute("src");
}

function changeScanZoom(delta) {
  zoomScanAt(scanView.zoom + delta);
}

function resetScanZoom() {
  scanView.zoom = 1;
  scanView.x = 0;
  scanView.y = 0;
  scanView.pointers.clear();
  scanView.dragStart = null;
  scanView.pinchDistance = 0;
  applyScanTransform();
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("scanModal")?.classList.contains("open")) closeScan();
});

// Показ выбранного участка
function showSelected(item) {
  const sec = document.getElementById("selectedSection");
  if (!sec) return;
  sec.style.display = "block";
  
  const displayNum = Math.round(parseFloat(item.num));
  const fn = [item.surname, item.name, item.patronymic].filter(Boolean).join(" ");
  let h = `<div class="selected-title">Усадьба №${esc(displayNum)}</div>
           <div class="selected-owner">${esc(fn)}</div>`;
  
  [
    ["Сословно-профессиональная группа", item.soslovie],
    ["Семейное положение", item.familyStatus],
    ["Тип", item.buildingType],
    ["Чин", item.rank],
    ["Служба", item.serviceType],
    ["Место приписки", item.registrationPlace],
    ["Место службы", item.servicePlace],
    ["Улица", item.street],
    ["Площадь", item.area_sazh ? item.area_sazh + " саж." : ""],
    ["Источник", formatArchiveSource(item.source)]
  ].forEach(f => {
    if (f[1]) h += `<div class="sf"><span class="sl">${f[0]}</span><span class="sv">${esc(f[1])}</span></div>`;
  });
  
  if (item.scanUrl) {
    h += `<div class="scan-block">
            <div class="scan-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C49A5C" stroke-width="1.5">
                <path d="M3 3C3 1.9 3.9 1 5 1H15L21 7V21C21 22.1 20.1 23 19 23H5C3.9 23 3 22.1 3 21V3Z"/>
                <path d="M15 1V5C15 6.1 15.9 7 17 7H21"/>
                <line x1="7" y1="11" x2="17" y2="11"/>
                <line x1="7" y1="15" x2="15" y2="15"/>
              </svg>
            </div>
            <div class="scan-text"><b>Скан ведомости</b><br><a href="#" onclick="openScan('${esc(item.scanUrl)}'); return false;">Открыть скан</a></div>
          </div>`;
  }
  
  const card = document.getElementById("selectedCard");
  if (card) card.innerHTML = h;

  if (isMobileMapLayout()) {
    if (window.map) window.map.closePopup();
    setMobileSidebar(true);
    window.setTimeout(() => {
      const content = document.getElementById("sidebarContent");
      if (content) content.scrollTo({ top: Math.max(0, sec.offsetTop - 12), behavior: "smooth" });
    }, 220);
  }
}

// Обновление статистики и бейджа
function updateStats(filtered) {
  const statShown = document.getElementById("statShown");
  const statTotal = document.getElementById("statTotal");
  if (statShown) statShown.textContent = filtered.length;
  if (statTotal) statTotal.textContent = allData.length;
  
  let dims = 0;
  FILTERS.forEach(f => { if (state[f.key].size) dims++; });
  
  const badge = document.getElementById("crossBadge");
  if (badge) {
    badge.className = dims >= 2 ? "cross-badge show" : "cross-badge";
  }
  const crossText = document.getElementById("crossText");
  if (crossText && dims >= 2) crossText.textContent = `Перекрёстная фильтрация: ${dims} изм.`;

  const mobileStatus = document.getElementById("mobileMapStatus");
  if (mobileStatus) {
    mobileStatus.textContent = dims
      ? `${filtered.length.toLocaleString("ru-RU")} объектов · фильтров: ${dims}`
      : `${filtered.length.toLocaleString("ru-RU")} объектов на карте`;
  }
}

// Предупреждение о повороте экрана
function initOrientationWarning() {
  const hint = document.getElementById("landscapeHint");
  if (hint) hint.remove();
}

function isMobileMapLayout() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function setMobileSidebar(open) {
  const sidebar = document.querySelector(".map-page .sidebar");
  const handle = document.getElementById("sidebarHandle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const content = document.getElementById("sidebarContent");
  if (!sidebar) return;

  const mobileLayout = isMobileMapLayout();
  const shouldOpen = Boolean(open && mobileLayout);
  sidebar.classList.toggle("show", shouldOpen);
  if (handle) {
    handle.setAttribute("aria-expanded", String(shouldOpen));
    handle.setAttribute("aria-label", shouldOpen ? "Свернуть фильтры" : "Открыть фильтры и поиск");
  }
  if (backdrop) {
    backdrop.classList.toggle("show", shouldOpen);
    backdrop.tabIndex = shouldOpen ? 0 : -1;
  }
  if (content) {
    content.toggleAttribute("inert", mobileLayout && !shouldOpen);
    if (mobileLayout && !shouldOpen) content.setAttribute("aria-hidden", "true");
    else content.removeAttribute("aria-hidden");
  }
  document.body.classList.toggle("mobile-sidebar-open", shouldOpen);
}

// Перетаскивание и управление мобильной шторкой фильтров
function initSidebarDrag() {
  const sidebar = document.querySelector(".sidebar");
  const handle = document.querySelector(".sidebar-handle");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!handle || !sidebar) return;
  
  let startY = 0, startTransform = 0, dragging = false, moved = false, suppressClick = false;

  handle.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setMobileSidebar(!sidebar.classList.contains("show"));
  });

  if (backdrop) backdrop.addEventListener("click", () => setMobileSidebar(false));
  
  handle.addEventListener("touchstart", function(e) {
    if (!window.matchMedia("(max-width: 768px) and (orientation: portrait)").matches) return;
    dragging = true;
    moved = false;
    startY = e.touches[0].clientY;
    const style = getComputedStyle(sidebar);
    const matrix = new DOMMatrix(style.transform);
    startTransform = matrix.m42;
    sidebar.style.transition = "none";
  });
  
  document.addEventListener("touchmove", function(e) {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    moved = moved || Math.abs(dy) > 6;
    const closedY = Math.max(0, sidebar.offsetHeight - 62);
    const newY = Math.min(closedY, Math.max(0, startTransform + dy));
    sidebar.style.transform = `translateY(${newY}px)`;
    if (moved) e.preventDefault();
  }, { passive: false });
  
  document.addEventListener("touchend", function() {
    if (!dragging) return;
    dragging = false;
    sidebar.style.transition = "transform .3s ease";
    if (!moved) {
      sidebar.style.transform = "";
      return;
    }
    const style = getComputedStyle(sidebar);
    const matrix = new DOMMatrix(style.transform);
    const currentY = matrix.m42;
    const height = sidebar.offsetHeight;
    suppressClick = true;
    setMobileSidebar(currentY < height * 0.38);
    sidebar.style.transform = "";
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      setMobileSidebar(false);
      closeMobile();
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobileMapLayout()) setMobileSidebar(false);
    if (window.map) window.setTimeout(() => window.map.invalidateSize(), 80);
  });

  setMobileSidebar(false);
}

window.openScan = openScan;
