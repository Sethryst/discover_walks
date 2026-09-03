import { el } from './utils.js';
import { toast } from './ui.js';
import { currentWalkPlan } from './field-guide.js';

function shareText() {
  const invite = el('friendWalkInvite')?.value?.trim();
  if (invite) return invite;
  const phrase = el('openPhraseInput')?.value?.trim();
  if (phrase) return phrase;
  const plan = currentWalkPlan();
  if (plan) return JSON.stringify(plan);
  return '';
}

export function renderShareQr(text = shareText()) {
  const panel = el('shareQrPanel');
  if (!panel) return;
  if (!text) {
    panel.innerHTML = '<small>Enter a phrase, start a friend walk, or sketch a walk first.</small>';
    panel.classList.remove('hidden');
    toast('There is nothing to put in a QR code yet.');
    return;
  }
  if (typeof qrcode !== 'function') {
    panel.innerHTML = '<small>QR tool is not available. Use Export instead.</small>';
    panel.classList.remove('hidden');
    return;
  }
  if (text.length > 800) {
    panel.innerHTML = '<small>This payload is too large for a QR code. Use Export JSON.</small>';
    panel.classList.remove('hidden');
    toast('Use Export JSON for large journal files.');
    return;
  }
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  panel.innerHTML = `${code.createSvgTag(5, 2)}<small>The other device taps Scan QR, then Open.</small>`;
  panel.classList.remove('hidden');
}

export function initShareQr() {
  el('shareQrButton')?.addEventListener('click', () => renderShareQr());
}
