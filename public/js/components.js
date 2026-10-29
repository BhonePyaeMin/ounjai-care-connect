import { el, icon, clear, baht } from './dom.js';

// ---------------------------------------------------------------- toast / modal
export function toast(message, kind = '') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = el('div', { class: `toast ${kind}`, text: message });
  host.append(t);
  setTimeout(() => t.remove(), 4500);
}

export function openModal({ title, body, actions = [], labelledBy = 'modal-title' }) {
  const previous = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (previous && previous.focus) previous.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = [...modal.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy },
    el('h2', { id: labelledBy, text: title }),
    body,
    actions.length ? el('div', { class: 'actions' }, actions.map((a) => {
      const btn = el(a.href ? 'a' : 'button', { class: `btn ${a.kind || 'secondary'}`, href: a.href, type: a.href ? undefined : 'button', text: a.label });
      if (!a.href) btn.addEventListener('click', () => a.onClick({ close, button: btn }));
      return btn;
    })) : null,
  );
  const backdrop = el('div', { class: 'modal-backdrop' }, modal);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  const focusable = modal.querySelector('input,select,textarea,button,a[href]');
  (focusable || modal).focus();
  return { close, modal };
}

// ---------------------------------------------------------------- analysis result
const LEVEL_ICON = { emergency: 'alert', urgent: 'alert', unclear: 'alert', routine: 'info', 'self-care': 'check' };

export function renderTriageBanner(triage) {
  const kind = triage.level;
  const box = el('div', { class: `callout ${kind}`, role: kind === 'emergency' ? 'alert' : 'status' },
    icon(LEVEL_ICON[kind] || 'info', 20),
    el('div', {},
      el('strong', { text: triage.levelLabel }),
      triage.redFlags && triage.redFlags.length ? el('div', { text: `Warning signs: ${triage.redFlags.map((r) => r.label).join('; ')}` }) : null,
      el('ul', { style: { margin: '.35rem 0 0', paddingLeft: '1.1rem' } }, triage.advice.map((a) => el('li', { text: a }))),
      triage.hotlines && triage.hotlines.length
        ? el('div', { class: 'row', style: { marginTop: '.6rem' } }, triage.hotlines.map((n) => el('a', { class: 'btn danger sm', href: `tel:${n}`, text: `Call ${n}` })))
        : null,
    ),
  );
  return box;
}

export function renderAnalysis(container, data, { onFind } = {}) {
  clear(container);
  const wrap = el('div', { class: 'analysis', 'aria-live': 'polite' },
    el('div', { class: 'row between' },
      el('strong', { text: 'AI analysis' }),
      el('span', { class: 'badge', text: data.source === 'vision-model' ? 'Vision model' : 'Text analysis' }),
    ),
    el('p', { class: 'small', style: { marginTop: '.5rem' }, text: data.summary }),
    data.needs.labels.length
      ? el('div', { class: 'cg-tags' }, data.needs.labels.map((l) => el('span', { class: 'chip static', text: l })))
      : null,
  );
  if (data.triage && data.triage.level !== 'self-care') wrap.append(el('div', { style: { marginTop: '.8rem' } }, renderTriageBanner(data.triage)));
  if (onFind) {
    wrap.append(el('div', { class: 'row', style: { marginTop: '.8rem' } },
      el('button', { class: 'btn', type: 'button', onclick: () => onFind(data) }, 'Find matching caregivers', icon('arrow', 16)),
    ));
  }
  wrap.append(el('p', { class: 'notice', style: { marginTop: '.8rem' }, text: 'Automated guidance only - not a medical diagnosis.' }));
  container.append(wrap);
}

// ---------------------------------------------------------------- stars
export function starRow(value) {
  return el('span', { class: 'rating', 'aria-label': `Rated ${value} out of 5` }, icon('star', 12), String(value.toFixed ? value.toFixed(1) : value));
}

export function breakdownBars(breakdown) {
  const labels = { skills: 'Skills', category: 'Service type', distance: 'Distance', rating: 'Rating', availability: 'Availability', experience: 'Experience', budget: 'Budget' };
  const max = { skills: 40, category: 15, distance: 15, rating: 10, availability: 10, experience: 5, budget: 5 };
  return el('div', {}, Object.keys(labels).map((k) =>
    el('div', { class: 'bar' },
      el('span', { text: labels[k] }),
      el('div', { class: 'track' }, el('div', { class: 'fill', style: { width: `${Math.round(((breakdown[k] || 0) / max[k]) * 100)}%` } })),
      el('span', { text: `${breakdown[k] ?? 0}/${max[k]}` }),
    ),
  ));
}

export function profileModal(cg, { onBook } = {}) {
  const body = el('div', { class: 'stack' },
    el('div', { class: 'row' },
      el('div', { class: 'avatar lg', style: { background: cg.avatarColor }, 'aria-hidden': 'true', text: cg.name.split(' ').map((w) => w[0]).slice(0, 2).join('') }),
      el('div', {},
        el('strong', { text: cg.name }), el('div', { class: 'muted small', text: `${cg.title} · ${cg.city}` }),
        el('div', { class: 'row', style: { marginTop: '.3rem' } }, starRow(cg.rating), el('span', { class: 'xsmall muted', text: `${cg.ratingCount} reviews` }), cg.verified ? el('span', { class: 'badge', text: 'Verified' }) : el('span', { class: 'badge warn', text: 'Verification pending' })),
      ),
    ),
    el('p', { text: cg.bio }),
    el('div', { class: 'kv' },
      el('div', {}, el('small', { text: 'Experience' }), el('strong', { text: `${cg.experienceYears} years` })),
      el('div', {}, el('small', { text: 'Fee' }), el('strong', { text: `${baht(cg.feePerHour)} / hour` })),
      el('div', {}, el('small', { text: 'Languages' }), el('strong', { text: cg.languages.join(', ') })),
    ),
    el('div', {}, el('small', { class: 'muted', text: 'Skills' }), el('div', { class: 'cg-tags' }, cg.skillLabels.map((s) => el('span', { class: 'chip static', text: s })))),
    cg.certs.length ? el('div', {}, el('small', { class: 'muted', text: 'Credentials' }), el('div', { class: 'cg-tags' }, cg.certs.map((c) => el('span', { class: 'badge', text: c })))) : null,
    el('p', { class: 'xsmall muted', text: 'Demo profile: this caregiver is fictional sample data for the prototype.' }),
  );
  const actions = [{ label: 'Close', onClick: ({ close }) => close() }];
  if (onBook) actions.push({ label: 'Book now', kind: '', onClick: ({ close }) => { close(); onBook(cg); } });
  return openModal({ title: 'Caregiver profile', body, actions });
}
