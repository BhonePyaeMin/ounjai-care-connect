import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  pass_hash TEXT NOT NULL,
  consent_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS caregivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  experience_years INTEGER NOT NULL,
  skills TEXT NOT NULL,
  categories TEXT NOT NULL,
  certs TEXT NOT NULL,
  rating REAL NOT NULL,
  rating_count INTEGER NOT NULL,
  fee_per_hour INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  city TEXT NOT NULL,
  languages TEXT NOT NULL,
  available_days TEXT NOT NULL,
  bio TEXT NOT NULL,
  verified INTEGER NOT NULL,
  phone TEXT NOT NULL,
  avatar_color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caregiver_id INTEGER NOT NULL REFERENCES caregivers(id),
  service TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_age INTEGER NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  start_ms INTEGER NOT NULL,
  hours INTEGER NOT NULL,
  status TEXT NOT NULL,
  fee INTEGER NOT NULL,
  notes TEXT NOT NULL,
  dispatched_ms INTEGER,
  sim_speed REAL,
  created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_cg ON bookings(caregiver_id, start_ms);
CREATE TABLE IF NOT EXISTS feedback (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sos_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  booking_id TEXT,
  message TEXT NOT NULL,
  lat REAL,
  lng REAL,
  notified TEXT NOT NULL,
  status TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  goal INTEGER NOT NULL,
  raised INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  user_id INTEGER,
  donor_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS triage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);
