// Все запросы к серверу идут через api()

let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

// без этого токена сервер не примет POST, PATCH и DELETE
function getCsrfToken() {
  const cookie = document.cookie
    .split('; ')
    .find(part => part.startsWith('gis_csrf='));
  return cookie ? cookie.split('=')[1] : '';
}

// body передаём обычным объектом
export async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {};

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = getCsrfToken();

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // сервер выключен или нет сети
    throw new Error('сервер не отвечает');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // при входе 401 - это просто неверный ключ
    if (response.status === 401 && path !== '/api/admin/login' && onUnauthorized) {
      onUnauthorized();
    }
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status; // 401 - не вошли, 403 - нет прав, 409 - конфликт, 422 - ошибка в данных
    throw error;
  }
  return data;
}
