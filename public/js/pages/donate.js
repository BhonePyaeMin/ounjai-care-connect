import { mountLayout } from '../layout.js';
import { api } from '../api.js';
import { el, $, clear, baht } from '../dom.js';
import { toast } from '../components.js';

await mountLayout();
const host = $('#campaigns');

function campaignCard(c, redraw) {
  const amountIn = el('input', { class: 'input', type: 'number', min: 20, max: 100000, value: '300', 'aria-label': `Amount in baht for ${c.title}`, style: { maxWidth: '8rem' } });
  const presets = el('div', { class: 'row' }, [100, 300, 500, 1000].map((v) =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(v === 300), text: baht(v),
      onclick: () => {
        amountIn.value = String(v);
        presets.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === baht(v))));
      },
    })));
  const msg = el('p', { class: 'small', role: 'status' });
  const btn = el('button', { class: 'btn', type: 'button', text: 'Donate' });
  btn.addEventListener('click', async () => {
    msg.textContent = '';
    btn.disabled = true;
    try {
      const res = await api('/api/donations', { method: 'POST', body: { campaignId: c.id, amount: Number(amountIn.value) } });
      toast(res.message, 'success');
      Object.assign(c, res.campaign);
      redraw();
    } catch (e) {
      msg.textContent = e.message;
      msg.className = 'small error-text';
      btn.disabled = false;
    }
  });
  const pct = Math.min(100, Math.round((c.raised / c.goal) * 100));
  return el('article', { class: 'card stack' },
    el('div', { class: 'row between' }, el('h2', { style: { margin: 0 }, text: c.title }), el('span', { class: 'badge', text: c.category })),
    el('p', { class: 'muted small', text: c.description }),
    el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': `${c.title} funding` }, el('div', { style: { width: `${pct}%` } })),
    el('p', { class: 'small' }, el('strong', { text: baht(c.raised) }), ` raised of ${baht(c.goal)} goal (${pct}%)`),
    presets,
    el('div', { class: 'row' }, amountIn, btn),
    msg,
  );
}

try {
  const { campaigns } = await api('/api/campaigns');
  clear(host);
  for (const c of campaigns) {
    const holder = el('div');
    const draw = () => clear(holder).append(campaignCard(c, draw));
    draw();
    host.append(holder);
  }
} catch (e) {
  host.append(el('p', { class: 'error-text', text: e.message }));
}
