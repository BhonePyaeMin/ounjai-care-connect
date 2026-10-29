import { mountLayout } from '../layout.js';
import { api, safeNext } from '../api.js';
import { $ } from '../dom.js';

const user = await mountLayout();
const next = safeNext(new URLSearchParams(location.search).get('next'));
if (user) location.replace(next);

function showTab(which) {
  for (const t of ['login', 'register']) {
    const on = t === which;
    $(`#tab-${t}`).setAttribute('aria-selected', String(on));
    $(`#tab-${t}`).setAttribute('aria-pressed', String(on));
    $(`#panel-${t}`).classList.toggle('hidden', !on);
  }
}
$('#tab-login').addEventListener('click', () => showTab('login'));
$('#tab-register').addEventListener('click', () => showTab('register'));
if (location.hash === '#register') showTab('register');

async function submit(e, path, body, errEl) {
  e.preventDefault();
  errEl.textContent = '';
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api(path, { method: 'POST', body });
    location.href = next;
  } catch (ex) {
    errEl.textContent = ex.message;
    btn.disabled = false;
  }
}

$('#panel-login').addEventListener('submit', (e) =>
  submit(e, '/api/auth/login', { email: $('#l-email').value.trim(), password: $('#l-pass').value }, $('#l-err')));

$('#panel-register').addEventListener('submit', (e) =>
  submit(e, '/api/auth/register', {
    name: $('#r-name').value.trim(),
    email: $('#r-email').value.trim(),
    phone: $('#r-phone').value.trim() || undefined,
    password: $('#r-pass').value,
    consent: $('#r-consent').checked,
  }, $('#r-err')));
