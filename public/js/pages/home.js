import { mountLayout } from '../layout.js';
import { api, getConfig } from '../api.js';
import { el, icon, $, clear } from '../dom.js';
import { renderAnalysis, toast } from '../components.js';

await mountLayout();
$('#upload-icon').append(icon('upload', 22));
$('#f1').append(icon('sparkles', 22));
$('#f2').append(icon('nav', 22));
$('#f3').append(icon('alert', 22));

const result = $('#analysis-result');
let category = '';

const config = await getConfig().catch(() => ({ categories: ['Childcare', 'Elderly Care', 'Disability Support', 'Rehabilitation'] }));
const chips = $('#chips');
for (const c of config.categories) {
  const chip = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: c });
  chip.addEventListener('click', () => {
    category = category === c ? '' : c;
    chips.querySelectorAll('.chip').forEach((n) => n.setAttribute('aria-pressed', String(n.textContent === category)));
  });
  chips.append(chip);
}

function goMatch(text) {
  const p = new URLSearchParams();
  if (text) p.set('q', text);
  if (category) p.set('category', category);
  location.href = `/matching${p.toString() ? `?${p}` : ''}`;
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  goMatch($('#search-text').value.trim());
});

const showAnalysis = (data) =>
  renderAnalysis(result, data, {
    onFind: (d) => {
      if (d.needs.categories.length && !category) category = d.needs.categories[0];
      goMatch(d.suggestedQuery || $('#paste-text').value.trim());
    },
  });

async function analyzeFile(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) return toast('Please choose a PNG, JPG or PDF file.', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('The file is larger than 5 MB.', 'error');
  clear(result).append(el('p', { class: 'small muted', role: 'status', text: `Analysing ${file.name}…` }));
  try {
    const data = await api('/api/analyze/file', { method: 'POST', rawBody: await file.arrayBuffer(), contentType: file.type });
    if (data.status === 'ok') return showAnalysis(data);
    clear(result).append(el('div', { class: 'callout info', role: 'status' }, icon('info', 18), el('p', { text: data.message })));
    $('#paste-box').open = true;
    $('#paste-text').focus();
  } catch (err) {
    clear(result);
    toast(err.message, 'error');
  }
}

const fileInput = $('#file-input');
const zone = $('#upload-zone');
zone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => analyzeFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
zone.addEventListener('drop', (e) => analyzeFile(e.dataTransfer.files[0]));

$('#analyze-btn').addEventListener('click', async () => {
  const text = $('#paste-text').value.trim();
  if (!text) return toast('Paste some text to analyse first.', 'error');
  try {
    showAnalysis(await api('/api/analyze', { method: 'POST', body: { text } }));
  } catch (err) {
    toast(err.message, 'error');
  }
});
