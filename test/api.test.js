import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp, client, signUp, HOUR } from './helpers.js';

let env;
before(async () => { env = await startApp(); });
after(async () => { await env.close(); });

const bookingBody = (over = {}) => ({
  caregiverId: 3, // Somchai P. - works every day, Elderly Care
  service: 'Elderly Care',
  recipientName: 'Martha',
  recipientAge: 74,
  address: '99 Moo 1, Tha Sut, Mueang Chiang Rai',
  lat: 20.0446,
  lng: 99.8947,
  startAt: '2026-11-02T03:00:00Z', // Mon 2 Nov 2026, 10:00 Bangkok
  hours: 2,
  notes: 'Needs help with walking',
  ...over,
});

test('health and config', async () => {
  const c = client(env.base);
  assert.equal((await c.get('/api/health')).data.ok, true);
  const cfg = (await c.get('/api/config')).data;
  assert.deepEqual(cfg.categories, ['Childcare', 'Elderly Care', 'Disability Support', 'Rehabilitation']);
  assert.ok(cfg.locations.length >= 4);
  assert.equal(cfg.llmEnabled, false);
});

test('pages and static assets are served with security headers', async () => {
  for (const p of ['/', '/matching', '/services', '/tracking', '/emergency', '/donate', '/login', '/privacy']) {
    const res = await fetch(env.base + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  }
  assert.equal((await fetch(env.base + '/css/app.css')).status, 200);
  assert.equal((await fetch(env.base + '/js/layout.js')).status, 200);
  assert.equal((await fetch(env.base + '/nope')).status, 404);
  assert.equal((await fetch(env.base + '/api/nope')).status, 404);
});

test('path traversal cannot read server files', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: env.port, path: '/..%2fserver%2findex.js' }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 404);
  const dot = await fetch(env.base + '/.env');
  assert.equal(dot.status, 404);
});

test('registration validates input and requires PDPA consent', async () => {
  const c = client(env.base);
  const ok = { name: 'Aree', email: 'aree@example.com', password: 'Secret123', consent: true };
  assert.equal((await c.post('/api/auth/register', { ...ok, password: 'short1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...ok, password: 'onlyletters' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...ok, email: 'not-an-email' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...ok, name: '' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...ok, phone: '12345' })).status, 400);
  const noConsent = await c.post('/api/auth/register', { ...ok, consent: false });
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.data.error, /PDPA/);
  const res = await c.post('/api/auth/register', ok);
  assert.equal(res.status, 201);
  assert.equal(res.data.user.email, 'aree@example.com');
  assert.ok(!('pass_hash' in res.data.user));
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal((await client(env.base).post('/api/auth/register', ok)).status, 409);
});

test('login, session and logout', async () => {
  const c = client(env.base);
  const { email, password } = await signUp(c, 'Somying');
  assert.equal((await c.get('/api/me')).data.user.name, 'Somying');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).data.user, null);
  const bad = await c.post('/api/auth/login', { email, password: 'WrongPass1' });
  assert.equal(bad.status, 401);
  const nobody = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'WrongPass1' });
  assert.equal(nobody.status, 401);
  assert.equal(nobody.data.error, bad.data.error, 'no account enumeration via the message');
  const good = await c.post('/api/auth/login', { email: email.toUpperCase(), password });
  assert.equal(good.status, 200);
  assert.equal((await c.get('/api/me')).data.user.email, email);
});

test('sessions expire', async () => {
  const c = client(env.base);
  await signUp(c);
  assert.ok((await c.get('/api/me')).data.user);
  env.clock.t += 8 * 24 * HOUR;
  assert.equal((await c.get('/api/me')).data.user, null);
  env.clock.t -= 8 * 24 * HOUR;
});

test('protected endpoints require sign-in', async () => {
  const c = client(env.base);
  for (const [m, p] of [['GET', '/api/bookings'], ['POST', '/api/bookings'], ['GET', '/api/contacts'], ['POST', '/api/contacts'], ['GET', '/api/bookings/OJ1/track'], ['DELETE', '/api/me']]) {
    const res = await c.call(m, p, m === 'GET' ? undefined : {});
    assert.equal(res.status, 401, `${m} ${p}`);
  }
});

