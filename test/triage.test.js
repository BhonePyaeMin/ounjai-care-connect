import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, parseAge } from '../server/triage.js';

const level = (text, extra = {}) => assess({ messages: [text], ...extra }).level;

test('red flags are always emergencies', () => {
  assert.equal(level('My father is 80 years old and has chest pain'), 'emergency');
  assert.equal(level('She cannot breathe properly'), 'emergency');
  assert.equal(level('He is unconscious and not waking up'), 'emergency');
  assert.equal(level('slurred speech and face droop since this morning'), 'emergency');
  assert.equal(level('she is vomiting blood'), 'emergency');
  assert.equal(level('มีอาการเจ็บหน้าอกมาก'), 'emergency');
  assert.equal(level('คุณตาหมดสติ'), 'emergency');
});

test('emergency advice tells people to call 1669', () => {
  const a = assess({ messages: ['chest pain'] });
  assert.equal(a.callEmergency, true);
  assert.deepEqual(a.hotlines, ['1669']);
  assert.match(a.advice[0], /1669/);
  assert.ok(a.score >= 85);
});

test('self-harm routes to the mental health hotline as well', () => {
  const a = assess({ messages: ['I want to die'] });
  assert.equal(a.level, 'emergency');
  assert.ok(a.hotlines.includes('1323'));
  assert.ok(a.hotlines.includes('1669'));
});

test('fever in an infant under 3 months is an emergency', () => {
  assert.equal(level('My 2 month old baby has a fever'), 'emergency');
  assert.notEqual(level('My 2 year old has a mild fever'), 'emergency');
});

test('head injury with vomiting is an emergency; head injury alone is urgent', () => {
  assert.equal(level('he hit his head and is vomiting'), 'emergency');
  assert.equal(level('she hit her head on the table'), 'urgent');
});

test('fall in an older adult who cannot stand is urgent', () => {
  assert.equal(level('She is 74 years old, fell in the bathroom and cannot stand'), 'urgent');
  assert.equal(level('คุณยายอายุ 78 ปี หกล้มในห้องน้ำ ยืนไม่ได้'), 'urgent');
});

test('unrecognised text is never reassured: it becomes "unclear" with a doctor/1669 pointer', () => {
  const a = assess({ messages: ['She has been clutching her chest and says it feels like an elephant is sitting on it'] });
  assert.equal(a.level, 'unclear');
  assert.equal(a.callEmergency, false);
  assert.match(a.advice.join(' '), /cannot reassure/);
  assert.match(a.advice.join(' '), /1669/);
  // a bare "not" is not evidence that things are fine
  assert.equal(level('The baby will not take her feed and seems odd'), 'unclear');
  // but explicit denial, "fine", or very short text is
  assert.equal(level('I feel fine today, nothing to report really'), 'self-care');
  assert.equal(level('no fever, no cough, just a long day'), 'self-care');
  assert.equal(level('hello'), 'self-care');
});

test('v1.1 wording: paraphrases of emergencies are recognised', () => {
  for (const t of [
    'Dad says his chest feels very tight and his left arm hurts',
    "Grandma's speech is all garbled and one side of her mouth is hanging down",
    'She took a whole bottle of her pills',
    'My baby, 5 weeks old, feels very hot',
    "He's bleeding a lot and it won't stop",
    "I don't want to live anymore",
    'Dad is coughing and spitting blood',
    'The baby is 3 weeks old, will not feed and feels warm',
  ]) assert.equal(level(t), 'emergency', t);
  assert.equal(level('Granny, 79, slipped and now her hip hurts too much to walk'), 'urgent');
  assert.equal(level('He has had a fever for three days and he is 71'), 'urgent');
  assert.equal(level('Her blood pressure is 200 over 120'), 'urgent');
  assert.equal(level('My uncle, 66, has been peeing blood'), 'urgent');
  assert.equal(level('My father, 82, has not passed urine since yesterday morning'), 'urgent');
});

test('persistent vomiting and wound infection are urgent at any age', () => {
  assert.equal(level('She keeps vomiting and cannot keep fluids down'), 'urgent');
  assert.equal(level('The wound is red and swollen with pus'), 'urgent');
  assert.equal(level('he vomited once after lunch'), 'self-care');
});

