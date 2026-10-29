import { mountLayout } from '../layout.js';
import { api } from '../api.js';
import { el, icon, $, clear } from '../dom.js';
import { toast } from '../components.js';
import { openSos } from '../sos.js';

const user = await mountLayout();
$('#sos-btn').append(icon('alert', 18), 'Emergency Support (SOS)');
$('#sos-btn').addEventListener('click', () => openSos());

async function loadContacts() {
  const { contacts } = await api('/api/contacts');
  const list = clear($('#contacts'));
  if (contacts.length === 0) list.append(el('li', { class: 'small muted', text: 'No contacts saved yet.' }));
  for (const c of contacts) {
    list.append(el('li', { class: 'row between' },
      el('span', {}, el('strong', { text: c.name }), el('span', { class: 'small muted', text: ` · ${c.relation} · ${c.phone}` })),
      el('span', { class: 'row' },
        el('a', { class: 'btn secondary sm', href: `tel:${c.phone}`, text: 'Call', 'aria-label': `Call ${c.name}` }),
        el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Remove ${c.name}`, onclick: async () => {
          try { await api(`/api/contacts/${c.id}`, { method: 'DELETE' }); loadContacts(); } catch (e) { toast(e.message, 'error'); }
        } }, icon('trash', 14)),
      ),
    ));
  }
}

if (!user) {
  $('#contacts-gate').append(el('p', { class: 'callout info' }, el('span', {}, 'Sign in to save emergency contacts. '), el('a', { href: '/login?next=/emergency', text: 'Sign in' })));
} else {
  $('#contact-form').classList.remove('hidden');
  loadContacts().catch((e) => toast(e.message, 'error'));
  $('#contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#contact-err');
    err.textContent = '';
    try {
      await api('/api/contacts', { method: 'POST', body: { name: $('#c-name').value.trim(), phone: $('#c-phone').value.trim(), relation: $('#c-rel').value.trim() } });
      e.target.reset();
      toast('Contact added', 'success');
      loadContacts();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}