test('caregiver catalogue and filters', async () => {
  const c = client(env.base);
  const all = (await c.get('/api/caregivers')).data.caregivers;
  assert.equal(all.length, 10);
  assert.ok(all.every((x) => !('phone' in x)), 'caregiver phone numbers are not public');
  const child = (await c.get('/api/caregivers?category=Childcare')).data.caregivers;
  assert.ok(child.length >= 3 && child.every((x) => x.categories.includes('Childcare')));
  const verified = (await c.get('/api/caregivers?verified=1')).data.caregivers;
  assert.equal(verified.length, 9);
  const cheap = (await c.get('/api/caregivers?maxFee=300')).data.caregivers;
  assert.ok(cheap.every((x) => x.feePerHour <= 300));
  assert.equal((await c.get('/api/caregivers/1')).data.caregiver.name, 'Marga Doe');
  assert.equal((await c.get('/api/caregivers/9999')).status, 404);
});

test('match endpoint ranks, explains and validates', async () => {
  const c = client(env.base);
  const res = await c.post('/api/match', { text: 'grandmother with dementia who needs help walking', lat: 20.0446, lng: 99.8947 });
  assert.equal(res.status, 200);
  assert.equal(res.data.results[0].caregiver.name, 'Marga Doe');
  assert.ok(res.data.results[0].score >= 80);
  assert.ok(res.data.results[0].reasons.length > 0);
  assert.deepEqual(Object.keys(res.data.results[0].breakdown).sort(), ['availability', 'budget', 'category', 'distance', 'experience', 'rating', 'skills']);
  assert.ok(res.data.needs.labels.includes('Dementia & memory care'));
  assert.match(res.data.insights, /Detected needs/);
  assert.equal((await c.post('/api/match', { text: 'x', category: 'Plumbing' })).status, 400);
  assert.equal((await c.post('/api/match', { text: 'x', lat: 51.5, lng: -0.12 })).status, 400);
  assert.equal((await c.post('/api/match', { text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await c.post('/api/match', { text: 'x', date: 'not-a-date' })).status, 400);
  assert.equal((await c.post('/api/match', { text: 'x', maxFee: 5 })).status, 400);
  assert.equal((await c.post('/api/match', { text: '', category: 'Childcare', limit: 2 })).data.results.length, 2);
});

test('triage endpoint', async () => {
  const c = client(env.base);
  const res = await c.post('/api/triage', { messages: ['My father is 80 years old and has chest pain'] });
  assert.equal(res.status, 200);
  assert.equal(res.data.assessment.level, 'emergency');
  assert.equal(res.data.explainedBy, 'rules');
  assert.equal(res.data.explanation, null);
  const multi = await c.post('/api/triage', { messages: ['she has a fever', 'She is 74 years old and the temperature is 39.4 °C'] });
  assert.equal(multi.data.assessment.level, 'urgent');
  assert.equal((await c.post('/api/triage', { messages: [] })).status, 400);
  assert.equal((await c.post('/api/triage', { messages: 'text' })).status, 400);
  assert.equal((await c.post('/api/triage', { messages: [''] })).status, 400);
  assert.equal((await c.post('/api/triage', { messages: ['x'.repeat(1001)] })).status, 400);
  assert.equal((await c.post('/api/triage', { messages: Array(21).fill('hi') })).status, 400);
  // only the level and score are logged - never text or identity
  const logs = env.app.db.prepare('SELECT * FROM triage_logs').all();
  assert.ok(logs.length >= 2);
  assert.deepEqual(Object.keys(logs[0]).sort(), ['created_ms', 'id', 'level', 'score', 'user_id']);
});

test('document analysis from text and files', async () => {
  const c = client(env.base);
  const t = await c.post('/api/analyze', { text: 'Patient 74 years old with dementia and diabetes, BP 150/95, needs help walking' });
  assert.equal(t.status, 200);
  assert.ok(t.data.needs.skills.includes('dementia') && t.data.needs.skills.includes('mobility'));
  assert.ok(t.data.conditions.includes('diabetes'));
  assert.equal(t.data.age, 74);
  assert.match(t.data.summary, /Care needs detected/);
  assert.equal((await c.post('/api/analyze', { text: '' })).status, 400);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const noVision = await c.call('POST', '/api/analyze/file', png, { raw: true, headers: { 'content-type': 'image/png' } });
  assert.equal(noVision.status, 200);
  assert.equal(noVision.data.status, 'needs_manual_input');
  assert.equal((await c.call('POST', '/api/analyze/file', png, { raw: true, headers: { 'content-type': 'image/gif' } })).status, 415);
  assert.equal((await c.call('POST', '/api/analyze/file', Buffer.from('MZ not a png at all'), { raw: true, headers: { 'content-type': 'image/png' } })).status, 400);
  assert.equal((await c.call('POST', '/api/analyze/file', Buffer.alloc(0), { raw: true, headers: { 'content-type': 'application/pdf' } })).status, 400);
  const big = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(6 * 1024 * 1024)]);
  assert.equal((await c.call('POST', '/api/analyze/file', big, { raw: true, headers: { 'content-type': 'application/pdf' } })).status, 413);
});

