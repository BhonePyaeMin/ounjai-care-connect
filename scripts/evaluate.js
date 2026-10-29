// Reproducible evaluation for the Progress 2 report.  Run:  node scripts/evaluate.js
// Writes docs/evaluation-results.json and prints a summary.
//
// IMPORTANT: the expected labels below were written by the student team, not by clinicians.
// They measure whether the rules behave as the team intended, not clinical accuracy.

import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { assess } from '../server/triage.js';
import { rankCaregivers } from '../server/matching.js';
import { openDb, hydrateCaregiver } from '../server/db.js';
import { createApp } from '../server/index.js';

// 'unclear' (the assistant did not recognise anything and refuses to reassure) sits between routine and urgent
const ORDER = ['self-care', 'routine', 'unclear', 'urgent', 'emergency'];

// [text, expected level]
const TRIAGE_CASES = [
  // --- emergencies
  ['My father is 80 and has chest pain and is sweating', 'emergency'],
  ['She suddenly cannot speak properly and her face is drooping', 'emergency'],
  ['He is unconscious and not breathing normally', 'emergency'],
  ['My mother cannot breathe, she is gasping', 'emergency'],
  ['My 2 month old baby has a fever of 38.5', 'emergency'],
  ['Grandfather had a seizure this morning', 'emergency'],
  ['She is vomiting blood', 'emergency'],
  ['คุณพ่อเจ็บหน้าอกและหายใจไม่ออก', 'emergency'],
  ['He fell and hit his head, now he is very sleepy and vomiting', 'emergency'],
  ['I want to end my life', 'emergency'],
  ['My toddler swallowed poison', 'emergency'],
  ['Heavy bleeding from the wound that will not stop', 'emergency'],
  ['He is choking on food', 'emergency'],
  ['ปู่หมดสติ', 'emergency'],
  // --- urgent
  ['My grandmother is 78 years old, fell in the bathroom and cannot stand', 'urgent'],
  ['70 years old with a fever of 39.2 C', 'urgent'],
  ['She keeps vomiting and cannot keep fluids down', 'urgent'],
  ['Blood pressure 195/115 and a severe headache', 'urgent'],
  ['Blood sugar 380 and feeling very weak', 'urgent'],
  ['He is 75 years old and very short of breath when walking', 'urgent'],
  ['Black stool and dizziness, 68 years old', 'urgent'],
  ['Sudden confusion in my 82-year-old grandmother', 'urgent'],
  ['อายุ 72 ปี ไข้สูง', 'urgent'],
  ['She hit her head on the table but is acting normally', 'urgent'],
  ['The wound is red and swollen with pus', 'urgent'],
  // --- routine
  ['My 4 year old has a mild cough, no fever', 'routine'],
  ['Grandfather 75 has had mild back pain for a week', 'routine'],
  ['My 68 year old mother with diabetes has been a little dizzy', 'routine'],
  ['My 3 year old has had diarrhea since yesterday', 'routine'],
  ['She is 80 years old, not eating much and constipated', 'routine'],
  // --- self-care
  ['I feel fine, just checking', 'self-care'],
  ['no fever, no cough, no pain', 'self-care'],
  ['A little tired after gardening, I am 40 years old', 'self-care'],
  ['Slight headache after reading', 'self-care'],
  ['ไม่มีไข้ ไม่เจ็บหน้าอก', 'self-care'],
  ['Father had a stroke two years ago and is stable, no new symptoms', 'self-care'],
  ['My grandfather has heart failure but is doing fine today', 'self-care'],
  ['A sore throat for two days', 'self-care'],
];

// Natural paraphrases written AFTER the rules were tuned, without adjusting the rules to fit,
// to measure how well keyword rules generalise to wording they were not built around.
const HELDOUT_CASES = [
  ['Dad says his chest feels very tight and his left arm hurts', 'emergency'],
  ['My wife is having trouble breathing and her lips look blue', 'emergency'],
  ["He collapsed in the kitchen and isn't responding", 'emergency'],
  ["Grandma's speech is all garbled and one side of her mouth is hanging down", 'emergency'],
  ['She took a whole bottle of her pills', 'emergency'],
  ['My baby, 5 weeks old, feels very hot', 'emergency'],
  ["He's bleeding a lot and it won't stop", 'emergency'],
  ["I don't want to live anymore", 'emergency'],
  ['Granny, 79, slipped and now her hip hurts too much to walk', 'urgent'],
  ['He has had a fever for three days and he is 71', 'urgent'],
  ['Her blood pressure is 200 over 120', 'urgent'],
  ['My uncle, 66, has been peeing blood', 'urgent'],
  ['My 6 year old has a runny nose and coughs a bit at night', 'routine'],
  ['Mum, 70, has had knee pain when climbing stairs', 'routine'],
  ['We are fine, just want a caregiver for company', 'self-care'],
  ['He is 85 and in good health, only needs help with shopping', 'self-care'],
];

