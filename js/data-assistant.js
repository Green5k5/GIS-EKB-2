function initDataAssistant() {
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
  let activeRequest = null;
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);

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

  function openAnswerMap(ids, description) {
    if (!lastAnswer?.map || !Array.isArray(ids) || !ids.length) return;
    openMapSelection(ids, description, lastAnswer.map.question);
  }

  function render(data) {
    lastAnswer = data;
    if (Array.isArray(data.map?.record_ids)) {
      const operation = data.tool_calls?.find(step => step.tool === 'query_database')?.arguments?.operation || '';
      setTableAIScope(data.map.record_ids, data.map.description, data.map.question, data.map.focus_ids || [], operation);
    } else clearTableAIScope();
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
    const items = Array.isArray(data.items) ? data.items.filter(item => Array.isArray(item.map_ids)) : [];
    const list = items.length ? `<div class="data-assistant-list" role="list">${items.map((item, index) => `<div role="listitem"><button type="button" class="assistant-group-row" ${item.map_ids?.length ? `data-group-index="${index}" title="Показать эту группу в таблице"` : item.id ? `data-estate-id="${Number(item.id)}" title="Открыть усадьбу на карте"` : 'disabled'}><span>${escapeHtml(item.value)}</span><span class="assistant-group-count">${item.count !== null ? `<b>${escapeHtml(item.count)}</b>` : ''}<span aria-hidden="true">↓</span></span></button></div>`).join("")}</div>${data.items_truncated ? '<p class="data-assistant-list-note">Показаны первые 50 строк. Полная выборка доступна ниже и на карте.</p>' : ""}` : "";
    const hasMap = Array.isArray(data.map?.record_ids) && data.map.record_ids.length > 0;
    const actions = Array.isArray(data.map?.record_ids) ? `<div class="assistant-result-actions"><button type="button" class="assistant-map-primary" data-table-all>К таблице · ${data.map.record_ids.length} усадеб ↓</button>${hasMap ? '<button type="button" data-map-all>Выборка на карте ↗</button>' : ''}${data.map.focus_ids?.length ? '<button type="button" data-table-extreme>Только найденные максимумы / минимумы</button>' : ''}</div>` : '';
    result.innerHTML = `<div class="data-assistant-result-head"><span class="data-assistant-status">${mode}${elapsed}</span><span>${escapeHtml(data.matches_label || "")}</span></div><div class="data-assistant-answer">${answerHtml}</div>${actions}${list}`;
    result.hidden = false;
    if (checks.length) result.insertAdjacentHTML("beforeend", `<details class="data-assistant-sources"><summary>Что проверено по базе</summary><div>${checks.join("")}</div></details>`);

  }

  result.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-cancel-search')) {cancelSearch();return;}
    if (!lastAnswer?.map) return;
    if (button.hasAttribute('data-table-all')) { setTableAIScope(lastAnswer.map.record_ids, lastAnswer.map.description, lastAnswer.map.question, lastAnswer.map.focus_ids || [], lastAnswer.tool_calls?.find(step => step.tool === 'query_database')?.arguments?.operation || ''); scrollToEstateTable(); }
    else if (button.hasAttribute('data-table-extreme')) { setTableAIScope(lastAnswer.map.focus_ids, lastAnswer.map.description, lastAnswer.map.question, lastAnswer.map.focus_ids); scrollToEstateTable(); }
    else if (button.hasAttribute('data-map-all')) openAnswerMap(lastAnswer.map.record_ids, lastAnswer.map.description);
    else if (button.hasAttribute('data-group-index')) {
      const item = lastAnswer.items.filter(item => Array.isArray(item.map_ids))[Number(button.dataset.groupIndex)];
      setTableAIScope(item.map_ids, lastAnswer.map.description + ' / ' + item.value, lastAnswer.map.question + ' / ' + item.value);
      scrollToEstateTable();
    }
  });
  document.getElementById('databaseMapBack')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-page="data"]').click();
    scrollToEstateTable();
  });
  document.getElementById('databaseMapAll')?.addEventListener('click', () => {
    if (databaseMapFilter?.kind === 'street') return;
    if (databaseMapFilter) {
      const selection = databaseMapFilter;
      applyDatabaseMapFilter([...selection.ids], selection.description, selection.question);
      fitToEstates(16, true);
    }
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
}