test('booking lifecycle: create, conflicts, tracking, feedback', async () => {
  const c = client(env.base);
  await signUp(c, 'Martha Family');
  const base = Date.parse('2026-11-02T03:00:00Z');
  env.clock.t = Date.parse('2026-10-30T03:00:00Z');

  const created = await c.post('/api/bookings', bookingBody());
  assert.equal(created.status, 201);
  const b = created.data.booking;
  assert.match(b.id, /^OJ20261030\d{4}$/);
  assert.equal(b.fee, 380 * 2);
  assert.equal(b.status, 'scheduled');
  assert.equal(b.caregiver.name, 'Somchai P.');
  assert.equal(b.caregiver.phone, '0800000003');

  // overlapping booking with the same caregiver -> conflict
  const clash = await c.post('/api/bookings', bookingBody({ startAt: '2026-11-02T04:00:00Z' }));
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /already booked/);
  // adjacent booking is fine
  assert.equal((await c.post('/api/bookings', bookingBody({ startAt: '2026-11-02T05:00:00Z' }))).status, 201);

  // validation
  for (const [label, over, status] of [
    ['unknown caregiver', { caregiverId: 999 }, 404],
    ['caregiver does not offer service', { service: 'Childcare' }, 400],
    ['bad service', { service: 'Gardening' }, 400],
    ['missing name', { recipientName: '' }, 400],
    ['bad age', { recipientAge: 200 }, 400],
    ['missing address', { address: '' }, 400],
    ['no location', { lat: undefined, lng: undefined }, 400],
    ['outside Thailand', { lat: 40, lng: 10 }, 400],
    ['hours too many', { hours: 13 }, 400],
    ['hours fractional', { hours: 1.5 }, 400],
    ['bad date', { startAt: 'tomorrow' }, 400],
    ['in the past', { startAt: '2026-10-29T03:00:00Z' }, 400],
    ['too far ahead', { startAt: '2027-03-01T03:00:00Z' }, 400],
    ['notes too long', { notes: 'x'.repeat(501) }, 400],
  ]) {
    const res = await c.post('/api/bookings', bookingBody(over));
    assert.equal(res.status, status, label);
  }
  // caregiver day off: Marga Doe does not work on Sunday
  const sunday = await c.post('/api/bookings', bookingBody({ caregiverId: 1, startAt: '2026-11-01T03:00:00Z' }));
  assert.equal(sunday.status, 409);
  assert.match(sunday.data.error, /does not work on that day/);

  // list and fetch
  const list = (await c.get('/api/bookings')).data.bookings;
  assert.equal(list.length, 2);
  assert.equal((await c.get(`/api/bookings/${b.id}`)).data.booking.id, b.id);

  // another user cannot see it
  const other = client(env.base);
  await signUp(other, 'Someone Else');
  assert.equal((await other.get(`/api/bookings/${b.id}`)).status, 404);
  assert.equal((await other.get(`/api/bookings/${b.id}/track`)).status, 404);
  assert.equal((await other.post(`/api/bookings/${b.id}/cancel`)).status, 404);
  assert.equal((await other.get('/api/bookings')).data.bookings.length, 0);

  // tracking over time
  const track = async () => (await c.get(`/api/bookings/${b.id}/track`)).data;
  assert.equal((await track()).status, 'scheduled');
  const transitMin = (await track()).tracking.transitMinutes;
  env.clock.t = base - (transitMin * 60000) / 2;
  const mid = await track();
  assert.equal(mid.status, 'in_transit');
  assert.ok(mid.tracking.etaMinutes >= 1 && mid.tracking.etaMinutes <= transitMin);
  assert.ok(mid.tracking.progress > 0.4 && mid.tracking.progress < 0.6);
  env.clock.t = base + 60_000;
  assert.equal((await track()).status, 'in_service');

  // cannot cancel after departure, cannot rate before completion
  assert.equal((await c.post(`/api/bookings/${b.id}/cancel`)).status, 409);
  assert.equal((await c.post(`/api/bookings/${b.id}/feedback`, { rating: 5 })).status, 409);

  env.clock.t = base + 2 * HOUR + 60_000;
  assert.equal((await track()).status, 'completed');

  // feedback
  const before = (await c.get('/api/caregivers/3')).data.caregiver;
  assert.equal((await c.post(`/api/bookings/${b.id}/feedback`, { rating: 0 })).status, 400);
  assert.equal((await c.post(`/api/bookings/${b.id}/feedback`, { rating: 6 })).status, 400);
  assert.equal((await c.post(`/api/bookings/${b.id}/feedback`, { rating: 5, comment: 'Kind and punctual' })).status, 201);
  const after = (await c.get('/api/caregivers/3')).data.caregiver;
  assert.equal(after.ratingCount, before.ratingCount + 1);
  assert.ok(after.rating >= before.rating);
  assert.equal((await c.post(`/api/bookings/${b.id}/feedback`, { rating: 1 })).status, 409, 'one review per booking');
  assert.equal((await c.get(`/api/bookings/${b.id}`)).data.booking.feedback.rating, 5);

  env.clock.t = Date.parse('2026-10-30T03:00:00Z');
});

