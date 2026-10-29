import { mountLayout } from '../layout.js';
import { api, getConfig } from '../api.js';
import { el, icon, $, $$ } from '../dom.js';
import { renderTriageBanner, toast } from '../components.js';

await mountLayout();
const config = await getConfig();
$('#info-ico').append(icon('info', 18));
$('#send-ico').append(icon('send', 18));
if (config.llmEnabled) $('#engine-badge').textContent = 'Rules + LLM explanation';

const DESCRIPTIONS = {
  Childcare: 'Trusted childcare and paediatric support for working families, including special-needs experience.',
  'Elderly Care': 'Daily living support, dementia and palliative care, medication reminders and companionship.',
  'Disability Support': 'Mobility, transfers and personal assistance for people with disabilities.',
  Rehabilitation: 'Physiotherapy, stroke and post-surgery recovery guided by qualified professionals.',
};
$('#services').append(...config.categories.map((c) =>
  el('article', { class: 'card feature' },
    el('h3', { text: c }),
    el('p', { class: 'muted small', text: DESCRIPTIONS[c] }),
    el('a', { class: 'btn secondary sm', href: `/matching?category=${encodeURIComponent(c)}`, text: 'Find a caregiver' }),
  ),
));

// ------------------------------------------------------------ assistant
const log = $('#chat-log');
const input = $('#chat-input');
let userMessages = [];

function say(kind, ...content) {
  const b = el('div', { class: `bubble ${kind}` }, ...content);
  log.append(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

// Everything said in one conversation is treated as one case; "New case" starts afresh.
function newCase() {
  userMessages = [];
  log.replaceChildren();
  say('bot', 'Hello, I am the OunJai assistant. Tell me who needs care, their age, and what is happening (for example fever, dizziness, a fall, memory changes). I will tell you how urgent it looks and what to do next. Each conversation is treated as one person; press "New case" to check someone else.');
}
newCase();
$('#reset-btn').addEventListener('click', () => { newCase(); input.focus(); });

function renderAssistant(data) {
  const a = data.assessment;
  const body = [];
  if (data.explanation) body.push(el('p', { text: data.explanation, style: { marginBottom: '.6rem' } }));
  body.push(renderTriageBanner(a));
  if (a.findings.length) {
    body.push(el('p', { class: 'small', style: { marginTop: '.6rem' } }, el('strong', { text: 'What I picked up: ' }), a.findings.map((f) => f.label).join(', ')));
  }
  if (a.reasons.length) body.push(el('ul', { class: 'small muted' }, a.reasons.map((r) => el('li', { text: r }))));
  if (a.followUps.length) {
    body.push(el('div', { style: { marginTop: '.6rem' } }, el('strong', { class: 'small', text: 'To refine this, please tell me:' }), el('ul', { class: 'small' }, a.followUps.map((f) => el('li', { text: f })))));
  }
  const actions = [];
  if (a.recommendedCategory && a.level !== 'emergency') {
    actions.push(el('a', { class: 'btn secondary sm', href: `/matching?category=${encodeURIComponent(a.recommendedCategory)}`, text: `Find ${a.recommendedCategory} caregivers` }));
  }
  if (actions.length) body.push(el('div', { class: 'row', style: { marginTop: '.6rem' } }, actions));
  body.push(el('p', { class: 'xsmall muted', style: { marginTop: '.6rem' }, text: a.disclaimer }));
  return body;
}

async function send(text) {
  if (!text) return;
  say('user', text);
  userMessages.push(text);
  const typing = say('bot', el('span', { class: 'typing', text: 'Checking…' }));
  $('#chat-send').disabled = true;
  try {
    const data = await api('/api/triage', { method: 'POST', body: { messages: userMessages.slice(-20) } });
    typing.replaceChildren(...renderAssistant(data));
  } catch (e) {
    typing.replaceChildren(el('span', { class: 'error-text', text: e.message }));
    userMessages.pop();
    toast(e.message, 'error');
  } finally {
    $('#chat-send').disabled = false;
    log.scrollTop = log.scrollHeight;
    input.focus();
  }
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  input.value = '';
  send(text);
});
$$('[data-example]').forEach((b) => b.addEventListener('click', () => { newCase(); send(b.dataset.example); }));