test('vitals are parsed and thresholds applied', () => {
  assert.equal(level('70 years old, temperature 39.5 °C'), 'urgent');
  assert.equal(level('fever of 102.6 °F, 30 years old'), 'urgent'); // 39.2 C
  assert.equal(level('BP 190/110 and a headache'), 'urgent');
  assert.equal(level('blood pressure 120/80, feeling fine'), 'self-care');
  assert.equal(level('blood sugar 350 and very thirsty'), 'urgent');
  assert.equal(level('blood sugar 62, sweating'), 'urgent');
});

test('negated symptoms are ignored', () => {
  assert.equal(level('no fever, no cough'), 'self-care');
  assert.equal(level('She does not have chest pain, only a mild cough', { age: 30 }), 'self-care');
  assert.equal(level('ไม่มีไข้ ไม่เจ็บหน้าอก'), 'self-care');
  // a negation must not leak across commas into the next symptom
  assert.equal(level('no cough, chest pain'), 'emergency');
  assert.equal(level('no cough and chest pain'), 'emergency');
  assert.equal(level('no fever and no cough'), 'self-care');
});

test('durations are not mistaken for ages', () => {
  assert.equal(parseAge('has had diabetes for 10 years'), null);
  assert.equal(parseAge('fever for 3 months'), null);
  assert.equal(parseAge('my grandmother is 74 years old').years, 74);
  assert.equal(parseAge('aged 80').years, 80);
  assert.equal(parseAge('อายุ 65 ปี').years, 65);
  assert.equal(parseAge('3 months old').months, 3);
  assert.equal(parseAge('a 4-year-old boy').years, 4);
  assert.equal(parseAge('Grandmother, 74, early dementia and diabetes').years, 74);
  assert.equal(parseAge('my father (82) has a cough').years, 82);
  assert.equal(parseAge('patient: 68 with diabetes').years, 68);
  assert.equal(parseAge('mother 120/80 blood pressure'), null);
});

test('routine and self-care levels', () => {
  assert.equal(level('My 4 year old has a mild cough and a runny nose, no fever'), 'routine');
  assert.equal(level('I feel fine today'), 'self-care');
  const a = assess({ messages: ['he is fine'] });
  assert.equal(a.callEmergency, false);
  assert.equal(a.hotlines.length, 0);
});

test('age and chronic conditions raise the level', () => {
  const young = assess({ messages: ['dizzy since morning'], age: 30 });
  const old = assess({ messages: ['dizzy since morning. She has diabetes and heart disease and is 82 years old'] });
  assert.ok(old.score > young.score);
  assert.equal(old.age, 82);
  assert.ok(old.conditions.includes('diabetes'));
  assert.ok(old.conditions.includes('heart_disease'));
});

test('history of stroke is a condition, not a stroke emergency', () => {
  const a = assess({ messages: ['stroke survivor, 70 years old, a bit tired today'] });
  assert.notEqual(a.level, 'emergency');
  assert.ok(a.conditions.includes('stroke_history'));
});

test('thai heart failure is not mistaken for a fall', () => {
  const a = assess({ messages: ['คุณตาเป็นโรคหัวใจล้มเหลว'] });
  assert.ok(!a.findings.some((f) => f.id === 'fall'));
});

test('follow-up questions guide missing information', () => {
  const a = assess({ messages: ['she has a fever'] });
  assert.ok(a.followUps.some((f) => /old/.test(f)));
  assert.ok(a.followUps.some((f) => /temperature/.test(f)));
  const b = assess({ messages: ['hello'] });
  assert.ok(b.followUps.some((f) => /describe/i.test(f)));
});

test('output always carries a disclaimer and a recommended category when relevant', () => {
  const a = assess({ messages: ['My grandmother is 74 years old and has been dizzy'] });
  assert.match(a.disclaimer, /not a medical diagnosis/);
  assert.equal(a.recommendedCategory, 'Elderly Care');
  assert.equal(assess({ messages: ['my 5 year old has a cough'] }).recommendedCategory, 'Childcare');
});

test('assessment is deterministic', () => {
  const m = ['My father is 80 years old with diabetes and dizziness and a temperature of 38.4 C'];
  assert.deepEqual(assess({ messages: m }), assess({ messages: m }));
});
