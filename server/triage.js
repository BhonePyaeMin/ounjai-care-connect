// Rule-based symptom triage. The rules (not an LLM) decide the urgency level, so the
// outcome is deterministic, auditable and can never be downgraded by generated text.
// This is guidance for deciding where to seek care - it is NOT a medical diagnosis.

import { normalizeText } from './nlp.js';

const RED_FLAGS = [
  { id: 'chest_pain', label: 'Chest pain or pressure', en: ['chest pain', 'chest pressure', 'chest tightness', 'pain in my chest', 'pain in the chest', 'chest feels', 'tight chest', 'chest is tight', 'chest hurts', 'crushing pain'], th: ['เจ็บหน้าอก', 'แน่นหน้าอก'] },
  { id: 'breathing', label: 'Severe difficulty breathing', en: ["can't breathe", 'cannot breathe', 'struggling to breathe', 'difficulty breathing', 'trouble breathing', 'gasping', 'not breathing', 'stopped breathing'], th: ['หายใจไม่ออก', 'หายใจลำบาก', 'หยุดหายใจ'] },
  { id: 'unconscious', label: 'Unconscious or unresponsive', en: ['unconscious', 'unresponsive', 'passed out', 'fainted', "won't wake", 'not waking', 'collapsed'], th: ['หมดสติ', 'เป็นลม', 'ไม่รู้สึกตัว'] },
  { id: 'seizure', label: 'Seizure', en: ['seizure', 'convulsion'], th: ['ชักเกร็ง', 'ชักกระตุก', 'อาการชัก', 'ลมชัก'] },
  { id: 'stroke_signs', label: 'Possible stroke signs', en: ['face droop', 'facial droop', 'drooping face', 'slurred speech', "can't speak", 'cannot speak', 'sudden weakness', 'arm weakness', 'weak on one side', 'numb on one side', 'sudden numbness', 'having a stroke', 'garbled', 'mouth is hanging', 'mouth hanging', 'mouth droop', 'speech is slurred', 'cannot move one side', "can't move one side"], th: ['พูดไม่ชัด', 'ปากเบี้ยว', 'อ่อนแรงครึ่งซีก', 'แขนขาอ่อนแรง'] },
  { id: 'severe_bleeding', label: 'Severe bleeding', en: ['severe bleeding', 'heavy bleeding', 'bleeding heavily', "won't stop bleeding", 'bleeding a lot', 'bleeding badly', 'spitting blood', 'spit blood', 'spat blood', 'lot of blood', 'lots of blood', 'vomiting blood', 'coughing blood', 'blood in vomit'], th: ['เลือดออกมาก', 'อาเจียนเป็นเลือด', 'ไอเป็นเลือด'] },
  { id: 'choking', label: 'Choking', en: ['choking'], th: ['ติดคอ'] },
  { id: 'anaphylaxis', label: 'Severe allergic reaction', en: ['anaphyla', 'throat closing', 'swollen tongue', 'swollen lips'], th: ['แพ้อย่างรุนแรง'] },
  { id: 'overdose', label: 'Overdose or poisoning', en: ['overdose', 'took too many pills', 'poison', 'whole bottle', 'bottle of pills', 'too many tablets', 'swallowed pills', 'swallowed bleach', 'drank bleach'], th: ['กินยาเกินขนาด', 'ยาพิษ'] },
  { id: 'self_harm', label: 'Thoughts of self-harm', en: ['suicid', 'kill myself', 'want to die', 'end my life', 'harm myself', "don't want to live", 'do not want to live', 'better off dead', 'end it all', 'no reason to live', 'hurt myself'], th: ['ฆ่าตัวตาย', 'อยากตาย', 'ไม่อยากมีชีวิต'] },
];

