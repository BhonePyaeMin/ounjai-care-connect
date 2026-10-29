import { mountLayout } from '../layout.js';
import { api, getConfig } from '../api.js';
import { el, icon, $, clear, baht, initials } from '../dom.js';
import { toast, starRow, breakdownBars, profileModal } from '../components.js';
import { openBooking } from '../booking.js';

const user = await mountLayout();
$('#arrow').append(icon('arrow', 16));
const config = await getConfig();

const params = new URLSearchParams(location.search);
const catSel = $('#f-category');
for (const c of config.categories) catSel.append(el('option', { value: c, text: c }));
const locSel = $('#f-location');
config.locations.forEach((l, i) => locSel.append(el('option', { value: String(i), text: l.name })));
$('#f-text').value = params.get('q') || '';
if (config.categories.includes(params.get('category'))) catSel.value = params.get('category');

let lastRequest = null;

function requestFromForm() {
  const loc = config.locations[Number(locSel.value)];
  const date = $('#f-date').value ? new Date($('#f-date').value).toISOString() : undefined;
  const maxFee = $('#f-fee').value ? Number($('#f-fee').value) : undefined;
  return {
    text: $('#f-text').value.trim(),
    category: catSel.value || undefined,
    lat: loc.lat,
    lng: loc.lng,
    date,
    maxFee,
    onlyVerified: $('#f-verified').checked,
  };
}

function book(cg) {
  if (!user) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  openBooking(cg, {
    service: lastRequest?.category && cg.categories.includes(lastRequest.category) ? lastRequest.category : cg.categories[0],
    locationIndex: locSel.value,
    startAt: $('#f-date').value,
  });
}

function card(r) {
  const cg = r.caregiver;
  return el('article', { class: 'card cg-card', 'aria-label': `${cg.name}, match score ${r.score} percent` },
    el('div', { class: 'avatar lg', style: { background: cg.avatarColor }, 'aria-hidden': 'true', text: initials(cg.name) }),
    el('div', { class: 'cg-main' },
      el('h3', {}, cg.name, starRow(cg.rating)),
      el('p', { class: 'small muted', text: `Experience: ${cg.experienceYears} yrs | Skills: ${cg.skillLabels.slice(0, 3).join(', ')}` }),
      el('div', { class: 'cg-tags' },
        el('span', { class: 'badge blue score-ring', text: `Match Score: ${r.score}%` }),
        cg.certs.length ? el('span', { class: 'badge', text: cg.certs[0] }) : null,
        cg.verified && !cg.certs.includes('Verified') ? el('span', { class: 'badge', text: 'Verified' }) : null,
        !cg.verified ? el('span', { class: 'badge warn', text: 'Verification pending' }) : null,
        el('span', { class: 'badge neutral', text: `${baht(cg.feePerHour)}/hr` }),
        r.distanceKm !== null ? el('span', { class: 'badge neutral', text: `${r.distanceKm} km` }) : null,
        !r.available ? el('span', { class: 'badge danger', text: 'Not available then' }) : null,
      ),
      el('details', { class: 'why' }, el('summary', { text: 'Why this match?' }),
        el('ul', {}, r.reasons.map((x) => el('li', { text: x }))),
        breakdownBars(r.breakdown),
      ),
    ),
    el('div', { class: 'cg-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => book(cg), text: 'Book Now', 'aria-label': `Book ${cg.name}` }),
      el('button', { class: 'btn secondary', type: 'button', onclick: () => profileModal(cg, { onBook: book }), text: 'View Profile', 'aria-label': `View profile of ${cg.name}` }),
    ),
  );
}

const STRENGTH = { none: ['No needs detected', 'neutral'], low: ['Signal: low', 'warn'], medium: ['Signal: medium', ''], high: ['Signal: high', ''] };

async function search() {
  const results = $('#results');
  clear(results).append(el('p', { class: 'muted', text: 'Finding the best matches…' }));
  try {
    lastRequest = requestFromForm();
    const data = await api('/api/match', { method: 'POST', body: lastRequest });
    $('#insights').textContent = data.insights;
    const [label, kind] = STRENGTH[data.needs.strength];
    const s = $('#strength');
    s.textContent = label;
    s.className = `badge ${kind}`;
    clear($('#needs')).append(...data.needs.labels.map((l) => el('span', { class: 'chip static', text: l })));
    $('#count').textContent = `${data.total} caregiver${data.total === 1 ? '' : 's'} found`;
    clear(results);
    if (data.results.length === 0) {
      results.append(el('div', { class: 'card' }, el('p', { text: 'No caregivers match these filters. Try removing the budget limit, the verified-only option or the service filter.' })));
    } else {
      results.append(...data.results.map(card));
    }
  } catch (e) {
    clear(results).append(el('p', { class: 'error-text', role: 'alert', text: e.message }));
    toast(e.message, 'error');
  }
}

$('#match-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  if ($('#f-text').value.trim()) p.set('q', $('#f-text').value.trim());
  if (catSel.value) p.set('category', catSel.value);
  history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
  search();
});

search();
