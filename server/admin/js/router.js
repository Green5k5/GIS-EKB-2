// Переключение разделов по адресу: /admin#records, /admin#plots

const DEFAULT_SECTION = 'dashboard';
const handlers = {};   // что вызвать при открытии раздела
let started = false;

export function onSectionShow(name, handler) {
  handlers[name] = handler;
}

function currentSection() {
  const name = location.hash.slice(1);
  return document.getElementById(`section-${name}`) ? name : DEFAULT_SECTION;
}

function showSection(name) {
  for (const section of document.querySelectorAll('.section')) {
    section.hidden = section.id !== `section-${name}`;
  }
  for (const link of document.querySelectorAll('.sidebar__link')) {
    link.classList.toggle('is-active', link.getAttribute('href') === `#${name}`);
  }
  const section = document.getElementById(`section-${name}`);
  document.title = `${section.dataset.title} · Админ-панель`;

  if (handlers[name]) handlers[name]();
}

export function startRouter() {
  if (!started) {
    window.addEventListener('hashchange', () => showSection(currentSection()));
    started = true;
  }
  showSection(currentSection());
}