const URGENT = [
  { id: 'high_fever', label: 'High fever', weight: 35, en: ['high fever', 'very high temperature'], th: ['ไข้สูง'] },
  { id: 'persistent_vomiting', label: 'Persistent vomiting', weight: 35, en: ['persistent vomiting', 'vomiting repeatedly', "can't keep fluids", 'cannot keep fluids', 'keeps vomiting', 'vomiting all day'], th: ['อาเจียนไม่หยุด'] },
  { id: 'blood_stool_urine', label: 'Blood in stool or urine', weight: 30, en: ['blood in stool', 'blood in urine', 'bloody stool', 'black stool', 'peeing blood', 'pee blood', 'passing blood', 'blood when peeing', 'blood in his pee', 'blood in her pee', 'blood in the pee'], th: ['ถ่ายเป็นเลือด', 'ปัสสาวะเป็นเลือด', 'อุจจาระดำ'] },
  { id: 'new_confusion', label: 'Sudden confusion', weight: 35, en: ['sudden confusion', 'suddenly confused', 'new confusion', 'suddenly disoriented'], th: ['สับสนทันที', 'สับสนกะทันหัน'] },
  { id: 'fall', label: 'Recent fall', weight: 25, en: ['fell', 'fallen', 'had a fall', 'slipped and', 'fall down'], th: ['หกล้ม', 'ล้มลง', 'ล้มในห้อง'] },
  { id: 'cannot_bear_weight', label: 'Cannot stand or bear weight', weight: 20, en: ['cannot stand', "can't stand", 'hip pain', 'hip hurts', 'cannot put weight', "can't put weight", 'unable to stand', 'too much to walk', 'cannot walk since', "can't walk since"], th: ['ยืนไม่ได้', 'ปวดสะโพก'] },
  { id: 'severe_pain', label: 'Severe pain', weight: 30, en: ['severe pain', 'unbearable pain', 'worst pain'], th: ['ปวดมาก', 'ปวดรุนแรง'] },
  { id: 'short_breath', label: 'Shortness of breath', weight: 40, en: ['short of breath', 'shortness of breath', 'breathless', 'out of breath'], th: ['เหนื่อยหอบ', 'หายใจเหนื่อย'] },
  { id: 'dehydration', label: 'Signs of dehydration', weight: 30, en: ['dehydrat', 'not urinating', 'no urine', 'not passed urine', 'not urinated', "hasn't peed", 'has not peed', 'very dry mouth'], th: ['ขาดน้ำ', 'ไม่ปัสสาวะ'] },
  { id: 'head_injury', label: 'Head injury', weight: 35, en: ['head injury', 'hit my head', 'hit his head', 'hit her head', 'bumped his head', 'bumped her head', 'bumped my head'], th: ['ศีรษะกระแทก', 'หัวกระแทก'] },
  { id: 'infection_signs', label: 'Possible wound infection', weight: 35, en: ['pus', 'red and swollen', 'infected wound', 'wound infection'], th: ['แผลติดเชื้อ', 'แผลเป็นหนอง'] },
];

const ROUTINE = [
  { id: 'fever', label: 'Fever', weight: 15, en: ['fever', 'feverish', 'high temperature', 'very hot', 'burning up', 'feels hot', 'feeling hot', 'feels warm', 'feel warm'], th: ['ไข้', 'ตัวร้อน'] },
  { id: 'cough', label: 'Cough', weight: 10, en: ['cough'], th: ['ไอ'] },
  { id: 'sore_throat', label: 'Sore throat', weight: 8, en: ['sore throat'], th: ['เจ็บคอ'] },
  { id: 'headache', label: 'Headache', weight: 10, en: ['headache', 'head ache'], th: ['ปวดหัว', 'ปวดศีรษะ'] },
  { id: 'dizziness', label: 'Dizziness', weight: 15, en: ['dizzy', 'dizziness', 'lightheaded', 'light-headed', 'vertigo'], th: ['เวียนหัว', 'มึนหัว', 'หน้ามืด'] },
  { id: 'diarrhea', label: 'Diarrhea', weight: 15, en: ['diarrhea', 'diarrhoea', 'loose stool'], th: ['ท้องเสีย', 'ท้องร่วง'] },
  { id: 'nausea', label: 'Nausea or vomiting', weight: 10, en: ['nausea', 'nauseous', 'vomit', 'throwing up'], th: ['คลื่นไส้', 'อาเจียน'] },
  { id: 'fatigue', label: 'Fatigue', weight: 8, en: ['fatigue', 'tired', 'exhausted', 'weak'], th: ['อ่อนเพลีย', 'เพลีย'] },
  { id: 'poor_appetite', label: 'Poor appetite', weight: 8, en: ['poor appetite', 'not eating', 'no appetite', 'loss of appetite'], th: ['เบื่ออาหาร', 'ไม่อยากอาหาร'] },
  { id: 'constipation', label: 'Constipation', weight: 8, en: ['constipat'], th: ['ท้องผูก'] },
  { id: 'insomnia', label: 'Sleep problems', weight: 6, en: ['insomnia', "can't sleep", 'cannot sleep', 'trouble sleeping'], th: ['นอนไม่หลับ'] },
  { id: 'pain', label: 'Pain', weight: 10, en: ['joint pain', 'back pain', 'knee pain', 'stomach pain', 'abdominal pain', 'pain'], th: ['ปวดข้อ', 'ปวดหลัง', 'ปวดเข่า', 'ปวดท้อง'] },
  { id: 'swelling', label: 'Swollen legs', weight: 15, en: ['swollen legs', 'swelling in legs', 'swollen ankles', 'swollen feet'], th: ['ขาบวม', 'เท้าบวม'] },
  { id: 'rash', label: 'Skin rash', weight: 8, en: ['rash', 'itchy'], th: ['ผื่น', 'คัน'] },
  { id: 'memory', label: 'Forgetfulness', weight: 10, en: ['forgetful', 'forgets', 'memory problems', 'memory loss'], th: ['หลงลืม', 'ขี้ลืม'] },
];

