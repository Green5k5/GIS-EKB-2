// Страница сама обновляется при сохранении файлов, только на localhost

// новые файлы дописывать сюда, иначе обновления не будет
const FILES = [
  '/admin/index.html',
  '/admin/admin.css',
  '/admin/js/api.js',
  '/admin/js/router.js',
  '/admin/js/dashboard.js',
  '/admin/js/main.js',
];

const CHECK_EVERY_MS = 1000;
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
let previous = null;

async function readAll() {
  const texts = await Promise.all(
    FILES.map(file => fetch(file, { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')))
  );
  return texts.join('\n---\n');
}

async function check() {
  try {
    const current = await readAll();
    if (previous !== null && current !== previous) {
      location.reload();
      return;
    }
    previous = current;
  } catch {
    // сервер недоступен - пробуем ещё раз через секунду
  }
  setTimeout(check, CHECK_EVERY_MS);
}

if (isLocal) check();
