import { el, icon, initials, $, clear } from './dom.js';
import { api } from './api.js';

const NAV = [
  ['/', 'Home'],
  ['/matching', 'Find a Caregiver'],
  ['/services', 'Services'],
  ['/tracking', 'My Bookings'],
  ['/emergency', 'Emergency Support'],
  ['/donate', 'Donate'],
];

export async function mountLayout() {
  let user = null;
  try {
    user = (await api('/api/me')).user;
  } catch { /* guest */ }

  const here = location.pathname.replace(/\/$/, '') || '/';
  const nav = el('nav', { class: 'nav', id: 'site-nav', 'aria-label': 'Main' },
    NAV.map(([href, label]) => el('a', { href, text: label, 'aria-current': href === here ? 'page' : false })),
    el('a', { href: '/services#assistant', class: 'ai' }, icon('sparkles', 16), 'AI Assistant'),
  );

  const logout = async (e) => {
    e?.preventDefault();
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  };
  // On phones the header is too narrow for a sign-in/out button, so it lives in the menu
  nav.append(user
    ? el('a', { href: '#', class: 'only-small', text: 'Sign out', onclick: logout })
    : el('a', { href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, class: 'only-small', text: 'Sign in' }));

  const userBox = user
    ? el('div', { class: 'userbox' },
        el('div', { class: 'who' }, el('small', { text: 'User' }), el('strong', { text: user.name })),
        el('div', { class: 'avatar', 'aria-hidden': 'true', text: initials(user.name) }),
        el('button', { class: 'btn ghost sm', id: 'logout-btn', text: 'Sign out' }),
      )
    : el('div', { class: 'userbox' }, el('a', { class: 'btn sm', href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, text: 'Sign in' }));

  const menuBtn = el('button', { class: 'menu-btn', 'aria-label': 'Open menu', 'aria-expanded': 'false', 'aria-controls': 'site-nav' }, icon('menu', 20));
  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  const header = el('header', { class: 'site-header' },
    el('div', { class: 'inner' },
      el('a', { class: 'brand', href: '/', 'aria-label': 'OunJai Health Services home' },
        el('span', { class: 'brand-mark' }, icon('heart', 22)),
        el('span', {}, el('div', { class: 'brand-name', text: 'OunJai' }), el('div', { class: 'brand-sub', text: 'Health Services' })),
      ),
      nav, userBox, menuBtn,
    ),
  );

  const footer = el('footer', { class: 'footer' },
    el('p', {}, '© 2026 OunJai Health Services. Developed for the AI Essentials course, Mae Fah Luang University. This is a prototype - not a medical service. In an emergency call 1669.'),
    el('p', { class: 'xsmall', style: { marginTop: '.4rem' } }, el('a', { href: '/privacy', text: 'Privacy & PDPA notice' })),
  );

  const skip = el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' });
  document.body.prepend(skip);
  try {
    const { getConfig } = await import('./api.js');
    if ((await getConfig()).publicDemo) {
      document.body.prepend(el('div', { class: 'demo-banner', role: 'note' },
        el('strong', { text: 'Demo prototype' }),
        ' for a university course. Not a medical service. Do not enter real personal or health information. In an emergency call 1669.'));
    }
  } catch { /* banner is optional */ }
  clear($('#app-header')).append(header);
  clear($('#app-footer')).append(footer);

  const out = $('#logout-btn');
  if (out) out.addEventListener('click', logout);
  return user;
}
