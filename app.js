const $ = (selector) => document.querySelector(selector);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CACHE_KEY = 'bayshore-hep-encrypted-bundle-v2';
let envelope = null;
let passphraseInMemory = '';
let library = null;
let selectedId = sessionStorage.getItem('bayshore-hep-selected-id') || '';

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function validEnvelope(value) {
  return value && value.version === 2 && value.kdf === 'PBKDF2-SHA256' &&
    value.cipher === 'AES-256-GCM' && Number.isInteger(value.iterations) &&
    value.iterations >= 300000 && typeof value.salt === 'string' &&
    typeof value.iv === 'string' && typeof value.ciphertext === 'string';
}

async function decryptBundle(bundle, passphrase) {
  if (!validEnvelope(bundle)) throw new Error('This is not a supported encrypted HEP bundle.');
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'PBKDF2', hash: 'SHA-256', salt: bytesFromBase64(bundle.salt), iterations: bundle.iterations,
  }, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytesFromBase64(bundle.iv)}, key, bytesFromBase64(bundle.ciphertext));
  const data = JSON.parse(decoder.decode(clear));
  if (data.version !== 2 || !Array.isArray(data.profiles) || !data.profiles.every((profile) =>
    typeof profile.id === 'string' && typeof profile.label === 'string' && Array.isArray(profile.sections) &&
    (profile.firstName === undefined || typeof profile.firstName === 'string') &&
    (profile.orderEndDate === undefined || typeof profile.orderEndDate === 'string'))) {
    throw new Error('The decrypted HEP bundle has an unexpected structure.');
  }
  return data;
}

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle('error', error);
}

async function fetchHostedBundle() {
  const response = await fetch('data/programs.enc.json', {cache: 'no-store'});
  if (!response.ok) throw new Error(`Hosted bundle unavailable (${response.status}).`);
  const candidate = await response.json();
  if (!validEnvelope(candidate)) throw new Error('Hosted bundle format is invalid.');
  return candidate;
}

async function refreshEnvelope() {
  try {
    const candidate = await fetchHostedBundle();
    if (passphraseInMemory) {
      const nextLibrary = await decryptBundle(candidate, passphraseInMemory);
      envelope = candidate;
      library = nextLibrary;
      renderLibrary();
      setStatus($('#library-status'), 'Latest encrypted library loaded.');
    } else {
      envelope = candidate;
      setStatus($('#unlock-status'), 'Encrypted library available. Enter your passphrase.');
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(candidate));
  } catch (error) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!envelope && cached) {
      try { const candidate = JSON.parse(cached); if (validEnvelope(candidate)) envelope = candidate; } catch { /* ignore broken cache */ }
    }
    if (library) setStatus($('#library-status'), 'Unable to check for an update; showing the current library.', true);
    else setStatus($('#unlock-status'), envelope
      ? 'Using the last encrypted bundle saved on this tablet.'
      : 'No encrypted library is available yet. Import one below or publish the bundle.', !envelope);
  }
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function renderOutline(profile) {
  const outline = $('#outline');
  outline.replaceChildren();
  if (!profile) {
    const empty = element('div', 'empty-state');
    empty.append(element('span', 'empty-rule'), element('h3', '', 'Select a client'),
      element('p', '', 'The exercise outline will appear here for review during the visit.'));
    outline.append(empty);
    return;
  }
  const head = element('header', 'outline-head');
  head.append(element('p', 'section-label', 'HEP reference'), element('h3', '', profile.firstName || profile.label));
  const details = element('div', 'outline-details');
  const initials = element('div', 'outline-detail');
  initials.append(element('span', 'outline-detail-label', 'Initials'), element('strong', '', profile.label));
  const endDate = element('div', 'outline-detail order-end');
  endDate.append(element('span', 'outline-detail-label', 'Procura order end'),
    element('strong', '', profile.orderEndDate || 'Not recorded'));
  details.append(initials, endDate);
  head.append(details);
  if (profile.revised) head.append(element('p', '', `Source updated ${profile.revised}`));
  outline.append(head);
  for (const section of profile.sections) {
    const group = element('section', 'program-section');
    group.append(element('h4', '', section.heading));
    for (const item of section.items || []) {
      if (item.kind === 'note') { group.append(element('p', 'program-note', item.text)); continue; }
      const row = element('div', 'exercise');
      row.append(element('p', 'exercise-name', item.name));
      row.append(element('p', 'exercise-prescription', item.prescription || 'See treatment plan'));
      if (item.note) row.append(element('p', 'exercise-note', item.note));
      group.append(row);
    }
    outline.append(group);
  }
}

function renderLibrary() {
  if (!library) return;
  const list = $('#profile-list');
  list.replaceChildren();
  const query = $('#profile-search').value.trim().toLowerCase();
  const profiles = [...library.profiles].sort((a, b) => a.label.localeCompare(b.label));
  for (const profile of profiles.filter((item) => item.label.toLowerCase().includes(query))) {
    const button = element('button', '', profile.id === library.inProgressId ? `${profile.label} · In progress` : profile.label);
    button.type = 'button';
    button.setAttribute('aria-current', profile.id === selectedId ? 'true' : 'false');
    button.addEventListener('click', () => {
      selectedId = profile.id;
      sessionStorage.setItem('bayshore-hep-selected-id', selectedId);
      renderLibrary();
    });
    list.append(button);
  }
  if (!list.children.length) list.append(element('p', 'status', 'No matching initials.'));
  renderOutline(profiles.find((profile) => profile.id === selectedId));
}

$('#unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!envelope) { setStatus($('#unlock-status'), 'Import an encrypted library first.', true); return; }
  const passphrase = $('#passphrase').value;
  setStatus($('#unlock-status'), 'Opening encrypted library…');
  try {
    library = await decryptBundle(envelope, passphrase);
    passphraseInMemory = passphrase;
    $('#passphrase').value = '';
    $('#unlock-view').hidden = true;
    $('#library-view').hidden = false;
    $('#lock-button').hidden = false;
    renderLibrary();
    setStatus($('#library-status'), `${library.profiles.length} outlines ready.`);
  } catch {
    setStatus($('#unlock-status'), 'Could not open the library. Check the passphrase and file.', true);
  }
});

$('#bundle-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const candidate = JSON.parse(await file.text());
    if (!validEnvelope(candidate)) throw new Error('Unsupported file.');
    envelope = candidate;
    localStorage.setItem(CACHE_KEY, JSON.stringify(candidate));
    setStatus($('#unlock-status'), 'Encrypted file loaded. Enter its passphrase.');
  } catch {
    setStatus($('#unlock-status'), 'This file is not a supported encrypted HEP bundle.', true);
  }
});

$('#lock-button').addEventListener('click', () => {
  library = null;
  passphraseInMemory = '';
  $('#profile-search').value = '';
  $('#library-view').hidden = true;
  $('#unlock-view').hidden = false;
  $('#lock-button').hidden = true;
  setStatus($('#unlock-status'), 'Library locked.');
});
$('#profile-search').addEventListener('input', renderLibrary);
$('#refresh-button').addEventListener('click', refreshEnvelope);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
refreshEnvelope();
