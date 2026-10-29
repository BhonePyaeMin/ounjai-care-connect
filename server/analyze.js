import { extractNeeds, SKILL_LABELS } from './nlp.js';
import { assess } from './triage.js';

export const FILE_TYPES = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'application/pdf': (b) => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-',
};

/** Analyse free text from a health report or care description. */
export function analyzeText(text) {
  const needs = extractNeeds(text);
  const triage = assess({ text });
  const labels = needs.skills.map((s) => SKILL_LABELS[s]);
  const parts = [];
  if (labels.length) parts.push(`Care needs detected: ${labels.join(', ')}.`);
  else parts.push('No specific care needs were detected in the text.');
  if (triage.age !== null) parts.push(`Age: ${Math.round(triage.age)}.`);
  if (triage.conditions.length) parts.push(`Existing conditions: ${triage.conditions.join(', ').replace(/_/g, ' ')}.`);
  if (triage.findings.length || triage.redFlags.length) {
    parts.push(`Health signals: ${[...triage.redFlags, ...triage.findings].map((f) => f.label).join('; ')}.`);
  }
  if (triage.level === 'emergency') parts.push('Warning signs of an emergency were found - call 1669 now.');
  else if (triage.level === 'urgent') parts.push('Some signs need medical attention within 24 hours.');
  return {
    needs: {
      skills: needs.skills,
      labels,
      categories: needs.categories,
      strength: needs.strength,
    },
    triage: {
      level: triage.level,
      levelLabel: triage.levelLabel,
      redFlags: triage.redFlags,
      findings: triage.findings,
      advice: triage.advice,
      callEmergency: triage.callEmergency,
      hotlines: triage.hotlines,
    },
    age: triage.age,
    conditions: triage.conditions,
    vitals: triage.vitals,
    summary: parts.join(' '),
    suggestedQuery: labels.join(', '),
  };
}
