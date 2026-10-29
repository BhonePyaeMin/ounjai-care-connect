import { mountLayout } from '../layout.js';
import { api } from '../api.js';
import { $ } from '../dom.js';

const user = await mountLayout();
if (!user) {
  $('#erase-gate').textContent = 'Sign in to delete your account.';
} else {
  $('#erase-gate').textContent = `You are signed in as ${user.email}. This cannot be undone.`;
  $('#erase-form').classList.remove('hidden');
  $('#erase-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#e-err').textContent = '';
    if (!confirm('Permanently delete your account and all related data?')) return;
    try {
      await api('/api/me', { method: 'DELETE', body: { password: $('#e-pass').value } });
      location.href = '/';
    } catch (ex) {
      $('#e-err').textContent = ex.message;
    }
  });
}
