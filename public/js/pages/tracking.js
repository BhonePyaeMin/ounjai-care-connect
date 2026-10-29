import { mountLayout } from '../layout.js';
import { api } from '../api.js';
import { el, icon, $, clear, baht, formatDateTime } from '../dom.js';
import { toast, openModal } from '../components.js';
import { openSos } from '../sos.js';

const user = await mountLayout();
const NS = 'http://www.w3.org/2000/svg';

$('#sos-btn').append(icon('alert', 18), 'Emergency Support (SOS)');
$('#support-btn').append(icon('headset', 18), 'Contact Customer Support');

const STATUS = {
  scheduled: ['Confirmed Booking', ''],
  in_transit: ['Caregiver in Transit', 'blue'],
  in_service: ['Service in progress', ''],
  completed: ['Completed', 'neutral'],
  cancelled: ['Cancelled', 'danger'],
};

let bookings = [];
let current = null;
let timer = null;
let fbBookingId = null;

async function start() {
  try {
    ({ bookings } = await api('/api/bookings'));
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  if (bookings.length === 0) {
    $('#gate').append(el('div', { class: 'card' },
      el('h2', { text: 'No bookings yet' }),
      el('p', { class: 'muted', text: 'Find a caregiver to make your first booking.' }),
      el('a', { class: 'btn', style: { marginTop: '1rem' }, href: '/matching', text: 'Find a caregiver' }),
    ));
    return;
  }
  const wanted = new URLSearchParams(location.search).get('id');
  select(bookings.find((b) => b.id === wanted) || bookings[0]);
}

function renderPicker() {
  clear($('#picker')).append(...bookings.map((b) =>
    el('button', { type: 'button', 'aria-pressed': String(b.id === current.id), onclick: () => select(b) },
      el('strong', { text: b.id }), el('div', { class: 'xsmall muted', text: `${b.service} · ${formatDateTime(b.startAt)}` }),
    ),
  ));
}

function select(b) {
  current = b;
  fbBookingId = null;
  const url = new URL(location.href);
  url.searchParams.set('id', b.id);
  history.replaceState(null, '', url);
  renderPicker();
  $('#detail').classList.remove('hidden');
  render(b);
  poll();
}

function render(b) {
  current = b;
  const [label, kind] = STATUS[b.status];
  $('#bk-id').textContent = `Booking ID: ${b.id}`;
  $('#bk-title').textContent = `Detailed ${b.service} Service`;
  const badge = $('#bk-status');
  badge.textContent = label;
  badge.className = `badge ${kind}`;
  $('#bk-when').textContent = formatDateTime(b.startAt);
  $('#bk-cg').textContent = b.caregiver.name;
  $('#bk-recipient').textContent = `${b.recipientName} (Age ${b.recipientAge})`;
  $('#bk-addr').textContent = b.address;
  $('#bk-fee').textContent = `${b.hours} h · ${baht(b.fee)}`;

  const call = $('#call-btn');
  clear(call).append(icon('phone', 18), 'Call Caregiver');
  call.href = `tel:${b.caregiver.phone}`;
  call.setAttribute('aria-label', `Call ${b.caregiver.name} (demo number ${b.caregiver.phone})`);

  const cancelBtn = $('#cancel-btn');
  cancelBtn.classList.toggle('hidden', b.status !== 'scheduled');

  renderTrip(b);
  renderDemo(b);
  renderFeedback(b);
}

function renderTrip(b) {
  const t = b.tracking;
  const tb = $('#trip-badge');
  const text = {
    scheduled: 'Waiting for departure',
    in_transit: 'Caregiver in Transit',
    in_service: 'Caregiver has arrived',
    completed: 'Service completed',
    cancelled: 'Booking cancelled',
  }[b.status];
  tb.textContent = text;
  tb.className = `badge ${b.status === 'in_transit' ? 'blue' : b.status === 'cancelled' ? 'danger' : ''}`;

  const eta = $('#eta');
  clear(eta).append(icon('nav', 14));
  if (b.status === 'in_transit') eta.append(`Estimated Arrival: ${t.etaMinutes} min${t.etaMinutes === 1 ? '' : 's'} to destination`);
  else if (b.status === 'scheduled') eta.append(`Departs about ${t.transitMinutes} min before start`);
  else if (b.status === 'in_service') eta.append('Arrived at destination');
  else if (b.status === 'completed') eta.append('Trip finished');
  else eta.append('No trip');

  const pct = Math.round((b.status === 'in_service' || b.status === 'completed' ? 1 : t.progress) * 100);
  $('#prog-bar').style.width = `${pct}%`;
  $('#prog').setAttribute('aria-valuenow', String(pct));
  drawMap(b);
}

function drawMap(b) {
  const svg = $('#map');
  clear(svg);
  const t = b.tracking;
  const pts = [t.origin, t.destination];
  const minLat = Math.min(...pts.map((p) => p.lat));
  const maxLat = Math.max(...pts.map((p) => p.lat));
  const minLng = Math.min(...pts.map((p) => p.lng));
  const maxLng = Math.max(...pts.map((p) => p.lng));
  const W = 640, H = 360, pad = 80;
  const spanLng = Math.max(maxLng - minLng, 0.02);
  const spanLat = Math.max(maxLat - minLat, 0.02);
  const scale = Math.min((W - pad * 2) / spanLng, (H - pad * 2) / spanLat);
  const cx = (minLng + maxLng) / 2, cy = (minLat + maxLat) / 2;
  const x = (lng) => W / 2 + (lng - cx) * scale;
  const y = (lat) => H / 2 - (lat - cy) * scale;
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (let i = 0; i <= 8; i++) {
    add('line', { x1: (W / 8) * i, y1: 0, x2: (W / 8) * i, y2: H, stroke: 'oklch(90% .02 170)', 'stroke-width': 1 });
    add('line', { x1: 0, y1: (H / 8) * i, x2: W, y2: (H / 8) * i, stroke: 'oklch(90% .02 170)', 'stroke-width': 1 });
  }
  add('line', { x1: x(t.origin.lng), y1: y(t.origin.lat), x2: x(t.destination.lng), y2: y(t.destination.lat), stroke: 'oklch(70% .05 200)', 'stroke-width': 4, 'stroke-dasharray': '10 8', 'stroke-linecap': 'round' });
  add('line', { x1: x(t.origin.lng), y1: y(t.origin.lat), x2: x(t.position.lng), y2: y(t.position.lat), stroke: 'oklch(59% .14 163)', 'stroke-width': 5, 'stroke-linecap': 'round' });
  add('circle', { cx: x(t.origin.lng), cy: y(t.origin.lat), r: 8, fill: 'oklch(52% .03 210)' });
  add('text', { x: x(t.origin.lng), y: y(t.origin.lat) + 26, 'text-anchor': 'middle', 'font-size': 14, fill: 'oklch(35% .03 200)' }, `${b.caregiver.name}'s base`);
  add('circle', { cx: x(t.destination.lng), cy: y(t.destination.lat), r: 11, fill: 'oklch(59% .22 15)', stroke: '#fff', 'stroke-width': 3 });
  add('text', { x: x(t.destination.lng), y: y(t.destination.lat) - 20, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'oklch(35% .03 200)' }, 'Care address');
  if (b.status === 'in_transit' || b.status === 'in_service' || b.status === 'completed') {
    const px = x(t.position.lng), py = y(t.position.lat);
    add('circle', { cx: px, cy: py, r: 18, fill: 'oklch(59% .14 163 / .25)' });
    add('circle', { cx: px, cy: py, r: 10, fill: 'oklch(59% .14 163)', stroke: '#fff', 'stroke-width': 3 });
  }
}

function renderDemo(b) {
  const row = clear($('#demo-row'));
  if (b.status === 'scheduled') {
    row.append(el('button', { class: 'btn secondary sm', type: 'button', onclick: demoStart, text: 'Demo: start the trip now' }),
      el('span', { class: 'xsmall muted', text: 'Compresses time so you can watch the whole journey in about a minute.' }));
  } else if (b.tracking.demo) {
    row.append(el('span', { class: 'badge neutral', text: 'Demo trip (accelerated time)' }));
  }
}

async function demoStart() {
  try {
    const { booking } = await api(`/api/bookings/${encodeURIComponent(current.id)}/start-demo`, { method: 'POST' });
    replace(booking);
    poll();
  } catch (e) { toast(e.message, 'error'); }
}

function replace(b) {
  bookings = bookings.map((x) => (x.id === b.id ? b : x));
  render(b);
  renderPicker();
}

function renderFeedback(b) {
  const card = $('#feedback-card');
  const body = $('#feedback-body');
  if (b.status !== 'completed') { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  if (fbBookingId === b.id && !b.feedback) return; // keep the form the user is filling in
  fbBookingId = b.id;
  clear(body);
  if (b.feedback) {
    body.append(el('p', { text: `Thank you! You rated ${b.caregiver.name} ${b.feedback.rating}/5.` }), b.feedback.comment ? el('p', { class: 'muted small', text: `“${b.feedback.comment}”` }) : null);
    return;
  }
  let rating = 0;
  const stars = el('div', { class: 'stars', role: 'group', 'aria-label': 'Rating' });
  const paint = () => [...stars.children].forEach((s, i) => { s.classList.toggle('on', i < rating); s.setAttribute('aria-pressed', String(i < rating)); });
  for (let i = 1; i <= 5; i++) {
    const s = el('button', { type: 'button', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, 'aria-pressed': 'false', onclick: () => { rating = i; paint(); } }, icon('star', 28));
    s.querySelector('svg').setAttribute('fill', 'currentColor');
    stars.append(s);
  }
  const comment = el('textarea', { class: 'input', maxlength: 500, 'aria-label': 'Comment', placeholder: 'Tell others about your experience (optional)' });
  const err = el('p', { class: 'error-text', role: 'alert' });
  const submit = el('button', { class: 'btn', type: 'button', text: 'Submit feedback' });
  submit.addEventListener('click', async () => {
    if (!rating) { err.textContent = 'Please choose a star rating.'; return; }
    submit.disabled = true;
    try {
      await api(`/api/bookings/${encodeURIComponent(b.id)}/feedback`, { method: 'POST', body: { rating, comment: comment.value.trim() } });
      toast('Thanks for your feedback!', 'success');
      const { booking } = await api(`/api/bookings/${encodeURIComponent(b.id)}`);
      fbBookingId = null;
      replace(booking);
    } catch (e) { err.textContent = e.message; submit.disabled = false; }
  });
  body.append(el('div', { class: 'stack' }, stars, comment, err, submit));
}

function poll() {
  clearTimeout(timer);
  if (!current) return;
  const active = ['scheduled', 'in_transit', 'in_service'].includes(current.status);
  if (!active) return;
  const id = current.id;
  const delay = current.status === 'in_transit' || current.tracking.demo ? 2000 : 15000;
  timer = setTimeout(async () => {
    try {
      const { booking } = await api(`/api/bookings/${encodeURIComponent(id)}`);
      if (current && current.id === id) replace(booking);
    } catch { /* keep trying */ }
    poll();
  }, delay);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

$('#sos-btn').addEventListener('click', () => {
  if (!current) return;
  openSos({ bookingId: current.id, location: { lat: current.lat, lng: current.lng } });
});

$('#support-btn').addEventListener('click', () => {
  openModal({
    title: 'Contact Customer Support',
    body: el('div', { class: 'stack' },
      el('p', { text: 'Questions about a booking or caregiver? Quote your booking ID when you contact us.' }),
      el('p', { class: 'small' }, 'Email: ', el('a', { href: 'mailto:support@ounjai.example', text: 'support@ounjai.example' })),
      el('p', { class: 'notice', text: 'Prototype notice: this address is a placeholder and is not monitored. For urgent medical help call 1669.' }),
    ),
    actions: [{ label: 'Close', onClick: ({ close }) => close() }],
  });
});

$('#cancel-btn').addEventListener('click', () => {
  openModal({
    title: 'Cancel this booking?',
    body: el('p', { text: `Booking ${current.id} with ${current.caregiver.name} will be cancelled.` }),
    actions: [
      { label: 'Keep booking', onClick: ({ close }) => close() },
      {
        label: 'Cancel booking', kind: 'danger',
        onClick: async ({ close, button }) => {
          button.disabled = true;
          try {
            const { booking } = await api(`/api/bookings/${encodeURIComponent(current.id)}/cancel`, { method: 'POST' });
            close();
            replace(booking);
            toast('Booking cancelled', 'success');
          } catch (e) { toast(e.message, 'error'); close(); }
        },
      },
    ],
  });
});

if (!user) {
  $('#gate').append(el('div', { class: 'card' },
    el('h2', { text: 'Sign in to see your bookings' }),
    el('p', { class: 'muted', text: 'Your bookings, caregiver details and live tracking are private to your account.' }),
    el('div', { class: 'row', style: { marginTop: '1rem' } },
      el('a', { class: 'btn', href: `/login?next=${encodeURIComponent('/tracking' + location.search)}`, text: 'Sign in or create an account' }),
      el('a', { class: 'btn danger', href: '/emergency', text: 'Emergency help (no sign-in needed)' }),
    ),
  ));
} else {
  start();
}