const CONDITIONS = [
  { id: 'diabetes', label: 'Diabetes', en: ['diabet'], th: ['เบาหวาน'] },
  { id: 'hypertension', label: 'High blood pressure', en: ['hypertension', 'high blood pressure'], th: ['ความดันสูง'] },
  { id: 'heart_disease', label: 'Heart disease', en: ['heart disease', 'heart failure', 'heart condition', 'pacemaker'], th: ['โรคหัวใจ', 'หัวใจล้มเหลว'] },
  { id: 'lung_disease', label: 'Lung disease', en: ['copd', 'asthma', 'emphysema'], th: ['หอบหืด', 'ถุงลมโป่งพอง'] },
  { id: 'kidney_disease', label: 'Kidney disease', en: ['kidney disease', 'kidney failure', 'dialysis'], th: ['โรคไต', 'ไตวาย', 'ล้างไต'] },
  { id: 'stroke_history', label: 'Previous stroke', en: ['history of stroke', 'had a stroke', 'previous stroke', 'stroke survivor'], th: ['เคยเป็นอัมพาต', 'เคยเป็นโรคหลอดเลือดสมอง'] },
  { id: 'dementia', label: 'Dementia', en: ['dementia', 'alzheimer'], th: ['สมองเสื่อม', 'อัลไซเมอร์'] },
  { id: 'cancer', label: 'Cancer', en: ['cancer', 'chemotherapy'], th: ['มะเร็ง'] },
];

