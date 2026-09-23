// Инфографика
function renderInfographics() {
  const s = statsData;
  const grid = document.getElementById("infoGrid");
  if (!grid) return;
  const maxC = s.top_soslovie[0][1];
  
  // 1. Владельцы по сословиям
  let h1 = `<div class="info-card"><h3>Владельцы усадеб по сословиям</h3>`;
  s.top_soslovie.forEach(r => {
    const pct = Math.round(r[1] / maxC * 100);
    h1 += `<div class="bar-row">
            <div class="bar-label">${r[0]}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%"></div>
              <div class="bar-val">${r[1]}</div>
            </div>
           </div>`;
  });
  h1 += `</div>`;
  
  // 2. Средний размер усадеб
  const maxA = s.avg_areas.length ? s.avg_areas[0][1] : 1;
  let h2 = `<div class="info-card"><h3>Средний размер усадеб по сословиям</h3>`;
  s.avg_areas.forEach(r => {
    const pct = Math.round(r[1] / maxA * 100);
    h2 += `<div class="bar-row">
            <div class="bar-label">${r[0]}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%;opacity:.7"></div>
              <div class="bar-val">${r[1]} саж.</div>
            </div>
           </div>`;
  });
  h2 += `</div>`;
  
  // 3. Медианный размер
  const medBySos = {};
  allData.forEach(d => {
    if (d.soslovie && d.area_sazh) {
      if (!medBySos[d.soslovie]) medBySos[d.soslovie] = [];
      medBySos[d.soslovie].push(d.area_sazh);
    }
  });
  const medArr = Object.keys(medBySos).map(k => {
    const arr = medBySos[k].sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const med = arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    return [k, med];
  }).sort((a, b) => b[1] - a[1]);
  const medMax = medArr[0][1];
  let h2m = `<div class="info-card"><h3>Медианный размер усадеб по сословиям</h3>`;
  medArr.forEach(r => {
    const pct = Math.round(r[1] / medMax * 100);
    h2m += `<div class="bar-row">
            <div class="bar-label">${r[0]}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%;opacity:.5;background:var(--ukt)"></div>
              <div class="bar-val">${r[1]} саж.</div>
            </div>
           </div>`;
  });
  h2m += `</div>`;
  
  // 4. Тип строений
  const btCounts = {};
  allData.forEach(d => { if (d.buildingType) btCounts[d.buildingType] = (btCounts[d.buildingType] || 0) + 1; });
  const btArr = Object.keys(btCounts).map(k => [k, btCounts[k]]).sort((a, b) => b[1] - a[1]);
  const btMax = btArr[0][1];
  let h3 = `<div class="info-card"><h3>Распределение по типу строений</h3>`;
  btArr.slice(0, 8).forEach(r => {
    const pct = Math.round(r[1] / btMax * 100);
    h3 += `<div class="bar-row">
            <div class="bar-label">${r[0]}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%;background:var(--niz)"></div>
              <div class="bar-val">${r[1]}</div>
            </div>
           </div>`;
  });
  h3 += `</div>`;
  
  // 5. Случайный факт
  const facts = [
    { n: Math.round(s.max_area.area) + " саж²", t: "Самый большой участок", d: s.max_area.surname + ", усадьба №" + s.max_area.num + ". " + s.max_area.settlement },
    { n: s.min_area.area + " саж²", t: "Самый маленький участок", d: s.min_area.surname + ", усадьба №" + s.min_area.num + ". " + s.min_area.street },
    { n: s.top_surname[0], t: "Самая частая фамилия", d: s.top_surname[1] + " усадеб с этой фамилией" },
    { n: "Иван", t: "Самое распространённое мужское имя", d: "278 владельцев усадеб носили это имя" },
    { n: "Анна", t: "Самое распространённое женское имя", d: "36 владелиц усадеб с этим именем" },
    { n: "3 925 саж²", t: "Самый большой участок среди женщин", d: "Граматчикова, усадьба №954c" },
    { n: "9 саж²", t: "Самый маленький участок среди женщин", d: "Головина, усадьба №104. Екатеринбург" },
    { n: "344", t: "Улица с наибольшим числом усадеб", d: "Третья часть по течению реки Исети по левую сторону" },
    { n: "1", t: "Самая немногочисленная группа", d: "Именитые граждане - всего 1 усадьба в Екатеринбурге" }
  ];
  let factIndex = 0;
  let h6 = `<div class="info-card"><h3>Случайный факт</h3>
            <div class="fact-box">
              <div class="fact-num" id="factNum">${facts[0].n}</div>
              <div class="fact-title" id="factTitle">${facts[0].t}</div>
              <div class="fact-desc" id="factDesc">${facts[0].d}</div>
            </div>
            <button class="fact-btn" id="factBtn">Ещё факт →</button>
           </div>`;
  
  // 6. Структура поселений
  let h7 = `<div class="info-card"><h3>Структура поселений</h3>
            <div class="settlement-bubbles">`;
  [["Екатеринбург", 2103, "var(--ekb)"], ["Нижне-Исетск", 243, "var(--niz)"], ["Уктус", 224, "var(--ukt)"]].forEach(r => {
    h7 += `<div class="settlement-bubble">
            <div class="settlement-circle" style="width:${Math.round(r[1] / 25)}px;height:${Math.round(r[1] / 25)}px;background:${r[2]};border-color:${r[2]}"></div>
            <div style="font-weight:700;font-size:14px">${r[1]}</div>
            <div style="font-size:11px;color:var(--body)">${r[0]}</div>
           </div>`;
  });
  h7 += `</div></div>`;
  
  grid.innerHTML = h1 + h2 + h2m + h3 + h6 + h7;
  
  const factBtn = document.getElementById("factBtn");
  if (factBtn) {
    factBtn.onclick = () => {
      factIndex = (factIndex + 1) % facts.length;
      const factNum = document.getElementById("factNum");
      const factTitle = document.getElementById("factTitle");
      const factDesc = document.getElementById("factDesc");
      if (factNum) factNum.textContent = facts[factIndex].n;
      if (factTitle) factTitle.textContent = facts[factIndex].t;
      if (factDesc) factDesc.textContent = facts[factIndex].d;
    };
  }
  
  // Статистическая строка
  const statRow = document.getElementById("statRow");
  if (statRow) {
    statRow.innerHTML = [
      ["2 570", "усадеб"],
      [s.streets_count, "улиц"],
      ["22", "сословия"],
      ["3", "поселения"],
      ["1809", "год"]
    ].map(r => `<div><div class="stat-num">${r[0]}</div><div class="stat-lbl">${r[1]}</div></div>`).join("");
  }
}
