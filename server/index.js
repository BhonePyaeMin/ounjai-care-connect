import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDb, hydrateCaregiver, transaction } from './db.js';
import { hashPassword, verifyPassword, validatePassword, newToken, tokenHash } from './auth.js';
import { extractNeeds, CATEGORIES, SKILL_LABELS } from './nlp.js';
import { rankCaregivers, buildInsights, bangkokWeekday, overlaps } from './matching.js';
import { assess } from './triage.js';
import { analyzeText, FILE_TYPES } from './analyze.js';
import { computeTracking } from './tracking.js';
import { createLlm } from './llm.js';
import {
  HttpError, sendJson, readJson, readBody, parseCookies, isEmail, cleanStr, cleanInt,
  cleanCoord, normalizePhone, createRateLimiter, clamp,
} from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const SESSION_MS = 7 * 24 * 3600 * 1000;
const LOCATIONS = [
  { name: 'Mae Fah Luang University, Chiang Rai', lat: 20.0446, lng: 99.8947 },
  { name: 'Chiang Rai city', lat: 19.9105, lng: 99.8406 },
  { name: 'Mae Sai, Chiang Rai', lat: 20.4276, lng: 99.8783 },
  { name: 'Chiang Mai city', lat: 18.7883, lng: 98.9853 },
  { name: 'Bangkok', lat: 13.7563, lng: 100.5018 },
];
const PAGES = {
  '/': 'index.html',
  '/matching': 'matching.html',
  '/services': 'services.html',
  '/tracking': 'tracking.html',
  '/emergency': 'emergency.html',
  '/donate': 'donate.html',
  '/login': 'login.html',
  '/privacy': 'privacy.html',
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
};