test('cancelling frees the slot', async () => {
  const c = client(env.base);
  await signUp(c);
  const body = bookingBody({ startAt: '2026-11-03T03:00:00Z' });
  const b = (await c.post('/api/bookings', body)).data.booking;
  assert.equal((await c.post('/api/bookings', body)).status, 409);
  const cancelled = await c.post(`/api/bookings/${b.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.booking.status, 'cancelled');
  assert.equal((await c.post(`/api/bookings/${b.id}/cancel`)).status, 409);
  assert.equal((await c.post('/api/bookings', body)).status, 201);
});

test('demo trip accelerates the journey', async () => {
  const c = client(env.base);
  await signUp(c);
  const b = (await c.post('/api/bookings', bookingBody({ startAt: '2026-11-04T03:00:00Z' }))).data.booking;
  const started = await c.post(`/api/bookings/${b.id}/start-demo`);
  assert.equal(started.status, 200);
  assert.equal(started.data.booking.status, 'in_transit');
  assert.equal(started.data.booking.tracking.demo, true);
  assert.equal((await c.post(`/api/bookings/${b.id}/start-demo`)).status, 409);
  const t0 = env.clock.t;
  env.clock.t = t0 + 2000;
  const early = (await c.get(`/api/bookings/${b.id}/track`)).data.tracking;
  assert.ok(early.progress > 0 && early.progress < 1);
  env.clock.t = t0 + 90 * 1000; // ~15 km trip = 30 min, compressed 30x = ~63 s
  assert.equal((await c.get(`/api/bookings/${b.id}/track`)).data.status, 'in_service');
  env.clock.t = t0 + 6 * 60 * 1000;
  assert.equal((await c.get(`/api/bookings/${b.id}/track`)).data.status, 'completed');
  env.clock.t = t0;
});

test('emergency contacts and SOS', async () => {
  const c = client(env.base);
  await signUp(c, 'Elder Care Family');
  assert.equal((await c.post('/api/contacts', { name: 'Daughter', phone: '123' })).status, 400);
  assert.equal((await c.post('/api/contacts', { name: '', phone: '0812345678' })).status, 400);
  const added = await c.post('/api/contacts', { name: 'Nok', phone: '081-234-5678', relation: 'Daughter' });
  assert.equal(added.status, 201);
  assert.equal(added.data.contact.phone, '0812345678');
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/contacts', { name: `C${i}`, phone: '0899999999' })).status, 201);
  assert.equal((await c.post('/api/contacts', { name: 'Sixth', phone: '0899999999' })).status, 400, 'max 5');
  const list = (await c.get('/api/contacts')).data.contacts;
  assert.equal(list.length, 5);
  assert.equal((await c.del(`/api/contacts/${list[4].id}`)).status, 200);
  assert.equal((await c.del('/api/contacts/99999')).status, 404);

  // another user cannot delete my contact
  const other = client(env.base);
  await signUp(other);
  assert.equal((await other.del(`/api/contacts/${list[0].id}`)).status, 404);

  const b = (await c.post('/api/bookings', bookingBody({ startAt: '2026-11-05T03:00:00Z' }))).data.booking;
  const sos = await c.post('/api/sos', { message: 'She has fallen', bookingId: b.id, lat: 20.04, lng: 99.89 });
  assert.equal(sos.status, 201);
  assert.equal(sos.data.simulated, true);
  assert.ok(sos.data.hotlines.some((h) => h.number === '1669'));
  assert.ok(sos.data.notified.some((n) => n.type === 'contact' && n.name === 'Nok'));
  assert.ok(sos.data.notified.some((n) => n.type === 'caregiver' && n.name === 'Somchai P.'));
  assert.ok(env.app.outbox.some((o) => o.alertId === sos.data.alertId));
  const stored = env.app.db.prepare('SELECT * FROM sos_alerts WHERE id = ?').get(sos.data.alertId);
  assert.equal(stored.message, 'She has fallen');
  assert.equal(stored.booking_id, b.id);
});

test('SOS works for guests and ignores bookings they do not own', async () => {
  const guest = client(env.base);
  const res = await guest.post('/api/sos', { message: 'Help', bookingId: 'OJ000' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.data.notified, []);
  assert.equal((await guest.post('/api/sos', { message: 'x'.repeat(301) })).status, 400);
});

test('donations update campaigns and validate amounts', async () => {
  const c = client(env.base);
  const campaigns = (await c.get('/api/campaigns')).data.campaigns;
  assert.equal(campaigns.length, 4);
  const first = campaigns[0];
  assert.equal((await c.post('/api/donations', { campaignId: first.id, amount: 5 })).status, 400);
  assert.equal((await c.post('/api/donations', { campaignId: first.id, amount: 1_000_000 })).status, 400);
  assert.equal((await c.post('/api/donations', { campaignId: first.id, amount: 20.5 })).status, 400);
  assert.equal((await c.post('/api/donations', { campaignId: 999, amount: 100 })).status, 404);
  const ok = await c.post('/api/donations', { campaignId: first.id, amount: 500, donorName: 'Kind Person' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.campaign.raised, first.raised + 500);
  assert.equal(ok.data.simulated, true);
  assert.equal((await c.get('/api/campaigns')).data.campaigns[0].raised, first.raised + 500);
});

test('request hardening', async () => {
  const c = client(env.base);
  assert.equal((await c.call('POST', '/api/match', 'text=hello', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await c.call('POST', '/api/match', '{bad json', { headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await c.call('POST', '/api/match', '[1,2]')).status, 400);
  assert.equal((await c.post('/api/match', { text: 'a'.repeat(200_000) })).status, 413);
  assert.equal((await c.call('PUT', '/api/health', {})).status, 405);
  assert.equal((await c.post('/api/health')).status, 405);

  // cross-site request is blocked
  const evil = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: env.port, path: '/api/auth/login', method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(evil, 403);

  // SQL-injection style input is handled safely as plain text
  const inj = await c.post('/api/auth/login', { email: "' OR 1=1 --@example.com", password: "' OR '1'='1" });
  assert.equal(inj.status, 401);
  const inj2 = await c.get('/api/caregivers?category=' + encodeURIComponent("Childcare' OR '1'='1"));
  assert.equal(inj2.status, 200);
  assert.equal(inj2.data.caregivers.length, 0);

  // markup in names is returned as data (the UI renders it with textContent)
  const x = client(env.base);
  const res = await x.post('/api/auth/register', { name: '<img src=x onerror=alert(1)>', email: 'xss@example.com', password: 'Secret123', consent: true });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.name, '<img src=x onerror=alert(1)>');
});

test('PDPA: users can erase their account and data', async () => {
  const c = client(env.base);
  const { email, password, user } = await signUp(c, 'Erase Me');
  await c.post('/api/contacts', { name: 'Friend', phone: '0811111111' });
  const b = (await c.post('/api/bookings', bookingBody({ startAt: '2026-11-06T03:00:00Z' }))).data.booking;
  await c.post('/api/sos', { message: 'test', bookingId: b.id });
  await c.post('/api/donations', { campaignId: 1, amount: 100 });

  assert.equal((await c.del('/api/me', { password: 'WrongPass1' })).status, 403);
  assert.equal((await c.del('/api/me', { password })).status, 200);

  const db = env.app.db;
  const count = (sql) => db.prepare(sql).get(user.id).n;
  assert.equal(count('SELECT COUNT(*) n FROM users WHERE id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM bookings WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM contacts WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM sos_alerts WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM sessions WHERE user_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM donations WHERE user_id = ?'), 0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM donations').get().n >= 1, 'donation totals are kept, anonymised');
  assert.equal((await c.get('/api/me')).data.user, null);
  assert.equal((await client(env.base).post('/api/auth/login', { email, password })).status, 401);
});

test('rate limiting protects login', async () => {
  const solo = await startApp({ rateLimit: true });
  try {
    const c = client(solo.base);
    let last;
    for (let i = 0; i < 11; i++) last = await c.post('/api/auth/login', { email: 'a@example.com', password: 'WrongPass1' });
    assert.equal(last.status, 429);
    solo.clock.t += 61_000;
    assert.equal((await c.post('/api/auth/login', { email: 'a@example.com', password: 'WrongPass1' })).status, 401);
  } finally {
    await solo.close();
  }
});

test('behind a trusted proxy, rate limits apply per real client, not per proxy', async () => {
  const solo = await startApp({ rateLimit: true, trustProxy: true });
  try {
    const c = client(solo.base);
    const login = (ip) => c.post('/api/auth/login', { email: 'a@example.com', password: 'WrongPass1' }, { headers: { 'x-forwarded-for': `203.0.113.9, ${ip}` } });
    let last;
    for (let i = 0; i < 11; i++) last = await login('198.51.100.1');
    assert.equal(last.status, 429, 'one client is limited');
    assert.equal((await login('198.51.100.2')).status, 401, 'another client is not');
  } finally { await solo.close(); }
});

test('without trustProxy, a forged X-Forwarded-For cannot dodge rate limits', async () => {
  const solo = await startApp({ rateLimit: true });
  try {
    const c = client(solo.base);
    let last;
    for (let i = 0; i < 11; i++) last = await c.post('/api/auth/login', { email: 'a@example.com', password: 'WrongPass1' }, { headers: { 'x-forwarded-for': `10.0.0.${i}` } });
    assert.equal(last.status, 429);
  } finally { await solo.close(); }
});

test('public demo flag is exposed for the banner', async () => {
  const solo = await startApp({ publicDemo: true });
  try {
    assert.equal((await client(solo.base).get('/api/config')).data.publicDemo, true);
  } finally { await solo.close(); }
  assert.equal((await client(env.base).get('/api/config')).data.publicDemo, false);
});

test('rate limiting protects SOS from floods but still allows normal use', async () => {
  const solo = await startApp({ rateLimit: true });
  try {
    const c = client(solo.base);
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.post('/api/sos', { message: 'x' })).status);
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 429]);
  } finally {
    await solo.close();
  }
});
