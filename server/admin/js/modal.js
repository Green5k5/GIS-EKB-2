// Окно поверх страницы. Одно на всю админку, форму подставляем каждый раз новую
const modal        = document.getElementById('modal');
const titleBox     = document.getElementById('modal-title');
const form         = document.getElementById('modal-form');
const errorBox     = document.getElementById('modal-error');
const saveButton   = document.getElementById('modal-save');
const closeButton  = document.getElementById('modal-close');
const cancelButton = document.getElementById('modal-cancel');

let currentOnSave = null;
let initialData = '';
let saving = false;

function formSnapshot() {
  return new URLSearchParams(new FormData(form)).toString();
}

// если onSave вернул false, окно остаётся открытым
export function openModal({ title, html, onSave }) {
  titleBox.textContent = title;
  form.innerHTML = html;
  errorBox.textContent = '';
  currentOnSave = onSave;
  initialData = formSnapshot();

  modal.hidden = false;
  document.body.classList.add('modal-open');
  const firstInput = form.querySelector('input, select, textarea');
  if (firstInput) firstInput.focus();
}

export function closeModal() {
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  form.innerHTML = '';
  currentOnSave = null;
}

// случайный клик мимо окна не должен стирать то, что уже ввели
function requestClose() {
  if (saving) return;
  if (formSnapshot() !== initialData && !confirm('Закрыть без сохранения? Изменения пропадут.')) return;
  closeModal();
}

export function setFieldErrors(errors) {
  for (const errorEl of form.querySelectorAll('[data-error-for]')) {
    const key = errorEl.dataset.errorFor;
    errorEl.textContent = errors[key] || '';
    const input = form.elements[key];
    if (input) input.classList.toggle('invalid', Boolean(errors[key]));
  }
  const firstKey = Object.keys(errors)[0];
  if (firstKey && form.elements[firstKey]) form.elements[firstKey].focus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentOnSave || saving) return;

  errorBox.textContent = '';
  saving = true;
  saveButton.disabled = true;
  saveButton.textContent = 'Сохранение…';
  try {
    const result = await currentOnSave(new FormData(form));
    if (result !== false) closeModal();
  } catch (error) {
    errorBox.textContent = `Не удалось сохранить: ${error.message}`;
  } finally {
    saving = false;
    saveButton.disabled = false;
    saveButton.textContent = 'Сохранить';
  }
});

closeButton.addEventListener('click', requestClose);
cancelButton.addEventListener('click', requestClose);

modal.addEventListener('click', event => {
  if (event.target === modal) requestClose();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !modal.hidden) requestClose();
});
