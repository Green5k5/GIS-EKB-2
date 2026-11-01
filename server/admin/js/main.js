// Вход и выход из админки
import { api, setUnauthorizedHandler } from './api.js';
import { startRouter } from './router.js';

// разделы сами регистрируются в роутере
import './dashboard.js';

const loginScreen = document.getElementById('login-screen');
const loginForm   = document.getElementById('login-form');
const loginKey    = document.getElementById('login-key');
const loginError  = document.getElementById('login-error');
const app         = document.getElementById('app');
const logoutBtn   = document.getElementById('logout-btn');

const LOGIN_ERRORS = {
  INVALID_KEY: 'Неверный ключ',
  ADMIN_KEY_NOT_CONFIGURED: 'На сервере не задан ADMIN_KEY (файл .env)',
};

function showLogin() {
  app.hidden = true;
  loginScreen.hidden = false;
  loginError.textContent = '';
  loginKey.focus();
}

// сессия кончилась посреди работы, надо сказать почему снова просим ключ
function handleSessionEnded() {
  showLogin();
  loginError.textContent = 'Сессия закончилась, войдите снова';
}

function showApp() {
  loginScreen.hidden = true;
  app.hidden = false;
  startRouter();
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: { key: loginKey.value } });
    loginKey.value = '';
    showApp();
  } catch (error) {
    loginError.textContent = LOGIN_ERRORS[error.message] || `Ошибка: ${error.message}`;
  }
}

async function handleLogout() {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch {
    // даже если сервер не ответил, всё равно выходим
  }
  showLogin();
}

async function start() {
  try {
    const session = await api('/api/admin/session');
    if (session.authenticated) showApp();
    else showLogin();
  } catch {
    showLogin();
    loginError.textContent = 'Сервер не отвечает. Запущен ли npm start?';
  }
}

setUnauthorizedHandler(handleSessionEnded);
loginForm.addEventListener('submit', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
start();