export function createApp(opts = {}) {
  const now = opts.now || (() => Date.now());
  const db = openDb(opts.dbPath ?? ':memory:');
  const llm = opts.llm || createLlm();
  const simSpeed = opts.simSpeed ?? 30;
  const demo = opts.demo ?? true;
  const limiter = createRateLimiter(now);
  const outbox = []; // simulated notifications (no SMS/push provider in the prototype)
  const dummyHash = hashPassword('not-a-real-password-1');
  const publicDemo = opts.publicDemo ?? process.env.OUNJAI_PUBLIC_DEMO === '1';
  // Behind a platform proxy (Render, Railway) every connection comes from the proxy's address, so rate limits
  // would be shared by all users. With trustProxy the address the proxy saw (the LAST X-Forwarded-For entry,
  // which the proxy appended itself and the client cannot forge) is used instead. Off by default.
  const trustProxy = opts.trustProxy ?? process.env.OUNJAI_TRUST_PROXY === '1';
  const clientIp = (req) => {
    if (trustProxy) {
      const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (email,name,phone,pass_hash,consent_ms,created_ms) VALUES (?,?,?,?,?,?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash,user_id,expires_ms) VALUES (?,?,?)'),
    sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_ms < ?'),
    allCaregivers: db.prepare('SELECT * FROM caregivers ORDER BY id'),
    caregiverById: db.prepare('SELECT * FROM caregivers WHERE id = ?'),
    busy: db.prepare("SELECT caregiver_id, start_ms, hours FROM bookings WHERE status = 'confirmed' AND start_ms < ? AND start_ms + hours * 3600000 > ?"),
    busyFor: db.prepare("SELECT start_ms, hours FROM bookings WHERE caregiver_id = ? AND status = 'confirmed'"),
    insertBooking: db.prepare(
      `INSERT INTO bookings (id,user_id,caregiver_id,service,recipient_name,recipient_age,address,lat,lng,start_ms,hours,status,fee,notes,created_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'confirmed',?,?,?)`,
    ),
    bookingsByUser: db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY start_ms DESC'),
    bookingOwned: db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?'),
    cancelBooking: db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?"),
    dispatchBooking: db.prepare('UPDATE bookings SET dispatched_ms = ?, sim_speed = ? WHERE id = ?'),
    feedbackFor: db.prepare('SELECT * FROM feedback WHERE booking_id = ?'),
    insertFeedback: db.prepare('INSERT INTO feedback (booking_id,user_id,rating,comment,created_ms) VALUES (?,?,?,?,?)'),
    updateRating: db.prepare('UPDATE caregivers SET rating = ?, rating_count = ? WHERE id = ?'),
    contactsByUser: db.prepare('SELECT id,name,phone,relation FROM contacts WHERE user_id = ? ORDER BY id'),
    insertContact: db.prepare('INSERT INTO contacts (user_id,name,phone,relation) VALUES (?,?,?,?)'),
    deleteContact: db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?'),
    insertSos: db.prepare('INSERT INTO sos_alerts (user_id,booking_id,message,lat,lng,notified,status,created_ms) VALUES (?,?,?,?,?,?,?,?)'),
    campaigns: db.prepare('SELECT * FROM campaigns ORDER BY id'),
    campaignById: db.prepare('SELECT * FROM campaigns WHERE id = ?'),
    insertDonation: db.prepare('INSERT INTO donations (campaign_id,user_id,donor_name,amount,created_ms) VALUES (?,?,?,?,?)'),
    addRaised: db.prepare('UPDATE campaigns SET raised = raised + ? WHERE id = ?'),
    insertTriageLog: db.prepare('INSERT INTO triage_logs (user_id,level,score,created_ms) VALUES (?,?,?,?)'),
  };

  const serializeCaregiver = (cg) => ({
    id: cg.id,
    name: cg.name,
    title: cg.title,
    experienceYears: cg.experience_years,
    skills: cg.skills,
    skillLabels: cg.skills.map((s) => SKILL_LABELS[s] || s),
    categories: cg.categories,
    certs: cg.certs,
    rating: Math.round(cg.rating * 10) / 10,
    ratingCount: cg.rating_count,
    feePerHour: cg.fee_per_hour,
    city: cg.city,
    languages: cg.languages,
    availableDays: cg.available_days,
    bio: cg.bio,
    verified: cg.verified,
    avatarColor: cg.avatar_color,
  });

  const serializeBooking = (row, cg, nowMs) => {
    const tr = computeTracking(row, cg, nowMs);
    const fb = q.feedbackFor.get(row.id);
    return {
      id: row.id,
      service: row.service,
      recipientName: row.recipient_name,
      recipientAge: row.recipient_age,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      startAt: new Date(row.start_ms).toISOString(),
      hours: row.hours,
      fee: row.fee,
      notes: row.notes,
      status: tr.status,
      caregiver: {
        id: cg.id,
        name: cg.name,
        title: cg.title,
        phone: cg.phone,
        certs: cg.certs,
        verified: cg.verified,
        avatarColor: cg.avatar_color,
      },
      tracking: tr,
      feedback: fb ? { rating: fb.rating, comment: fb.comment } : null,
    };
  };

  // ---------------------------------------------------------------- routing
  const routes = [];
  const route = (method, pattern, handler, ropts = {}) => {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$',
    );
    routes.push({ method, re, keys, handler, ropts });
  };
  const ok = (body) => ({ body });
  const created = (body) => ({ status: 201, body });
  const requireUser = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Please sign in to continue');
    return ctx.user;
  };
  const limit = (ctx, bucket, n, windowMs) => {
    if (opts.rateLimit !== false) limiter(`${bucket}:${ctx.ip}`, n, windowMs);
  };

  const startSession = (userId) => {
    const token = newToken();
    q.insertSession.run(tokenHash(token), userId, now() + SESSION_MS);
    return token;
  };
  const cookieFor = (ctx, token, maxAge) =>
    `ojsid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${ctx.secure ? '; Secure' : ''}`;
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone || null });

  route('GET', '/api/health', () => ok({ ok: true, time: new Date(now()).toISOString() }));

  route('GET', '/api/config', () =>
    ok({
      categories: CATEGORIES,
      locations: LOCATIONS,
      skills: SKILL_LABELS,
      demoTrips: demo,
      publicDemo,
      llmEnabled: llm.enabled,
    }),
  );

  // ---- accounts
  route('POST', '/api/auth/register', async (ctx) => {
    limit(ctx, 'register', 10, 60_000);
    const b = ctx.body;
    const name = cleanStr(b.name, 80, { required: true, field: 'Name' });
    const email = cleanStr(b.email, 254, { required: true, field: 'Email' }).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address');
    validatePassword(b.password);
    const phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.consent !== true) {
      throw new HttpError(400, 'You must accept the privacy notice (PDPA) to create an account');
    }
    if (q.userByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists');
    const t = now();
    const info = q.insertUser.run(email, name, phone, hashPassword(b.password), t, t);
    const token = startSession(Number(info.lastInsertRowid));
    const user = q.userById.get(Number(info.lastInsertRowid));
    return { status: 201, body: { user: publicUser(user) }, headers: { 'Set-Cookie': cookieFor(ctx, token, SESSION_MS / 1000) } };
  });

  route('POST', '/api/auth/login', async (ctx) => {
    limit(ctx, 'login', 10, 60_000);
    const email = cleanStr(ctx.body.email, 254, { required: true, field: 'Email' }).toLowerCase();
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const user = q.userByEmail.get(email);
    const valid = verifyPassword(password, user ? user.pass_hash : dummyHash);
    if (!user || !valid) throw new HttpError(401, 'Incorrect email or password');
    const token = startSession(user.id);
    return { body: { user: publicUser(user) }, headers: { 'Set-Cookie': cookieFor(ctx, token, SESSION_MS / 1000) } };
  });

  route('POST', '/api/auth/logout', (ctx) => {
    if (ctx.token) q.deleteSession.run(tokenHash(ctx.token));
    return { body: { ok: true }, headers: { 'Set-Cookie': cookieFor(ctx, '', 0) } };
  });

  route('GET', '/api/me', (ctx) => ok({ user: ctx.user ? publicUser(ctx.user) : null }));

  // PDPA right to erasure
  route('DELETE', '/api/me', (ctx) => {
    const user = requireUser(ctx);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!verifyPassword(password, user.pass_hash)) throw new HttpError(403, 'Password is incorrect');
    transaction(db, () => {
      db.prepare('DELETE FROM sos_alerts WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE donations SET user_id = NULL WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE triage_logs SET user_id = NULL WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });
    return { body: { ok: true }, headers: { 'Set-Cookie': cookieFor(ctx, '', 0) } };
  });

  // ---- caregivers & matching
  route('GET', '/api/caregivers', (ctx) => {
    let list = q.allCaregivers.all().map(hydrateCaregiver);
    const { category, verified, maxFee, q: text } = ctx.query;
    if (category) list = list.filter((c) => c.categories.includes(category));
    if (verified === '1') list = list.filter((c) => c.verified);
    if (maxFee) list = list.filter((c) => c.fee_per_hour <= Number(maxFee));
    if (text) {
      const t = text.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(t) || c.skills.some((s) => (SKILL_LABELS[s] || '').toLowerCase().includes(t)));
    }
    return ok({ caregivers: list.map(serializeCaregiver) });
  });

  route('GET', '/api/caregivers/:id', (ctx) => {
    const cg = hydrateCaregiver(q.caregiverById.get(Number(ctx.params.id)));
    if (!cg) throw new HttpError(404, 'Caregiver not found');
    return ok({ caregiver: serializeCaregiver(cg) });
  });

  route('POST', '/api/match', (ctx) => {
    limit(ctx, 'match', 60, 60_000);
    const b = ctx.body;
    const text = cleanStr(b.text, 1000, { field: 'Description' });
    const category = b.category ? cleanStr(b.category, 40, { field: 'Category' }) : '';
    if (category && !CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown category');
    const coord = cleanCoord(b.lat, b.lng);
    const hours = b.hours ? cleanInt(b.hours, { min: 1, max: 12, field: 'Hours' }) : 2;
    let maxFee = null;
    if (b.maxFee !== undefined && b.maxFee !== null && b.maxFee !== '') maxFee = cleanInt(b.maxFee, { min: 50, max: 10000, field: 'Budget' });
    let startMs = null;
    if (b.date) {
      startMs = Date.parse(b.date);
      if (!Number.isFinite(startMs)) throw new HttpError(400, 'Invalid date');
    }
    const caregivers = q.allCaregivers.all().map(hydrateCaregiver);
    const busy = new Map();
    if (startMs !== null) {
      for (const r of q.busy.all(startMs + hours * 3600000, startMs)) {
        if (!busy.has(r.caregiver_id)) busy.set(r.caregiver_id, []);
        busy.get(r.caregiver_id).push({ start: r.start_ms, end: r.start_ms + r.hours * 3600000 });
      }
    }
    const request = {
      text,
      category,
      lat: coord ? coord.lat : null,
      lng: coord ? coord.lng : null,
      maxFee,
      startMs,
      hours,
      onlyVerified: b.onlyVerified === true,
    };
    const { needs, ranked } = rankCaregivers(caregivers, request, busy);
    const lim = clamp(Number(b.limit) || 10, 1, 20);
    const results = ranked.slice(0, lim).map((r) => ({
      caregiver: serializeCaregiver(r.caregiver),
      score: r.score,
      breakdown: r.breakdown,
      reasons: r.reasons,
      available: r.available,
      distanceKm: r.distanceKm,
    }));
    return ok({
      needs: {
        skills: needs.skills,
        labels: needs.skills.map((s) => SKILL_LABELS[s]),
        categories: needs.categories,
        strength: needs.strength,
      },
      insights: buildInsights(needs, ranked[0] ? ranked[0].caregiver : null),
      total: ranked.length,
      results,
    });
  });

  // ---- AI: triage assistant and document analysis
  route('POST', '/api/triage', async (ctx) => {
    limit(ctx, 'triage', 30, 60_000);
    const b = ctx.body;
    if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > 20) {
      throw new HttpError(400, 'messages must be a list of 1-20 texts');
    }
    const messages = b.messages.map((m) => cleanStr(m, 1000, { required: true, field: 'Message' }));
    const age = b.age ? cleanInt(b.age, { min: 0, max: 120, field: 'Age' }) : undefined;
    const assessment = assess({ messages, age });
    q.insertTriageLog.run(ctx.user ? ctx.user.id : null, assessment.level, assessment.score, now());
    const explanation = await llm.explainTriage(assessment, messages.join('\n'));
    return ok({ assessment, explanation, explainedBy: explanation ? 'llm' : 'rules' });
  });

  route('POST', '/api/analyze', (ctx) => {
    limit(ctx, 'analyze', 20, 60_000);
    const text = cleanStr(ctx.body.text, 5000, { required: true, field: 'Text' });
    return ok({ status: 'ok', source: 'text', ...analyzeText(text) });
  });

  route('POST', '/api/analyze/file', async (ctx) => {
    limit(ctx, 'analyze', 20, 60_000);
    const mime = String(ctx.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!FILE_TYPES[mime]) throw new HttpError(415, 'Only PNG, JPG or PDF files are supported');
    const buf = await readBody(ctx.req, 5 * 1024 * 1024);
    if (buf.length === 0 || !FILE_TYPES[mime](buf)) throw new HttpError(400, 'The file content does not match its type');
    if (!llm.enabled) {
      return ok({
        status: 'needs_manual_input',
        message: 'Automatic reading of images and PDFs needs the vision model, which is not configured on this server. Please paste the key details of the report as text instead.',
      });
    }
    const text = await llm.readDocument(buf, mime);
    if (!text) return ok({ status: 'unreadable', message: 'The document could not be read. Please paste the key details as text.' });
    return ok({ status: 'ok', source: 'vision-model', ...analyzeText(text) });
  }, { raw: true });

  // ---- bookings
  const requireBooking = (ctx) => {
    const user = requireUser(ctx);
    const row = q.bookingOwned.get(ctx.params.id, user.id);
    if (!row) throw new HttpError(404, 'Booking not found');
    return { user, row, cg: hydrateCaregiver(q.caregiverById.get(row.caregiver_id)) };
  };

  route('POST', '/api/bookings', (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, 'booking', 20, 60_000);
    const b = ctx.body;
    const caregiverId = cleanInt(b.caregiverId, { min: 1, max: 1_000_000, field: 'Caregiver' });
    const cg = hydrateCaregiver(q.caregiverById.get(caregiverId));
    if (!cg) throw new HttpError(404, 'Caregiver not found');
    const service = cleanStr(b.service, 40, { required: true, field: 'Service' });
    if (!CATEGORIES.includes(service)) throw new HttpError(400, 'Unknown service');
    if (!cg.categories.includes(service)) throw new HttpError(400, `${cg.name} does not offer ${service}`);
    const recipientName = cleanStr(b.recipientName, 80, { required: true, field: 'Care recipient name' });
    const recipientAge = cleanInt(b.recipientAge, { min: 0, max: 120, field: 'Care recipient age' });
    const address = cleanStr(b.address, 200, { required: true, field: 'Address' });
    const coord = cleanCoord(b.lat, b.lng);
    if (!coord) throw new HttpError(400, 'Choose the care location');
    const startMs = Date.parse(b.startAt);
    if (!Number.isFinite(startMs)) throw new HttpError(400, 'Choose a valid date and time');
    const t = now();
    if (startMs < t - 60_000) throw new HttpError(400, 'The start time must be in the future');
    if (startMs > t + 90 * 86400_000) throw new HttpError(400, 'Bookings can be made up to 90 days ahead');
    const hours = cleanInt(b.hours, { min: 1, max: 12, field: 'Hours' });
    const notes = cleanStr(b.notes, 500, { field: 'Notes' });
    const endMs = startMs + hours * 3600000;

    const id = transaction(db, () => {
      if (!cg.available_days.includes(bangkokWeekday(startMs))) {
        throw new HttpError(409, `${cg.name} does not work on that day`);
      }
      for (const r of q.busyFor.all(cg.id)) {
        if (overlaps(startMs, endMs, r.start_ms, r.start_ms + r.hours * 3600000)) {
          throw new HttpError(409, `${cg.name} is already booked at that time`);
        }
      }
      const ymd = new Date(t + 7 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
      for (let i = 0; i < 20; i++) {
        const bid = `OJ${ymd}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
        try {
          q.insertBooking.run(bid, user.id, cg.id, service, recipientName, recipientAge, address, coord.lat, coord.lng, startMs, hours, cg.fee_per_hour * hours, notes, t);
          return bid;
        } catch (e) {
          if (!/UNIQUE|PRIMARY/i.test(String(e.message))) throw e;
        }
      }
      throw new HttpError(500, 'Could not allocate a booking number');
    });
    const row = q.bookingOwned.get(id, user.id);
    return created({ booking: serializeBooking(row, cg, t) });
  });

  route('GET', '/api/bookings', (ctx) => {
    const user = requireUser(ctx);
    const t = now();
    const bookings = q.bookingsByUser.all(user.id).map((row) =>
      serializeBooking(row, hydrateCaregiver(q.caregiverById.get(row.caregiver_id)), t),
    );
    return ok({ bookings });
  });

  route('GET', '/api/bookings/:id', (ctx) => {
    const { row, cg } = requireBooking(ctx);
    return ok({ booking: serializeBooking(row, cg, now()) });
  });

  route('GET', '/api/bookings/:id/track', (ctx) => {
    const { row, cg } = requireBooking(ctx);
    const t = now();
    const s = serializeBooking(row, cg, t);
    return ok({ id: s.id, status: s.status, tracking: s.tracking, serverTime: t });
  });

  route('POST', '/api/bookings/:id/cancel', (ctx) => {
    const { row, cg } = requireBooking(ctx);
    const t = now();
    const status = computeTracking(row, cg, t).status;
    if (status === 'cancelled') throw new HttpError(409, 'This booking is already cancelled');
    if (status !== 'scheduled') throw new HttpError(409, 'The caregiver has already set off, so this booking can no longer be cancelled online');
    q.cancelBooking.run(row.id);
    return ok({ booking: serializeBooking(q.bookingOwned.get(row.id, row.user_id), cg, t) });
  });

  route('POST', '/api/bookings/:id/start-demo', (ctx) => {
    if (!demo) throw new HttpError(404, 'Not found');
    const { row, cg } = requireBooking(ctx);
    const t = now();
    if (computeTracking(row, cg, t).status !== 'scheduled') throw new HttpError(409, 'The trip has already started');
    q.dispatchBooking.run(t, simSpeed, row.id);
    return ok({ booking: serializeBooking(q.bookingOwned.get(row.id, row.user_id), cg, t) });
  });

  route('POST', '/api/bookings/:id/feedback', (ctx) => {
    const { user, row, cg } = requireBooking(ctx);
    const t = now();
    if (computeTracking(row, cg, t).status !== 'completed') throw new HttpError(409, 'You can rate a caregiver after the service is completed');
    if (q.feedbackFor.get(row.id)) throw new HttpError(409, 'Feedback has already been submitted');
    const rating = cleanInt(ctx.body.rating, { min: 1, max: 5, field: 'Rating' });
    const comment = cleanStr(ctx.body.comment, 500, { field: 'Comment' });
    transaction(db, () => {
      q.insertFeedback.run(row.id, user.id, rating, comment, t);
      const fresh = q.caregiverById.get(cg.id);
      const count = fresh.rating_count + 1;
      q.updateRating.run((fresh.rating * fresh.rating_count + rating) / count, count, cg.id);
    });
    return created({ feedback: { rating, comment } });
  });

  // ---- emergency
  route('GET', '/api/contacts', (ctx) => ok({ contacts: q.contactsByUser.all(requireUser(ctx).id) }));

  route('POST', '/api/contacts', (ctx) => {
    const user = requireUser(ctx);
    if (q.contactsByUser.all(user.id).length >= 5) throw new HttpError(400, 'You can save up to 5 emergency contacts');
    const name = cleanStr(ctx.body.name, 80, { required: true, field: 'Name' });
    const phone = normalizePhone(ctx.body.phone);
    const relation = cleanStr(ctx.body.relation, 40, { field: 'Relationship' }) || 'Family';
    const info = q.insertContact.run(user.id, name, phone, relation);
    return created({ contact: { id: Number(info.lastInsertRowid), name, phone, relation } });
  });

  route('DELETE', '/api/contacts/:id', (ctx) => {
    const user = requireUser(ctx);
    const info = q.deleteContact.run(Number(ctx.params.id), user.id);
    if (info.changes === 0) throw new HttpError(404, 'Contact not found');
    return ok({ ok: true });
  });

  route('POST', '/api/sos', (ctx) => {
    limit(ctx, 'sos', 5, 60_000);
    const message = cleanStr(ctx.body.message, 300, { field: 'Message' }) || 'Emergency assistance requested';
    const coord = cleanCoord(ctx.body.lat, ctx.body.lng);
    const notified = [];
    let bookingId = null;
    if (ctx.user) {
      for (const c of q.contactsByUser.all(ctx.user.id)) notified.push({ type: 'contact', name: c.name, relation: c.relation });
      if (ctx.body.bookingId) {
        const row = q.bookingOwned.get(String(ctx.body.bookingId), ctx.user.id);
        if (row) {
          bookingId = row.id;
          const cg = hydrateCaregiver(q.caregiverById.get(row.caregiver_id));
          notified.push({ type: 'caregiver', name: cg.name, relation: 'Assigned caregiver' });
        }
      }
    }
    const t = now();
    const info = q.insertSos.run(ctx.user ? ctx.user.id : null, bookingId, message, coord ? coord.lat : null, coord ? coord.lng : null, JSON.stringify(notified), 'open', t);
    const alertId = Number(info.lastInsertRowid);
    outbox.push({ alertId, to: notified, message, at: t });
    return created({
      alertId,
      status: 'logged',
      notified,
      hotlines: [{ number: '1669', label: 'Emergency medical service' }, { number: '191', label: 'Police' }, { number: '1323', label: 'Mental health hotline' }],
      simulated: true,
      message: 'Your alert is recorded. This prototype does not send real SMS or push messages, so call 1669 now if this is an emergency.',
    });
  });

  // ---- donations
  route('GET', '/api/campaigns', () => ok({ campaigns: q.campaigns.all() }));

  route('POST', '/api/donations', (ctx) => {
    limit(ctx, 'donate', 10, 60_000);
    const campaignId = cleanInt(ctx.body.campaignId, { min: 1, max: 1_000_000, field: 'Campaign' });
    const amount = cleanInt(ctx.body.amount, { min: 20, max: 100_000, field: 'Amount (THB)' });
    const donorName = cleanStr(ctx.body.donorName, 80, { field: 'Name' }) || (ctx.user ? ctx.user.name : 'Anonymous');
    if (!q.campaignById.get(campaignId)) throw new HttpError(404, 'Campaign not found');
    transaction(db, () => {
      q.insertDonation.run(campaignId, ctx.user ? ctx.user.id : null, donorName, amount, now());
      q.addRaised.run(amount, campaignId);
    });
    return created({
      campaign: q.campaignById.get(campaignId),
      simulated: true,
      message: 'Thank you! This is a prototype: no real payment was taken.',
    });
  });

  // ---------------------------------------------------------------- server
  async function serveStatic(req, res, pathname) {
    let rel = PAGES[pathname] || pathname.replace(/^\/+/, '');
    const abs = path.resolve(PUBLIC_DIR, rel);
    if (!abs.startsWith(PUBLIC_DIR + path.sep) || path.basename(abs).startsWith('.')) {
      throw new HttpError(404, 'Not found');
    }
    try {
      const data = await readFile(abs);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        ...SECURITY_HEADERS,
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      throw new HttpError(404, 'Page not found');
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      return serveStatic(req, res, pathname);
    }

    const ctx = {
      req,
      res,
      url,
      query: Object.fromEntries(url.searchParams),
      ip: clientIp(req),
      secure: req.headers['x-forwarded-proto'] === 'https',
      params: {},
      body: {},
      user: null,
      token: null,
    };

    let matched = null;
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== req.method) { methodMismatch = true; continue; }
      matched = r;
      r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
      break;
    }
    if (!matched) throw new HttpError(methodMismatch ? 405 : 404, methodMismatch ? 'Method not allowed' : 'Not found');

    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating && req.headers.origin) {
      let host = '';
      try { host = new URL(req.headers.origin).host; } catch { /* invalid */ }
      if (host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked');
    }

    const token = parseCookies(req.headers.cookie).ojsid;
    if (token) {
      const s = q.sessionByHash.get(tokenHash(token));
      if (s && s.expires_ms > now()) {
        ctx.user = q.userById.get(s.user_id) || null;
        ctx.token = token;
      } else if (s) {
        q.deleteSession.run(s.token_hash);
      }
    }

    if (mutating && !matched.ropts.raw) ctx.body = await readJson(req);
    const result = await matched.handler(ctx);
    sendJson(res, result.status || 200, result.body, { ...SECURITY_HEADERS, ...(result.headers || {}) });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) {
        const wantsJson = req.url.startsWith('/api/');
        if (wantsJson) return sendJson(res, err.status, { error: err.message, details: err.details }, SECURITY_HEADERS);
        res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        return res.end(err.status === 404 ? 'Page not found' : err.message);
      }
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' }, SECURITY_HEADERS);
    });
  });

  setInterval(() => q.purgeSessions.run(now()), 3600_000).unref();

  return {
    server,
    db,
    outbox,
    llm,
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { server.close(() => { db.close(); resolve(); }); server.closeAllConnections?.(); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dataDir = path.resolve(__dirname, '..', 'data');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dataDir, { recursive: true });
  const app = createApp({ dbPath: process.env.OUNJAI_DB || path.join(dataDir, 'ounjai.db') });
  const port = Number(process.env.PORT) || 3000;
  // hosting platforms set PORT and need the server reachable from outside the container
  const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  await app.listen(port, host);
  console.log(`OunJai Care Connect running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(app.llm.enabled ? `LLM assistant: enabled (${app.llm.model})` : 'LLM assistant: off (rule-based engines only; set ANTHROPIC_API_KEY to enable)');
}
