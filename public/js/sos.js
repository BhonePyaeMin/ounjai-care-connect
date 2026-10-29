import { api } from './api.js';
import { el, icon } from './dom.js';
import { openModal, toast } from './components.js';

/** Confirm, send an SOS alert, and show what happened. Works for guests and signed-in users. */
export function openSos({ bookingId, location } = {}) {
  const msg = el('textarea', { id: 'sos-msg', class: 'input', maxlength: 300, placeholder: 'What is happening? (optional)' });
  const err = el('p', { class: 'error-text', role: 'alert' });
  const body = el('div', { class: 'stack' },
    el('div', { class: 'callout emergency' }, icon('alert', 20), el('p', { class: 'small', text: 'If someone is in danger, call 1669 first. This button records an alert and notifies your saved emergency contacts and assigned caregiver in the prototype.' })),
    el('div', { class: 'field' }, el('label', { for: 'sos-msg', text: 'Message' }), msg),
    err,
  );
  openModal({
    title: 'Send emergency alert?',
    body,
    labelledBy: 'sos-title',
    actions: [
      { label: 'Cancel', onClick: ({ close }) => close() },
      { label: 'Call 1669', kind: 'danger', href: 'tel:1669' },
      {
        label: 'Send SOS alert',
        kind: 'danger',
        onClick: async ({ close, button }) => {
          button.disabled = true;
          try {
            const res = await api('/api/sos', { method: 'POST', body: { message: msg.value.trim(), bookingId, lat: location?.lat, lng: location?.lng } });
            close();
            showResult(res);
          } catch (e) {
            err.textContent = e.message;
            button.disabled = false;
            toast(e.message, 'error');
          }
        },
      },
    ],
  });
}

function showResult(res) {
  openModal({
    title: 'Alert recorded',
    labelledBy: 'sos-done-title',
    body: el('div', { class: 'stack' },
      el('p', { text: res.message }),
      res.notified.length
        ? el('div', {}, el('strong', { class: 'small', text: 'Would be notified (simulation):' }), el('ul', { class: 'small' }, res.notified.map((n) => el('li', { text: `${n.name} (${n.relation})` }))))
        : el('p', { class: 'small muted', text: 'No emergency contacts are saved yet. Add some on the Emergency Support page.' }),
      el('div', { class: 'row' }, res.hotlines.map((h) => el('a', { class: 'btn danger sm', href: `tel:${h.number}`, text: `${h.number} · ${h.label}` }))),
      el('p', { class: 'xsmall muted', text: `Alert reference #${res.alertId}` }),
    ),
    actions: [{ label: 'Close', onClick: ({ close }) => close() }],
  });
}