`;

// Fictional demo caregivers. Day numbers: 0 = Sunday ... 6 = Saturday.
const CAREGIVERS = [
  ['Marga Doe', 'Registered Nurse', 10, ['dementia', 'elderly_care', 'mobility', 'night_care'], ['Elderly Care'], ['Certified RN'], 4.5, 38, 450, 20.0275, 99.9012, 'Chiang Rai', ['Thai', 'English'], [1, 2, 3, 4, 5, 6], 'Ten years in geriatric nursing with a focus on dementia and mobility support. Calm, patient and experienced with night shifts.', 1, '0800000001', '#2f9e74'],
  ['Ramin Jang', 'Special Needs Caregiver', 6, ['childcare', 'special_needs', 'disability'], ['Childcare', 'Disability Support'], ['Verified'], 4.4, 21, 350, 20.0611, 99.8805, 'Chiang Rai', ['Thai', 'English'], [0, 1, 2, 3, 4, 5], 'Works with children with autism and ADHD and supports families with structured daily routines.', 1, '0800000002', '#e07a5f'],
  ['Somchai P.', 'Nursing Assistant', 8, ['elderly_care', 'mobility', 'diabetes_care', 'wound_care'], ['Elderly Care'], ['Certified Nursing Assistant'], 4.7, 54, 380, 19.9156, 99.8397, 'Chiang Rai', ['Thai'], [0, 1, 2, 3, 4, 5, 6], 'Experienced in daily living support, insulin reminders and simple wound dressing for older adults.', 1, '0800000003', '#3d7ea6'],
  ['Malee S.', 'Physiotherapist', 12, ['rehabilitation', 'mobility', 'post_surgery', 'elderly_care'], ['Rehabilitation', 'Elderly Care'], ['Licensed Physical Therapist'], 4.8, 62, 700, 20.4281, 99.8792, 'Mae Sai', ['Thai', 'English'], [1, 2, 3, 4, 5], 'Stroke and post-surgery rehabilitation with home exercise programmes for older adults.', 1, '0800000004', '#8e6bbf'],
  ['Anan K.', 'Disability Support Worker', 5, ['disability', 'mobility', 'special_needs'], ['Disability Support'], ['Disability Support Certificate'], 4.3, 17, 320, 18.7912, 98.9921, 'Chiang Mai', ['Thai', 'English'], [1, 2, 3, 4, 5, 6], 'Supports wheelchair users and people with physical disabilities with transfers, outings and daily tasks.', 1, '0800000005', '#c9803a'],
  ['Pimchanok R.', 'Childcare Provider', 4, ['childcare', 'night_care'], ['Childcare'], ['Early Childhood Certificate'], 4.2, 12, 280, 20.0489, 99.8951, 'Chiang Rai', ['Thai'], [0, 1, 2, 3, 4, 5, 6], 'After-school and evening childcare for working parents, including overnight stays.', 1, '0800000006', '#d96c8c'],
  ['Wichai T.', 'Palliative Care Nurse', 15, ['palliative', 'elderly_care', 'dementia', 'wound_care'], ['Elderly Care'], ['Certified RN', 'Palliative Care Training'], 4.9, 71, 650, 18.7802, 98.9813, 'Chiang Mai', ['Thai', 'English'], [1, 2, 3, 4, 5, 6], 'Fifteen years supporting elderly patients and families through long-term and end-of-life care.', 1, '0800000007', '#2d6a5a'],
  ['Nattaya L.', 'Rehabilitation Nurse', 7, ['rehabilitation', 'elderly_care', 'diabetes_care'], ['Rehabilitation', 'Elderly Care'], ['Certified RN'], 4.5, 29, 550, 13.7467, 100.5342, 'Bangkok', ['Thai', 'English'], [1, 2, 3, 4, 5], 'Combines nursing care with rehabilitation exercises for diabetes and post-hospital recovery.', 1, '0800000008', '#4a86c5'],
  ['Kittipong A.', 'Home Helper', 3, ['elderly_care', 'night_care'], ['Elderly Care'], [], 4.0, 6, 250, 20.0332, 99.8764, 'Chiang Rai', ['Thai'], [0, 6, 5], 'Companionship and night-time presence for older adults. Verification still in progress.', 0, '0800000009', '#9a8c3b'],
  ['Supaporn N.', 'Paediatric Nurse', 9, ['childcare', 'special_needs'], ['Childcare', 'Disability Support'], ['Certified Paediatric Nurse'], 4.7, 33, 600, 13.7701, 100.4932, 'Bangkok', ['Thai', 'English'], [1, 2, 3, 4, 5], 'Paediatric nursing for infants and children with developmental needs.', 1, '0800000010', '#c4568d'],
];

const CAMPAIGNS = [
  ['Care for isolated elders', 'Home visits, meals and health checks for older adults who live alone in Chiang Rai.', 'Elderly Care', 200000],
  ['Mobility aids fund', 'Wheelchairs, walkers and home adaptations for people with disabilities.', 'Disability Support', 150000],
  ['Early childhood care', 'Subsidised childcare for working families who cannot afford it.', 'Childcare', 120000],
  ['Rehabilitation for all', 'Physiotherapy sessions for low-income patients recovering from stroke or surgery.', 'Rehabilitation', 180000],
];

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM caregivers').get();
  if (n === 0) {
    const ins = db.prepare(
      `INSERT INTO caregivers (name,title,experience_years,skills,categories,certs,rating,rating_count,fee_per_hour,lat,lng,city,languages,available_days,bio,verified,phone,avatar_color)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const c of CAREGIVERS) {
      ins.run(c[0], c[1], c[2], JSON.stringify(c[3]), JSON.stringify(c[4]), JSON.stringify(c[5]), c[6], c[7], c[8], c[9], c[10], c[11], JSON.stringify(c[12]), JSON.stringify(c[13]), c[14], c[15], c[16], c[17]);
    }
    const insC = db.prepare('INSERT INTO campaigns (title,description,category,goal) VALUES (?,?,?,?)');
    for (const c of CAMPAIGNS) insC.run(...c);
  }
  return db;
}

export function hydrateCaregiver(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    experience_years: row.experience_years,
    skills: JSON.parse(row.skills),
    categories: JSON.parse(row.categories),
    certs: JSON.parse(row.certs),
    rating: row.rating,
    rating_count: row.rating_count,
    fee_per_hour: row.fee_per_hour,
    lat: row.lat,
    lng: row.lng,
    city: row.city,
    languages: JSON.parse(row.languages),
    available_days: JSON.parse(row.available_days),
    bio: row.bio,
    verified: Boolean(row.verified),
    phone: row.phone,
    avatar_color: row.avatar_color,
  };
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
