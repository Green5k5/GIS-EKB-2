(function () {
  "use strict";
  const form = document.getElementById("dataAssistantForm");
  const input = document.getElementById("dataAssistantQuestion");
  const submit = document.getElementById("dataAssistantSubmit");
  const clear = document.getElementById("dataAssistantClear");
  const result = document.getElementById("dataAssistantResult");
  const modelState = document.getElementById("dataAssistantModelState");
  if (!form || !input || !submit || !result) return;
  const updateClear = () => { if (clear) clear.hidden = input.value.length === 0; };
  input.addEventListener("input", updateClear);
  input.addEventListener("search", updateClear);
  if (clear) clear.addEventListener("click", () => { input.value = ""; updateClear(); input.focus(); });
  updateClear();
  let history = [];
  let requestId = 0;
  let lastAnswer = null;
  let mapContext = null;
  let previewLimit = 20;
  let activeRequest = null;
  const recordsById = new Map(allData.map(record => [Number(record.id), record]));
  const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);

  function cancelSearch(showNotice = true) {
    if (!activeRequest) return;
    const cancelled = activeRequest;
    activeRequest = null;
    const cancellationVersion = ++requestId;
    clearTimeout(cancelled.slowMessage);
    cancelled.controller.abort();
    submit.disabled = false;
    form.classList.remove('is-loading');
    if (showNotice) {
      result.innerHTML = '<div class="assistant-cancelled" role="status"><b>Поиск отменён</b><span>Исправьте вопрос и отправьте его снова.</span></div>';
      input.focus();
    }
    fetch('ai/cancel.php', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:cancelled.token}),keepalive:true})
      .then(response => {if (!response.ok) throw new Error('cancel');})
      .catch(() => {if (showNotice && requestId === cancellationVersion) {const notice=result.querySelector('.assistant-cancelled span');if(notice)notice.textContent='Ответ скрыт. Не удалось подтвердить остановку на сервере; текущий запрос завершится по лимиту времени.';}});
  }
  input.addEventListener('keydown', event => {if(event.key === 'Escape' && activeRequest) {event.preventDefault();cancelSearch();}});
  window.addEventListener('pagehide', () => cancelSearch(false));

  function answerRecords(data = lastAnswer) {
    return (data?.map?.record_ids || []).map(id => recordsById.get(Number(id))).filter(Boolean);
  }

  function openAnswerMap(ids, description, focusId = null) {
    if (!lastAnswer?.map || !Array.isArray(ids) || !ids.length) return;
    const target = focusId === null ? null : recordsById.get(Number(focusId));
    if (target && (!target.lat || !target.lng)) return;
    if (!applyDatabaseMapFilter(ids, description, lastAnswer.map.question)) return;
    mapContext = { data: lastAnswer };
    document.querySelector('.nav-item[data-page="map"]').click();
    // Refit after navigation has restored the map viewport; focus without dropping the set.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.map.invalidateSize();
      if (target) {
        window.map.flyTo(estateAnchor(target), 18, { duration: .7 });
        openEstate(target);
      } else fitToEstates(16, true);
    }));
  }

  function renderRecordPreview() {
    const host = result.querySelector('[data-record-preview]');
    if (!host) return;
    const query = (result.querySelector('[data-record-search]')?.value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    const rows = answerRecords().filter(record => [record.surname, record.name, record.patronymic, record.settlement, record.street, record.num].join(' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').includes(query));
    host.innerHTML = rows.slice(0, previewLimit).map(record => {
      const owner = [record.surname, record.name, record.patronymic].filter(Boolean).join(' ') || 'Владелец не указан';
      return `<button type="button" class="assistant-estate-row" data-estate-id="${Number(record.id)}" ${record.lat && record.lng ? '' : 'disabled'}><span><b>${escapeHtml(owner)}</b><small>${escapeHtml(record.settlement)} · №${escapeHtml(formatNum(record.num))}${record.street ? ' · ' + escapeHtml(record.street) : ''}</small></span><span class="assistant-estate-area">${record.area_sazh > 0 ? escapeHtml(record.area_sazh) + ' саж²' : 'Площадь не указана'}<small>На карте ↗</small></span></button>`;
    }).join('') || '<p class="data-assistant-list-note">В этой выборке нет совпадений.</p>';
    const count = result.querySelector('[data-record-count]');
    if (count) count.textContent = `Показано ${Math.min(rows.length, previewLimit)} из ${rows.length}`;
    const more = result.querySelector('[data-record-more]');
    if (more) more.hidden = rows.length <= previewLimit;
  }

  function render(data) {
    lastAnswer = data;
    previewLimit = 20;
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const answerHtml = escapeHtml(data.answer).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
    const operations = {search:"Поиск записей",count:"Количество усадеб",group:"Частотность",distinct:"Различные значения",sum:"Суммарная площадь",mean:"Средняя площадь",median:"Медианная площадь",min:"Минимальная площадь",max:"Максимальная площадь",add:"Сложение",subtract:"Разность",multiply:"Произведение",divide:"Отношение",percentage:"Процент"};
    const fields = {surname:"Фамилия",name:"Имя",patronymic:"Отчество",settlement:"Поселение",street:"Улица",soslovie:"Сословие",buildingType:"Строение",area_sazh:"Площадь",num:"Номер усадьбы",sex:"Пол владельца",familyStatus:"Семейное положение",rank:"Чин",position:"Должность",serviceType:"Вид службы",servicePlace:"Место службы",registrationPlace:"Место приписки"};
    const signs = {eq:"=",ne:"≠",gt:">",gte:"≥",lt:"<",lte:"≤",contains:"содержит"};
    const checks = (Array.isArray(data.tool_calls) ? data.tool_calls : []).map(step => {
      const args = step.arguments || {}, facts = step.result || {};
      const filters = step.tool === "calculate" ? `Числа из результатов: ${args.a}; ${args.b}` : (Array.isArray(args.filters) ? args.filters : []).map(filter => `${fields[filter.field] || filter.field} ${signs[filter.operator] || "="} ${filter.value}`).join("; ") || "Вся база";
      const groups = Array.isArray(facts.groups) ? facts.groups.slice(0,5).map(group => `${group.value} — ${group.count}`).join("; ") : "";
      const value = facts.value !== undefined && facts.value !== null ? `Результат: ${facts.value}${facts.unit ? " " + facts.unit : ""}` : (groups || (facts.distinct_values !== undefined ? `Различных значений: ${facts.distinct_values}` : "Описание проекта"));
      return `<article><b>${escapeHtml(operations[args.operation] || "О проекте")}${args.operation === "group" || args.operation === "distinct" ? " · " + escapeHtml(fields[args.field] || args.field) : ""}</b><span>${escapeHtml(filters)}</span><small>${escapeHtml(value)}${facts.matched_records !== undefined ? " · Записей в выборке: " + escapeHtml(facts.matched_records) : ""}</small></article>`;
    });
    const mode = data.route === "clarification" ? "Нужно уточнение" : data.model_used ? "Вопрос разобран ИИ · ответ рассчитан по базе" : "Быстрый ответ · расчёт по базе";
    const elapsed = Number.isFinite(data.elapsed_ms) ? ` · ${(data.elapsed_ms / 1000).toLocaleString("ru-RU", {maximumFractionDigits: 2})} с` : "";
    const items = Array.isArray(data.items) ? data.items : [];
    const list = items.length ? `<div class="data-assistant-list" role="list">${items.map((item, index) => `<div role="listitem"><button type="button" class="assistant-group-row" ${item.map_ids?.length ? `data-group-index="${index}" title="Показать эту группу на карте"` : item.id ? `data-estate-id="${Number(item.id)}" title="Открыть усадьбу на карте"` : 'disabled'}><span>${escapeHtml(item.value)}</span><span class="assistant-group-count">${item.count !== null ? `<b>${escapeHtml(item.count)}</b>` : ''}<span aria-hidden="true">↗</span></span></button></div>`).join("")}</div>${data.items_truncated ? '<p class="data-assistant-list-note">Показаны первые 50 строк. Полная выборка доступна ниже и на карте.</p>' : ""}` : "";
    const hasMap = Array.isArray(data.map?.record_ids) && data.map.record_ids.length > 0;
    const actions = hasMap ? `<div class="assistant-result-actions"><button type="button" class="assistant-map-primary" data-map-all>Посмотреть на карте <span aria-hidden="true">↗</span></button>${data.map.focus_ids?.length ? '<button type="button" data-map-extreme>Показать найденный участок ↗</button>' : ''}</div><details class="assistant-records"><summary>Все найденные усадьбы <span>${data.map.record_ids.length}</span></summary><div class="assistant-record-tools"><label>Поиск внутри выборки<input type="search" data-record-search placeholder="Фамилия, улица или номер…" aria-label="Поиск внутри найденных усадеб"></label><span data-record-count></span></div><div data-record-preview></div><button type="button" class="assistant-more" data-record-more>Показать ещё 20</button></details>` : '';
    result.innerHTML = `<div class="data-assistant-result-head"><span class="data-assistant-status">${mode}${elapsed}</span><span>${escapeHtml(data.matches_label || "")}</span></div><div class="data-assistant-answer">${answerHtml}</div>${actions}${list}${sources.length ? `<details class="data-assistant-sources"><summary>Примеры записей · ${sources.length}</summary><div>${sources.map(source => `<article><b>${escapeHtml(source.title)}</b><span>${escapeHtml(source.meta)}</span>${source.source ? `<small>${escapeHtml(source.source)}</small>` : ""}${hasMap && recordsById.has(Number(source.id)) ? `<button type="button" class="assistant-source-map" data-estate-id="${Number(source.id)}">Открыть на карте ↗</button>` : ''}</article>`).join("")}</div></details>` : ""}`;
    result.hidden = false;
    if (checks.length) result.insertAdjacentHTML("beforeend", `<details class="data-assistant-sources"><summary>Что проверено по базе</summary><div>${checks.join("")}</div></details>`);
    if (hasMap) renderRecordPreview();
  }

  result.addEventListener('input', event => { if (event.target.matches('[data-record-search]')) { previewLimit = 20; renderRecordPreview(); } });
  result.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-cancel-search')) {cancelSearch();return;}
    if (!lastAnswer?.map) return;
    if (button.hasAttribute('data-map-all')) openAnswerMap(lastAnswer.map.record_ids, lastAnswer.map.description);
    else if (button.hasAttribute('data-map-extreme')) openAnswerMap(lastAnswer.map.focus_ids, 'Участки с найденной площадью', lastAnswer.map.focus_ids.length === 1 ? lastAnswer.map.focus_ids[0] : null);
    else if (button.hasAttribute('data-estate-id')) openAnswerMap(lastAnswer.map.record_ids, lastAnswer.map.description, Number(button.dataset.estateId));
    else if (button.hasAttribute('data-group-index')) { const item = lastAnswer.items[Number(button.dataset.groupIndex)]; openAnswerMap(item.map_ids, lastAnswer.map.description + ' · ' + item.value); }
    else if (button.hasAttribute('data-record-more')) { previewLimit += 20; renderRecordPreview(); }
  });
  document.getElementById('databaseMapClear')?.addEventListener('click', clearDatabaseMapFilter);
  document.getElementById('databaseMapBack')?.addEventListener('click', () => {
    if (mapContext) { input.value = mapContext.data.map.question; updateClear(); render(mapContext.data); }
    document.querySelector('.nav-item[data-page="info"]').click();
    result.scrollIntoView({block: 'center', behavior: 'smooth'});
  });
  document.getElementById('databaseMapAll')?.addEventListener('click', () => {
    if (databaseMapFilter?.kind === 'street') {
      const selection = databaseMapFilter;
      applyDatabaseMapFilter([...selection.ids], selection.description, selection.question, {kind: 'street', streetId: selection.streetId});
      fitToEstates(16, true);
      return;
    }
    if (mapContext) { lastAnswer = mapContext.data; openAnswerMap(lastAnswer.map.record_ids, lastAnswer.map.description); }
  });

  async function ask(question) {
    cancelSearch(false);
    updateClear();
    const currentRequest = ++requestId;
    const controller = new AbortController();
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const request = {controller, token, slowMessage:null};
    activeRequest = request;
    submit.disabled = true; form.classList.add("is-loading"); result.hidden = false;
    result.innerHTML = '<div class="data-assistant-loading"><i></i><span>Разбираю вопрос и проверяю реестр…</span><button type="button" class="assistant-cancel" data-cancel-search>Отменить</button></div>';
    const slowMessage = setTimeout(() => { if (currentRequest === requestId) { const label = result.querySelector(".data-assistant-loading span"); if (label) label.textContent = "Локальная модель разбирает условия. Подсчёт выполнит база…"; } }, 1500);
    request.slowMessage = slowMessage;
    try {
      const response = await fetch("ai/search.php", {method:"POST",signal:controller.signal, headers:{"Content-Type":"application/json","Accept":"application/json"}, body:JSON.stringify({question, history,request_id:token})});
      const data = await response.json();
      if (currentRequest !== requestId) return;
      if (!response.ok) throw new Error(data.error || "Не удалось получить ответ");
      render(data);
      history = [...history, {role:"user",content:question}, {role:"assistant",content:data.answer}].slice(-4);
    } catch (error) {
      if (currentRequest !== requestId) return;
      result.innerHTML = `<div class="data-assistant-error"><b>Ответ пока недоступен</b><span>${escapeHtml(error.message)}</span></div>`;
    } finally { clearTimeout(slowMessage); if (currentRequest === requestId) { activeRequest = null; submit.disabled = false; form.classList.remove("is-loading"); } }
  }

  form.addEventListener("submit", event => { event.preventDefault(); const question = input.value.trim(); if (question.length < 3) { input.focus(); return; } ask(question); });
  document.querySelectorAll("[data-ai-question]").forEach(button => button.addEventListener("click", () => { input.value = button.dataset.aiQuestion; ask(input.value); }));

  if (modelState) {
    fetch("ai/status.php", {headers:{"Accept":"application/json"}})
      .then(response => response.json())
      .then(data => {
        modelState.classList.add(data.online ? "is-online" : "is-offline");
        modelState.querySelector("span").textContent = data.online ? "Гибрид готов · локальный ИИ подключён" : "Быстрый поиск готов · ИИ не подключён";
      })
      .catch(() => {
        modelState.classList.add("is-offline");
        modelState.querySelector("span").textContent = "Модель не запущена";
      });
  }
})();
