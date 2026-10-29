import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTracking, transitMs } from '../server/tracking.js';

const cg = { lat: 20.0, lng: 99.9 };
const booking = (over = {}) => ({
  lat: 20.1, lng: 99.9, start_ms: 1_000_000_000_000, hours: 2, status: 'confirmed', dispatched_ms: null, sim_speed: null, ...over,
});

test('transit time is distance based and bounded', () => {
  assert.equal(transitMs(0), 5 * 60000);
  assert.equal(transitMs(15), 30 * 60000);
  assert.equal(transitMs(500), 90 * 60000);
});

test('status timeline for a normal booking', () => {
  const b = booking();
  const t0 = computeTracking(b, cg, b.start_ms - 3 * 3600_000);
  assert.equal(t0.status, 'scheduled');
  assert.equal(t0.progress, 0);

  const transit = t0.transitMinutes * 60000;
  const mid = computeTracking(b, cg, b.start_ms - transit / 2);
  assert.equal(mid.status, 'in_transit');
  assert.ok(Math.abs(mid.progress - 0.5) < 0.01);
  assert.ok(mid.position.lat > cg.lat && mid.position.lat < b.lat);
  assert.ok(mid.etaMinutes > 0 && mid.etaMinutes <= t0.transitMinutes);

  assert.equal(computeTracking(b, cg, b.start_ms + 1000).status, 'in_service');
  assert.equal(computeTracking(b, cg, b.start_ms + 2 * 3600_000 + 1).status, 'completed');
});

test('position ends exactly at the destination on arrival', () => {
  const b = booking();
  const t = computeTracking(b, cg, b.start_ms + 5);
  assert.ok(Math.abs(t.position.lat - b.lat) < 1e-9);
  assert.ok(Math.abs(t.position.lng - b.lng) < 1e-9);
});

test('cancelled bookings never track', () => {
  const t = computeTracking(booking({ status: 'cancelled' }), cg, 0);
  assert.equal(t.status, 'cancelled');
  assert.equal(t.etaMinutes, null);
});

test('demo trips compress time', () => {
  const now = 5_000_000_000_000;
  const b = booking({ dispatched_ms: now, sim_speed: 30 });
  const probe = computeTracking(b, cg, now);
  assert.equal(probe.demo, true);
  const transit = probe.transitMinutes * 60000;
  assert.equal(computeTracking(b, cg, now + 1).status, 'in_transit');
  assert.equal(computeTracking(b, cg, now + transit / 30 + 5000).status, 'in_service');
  assert.equal(computeTracking(b, cg, now + transit / 30 + (2 * 3600_000) / 30 + 5000).status, 'completed');
});