// Third batch: written after the v1.1 vocabulary fixes and NOT used to tune anything.
// This is the best available estimate of how the current rules generalise.
const FRESH_CASES = [
  ['He has crushing chest pain going into his jaw', 'emergency'],
  ['She is having a seizure right now', 'emergency'],
  ["He fell down and now won't wake up properly", 'emergency'],
  ['She has been clutching her chest and says it feels like an elephant is sitting on it', 'emergency'],
  ["Grandmother's lips are turning blue and she is struggling for air", 'emergency'],
  ['He drank a bottle of cleaning liquid', 'emergency'],
  ['Dad is coughing and spitting blood', 'emergency'],
  ['The baby is 3 weeks old, will not feed and feels warm', 'emergency'],
  ['Mum has a temperature of 39 and is very confused', 'urgent'],
  ['My father, 82, has not passed urine since yesterday morning', 'urgent'],
  ['Neighbour, 88, lives alone, has had bad diarrhoea for 3 days and is very weak', 'urgent'],
  ['She has been coughing for a week and is tired, she is 55', 'routine'],
  ['My son has a mild tummy ache after lunch, he is 8', 'self-care'],
  ['Everything is normal today, he ate well and slept well', 'self-care'],
];

const MFU = { lat: 20.0446, lng: 99.8947 };
const CHIANG_MAI = { lat: 18.7883, lng: 98.9853 };
const CHIANG_RAI = { lat: 19.9105, lng: 99.8406 };
const MAE_SAI = { lat: 20.4276, lng: 99.8783 };
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

// [query, location, extra request fields, acceptable top-1 names, note]
const MATCH_CASES = [
  ['dementia care for my mother', MFU, {}, ['Marga Doe']],
  ['my autistic child needs after school care', MFU, {}, ['Ramin Jang']],
  ['physiotherapy after a stroke', MAE_SAI, {}, ['Malee S.']],
  ['wheelchair user needs daily help', CHIANG_MAI, {}, ['Anan K.']],
  ['palliative care for my father with cancer', CHIANG_MAI, {}, ['Wichai T.']],
  ['diabetes and wound dressing for an elderly relative', CHIANG_RAI, {}, ['Somchai P.']],
  ['newborn baby, need an overnight nanny', MFU, {}, ['Pimchanok R.']],
  ['paediatric nurse for a child with developmental delay', BANGKOK, {}, ['Supaporn N.']],
  ['post surgery rehabilitation at home', BANGKOK, {}, ['Nattaya L.']],
  ['ต้องการคนดูแลผู้สูงอายุสมองเสื่อม', MFU, {}, ['Marga Doe']],
  ['night care for an elderly person', MFU, { maxFee: 300, onlyVerified: true }, ['Somchai P.', 'Marga Doe', 'Malee S.']],
];

function evaluateTriage(cases = TRIAGE_CASES) {
  const rows = cases.map(([text, expected]) => {
    const a = assess({ messages: [text] });
    const diff = ORDER.indexOf(a.level) - ORDER.indexOf(expected);
    return { text, expected, predicted: a.level, score: a.score, result: diff === 0 ? 'match' : diff < 0 ? 'under-triage' : 'over-triage' };
  });
  const n = rows.length;
  const match = rows.filter((r) => r.result === 'match').length;
  const under = rows.filter((r) => r.result === 'under-triage');
  const over = rows.filter((r) => r.result === 'over-triage');
  const emerg = rows.filter((r) => r.expected === 'emergency');
  const emergHit = emerg.filter((r) => r.predicted === 'emergency').length;
  const nonEmerg = rows.filter((r) => r.expected !== 'emergency');
  const falseEmerg = nonEmerg.filter((r) => r.predicted === 'emergency').length;
  const confusion = Object.fromEntries(ORDER.map((e) => [e, Object.fromEntries(ORDER.map((p) => [p, rows.filter((r) => r.expected === e && r.predicted === p).length]))]));
  return {
    cases: n,
    exactMatch: match,
    exactMatchRate: match / n,
    underTriage: under.length,
    overTriage: over.length,
    emergencyCases: emerg.length,
    emergencyRecall: emergHit / emerg.length,
    falseEmergencies: falseEmerg,
    // urgent/emergency cases that were told "self-care" - the dangerous kind of miss
    falselyReassured: rows.filter((r) => (r.expected === 'urgent' || r.expected === 'emergency') && r.predicted === 'self-care').length,
    unclear: rows.filter((r) => r.predicted === 'unclear').length,
    confusion,
    mismatches: rows.filter((r) => r.result !== 'match'),
    rows,
  };
}

