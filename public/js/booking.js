import { api, getConfig } from './api.js';
import { el, baht, $ } from './dom.js';
import { openModal, toast } from './components.js';

function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const defaultStart = () => {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return localInputValue(d);
};

export async function openBooking(cg, { service = '', locationIndex = 0, startAt = '', hours = 2 } = {}) {
  const config = await getConfig();
  const err = el('p', { class: 'error-text', role: 'alert' });
  const field = (id, label, input, hint, full) =>
    el('div', { class: `field${full ? ' full' : ''}` }, el('label', { for: id, text: label }), input, hint ? el('span', { class: 'hint', text: hint }) : null);

  const serviceSel = el('select', { id: 'b-service', class: 'input' }, cg.categories.map((c) => el('option', { value: c, text: c, selected: c === service })));
  const locSel = el('select', { id: 'b-loc', class: 'input' }, config.locations.map((l, i) => el('option', { value: String(i), text: l.name, selected: i === Number(locationIndex) })));
  const nameIn = el('input', { id: 'b-name', class: 'input', maxlength: 80, required: true, autocomplete: 'off' });
  const ageIn = el('input', { id: 'b-age', class: 'input', type: 'number', min: 0, max: 120, required: true });
  const addrIn = el('input', { id: 'b-addr', class: 'input', maxlength: 200, required: true, placeholder: 'House no., road, sub-district' });
  const startIn = el('input', { id: 'b-start', class: 'input', type: 'datetime-local', required: true, value: startAt || defaultStart() });
  const hoursIn = el('input', { id: 'b-hours', class: 'input', type: 'number', min: 1, max: 12, required: true, value: String(hours) });
  const notesIn = el('textarea', { id: 'b-notes', class: 'input', maxlength: 500, placeholder: 'Anything the caregiver should know (optional). Avoid sharing more health detail than needed.' });
  const total = el('strong', { text: baht(cg.feePerHour * hours) });
  hoursIn.addEventListener('input', () => { total.textContent = baht(cg.feePerHour * (Number(hoursIn.value) || 0)); });

  const form = el('form', { class: 'form-grid', novalidate: true },
    field('b-service', 'Service', serviceSel),
    field('b-loc', 'Area', locSel, 'Used to estimate the caregiver’s travel time'),
    field('b-name', 'Care recipient name', nameIn),
    field('b-age', 'Care recipient age', ageIn),
    field('b-addr', 'Address', addrIn, null, true),
    field('b-start', 'Start date & time', startIn),
    field('b-hours', 'Hours (1-12)', hoursIn),
    field('b-notes', 'Notes', notesIn, null, true),
    el('div', { class: 'full row between' }, el('span', {}, 'Estimated total: ', total, el('span', { class: 'xsmall muted', text: ` (${baht(cg.feePerHour)}/hour)` })), el('span', { class: 'xsmall muted', text: 'No payment is taken in this prototype.' })),
    el('div', { class: 'full' }, err),
  );

  const { close } = openModal({
    title: `Book ${cg.name}`,
    body: form,
    labelledBy: 'booking-title',
    actions: [
      { label: 'Cancel', onClick: ({ close: c }) => c() },
      {
        label: 'Confirm booking',
        kind: '',
        onClick: async ({ button }) => {
          err.textContent = '';
          const loc = config.locations[Number(locSel.value)];
          const start = new Date(startIn.value);
          if (!nameIn.value.trim() || !addrIn.value.trim() || ageIn.value === '' || Number.isNaN(start.getTime())) {
            err.textContent = 'Please complete the recipient name, age, address and start time.';
            return;
          }
          button.disabled = true;
          try {
            const { booking } = await api('/api/bookings', {
              method: 'POST',
              body: {
                caregiverId: cg.id,
                service: serviceSel.value,
                recipientName: nameIn.value.trim(),
                recipientAge: Number(ageIn.value),
                address: addrIn.value.trim(),
                lat: loc.lat,
                lng: loc.lng,
                startAt: start.toISOString(),
                hours: Number(hoursIn.value),
                notes: notesIn.value.trim(),
              },
            });
            toast(`Booking ${booking.id} confirmed`, 'success');
            location.href = `/tracking?id=${encodeURIComponent(booking.id)}`;
          } catch (e) {
            err.textContent = e.message;
            button.disabled = false;
          }
        },
      },
    ],
  });
  nameIn.focus();
  return close;
}