const NEGATIONS_EN = /\b(no|not|without|denies|never|isn't|isnt|doesn't have|does not have|didn't|hasn't|hasnt)\b/;
const NEGATIONS_TH = ['ไม่มี', 'ไม่ได้', 'ไม่'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findTerm(text, item, stat) {
  // returns index of first non-negated match, or -1. Records in stat when a term was found but negated.
  const candidates = [];
  for (const term of item.en) {
    const re = new RegExp(`(?:^|[^a-z])(${escapeRe(term)})`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      candidates.push(m.index + m[0].length - m[1].length);
    }
  }
  for (const term of item.th) {
    let i = text.indexOf(term);
    while (i !== -1) {
      candidates.push(i);
      i = text.indexOf(term, i + 1);
    }
  }
  for (const idx of candidates.sort((a, b) => a - b)) {
    if (!isNegated(text, idx)) return idx;
  }
  if (candidates.length > 0 && stat) stat.negated = true;
  return -1;
}

function isNegated(text, idx) {
  const before = text.slice(Math.max(0, idx - 30), idx);
  // negation only reaches to the end of its own clause ("will not feed AND feels warm" -> warm is not negated)
  const clause = before.split(/[.!?;,\n]|\b(?:and|but|while|then|although)\b|และ|แต่/).pop();
  if (NEGATIONS_EN.test(clause)) return true;
  return NEGATIONS_TH.some((n) => clause.trimEnd().endsWith(n));
}

const BENIGN = /\b(fine|well|healthy|good health|no symptoms?|no problems?|not sick|nothing wrong|doing ok|doing okay|stable|just checking|company|shopping|errands)\b|สบายดี|ปกติดี/;

// Benign = very short, says things are fine, or explicitly denies a symptom we recognise.
// A bare "not"/"no" is NOT enough ("will not feed", "has not passed urine" are worrying).
function looksBenign(t, negatedSymptom) {
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  return words < 4 || negatedSymptom || BENIGN.test(t);
}

export function parseAge(text) {
  const t = normalizeText(text);
  // Ages only: "3 months old", "74 years old", "aged 74", "อายุ 74" - not durations like "for 3 months".
  const months =
    t.match(/(\d{1,2})\s*-?\s*(?:months?|mos?)\s*-?\s*old\b/) ||
    t.match(/อายุ\s*(\d{1,2})\s*เดือน/);
  if (months) return { years: Number(months[1]) / 12, months: Number(months[1]) };
  const weeks = t.match(/(\d{1,2})\s*-?\s*weeks?\s*-?\s*old\b/) || t.match(/(?:baby|infant|newborn)\D{0,12}(\d{1,2})\s*weeks?\b/);
  if (weeks) return { years: Number(weeks[1]) / 52, months: Number(weeks[1]) / 4.345 };
  if (/newborn|ทารกแรกเกิด/.test(t)) return { years: 0, months: 0 };
  const m =
    t.match(/(\d{1,3})\s*-?\s*(?:years?|yrs?)\s*-?\s*old\b/) ||
    t.match(/\b(\d{1,3})\s*(?:yo|y\/o)\b/) ||
    t.match(/\baged?\s+(\d{1,3})\b/) ||
    t.match(/อายุ\s*(\d{1,3})/) ||
    t.match(/(\d{1,2})\s*ขวบ/) ||
    // "Grandmother, 74, early dementia" - a bare number right after who the person is
    t.match(/\b(?:grandmother|grandfather|grandma|grandpa|granny|gran|mother|father|mom|mum|mummy|dad|patient|husband|wife|aunt|uncle|neighbou?r|elderly (?:man|woman|lady))\b[\s,(:-]{1,3}(\d{2,3})\b(?!\s*(?:\/|mg|kg|bpm|%|°))/) ||
    // "he is 71", "she's 80"
    t.match(/\b(?:he|she|they|i)(?:\s+is|\s+am|'s|'m)\s+(\d{2,3})\b(?!\s*(?:days?|weeks?|months?|hours?|mins?|minutes?|kg|%|\/|mg|bpm|cm|degrees|°))/);
  if (!m) return null;
  const years = Number(m[1]);
  if (years < 0 || years > 120) return null;
  return { years, months: years * 12 };
}

function parseVitals(text) {
  const t = normalizeText(text);
  const out = {};
  const c = t.match(/(\d{2}(?:\.\d)?)\s*(?:°\s*c|degrees?\s*c(?:elsius)?|celsius|องศา)/) || t.match(/(?:temp(?:erature)?|fever(?: of)?|ไข้|อุณหภูมิ)\D{0,12}(3[5-9](?:\.\d)?|4[0-3](?:\.\d)?)\b/);
  if (c) out.tempC = Number(c[1]);
  const f = t.match(/(\d{3}(?:\.\d)?)\s*(?:°\s*f|degrees?\s*f(?:ahrenheit)?|fahrenheit)/);
  if (!out.tempC && f) out.tempC = Math.round(((Number(f[1]) - 32) * 5) / 9 * 10) / 10;
  const bp = t.match(/(?:bp|blood pressure|ความดัน)\D{0,12}(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})/);
  if (bp) out.bp = { sys: Number(bp[1]), dia: Number(bp[2]) };
  const g = t.match(/(?:sugar|glucose|น้ำตาล)\D{0,12}(\d{2,3})/);
  if (g) out.glucose = Number(g[1]);
  return out;
}

function assessOne(text, extra = {}) {
  const t = normalizeText(text);
  const age = extra.age ?? parseAge(t);
  const vitals = parseVitals(t);
  const findings = [];
  const redFlags = [];

  const stat = { negated: false };
  for (const r of RED_FLAGS) if (findTerm(t, r, stat) !== -1) redFlags.push({ id: r.id, label: r.label });
  for (const u of URGENT) if (findTerm(t, u, stat) !== -1) findings.push({ id: u.id, label: u.label, weight: u.weight, tier: 'urgent' });
  for (const r of ROUTINE) if (findTerm(t, r, stat) !== -1) findings.push({ id: r.id, label: r.label, weight: r.weight, tier: 'routine' });

  // 'fever' and 'high_fever' / 'nausea' and 'persistent_vomiting' describe the same thing
  const has = (id) => findings.some((f) => f.id === id);
  const drop = (id) => {
    const i = findings.findIndex((f) => f.id === id);
    if (i !== -1) findings.splice(i, 1);
  };
  if (has('high_fever')) drop('fever');
  if (has('persistent_vomiting')) drop('nausea');
  if (has('short_breath')) drop('fatigue');
  if (has('severe_pain') || redFlags.some((r) => r.id === 'chest_pain')) drop('pain');

  if (vitals.tempC !== undefined) {
    drop('fever');
    drop('high_fever');
    if (vitals.tempC >= 39) findings.push({ id: 'high_fever', label: `High fever (${vitals.tempC} °C)`, weight: 35, tier: 'urgent' });
    else if (vitals.tempC >= 38) findings.push({ id: 'fever', label: `Fever (${vitals.tempC} °C)`, weight: 20, tier: 'routine' });
  }
  if (vitals.bp) {
    if (vitals.bp.sys >= 180 || vitals.bp.dia >= 120) findings.push({ id: 'bp_high', label: `Very high blood pressure (${vitals.bp.sys}/${vitals.bp.dia})`, weight: 40, tier: 'urgent' });
    else if (vitals.bp.sys <= 90 || vitals.bp.dia <= 50) findings.push({ id: 'bp_low', label: `Low blood pressure (${vitals.bp.sys}/${vitals.bp.dia})`, weight: 35, tier: 'urgent' });
  }
  if (vitals.glucose !== undefined) {
    if (vitals.glucose >= 300) findings.push({ id: 'glucose_high', label: `Very high blood sugar (${vitals.glucose} mg/dL)`, weight: 35, tier: 'urgent' });
    else if (vitals.glucose <= 70) findings.push({ id: 'glucose_low', label: `Low blood sugar (${vitals.glucose} mg/dL)`, weight: 35, tier: 'urgent' });
  }

  const conditions = new Set(extra.conditions || []);
  for (const c of CONDITIONS) if (findTerm(t, c, stat) !== -1) conditions.add(c.id);

  const ageYears = age ? age.years : null;
  const ageMonths = age ? age.months : null;
  const hasFever = has('fever') || has('high_fever');

  // combination rules
  if (hasFever && ageMonths !== null && ageMonths < 3) redFlags.push({ id: 'infant_fever', label: 'Fever in an infant under 3 months' });
  const headInjury = has('head_injury');
  if (headInjury && (has('nausea') || has('persistent_vomiting') || has('new_confusion') || redFlags.some((r) => r.id === 'unconscious') || /drows|sleepy|ง่วงผิดปกติ/.test(t))) {
    redFlags.push({ id: 'head_injury_danger', label: 'Head injury with warning signs' });
  }

  let score = findings.reduce((s, f) => s + f.weight, 0);
  const reasons = [];
  if (findings.length > 0 || redFlags.length > 0) {
    if (ageYears !== null) {
      const mod = ageYears >= 75 ? 10 : ageYears >= 65 ? 5 : ageYears < 1 ? 15 : ageYears < 5 ? 5 : 0;
      if (mod) {
        score += mod;
        reasons.push(`Age ${ageMonths !== null && ageMonths < 24 ? `${ageMonths} months` : `${Math.round(ageYears)}`} raises the risk level`);
      }
      if (hasFever && (ageYears >= 65 || ageYears < 5)) {
        score += 15;
        reasons.push('Fever is more concerning in older adults and young children');
      }
      if (has('dizziness') && ageYears >= 65) score += 10;
    }
    const chronic = Math.min(conditions.size * 4, 12);
    if (chronic) {
      score += chronic;
      reasons.push(`Existing conditions (${[...conditions].map((id) => CONDITIONS.find((c) => c.id === id)?.label || id).join(', ')}) raise the risk level`);
    }
    if (hasFever && conditions.size > 0 && !(ageYears !== null && (ageYears >= 65 || ageYears < 5))) score += 10;
  }
  score = Math.min(100, score);
  if (redFlags.length > 0) score = Math.max(score, 85);

  let level;
  if (redFlags.length > 0 || score >= 70) level = 'emergency';
  else if (score >= 35) level = 'urgent';
  else if (score >= 12) level = 'routine';
  else level = 'self-care';

  // Safety net: if nothing was recognised and the text does not clearly say everything is fine,
  // never reassure - say we are unsure. Keyword rules cannot understand every phrasing.
  if (level === 'self-care' && findings.length === 0 && conditions.size === 0 && !looksBenign(t, stat.negated)) level = 'unclear';

  return { level, score, redFlags, findings, conditions: [...conditions], age, vitals, reasons };
}

const RECOMMENDED = {
  emergency: null,
  urgent: 'Elderly Care',
  routine: 'Elderly Care',
  'self-care': null,
};

function recommendCategory(a) {
  const ids = new Set(a.findings.map((f) => f.id));
  const years = a.age ? a.age.years : null;
  if (years !== null && years < 13) return 'Childcare';
  if (ids.has('fall') || ids.has('cannot_bear_weight')) return 'Rehabilitation';
  if (ids.has('memory') || a.conditions.includes('dementia')) return 'Elderly Care';
  return years !== null && years >= 60 ? 'Elderly Care' : RECOMMENDED[a.level];
}

const ADVICE = {
  emergency: [
    'Call 1669 (Thailand emergency medical service) now. Do not wait to see if it improves.',
    'Stay with the person and keep them calm, still and comfortable.',
    'Do not give food, drink or medicine unless the 1669 operator tells you to.',
    'Follow the operator’s instructions, including CPR guidance if the person is not breathing.',
  ],
  urgent: [
    'Arrange to see a doctor or go to a hospital or clinic within the next 24 hours.',
    'Call 1669 immediately if symptoms get worse, or if new warning signs appear (chest pain, trouble breathing, confusion, fainting).',
    'Do not leave an older adult or child alone; a caregiver can stay and monitor.',
  ],
  routine: [
    'Book a clinic or GP visit within the next few days.',
    'Keep track of temperature, food and fluid intake, and note any changes.',
    'Seek urgent care if symptoms become severe or new warning signs appear.',
  ],
  'self-care': [
    'No warning signs were recognised in your message.',
    'Rest, drink fluids and keep monitoring. Describe any new symptoms and I will re-check.',
    'This tool can miss things. If you are still worried, contact a doctor.',
  ],
  unclear: [
    'I could not recognise specific symptoms in what you wrote, so I cannot reassure you.',
    'If you are worried about this person, contact a doctor or clinic today, and call 1669 if you think it may be serious.',
    'You can describe what is happening in more detail (what, since when, how bad) and I will check again.',
  ],
};

const SELF_HARM_ADVICE = [
  'You are not alone. If there is immediate danger, call 1669 now.',
  'Call the Department of Mental Health hotline 1323 (24 hours) to talk with someone right away.',
  'Stay with the person, and remove access to anything that could be used for self-harm.',
];

export const DISCLAIMER =
  'This guidance is generated by automated rules to help you decide where to seek care. It is not a medical diagnosis and does not replace a doctor. In an emergency call 1669.';

export function assess(input) {
  const messages = Array.isArray(input.messages) ? input.messages : [String(input.text || '')];
  const text = messages.join('. ');
  const a = assessOne(text, { age: input.age ? { years: input.age, months: input.age * 12 } : undefined, conditions: input.conditions });
  const selfHarm = a.redFlags.some((r) => r.id === 'self_harm');
  const advice = selfHarm ? SELF_HARM_ADVICE : ADVICE[a.level];

  const followUps = [];
  if (!a.age && a.level !== 'emergency') followUps.push('How old is the person (years, or months for a baby)?');
  const hasFeverFinding = a.findings.some((f) => f.id === 'fever' || f.id === 'high_fever');
  if (hasFeverFinding && a.vitals.tempC === undefined && a.level !== 'emergency') followUps.push('What is the temperature, if you have measured it?');
  if (a.findings.length === 0 && a.redFlags.length === 0) followUps.push('Please describe the symptoms, for example fever, dizziness, pain, a fall or changes in memory.');
  if (a.age && a.age.years >= 65 && a.conditions.length === 0 && a.level !== 'emergency') followUps.push('Does the person have any long-term conditions such as diabetes, high blood pressure or heart disease?');

  const labels = { emergency: 'Emergency', urgent: 'Urgent - see a doctor within 24 hours', routine: 'Routine - book a visit', 'self-care': 'Low concern - self-care and monitoring', unclear: 'Not sure - please check with a professional' };
  return {
    level: a.level,
    levelLabel: labels[a.level],
    score: a.score,
    redFlags: a.redFlags,
    findings: a.findings.map(({ id, label, weight }) => ({ id, label, weight })),
    conditions: a.conditions,
    age: a.age ? a.age.years : null,
    vitals: a.vitals,
    reasons: a.reasons,
    advice,
    callEmergency: a.level === 'emergency',
    hotlines: a.level === 'emergency' ? (selfHarm ? ['1323', '1669'] : ['1669']) : [],
    recommendedCategory: recommendCategory(a),
    followUps: followUps.slice(0, 2),
    disclaimer: DISCLAIMER,
  };
}
