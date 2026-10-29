import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, hydrateCaregiver } from '../server/db.js';
import { rankCaregivers, bangkokWeekday, overlaps, WEIGHTS } from '../server/matching.js';
import { extractNeeds } from '../server/nlp.js';

const db = openDb();
const caregivers = db.prepare('SELECT * FROM caregivers ORDER BY id').all().map(hydrateCaregiver);
const MFU = { lat: 20.0446, lng: 99.8947 };
const top = (request) => rankCaregivers(caregivers, request).ranked;

test('seed data is present and consistent', () => {
  assert.equal(caregivers.length, 10);
  for (const c of caregivers) {
    assert.ok(c.skills.length > 0 && c.categories.length > 0);
    assert.ok(c.available_days.every((d) => d >= 0 && d <= 6));
  }
});

test('weights add up to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('need extraction (English and Thai)', () => {
  const en = extractNeeds('My grandmother has dementia and needs help walking after surgery');
  assert.deepEqual(en.skills.sort(), ['dementia', 'elderly_care', 'mobility', 'post_surgery'].sort());
  assert.ok(en.categories.includes('Elderly Care'));
  const th = extractNeeds('ต้องการคนดูแลผู้สูงอายุ สมองเสื่อม ทำกายภาพ');
  assert.ok(th.skills.includes('dementia') && th.skills.includes('rehabilitation') && th.skills.includes('elderly_care'));
  assert.equal(extractNeeds('hello there').strength, 'none');
});

test('word-start matching avoids false positives', () => {
  // "hold" contains "old" but is not an elderly signal; "told" neither
  assert.deepEqual(extractNeeds('I hold the door and told him').skills, []);
});

test('dementia + mobility query ranks the dementia nurse first', () => {
  const ranked = top({ text: 'my grandmother has dementia and needs help walking', ...MFU });
  assert.equal(ranked[0].caregiver.name, 'Marga Doe');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].reasons.some((r) => /Dementia/.test(r)));
});

test('special-needs child query ranks the nearby special-needs caregiver first', () => {
  const ranked = top({ text: 'my autistic child needs after school care', ...MFU });
  assert.equal(ranked[0].caregiver.name, 'Ramin Jang');
});

test('rehabilitation query favours the physiotherapist', () => {
  const ranked = top({ text: 'stroke rehabilitation physiotherapy at home', lat: 20.4276, lng: 99.8783 });
  assert.equal(ranked[0].caregiver.name, 'Malee S.');
});

test('distance matters: same skills, nearer caregiver wins', () => {
  const near = top({ text: 'elderly care', lat: 13.7563, lng: 100.5018 });
  assert.equal(near[0].caregiver.city, 'Bangkok');
});

test('caregivers more than 100 km away are penalised and explained', () => {
  const ranked = top({ text: 'autistic child', ...MFU });
  const bangkok = ranked.find((r) => r.caregiver.name === 'Supaporn N.');
  assert.ok(bangkok.distanceKm > 100);
  assert.ok(bangkok.reasons.some((r) => /Too far/.test(r)));
  assert.ok(bangkok.score < 50, `score ${bangkok.score}`);
  const near = ranked.find((r) => r.caregiver.name === 'Ramin Jang');
  assert.ok(!near.reasons.some((r) => /Too far/.test(r)));
  assert.ok(near.score > bangkok.score);
});

test('verified-only and category filters', () => {
  const all = top({ text: 'elderly night care', ...MFU });
  assert.ok(all.some((r) => !r.caregiver.verified));
  const verified = top({ text: 'elderly night care', ...MFU, onlyVerified: true });
  assert.ok(verified.every((r) => r.caregiver.verified));
  const kids = top({ text: '', category: 'Childcare' });
  assert.ok(kids.length > 0 && kids.every((r) => r.caregiver.categories.includes('Childcare')));
});

test('budget lowers the score of expensive caregivers', () => {
  const free = top({ text: 'physiotherapy', ...MFU });
  const capped = top({ text: 'physiotherapy', ...MFU, maxFee: 300 });
  const mFree = free.find((r) => r.caregiver.name === 'Malee S.');
  const mCapped = capped.find((r) => r.caregiver.name === 'Malee S.');
  assert.ok(mCapped.score < mFree.score);
  assert.ok(mCapped.reasons.includes('Above budget'));
});

test('availability: weekday and existing bookings', () => {
  // Saturday 7 Nov 2026 10:00 Bangkok -> Ramin Jang does not work Saturdays
  const sat = Date.parse('2026-11-07T03:00:00Z');
  assert.equal(bangkokWeekday(sat), 6);
  const ranked = top({ text: 'autistic child', ...MFU, startMs: sat, hours: 2 });
  const ramin = ranked.find((r) => r.caregiver.name === 'Ramin Jang');
  assert.equal(ramin.available, false);
  assert.ok(ramin.reasons.includes('Not working on the requested day'));

  // Monday with an existing booking overlapping the request
  const mon = Date.parse('2026-11-02T03:00:00Z');
  const busy = new Map([[ramin.caregiver.id, [{ start: mon, end: mon + 3 * 3600_000 }]]]);
  const r2 = rankCaregivers(caregivers, { text: 'autistic child', ...MFU, startMs: mon, hours: 2 }, busy).ranked.find((r) => r.caregiver.name === 'Ramin Jang');
  assert.equal(r2.available, false);
  assert.ok(r2.reasons.includes('Already booked at the requested time'));
});

test('overlap helper', () => {
  assert.equal(overlaps(0, 10, 5, 15), true);
  assert.equal(overlaps(0, 10, 10, 20), false);
  assert.equal(overlaps(5, 6, 0, 10), true);
});

test('scores are 0-100, deterministic and explainable', () => {
  const a = top({ text: 'dementia', ...MFU });
  const b = top({ text: 'dementia', ...MFU });
  assert.deepEqual(a.map((r) => [r.caregiver.id, r.score]), b.map((r) => [r.caregiver.id, r.score]));
  for (const r of a) {
    assert.ok(r.score >= 0 && r.score <= 100);
    const sum = Object.values(r.breakdown).reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum - r.score) <= 1.5, `breakdown ${sum} vs ${r.score}`);
  }
});

test('with no detected needs the ranking still works and says so', () => {
  const ranked = top({ text: 'please help', ...MFU });
  assert.equal(ranked.length, 10);
  assert.ok(ranked[0].reasons.some((r) => /No specific needs/.test(r)));
});