function evaluateMatching() {
  const db = openDb();
  const caregivers = db.prepare('SELECT * FROM caregivers ORDER BY id').all().map(hydrateCaregiver);
  const rows = MATCH_CASES.map(([text, loc, extra, accept]) => {
    const { ranked } = rankCaregivers(caregivers, { text, ...loc, ...extra });
    const names = ranked.slice(0, 3).map((r) => `${r.caregiver.name} (${r.score})`);
    return { query: text, expected: accept, top3: names, top1Hit: accept.includes(ranked[0].caregiver.name), top3Hit: ranked.slice(0, 3).some((r) => accept.includes(r.caregiver.name)) };
  });
  db.close();
  return {
    queries: rows.length,
    top1: rows.filter((r) => r.top1Hit).length,
    top3: rows.filter((r) => r.top3Hit).length,
    top1Rate: rows.filter((r) => r.top1Hit).length / rows.length,
    top3Rate: rows.filter((r) => r.top3Hit).length / rows.length,
    rows,
  };
}

const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil((p / 100) * arr.length) - 1)];

async function benchmark() {
  const app = createApp({ rateLimit: false });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.arrayBuffer());
  const jobs = {
    'POST /api/match': () => post('/api/match', { text: 'grandmother with dementia who needs help walking', lat: 20.0446, lng: 99.8947 }),
    'POST /api/triage': () => post('/api/triage', { messages: ['My father is 80 years old with diabetes, dizzy, temperature 38.4 C'] }),
    'GET /api/caregivers': () => fetch(base + '/api/caregivers').then((r) => r.arrayBuffer()),
  };
  const out = {};
  for (const [name, job] of Object.entries(jobs)) {
    for (let i = 0; i < 20; i++) await job(); // warm-up
    const times = [];
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      await job();
      times.push(performance.now() - t);
    }
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 200 }, () => job()));
    const burst = performance.now() - t0;
    out[name] = { sequentialRequests: times.length, p50Ms: +pct(times, 50).toFixed(2), p95Ms: +pct(times, 95).toFixed(2), p99Ms: +pct(times, 99).toFixed(2), burst200Ms: +burst.toFixed(0) };
  }
  await app.close();
  return out;
}

const triage = evaluateTriage();
const heldout = evaluateTriage(HELDOUT_CASES);
const fresh = evaluateTriage(FRESH_CASES);
const matching = evaluateMatching();
const latency = await benchmark();
const result = { generatedAt: new Date().toISOString(), node: process.version, triage, heldout, fresh, matching, latency };

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/evaluation-results.json', import.meta.url), JSON.stringify(result, null, 2));

console.log(`TRIAGE  ${triage.exactMatch}/${triage.cases} exact (${(triage.exactMatchRate * 100).toFixed(1)}%) | under-triage ${triage.underTriage} | over-triage ${triage.overTriage} | emergency recall ${(triage.emergencyRecall * 100).toFixed(0)}% | false emergencies ${triage.falseEmergencies}`);
for (const m of triage.mismatches) console.log(`   ${m.result.padEnd(13)} expected ${m.expected.padEnd(9)} got ${m.predicted.padEnd(9)} (${m.score})  ${m.text}`);
console.log(`PARAPHRASES  ${heldout.exactMatch}/${heldout.cases} exact | under-triage ${heldout.underTriage} | over-triage ${heldout.overTriage} | emergency recall ${heldout.emergencyRecall * heldout.emergencyCases}/${heldout.emergencyCases}`);
for (const m of heldout.mismatches) console.log(`   ${m.result.padEnd(13)} expected ${m.expected.padEnd(9)} got ${m.predicted.padEnd(9)} (${m.score})  ${m.text}`);
console.log(`FRESH  ${fresh.exactMatch}/${fresh.cases} exact | under ${fresh.underTriage} | over ${fresh.overTriage} | emergency recall ${Math.round(fresh.emergencyRecall * fresh.emergencyCases)}/${fresh.emergencyCases} | falsely reassured ${fresh.falselyReassured} | unclear ${fresh.unclear}`);
for (const m of fresh.mismatches) console.log(`   ${m.result.padEnd(13)} expected ${m.expected.padEnd(9)} got ${m.predicted.padEnd(9)} (${m.score})  ${m.text}`);
console.log(`MATCH   top-1 ${matching.top1}/${matching.queries} | top-3 ${matching.top3}/${matching.queries}`);
for (const r of matching.rows.filter((x) => !x.top1Hit)) console.log(`   miss: ${r.query} -> ${r.top3.join(', ')} (expected ${r.expected.join(' / ')})`);
console.log('LATENCY', JSON.stringify(latency));
