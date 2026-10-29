// Explainable caregiver matching. Each caregiver gets a 0-100 score built from
// transparent components, so the platform can always show *why* someone was recommended.

import { clamp, haversineKm } from './util.js';
import { extractNeeds, SKILL_LABELS, CONCEPTS } from './nlp.js';

export const WEIGHTS = {
  skills: 40,
  category: 15,
  distance: 15,
  rating: 10,
  availability: 10,
  experience: 5,
  budget: 5,
};

const FAR_KM = 100;
const BKK_OFFSET_MS = 7 * 3600 * 1000;

/** Day of week (0=Sunday) in Thailand time for an instant. */
export function bangkokWeekday(ms) {
  return new Date(ms + BKK_OFFSET_MS).getUTCDay();
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export function scoreCaregiver(cg, request, needs, busy = []) {
  const parts = {};
  const reasons = [];

  // skills (40)
  if (needs.skills.length > 0) {
    const have = new Set(cg.skills);
    const hit = needs.skills.filter((s) => have.has(s));
    parts.skills = WEIGHTS.skills * (hit.length / needs.skills.length);
    if (hit.length) reasons.push(`Covers ${hit.map((s) => SKILL_LABELS[s]).join(', ')}`);
    const missing = needs.skills.filter((s) => !have.has(s));
    if (missing.length) reasons.push(`Does not list ${missing.map((s) => SKILL_LABELS[s]).join(', ')}`);
  } else {
    parts.skills = WEIGHTS.skills / 2;
    reasons.push('No specific needs detected, so skills are scored neutrally');
  }

  // category (15)
  const wantedCats = request.category ? [request.category] : needs.categories;
  if (wantedCats.length > 0) {
    const ok = wantedCats.some((c) => cg.categories.includes(c));
    parts.category = ok ? WEIGHTS.category : 0;
    if (ok) reasons.push(`Works in ${wantedCats.filter((c) => cg.categories.includes(c)).join(', ')}`);
  } else {
    parts.category = WEIGHTS.category / 2;
  }

  // distance (15)
  let distanceKm = null;
  if (request.lat != null && request.lng != null) {
    distanceKm = haversineKm(request.lat, request.lng, cg.lat, cg.lng);
    parts.distance = WEIGHTS.distance * clamp(1 - distanceKm / 50, 0, 1);
    reasons.push(`${distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km away`);
  } else {
    parts.distance = WEIGHTS.distance / 2;
  }

  // rating, smoothed so a single review cannot dominate (10)
  const smoothed = (cg.rating * cg.rating_count + 4.0 * 5) / (cg.rating_count + 5);
  parts.rating = WEIGHTS.rating * clamp((smoothed - 3) / 2, 0, 1);

  // experience (5)
  parts.experience = WEIGHTS.experience * clamp(cg.experience_years / 10, 0, 1);
  if (cg.experience_years >= 8) reasons.push(`${cg.experience_years} years of experience`);

  // availability (10)
  let available = true;
  if (request.startMs != null) {
    const endMs = request.startMs + (request.hours || 2) * 3600 * 1000;
    const dayOk = cg.available_days.includes(bangkokWeekday(request.startMs));
    const free = !busy.some((b) => overlaps(request.startMs, endMs, b.start, b.end));
    available = dayOk && free;
    parts.availability = available ? WEIGHTS.availability : 0;
    reasons.push(available ? 'Available at the requested time' : dayOk ? 'Already booked at the requested time' : 'Not working on the requested day');
  } else {
    parts.availability = WEIGHTS.availability / 2;
  }

  // budget (5)
  if (request.maxFee) {
    parts.budget = cg.fee_per_hour <= request.maxFee ? WEIGHTS.budget : WEIGHTS.budget * clamp(1 - (cg.fee_per_hour - request.maxFee) / request.maxFee, 0, 1);
    reasons.push(cg.fee_per_hour <= request.maxFee ? 'Within budget' : 'Above budget');
  } else {
    parts.budget = WEIGHTS.budget / 2;
  }

  // In-person care is impractical far away: halve the score beyond 100 km and say so.
  let total = Object.values(parts).reduce((a, b) => a + b, 0);
  if (distanceKm !== null && distanceKm > FAR_KM) {
    parts.penalty = -total / 2;
    total /= 2;
    reasons.push(`Too far for in-person care (over ${FAR_KM} km), score halved`);
  }
  const breakdown = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  return { score: Math.round(total), breakdown, reasons, available, distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10 };
}

export function rankCaregivers(caregivers, request, busyByCaregiver = new Map()) {
  const needs = extractNeeds(request.text || '');
  let pool = caregivers;
  if (request.onlyVerified) pool = pool.filter((c) => c.verified);
  if (request.category) pool = pool.filter((c) => c.categories.includes(request.category));
  const ranked = pool
    .map((cg) => ({ caregiver: cg, ...scoreCaregiver(cg, request, needs, busyByCaregiver.get(cg.id) || []) }))
    .sort((a, b) => b.score - a.score || b.caregiver.rating - a.caregiver.rating || a.caregiver.id - b.caregiver.id);
  return { needs, ranked };
}

export function buildInsights(needs, top) {
  if (needs.skills.length === 0) {
    return 'No specific care needs were detected in the description, so caregivers are ranked on proximity, rating, experience and availability. Add details such as "dementia", "wheelchair" or "after surgery" for a sharper match.';
  }
  const labels = needs.skills.map((s) => SKILL_LABELS[s]);
  const cats = needs.categories.length ? ` in ${needs.categories.join(' / ')}` : '';
  let text = `Detected needs: ${labels.join(', ')}. Looking for a caregiver${cats} with matching skills.`;
  if (top) {
    const certs = top.certs && top.certs.length ? `${top.certs[0]} ` : '';
    text += ` Best match: ${certs}${top.name}.`;
  }
  return text;
}

export { CONCEPTS };
