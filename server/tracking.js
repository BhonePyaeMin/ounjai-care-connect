// Simulated live tracking. There is no real GPS feed in this prototype: the caregiver's
// position is interpolated between their base and the care address over the transit time.
// A "demo trip" compresses time (sim_speed) so the whole journey can be watched in a minute.

import { clamp, haversineKm } from './util.js';

export const AVG_SPEED_KMH = 30;

export function transitMs(distKm) {
  return clamp((distKm / AVG_SPEED_KMH) * 60, 5, 90) * 60000;
}

export function computeTracking(b, cg, nowMs) {
  const distKm = haversineKm(cg.lat, cg.lng, b.lat, b.lng);
  const tMs = transitMs(distKm);
  const speed = b.sim_speed || 1;
  const dispatch = b.dispatched_ms ?? b.start_ms - tMs;
  const arrive = dispatch + tMs / speed;
  const end = arrive + (b.hours * 3600000) / speed;

  let status;
  if (b.status === 'cancelled') status = 'cancelled';
  else if (nowMs < dispatch) status = 'scheduled';
  else if (nowMs < arrive) status = 'in_transit';
  else if (nowMs < end) status = 'in_service';
  else status = 'completed';

  const progress = status === 'scheduled' ? 0 : status === 'cancelled' ? 0 : clamp((nowMs - dispatch) / (arrive - dispatch), 0, 1);
  const position = {
    lat: cg.lat + (b.lat - cg.lat) * progress,
    lng: cg.lng + (b.lng - cg.lng) * progress,
  };
  return {
    status,
    progress: Math.round(progress * 1000) / 1000,
    position,
    origin: { lat: cg.lat, lng: cg.lng },
    destination: { lat: b.lat, lng: b.lng },
    distanceKm: Math.round(distKm * 10) / 10,
    transitMinutes: Math.round(tMs / 60000),
    etaMinutes: status === 'in_transit' ? Math.max(1, Math.ceil((1 - progress) * (tMs / 60000))) : null,
    dispatchAtMs: dispatch,
    arrivesAtMs: arrive,
    endsAtMs: end,
    demo: b.dispatched_ms != null,
    simulated: true,
  };
}
