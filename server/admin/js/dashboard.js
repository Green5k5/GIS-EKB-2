// Сводка - четыре карточки с числами
import { api } from './api.js';
import { onSectionShow } from './router.js';

const statsBox = document.getElementById('stats');

function statCard(label, value) {
  return `
    <div class="card">
      <div class="stat__value">${Number(value).toLocaleString('ru-RU')}</div>
      <div class="stat__label">${label}</div>
    </div>`;
}

async function loadStats() {
  statsBox.innerHTML = '<p class="muted">Загрузка…</p>';
  try {
    const stats = await api('/api/admin/stats');
    statsBox.innerHTML =
      statCard('Записей', stats.records) +
      statCard('Контуров', stats.plots) +
      statCard('Поселений', stats.settlements) +
      statCard('Публикаций', stats.releases);
  } catch (error) {
    // текст с сервера, поэтому не через innerHTML
    statsBox.innerHTML = '<p class="error"></p>';
    statsBox.firstChild.textContent = `Не удалось загрузить сводку: ${error.message}`;
  }
}

onSectionShow('dashboard', loadStats);
