// Lightweight bilingual (English/Thai) need extraction used by caregiver matching
// and document analysis. English terms match on word starts; Thai terms by substring.

export const CATEGORIES = ['Childcare', 'Elderly Care', 'Disability Support', 'Rehabilitation'];

export const CONCEPTS = {
  elderly_care: {
    label: 'Elderly care',
    category: 'Elderly Care',
    en: ['elderly', 'senior', 'grandma', 'grandmother', 'grandpa', 'grandfather', 'old age', 'aged care', 'my mother', 'my father', 'my mom', 'my dad'],
    th: ['ผู้สูงอายุ', 'คุณยาย', 'คุณตา', 'คุณปู่', 'คุณย่า', 'สูงวัย'],
  },
  dementia: {
    label: 'Dementia & memory care',
    category: 'Elderly Care',
    en: ['dementia', 'alzheimer', 'memory loss', 'forgetful', 'forgets', 'confus', 'wandering'],
    th: ['สมองเสื่อม', 'อัลไซเมอร์', 'หลงลืม', 'ขี้ลืม'],
  },
  mobility: {
    label: 'Mobility support',
    category: null,
    en: ['mobility', 'walking', 'wheelchair', 'walker', 'cannot walk', "can't walk", 'unable to walk', 'bedridden', 'falls', 'fall', 'transfer'],
    th: ['เดินไม่ได้', 'เดินลำบาก', 'รถเข็น', 'ล้มบ่อย', 'ติดเตียง'],
  },
  rehabilitation: {
    label: 'Rehabilitation',
    category: 'Rehabilitation',
    en: ['rehab', 'physio', 'physical therapy', 'therapy', 'stroke', 'recovery', 'recovering', 'exercise'],
    th: ['กายภาพ', 'ฟื้นฟู', 'อัมพาต', 'อัมพฤกษ์'],
  },
  post_surgery: {
    label: 'Post-surgery care',
    category: 'Rehabilitation',
    en: ['post-surgery', 'post surgery', 'after surgery', 'post-op', 'surgery', 'operation'],
    th: ['หลังผ่าตัด', 'ผ่าตัด'],
  },
  childcare: {
    label: 'Childcare',
    category: 'Childcare',
    en: ['child', 'baby', 'infant', 'toddler', 'newborn', 'kid', 'nanny', 'after school', 'my son', 'my daughter'],
    th: ['เด็ก', 'ทารก', 'ลูก', 'เลี้ยงเด็ก'],
  },
  special_needs: {
    label: 'Special needs',
    category: 'Disability Support',
    en: ['autism', 'autistic', 'adhd', 'down syndrome', 'special needs', 'developmental'],
    th: ['ออทิสติก', 'สมาธิสั้น', 'ดาวน์ซินโดรม', 'ต้องการพิเศษ'],
  },
  disability: {
    label: 'Disability support',
    category: 'Disability Support',
    en: ['disability', 'disabled', 'blind', 'deaf', 'paraplegi', 'quadriplegi', 'amput'],
    th: ['พิการ', 'ตาบอด', 'หูหนวก', 'อัมพาตครึ่งล่าง'],
  },
  diabetes_care: {
    label: 'Diabetes care',
    category: null,
    en: ['diabet', 'insulin', 'blood sugar', 'glucose'],
    th: ['เบาหวาน', 'อินซูลิน'],
  },
  wound_care: {
    label: 'Wound care',
    category: null,
    en: ['wound', 'dressing', 'bedsore', 'pressure sore', 'pressure ulcer'],
    th: ['แผล', 'แผลกดทับ'],
  },
  palliative: {
    label: 'Palliative care',
    category: 'Elderly Care',
    en: ['palliative', 'end of life', 'hospice', 'cancer', 'terminal'],
    th: ['ประคับประคอง', 'มะเร็ง', 'ระยะสุดท้าย'],
  },
  night_care: {
    label: 'Overnight care',
    category: null,
    en: ['overnight', 'night shift', 'night care', 'at night', 'nighttime'],
    th: ['กลางคืน', 'ค้างคืน'],
  },
};

export const SKILL_LABELS = Object.fromEntries(
  Object.entries(CONCEPTS).map(([k, v]) => [k, v.label]),
);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchers = Object.entries(CONCEPTS).map(([key, c]) => ({
  key,
  en: c.en.map((t) => ({ term: t, re: new RegExp(`(?:^|[^a-z])${escapeRe(t)}`, 'i') })),
  th: c.th,
}));

export function normalizeText(text) {
  return String(text || '')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

export function extractNeeds(text) {
  const t = normalizeText(text);
  const skills = [];
  const matched = [];
  for (const m of matchers) {
    let hit = null;
    for (const e of m.en) {
      if (e.re.test(t)) {
        hit = e.term;
        break;
      }
    }
    if (!hit) hit = m.th.find((term) => t.includes(term)) || null;
    if (hit) {
      skills.push(m.key);
      matched.push({ skill: m.key, term: hit });
    }
  }
  const categories = [
    ...new Set(skills.map((s) => CONCEPTS[s].category).filter(Boolean)),
  ];
  const strength = skills.length === 0 ? 'none' : skills.length === 1 ? 'low' : skills.length === 2 ? 'medium' : 'high';
  return { skills, categories, matched, strength };
}
