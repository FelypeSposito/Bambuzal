// Lógica principal do app. Roda dentro da janela do Electron.
// Usa o SDK "livekit-client" para voz, vídeo (compartilhamento de tela)
// e mensagens de texto (via "data channel" do LiveKit).

const { ipcRenderer } = require('electron');
const { Room, RoomEvent, Track } = require('livekit-client');

const $ = (id) => document.getElementById(id);

// ---------- Referências de elementos ----------

const joinScreen = $('join-screen');
const mainScreen = $('main-screen');

const joinForm = $('join-form');
const serverUrlInput = $('server-url');
const roomNameInput = $('room-name');
const userNameInput = $('user-name');
const roomPasswordInput = $('room-password');
const joinBtn = $('join-btn');
const joinError = $('join-error');
const serverPeek = $('server-peek');
const advanced = $('advanced');

const titlebarRoom = $('titlebar-room');
const currentRoomNameEl = $('current-room-name');
const participantsList = $('participants-list');
const participantCount = $('participant-count');

const stage = $('stage');
const tiles = $('tiles');
const shareView = $('share-view');
const shareBar = $('share-bar');
const stageBadgeText = $('stage-badge-text');
const fullscreenBtn = $('fullscreen-btn');
const streamVolWrap = $('stream-vol-wrap');
const streamVolBtn = $('stream-vol-btn');
const streamVol = $('stream-vol');
const streamVolValue = $('stream-vol-value');

const micBtn = $('mic-btn');
const screenshareBtn = $('screenshare-btn');
const settingsBtn = $('settings-btn');
const leaveBtn = $('leave-btn');

const chat = $('chat');
const chatToggle = $('chat-toggle');
const chatUnread = $('chat-unread');
const chatMessages = $('chat-messages');
const chatForm = $('chat-form');
const chatText = $('chat-text');
const sendBtn = $('send-btn');
const typingEl = $('typing');
const typingText = $('typing-text');

const reconnectBanner = $('reconnect-banner');

const sourcePicker = $('source-picker');
const sourceGrid = $('source-grid');
const sourceEmpty = $('source-empty');
const cancelPicker = $('cancel-picker');
const closePicker = $('close-picker');
const confirmPicker = $('confirm-picker');
const pickerSelection = $('picker-selection');
const segmented = document.querySelector('.segmented');
const qualitySelect = $('quality-select');
const modeSelect = $('mode-select');
const shareAudioToggle = $('share-audio');
const shareAudioHint = $('share-audio-hint');

const settingsDialog = $('settings-dialog');
const closeSettings = $('close-settings');
const closeSettings2 = $('close-settings-2');
const displayNameInput = $('display-name');
const saveNameBtn = $('save-name');
const micSelect = $('mic-select');
const speakerSelect = $('speaker-select');
const micMeter = $('mic-meter');
const micGain = $('mic-gain');
const micGainValue = $('mic-gain-value');
const outputVolume = $('output-volume');
const outputVolumeValue = $('output-volume-value');
const optNoise = $('opt-noise');
const optEcho = $('opt-echo');
const optAgc = $('opt-agc');
const settingsStatus = $('settings-status');

const confirmDialog = $('confirm-dialog');
const confirmTitle = $('confirm-title');
const confirmText = $('confirm-text');
const confirmOk = $('confirm-ok');
const confirmCancel = $('confirm-cancel');

const toastWrap = $('toast-wrap');
const netPanel = $('net-panel');
const netToggle = $('net-toggle');
const netBars = $('net-bars');
const netLabel = $('net-label');

// ---------- Estado ----------

let room = null;
let micEnabled = true;
let isSharingScreen = false;
let myUsername = '';
let localScreenStream = null;

let allSources = [];
let activeTab = 'screen';
let selectedSourceId = null;
let onConfirmAccept = null;

let lastChatAuthor = null;
let unreadCount = 0;
const typingUntil = new Map();
let lastTypingSent = 0;

let gainCtx = null;

// Transmissões ativas, incluindo a própria. A chave é 'local' ou o sid
// do participante remoto.
const shares = new Map();
let activeShareKey = null;

const LAST_USED_KEY = 'voicechat.lastUsed';
const SETTINGS_KEY = 'voicechat.settings';
const SHARE_PREFS_KEY = 'voicechat.sharePrefs';

const settings = {
  micId: '', spkId: '',
  gain: 1, outVolume: 1,
  noise: true, echo: true, agc: true,
  chatCollapsed: false,
  peers: {},          // identidade -> { volume, gate }
  streamVolume: 1,
};

// ============================================================
// Utilidades
// ============================================================

const icon = (name, cls = 'ic ic-sm') => `<svg class="${cls}"><use href="#${name}" /></svg>`;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' err' : ''}`;
  el.innerHTML = `${icon(isError ? 'ic-alert' : 'ic-check')}<span>${escapeHtml(message)}</span>`;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function showError(message) {
  joinError.innerHTML = `${icon('ic-alert')}<span>${escapeHtml(message)}</span>`;
  joinError.classList.remove('hidden');
  joinError.style.animation = 'none';
  void joinError.offsetWidth;
  joinError.style.animation = '';
}

function clearError() {
  joinError.classList.add('hidden');
  joinError.textContent = '';
}

const AVATAR_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a'];

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// O nome exibido pode mudar em tempo real; a identidade do token, não.
const displayName = (p) => p?.name || p?.identity || 'sem nome';

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Preferências por pessoa, guardadas pela identidade (que é estável,
// ao contrário do nome de exibição e do sid)
function peerPrefs(identity) {
  if (!settings.peers[identity]) settings.peers[identity] = { volume: 1, gate: false };
  return settings.peers[identity];
}

// ---------- Camada de modais ----------

const openModals = [];

function openModal(el, onClose) {
  el.classList.remove('hidden', 'closing');
  openModals.push({ el, onClose });
  const target = el.querySelector('.btn-primary:not(:disabled), .btn');
  if (target) target.focus();
}

function closeModal(el) {
  const i = openModals.findIndex((m) => m.el === el);
  if (i === -1) return;
  const [entry] = openModals.splice(i, 1);

  el.classList.add('closing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.classList.add('hidden');
    el.classList.remove('closing');
    if (entry.onClose) entry.onClose();
  };
  el.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 400); // rede de segurança se a animação não disparar
}

function closeTopModal() {
  if (!openModals.length) return false;
  closeModal(openModals[openModals.length - 1].el);
  return true;
}

for (const backdrop of document.querySelectorAll('.backdrop')) {
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModal(backdrop);
  });
}

function askConfirm({ title, text, okLabel, danger = true, onAccept }) {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  confirmOk.textContent = okLabel;
  confirmOk.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  onConfirmAccept = onAccept;
  openModal(confirmDialog);
}

confirmCancel.addEventListener('click', () => closeModal(confirmDialog));
confirmOk.addEventListener('click', () => {
  const fn = onConfirmAccept;
  onConfirmAccept = null;
  closeModal(confirmDialog);
  if (fn) fn();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (closeTopModal()) e.preventDefault();
    else if (streamVolWrap.classList.contains('open')) streamVolWrap.classList.remove('open');
    else if (document.fullscreenElement) document.exitFullscreen();
    return;
  }

  if (e.key === 'Enter' && openModals.length) {
    const top = openModals[openModals.length - 1].el;
    const primary = top.querySelector('.btn-primary:not(:disabled), .btn-danger:not(:disabled)');
    if (primary && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      primary.click();
    }
    return;
  }

  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (typing || openModals.length || !room) return;

  if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMic(); }
  if (e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.key === 'f' || e.key === 'F') && activeShareKey) { e.preventDefault(); toggleFullscreen(); }
});

function switchScreen(from, to) {
  from.classList.add('leaving');
  setTimeout(() => {
    from.classList.add('hidden');
    from.classList.remove('leaving');
    to.classList.remove('hidden');
    to.style.animation = 'none';
    void to.offsetWidth;
    to.style.animation = '';
  }, 240);
}

// ============================================================
// Entrar na sala
// ============================================================

try {
  const saved = JSON.parse(localStorage.getItem(LAST_USED_KEY) || '{}');
  if (saved.username) userNameInput.value = saved.username;
  if (saved.room) roomNameInput.value = saved.room;
  if (saved.serverUrl) serverUrlInput.value = saved.serverUrl;
  // Senha da sala é combinada do grupo, não credencial pessoal: guardar
  // localmente evita que todo mundo redigite a cada entrada.
  if (saved.password) roomPasswordInput.value = saved.password;
} catch { /* preferências corrompidas não podem impedir o app de abrir */ }

try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  if (!settings.peers) settings.peers = {};
} catch { /* idem */ }

function updateServerPeek() {
  try { serverPeek.textContent = new URL(serverUrlInput.value.trim()).host; }
  catch { serverPeek.textContent = ''; }
}
serverUrlInput.addEventListener('input', updateServerPeek);
updateServerPeek();

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const roomName = roomNameInput.value.trim();
  const username = userNameInput.value.trim();
  const password = roomPasswordInput.value;

  clearError();

  if (!username)  return showError('Digite o seu nome.');
  if (!roomName)  return showError('Digite o nome da sala.');
  if (!serverUrl) { advanced.open = true; return showError('Informe o endereço do servidor de tokens.'); }

  joinBtn.classList.add('loading');
  joinBtn.disabled = true;
  joinBtn.querySelector('.btn-label').textContent = 'Entrando…';

  try {
    const res = await fetch(`${serverUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: roomName, username, password }),
    });

    if (!res.ok) {
      // O servidor manda o motivo em JSON; mostrar ele é bem mais útil
      // do que um código de status solto na tela.
      const detail = await res.json().catch(() => null);
      throw new Error(
        detail?.error || `O servidor de tokens respondeu ${res.status}. Confira se ele está rodando.`
      );
    }

    const { token, url } = await res.json();
    myUsername = username;

    await connectToRoom(url, token, roomName);

    localStorage.setItem(LAST_USED_KEY, JSON.stringify({
      username, room: roomName, serverUrl, password,
    }));

    switchScreen(joinScreen, mainScreen);
    setTimeout(() => chatText.focus(), 320);
    toast(`Você entrou em #${roomName}`);
  } catch (err) {
    console.error(err);
    showError(err.message === 'Failed to fetch'
      ? 'Não foi possível falar com o servidor de tokens. Ele está rodando nesse endereço?'
      : err.message);
  } finally {
    joinBtn.classList.remove('loading');
    joinBtn.disabled = false;
    joinBtn.querySelector('.btn-label').textContent = 'Entrar na sala';
  }
});

async function connectToRoom(url, token, roomName) {
  room = new Room({ adaptiveStream: true, dynacast: true });

  currentRoomNameEl.textContent = roomName;
  titlebarRoom.textContent = `#${roomName}`;
  titlebarRoom.classList.remove('hidden');

  room
    .on(RoomEvent.ParticipantConnected, (p) => {
      syncParticipants();
      addSystemMessage(`${displayName(p)} entrou`);
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      removeShare(p.sid);
      syncParticipants();
      addSystemMessage(`${displayName(p)} saiu`);
    })
    .on(RoomEvent.ParticipantNameChanged, () => { syncParticipants(); renderShareBar(); })
    .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    .on(RoomEvent.TrackMuted, syncParticipants)
    .on(RoomEvent.TrackUnmuted, syncParticipants)
    .on(RoomEvent.DataReceived, handleDataReceived)
    .on(RoomEvent.Disconnected, handleDisconnected)
    .on(RoomEvent.ActiveSpeakersChanged, syncParticipants)
    .on(RoomEvent.ConnectionQualityChanged, handleQualityChanged)
    .on(RoomEvent.Reconnecting, () => reconnectBanner.classList.remove('hidden'))
    .on(RoomEvent.Reconnected, () => {
      reconnectBanner.classList.add('hidden');
      toast('Reconectado');
    });

  await room.connect(url, token);
  await applyMicSettings({ silent: true });

  displayNameInput.value = displayName(room.localParticipant);
  renderStage();
  syncParticipants();
  renderChatEmptyState();
  startStatsLoop();
  startLevelLoop();
}

// ============================================================
// Participantes
// ============================================================

// Reconciliação por chave: elementos existentes são atualizados no
// lugar, nunca recriados. Sem isso, cada re-render reiniciaria as
// animações e o anel de voz piscaria a cada evento do SDK.
function reconcile(container, items, create, update) {
  const alive = new Set();

  items.forEach((p, index) => {
    const key = p.sid || p.identity;
    alive.add(key);

    let el = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!el) {
      el = create(p);
      el.dataset.key = key;
      container.appendChild(el);
    }
    el.style.order = String(index);
    update(el, p);
  });

  for (const el of [...container.children]) {
    // Painéis auxiliares (como o de áudio por pessoa) não têm chave e
    // não são participantes — a reconciliação não pode removê-los
    if (!el.dataset.key) continue;

    if (!alive.has(el.dataset.key) && !el.classList.contains('leaving')) {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 280);
    }
  }
}

function micOnFor(p) {
  try { return p.isMicrophoneEnabled; } catch { return true; }
}

function makeRow(p) {
  const el = document.createElement('div');
  el.className = 'participant';
  el.innerHTML = `
    <span class="av"><span class="av-ring"></span><span class="ini"></span></span>
    <span class="name"></span>
    <span class="mute-slot"></span>
    <button class="vol-btn" type="button" title="Áudio desta pessoa" aria-label="Áudio desta pessoa">
      ${icon('ic-speaker')}
    </button>
  `;

  // O painel de áudio individual fica logo abaixo da linha
  const isLocal = room && p === room.localParticipant;
  if (!isLocal) {
    el.querySelector('.vol-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePeerPanel(el, p);
    });
  } else {
    el.querySelector('.vol-btn').remove();
  }

  return el;
}

function updateRow(el, p) {
  const name = displayName(p);
  const isLocal = room && p === room.localParticipant;

  el.classList.toggle('speaking', Boolean(p.isSpeaking));
  el.querySelector('.av').style.background = colorFor(name);
  el.querySelector('.ini').textContent = initialsOf(name);
  el.querySelector('.name').textContent = name + (isLocal ? ' (você)' : '');

  const slot = el.querySelector('.mute-slot');
  const muted = !micOnFor(p);
  if (muted && !slot.firstChild) slot.innerHTML = `<span class="muted-ic">${icon('ic-mic-off')}</span>`;
  if (!muted && slot.firstChild) slot.innerHTML = '';

  if (!isLocal) {
    const prefs = peerPrefs(p.identity);
    el.classList.toggle('turned-down', prefs.volume !== 1 || prefs.gate);
  }
}

function makeTile() {
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <div class="tile-av"><span class="tile-ring"></span><span class="ini"></span></div>
    <div class="tile-foot"><span class="nm"></span><span class="mute-slot"></span></div>
  `;
  return el;
}

function updateTile(el, p) {
  const name = displayName(p);
  const isLocal = room && p === room.localParticipant;

  el.classList.toggle('speaking', Boolean(p.isSpeaking));
  el.querySelector('.tile-av').style.background = colorFor(name);
  el.querySelector('.ini').textContent = initialsOf(name);
  el.querySelector('.nm').textContent = name + (isLocal ? ' (você)' : '');

  const slot = el.querySelector('.mute-slot');
  const muted = !micOnFor(p);
  if (muted && !slot.firstChild) slot.innerHTML = `<span class="muted-ic">${icon('ic-mic-off')}</span>`;
  if (!muted && slot.firstChild) slot.innerHTML = '';
}

let lastCount = 0;

function syncParticipants() {
  if (!room) return;

  const all = [room.localParticipant, ...room.remoteParticipants.values()];

  if (all.length !== lastCount) {
    lastCount = all.length;
    participantCount.textContent = String(all.length);
    participantCount.classList.add('bump');
    setTimeout(() => participantCount.classList.remove('bump'), 320);
  }

  reconcile(participantsList, all, makeRow, updateRow);
  reconcile(tiles, all, makeTile, updateTile);
}

// ---------- Painel de áudio por pessoa ----------

function closePeerPanels() {
  participantsList.querySelectorAll('.peer-panel').forEach((n) => n.remove());
  participantsList.querySelectorAll('.vol-open').forEach((n) => n.classList.remove('vol-open'));
}

function togglePeerPanel(rowEl, participant) {
  const alreadyOpen = rowEl.classList.contains('vol-open');
  closePeerPanels();
  if (alreadyOpen) return;

  const prefs = peerPrefs(participant.identity);
  const pct = Math.round(prefs.volume * 100);

  const panel = document.createElement('div');
  panel.className = 'peer-panel';
  // A linha é posicionada por "order", então o painel precisa do mesmo
  // valor para ficar logo abaixo da pessoa certa
  panel.style.order = rowEl.style.order;
  panel.innerHTML = `
    <div class="peer-row">
      <input class="range" type="range" min="0" max="150" value="${pct}" />
      <span class="range-value">${pct}%</span>
    </div>
    <label class="switch gate-switch">
      <input type="checkbox" ${prefs.gate ? 'checked' : ''} />
      <span class="track"><span class="knob"></span></span>
      <span class="switch-label">Supressão de ruído</span>
    </label>
  `;

  const range = panel.querySelector('.range');
  const value = panel.querySelector('.range-value');
  const gate = panel.querySelector('.gate-switch input');

  const markRow = () =>
    rowEl.classList.toggle('turned-down', prefs.volume !== 1 || prefs.gate);

  range.addEventListener('input', () => {
    prefs.volume = Number(range.value) / 100;
    value.textContent = `${range.value}%`;
    applyPeerVolume(participant);
    markRow();
  });
  range.addEventListener('change', saveSettings);

  gate.addEventListener('change', () => {
    prefs.gate = gate.checked;
    saveSettings();
    applyPeerAudio(participant);
    markRow();
    toast(`Supressão de ruído ${prefs.gate ? 'ligada' : 'desligada'} para ${displayName(participant)}`);
  });

  rowEl.classList.add('vol-open');
  rowEl.after(panel);
}

// ============================================================
// Cadeia de áudio por participante
// ============================================================
//
// Cada pessoa pode ter volume e supressão de ruído próprios. Quando a
// supressão está desligada, deixamos o SDK tocar a faixa direto e o
// volume vai pelo setVolume dele — caminho mais simples e barato.
// Quando está ligada, montamos uma cadeia de Web Audio:
//
//   faixa → passa-alta (corta zumbido) → portão → ganho → saída
//
// O portão mede o volume instantâneo e fecha abaixo de um limiar, o
// que elimina ventilador, teclado e chiado constante nas pausas. Não é
// o mesmo que a supressão do WebRTC (que roda na captura, do outro
// lado), mas é o que dá para fazer sobre uma faixa já recebida.

const chains = new Map();   // identidade -> { ctx, gate, vol, analyser, el, data }

function audioElFor(participant) {
  return document.querySelector(`audio[data-owner="${CSS.escape(participant.identity)}"]`);
}

function applyPeerVolume(participant) {
  const prefs = peerPrefs(participant.identity);
  const effective = prefs.volume * settings.outVolume;
  const chain = chains.get(participant.identity);

  if (chain) {
    chain.vol.gain.setTargetAtTime(effective, chain.ctx.currentTime, 0.02);
  } else {
    try { participant.setVolume(effective); } catch { /* SDK sem esse método */ }
  }
}

function applyPeerAudio(participant) {
  const prefs = peerPrefs(participant.identity);
  const el = audioElFor(participant);
  if (!el) return;

  if (prefs.gate) buildChain(participant, el);
  else destroyChain(participant.identity);

  applyPeerVolume(participant);
}

function buildChain(participant, el) {
  if (chains.get(participant.identity)) return;

  const stream = el.srcObject;
  const track = stream?.getAudioTracks?.()[0];
  if (!track) return;

  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 90;   // abaixo disso é quase só zumbido

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;

    const gate = ctx.createGain();
    const vol = ctx.createGain();

    src.connect(highpass);
    highpass.connect(analyser);
    highpass.connect(gate);
    gate.connect(vol);
    vol.connect(ctx.destination);

    // O elemento do SDK continua existindo, mas em silêncio: quem toca
    // agora é a cadeia. Sem isto, o áudio sairia duas vezes.
    el.muted = true;

    chains.set(participant.identity, {
      ctx, gate, vol, analyser,
      el,
      data: new Float32Array(analyser.fftSize),
      open: true,
    });
  } catch (err) {
    console.error('Não foi possível montar a cadeia de áudio:', err);
  }
}

function destroyChain(identity) {
  const chain = chains.get(identity);
  if (!chain) return;
  chains.delete(identity);
  chain.el.muted = false;
  chain.ctx.close().catch(() => {});
}

// Um único laço cuida de todos os portões abertos
const GATE_OPEN = 0.014;    // acima disso é voz
const GATE_CLOSE = 0.008;   // abaixo disso é ruído de fundo

function runGates() {
  for (const [, chain] of chains) {
    const { analyser, data, gate, ctx } = chain;
    analyser.getFloatTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    // Histerese: limiares diferentes para abrir e fechar, senão o
    // portão ficaria batendo em volumes próximos do limite.
    if (chain.open && rms < GATE_CLOSE) chain.open = false;
    else if (!chain.open && rms > GATE_OPEN) chain.open = true;

    // Fechar devagar e abrir rápido: cortar o começo de uma palavra
    // incomoda muito mais do que deixar escapar um pouco de ruído.
    gate.gain.setTargetAtTime(chain.open ? 1 : 0, ctx.currentTime, chain.open ? 0.01 : 0.12);
  }
}

// ---------- Anéis de voz, quadro a quadro ----------

let levelRaf = null;
const smoothed = new Map();

function startLevelLoop() {
  cancelAnimationFrame(levelRaf);

  const tick = () => {
    if (!room) return;

    runGates();

    const all = [room.localParticipant, ...room.remoteParticipants.values()];
    for (const p of all) {
      const key = p.sid || p.identity;
      const target = micOnFor(p) ? (p.audioLevel || 0) : 0;

      // Suavização exponencial: o valor bruto do SDK oscila muito e
      // faria o anel tremer em vez de pulsar.
      const prev = smoothed.get(key) || 0;
      const next = prev + (target - prev) * (target > prev ? 0.55 : 0.12);
      smoothed.set(key, next);

      const value = next.toFixed(3);
      for (const el of document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`)) {
        el.style.setProperty('--level', value);
      }

      if (p === room.localParticipant) {
        micBtn.style.setProperty('--level', value);
        micMeter.style.setProperty('--level', Math.min(1, next * 1.6).toFixed(3));
      }
    }

    levelRaf = requestAnimationFrame(tick);
  };

  levelRaf = requestAnimationFrame(tick);
}

function stopLevelLoop() {
  cancelAnimationFrame(levelRaf);
  levelRaf = null;
  smoothed.clear();
  micBtn.style.setProperty('--level', '0');
  micMeter.style.setProperty('--level', '0');
}

// ============================================================
// Microfone
// ============================================================

function setMicButton(on) {
  micBtn.classList.toggle('on', on);
  micBtn.classList.toggle('off', !on);
  micBtn.querySelector('use').setAttribute('href', on ? '#ic-mic' : '#ic-mic-off');
  micBtn.title = on ? 'Desligar microfone (M)' : 'Ligar microfone (M)';
}

async function toggleMic() {
  if (!room) return;
  micEnabled = !micEnabled;
  await room.localParticipant.setMicrophoneEnabled(micEnabled);
  setMicButton(micEnabled);
  syncParticipants();
  toast(micEnabled ? 'Microfone ligado' : 'Microfone desligado');
}

micBtn.addEventListener('click', toggleMic);

// Publica (ou republica) o microfone com os ajustes atuais. O SDK
// continua dono da faixa — o que garante que mudo, estado e indicador
// de voz sigam funcionando. O ganho entra depois, por cima.
async function applyMicSettings({ silent = false } = {}) {
  if (!room) return;

  disposeGainChain();

  const capture = {
    noiseSuppression: settings.noise,
    echoCancellation: settings.echo,
    autoGainControl: settings.agc,
  };
  if (settings.micId) capture.deviceId = { exact: settings.micId };

  try {
    await room.localParticipant.setMicrophoneEnabled(false);
    await room.localParticipant.setMicrophoneEnabled(true, capture);
    micEnabled = true;
    setMicButton(true);

    if (settings.gain !== 1) await applyGain();
    if (!silent) toast('Microfone atualizado');
  } catch (err) {
    console.error('Falha ao aplicar ajustes do microfone:', err);
    if (!silent) toast('Não consegui usar esse microfone.', true);
    // Volta para o dispositivo padrão, senão o usuário fica sem voz
    if (settings.micId) {
      settings.micId = '';
      saveSettings();
      try { await room.localParticipant.setMicrophoneEnabled(true, { ...capture, deviceId: undefined }); } catch {}
    }
  }

  syncParticipants();
}

async function applyGain() {
  const pub = [...room.localParticipant.trackPublications.values()]
    .find((p) => p.source === Track.Source.Microphone);
  if (!pub?.track?.mediaStreamTrack) return;

  try {
    gainCtx = new AudioContext();
    const source = gainCtx.createMediaStreamSource(new MediaStream([pub.track.mediaStreamTrack]));
    const node = gainCtx.createGain();
    node.gain.value = settings.gain;
    const dest = gainCtx.createMediaStreamDestination();
    source.connect(node).connect(dest);

    // O segundo argumento avisa o SDK que a faixa é nossa, e que ele
    // não deve tentar gerenciar o ciclo de vida dela sozinho.
    await pub.track.replaceTrack(dest.stream.getAudioTracks()[0], true);
  } catch (err) {
    console.error('Não foi possível aplicar ganho:', err);
    disposeGainChain();
  }
}

function disposeGainChain() {
  if (gainCtx) {
    gainCtx.close().catch(() => {});
    gainCtx = null;
  }
}

// ============================================================
// Configurações
// ============================================================

async function populateDevices() {
  const fill = (select, devices, current, fallbackLabel) => {
    select.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Padrão do sistema';
    select.appendChild(auto);

    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      // Sem permissão concedida o label vem vazio; um rótulo genérico
      // é melhor do que uma lista de opções em branco.
      opt.textContent = d.label || `${fallbackLabel} ${i + 1}`;
      select.appendChild(opt);
    });

    select.value = devices.some((d) => d.deviceId === current) ? current : '';
  };

  try {
    const [mics, speakers] = await Promise.all([
      Room.getLocalDevices('audioinput', true),
      Room.getLocalDevices('audiooutput', false),
    ]);
    fill(micSelect, mics, settings.micId, 'Microfone');
    fill(speakerSelect, speakers, settings.spkId, 'Saída');
  } catch (err) {
    console.error('Falha ao listar dispositivos:', err);
    settingsStatus.textContent = 'Não consegui listar os dispositivos.';
  }
}

function openSettings() {
  if (!room) return;
  displayNameInput.value = displayName(room.localParticipant);
  settingsStatus.textContent = '';
  micGain.value = String(Math.round(settings.gain * 100));
  micGainValue.textContent = `${micGain.value}%`;
  outputVolume.value = String(Math.round(settings.outVolume * 100));
  outputVolumeValue.textContent = `${outputVolume.value}%`;
  optNoise.checked = settings.noise;
  optEcho.checked = settings.echo;
  optAgc.checked = settings.agc;
  populateDevices();
  openModal(settingsDialog);
}

settingsBtn.addEventListener('click', openSettings);
closeSettings.addEventListener('click', () => closeModal(settingsDialog));
closeSettings2.addEventListener('click', () => closeModal(settingsDialog));

async function saveDisplayName() {
  const name = displayNameInput.value.trim();
  if (!room || !name) return;

  saveNameBtn.disabled = true;
  try {
    await room.localParticipant.setName(name);
    myUsername = name;
    syncParticipants();
    renderShareBar();
    settingsStatus.textContent = 'Nome atualizado.';
    toast('Nome atualizado');
  } catch (err) {
    console.error(err);
    settingsStatus.textContent = 'O servidor não autorizou a troca de nome.';
  } finally {
    saveNameBtn.disabled = false;
  }
}

saveNameBtn.addEventListener('click', saveDisplayName);
displayNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveDisplayName(); }
});

micSelect.addEventListener('change', () => {
  settings.micId = micSelect.value;
  saveSettings();
  applyMicSettings();
});

speakerSelect.addEventListener('change', async () => {
  settings.spkId = speakerSelect.value;
  saveSettings();
  try {
    await room.switchActiveDevice('audiooutput', settings.spkId || 'default');
    toast('Saída de áudio alterada');
  } catch (err) {
    console.error(err);
    toast('Não consegui usar essa saída.', true);
  }
});

// Ganho: aplica só ao soltar o controle, para não republicar a faixa
// a cada pixel arrastado
micGain.addEventListener('input', () => { micGainValue.textContent = `${micGain.value}%`; });
micGain.addEventListener('change', () => {
  settings.gain = Number(micGain.value) / 100;
  saveSettings();
  applyMicSettings();
});

function applyOutputVolume() {
  if (!room) return;
  for (const p of room.remoteParticipants.values()) applyPeerVolume(p);
}

outputVolume.addEventListener('input', () => {
  settings.outVolume = Number(outputVolume.value) / 100;
  outputVolumeValue.textContent = `${outputVolume.value}%`;
  applyOutputVolume();
});
outputVolume.addEventListener('change', saveSettings);

for (const [el, key] of [[optNoise, 'noise'], [optEcho, 'echo'], [optAgc, 'agc']]) {
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    saveSettings();
    applyMicSettings();
  });
}

// ============================================================
// Compartilhamento de tela
// ============================================================

try {
  const prefs = JSON.parse(localStorage.getItem(SHARE_PREFS_KEY) || '{}');
  if (prefs.quality) qualitySelect.value = prefs.quality;
  if (prefs.mode) modeSelect.value = prefs.mode;
  if (typeof prefs.audio === 'boolean') shareAudioToggle.checked = prefs.audio;
} catch { /* idem */ }

function saveSharePrefs() {
  localStorage.setItem(SHARE_PREFS_KEY, JSON.stringify({
    quality: qualitySelect.value, mode: modeSelect.value, audio: shareAudioToggle.checked,
  }));
}
qualitySelect.addEventListener('change', saveSharePrefs);
modeSelect.addEventListener('change', saveSharePrefs);
shareAudioToggle.addEventListener('change', saveSharePrefs);

screenshareBtn.addEventListener('click', async () => {
  if (!room) return;

  if (isSharingScreen) {
    askConfirm({
      title: 'Parar de compartilhar?',
      text: 'As outras pessoas vão deixar de ver a sua tela.',
      okLabel: 'Parar',
      onAccept: stopScreenShare,
    });
    return;
  }

  try {
    allSources = await ipcRenderer.invoke('get-screen-sources');
  } catch (err) {
    console.error(err);
    toast('Não consegui listar as telas disponíveis.', true);
    return;
  }

  selectedSourceId = null;
  activeTab = allSources.some((s) => s.id.startsWith('screen:')) ? 'screen' : 'window';
  renderTabs();
  renderSourceGrid();
  updatePickerFooter();
  openModal(sourcePicker);
});

function renderTabs() {
  const screens = allSources.filter((s) => s.id.startsWith('screen:')).length;
  $('count-screen').textContent = screens ? `(${screens})` : '';
  $('count-window').textContent = allSources.length - screens ? `(${allSources.length - screens})` : '';

  segmented.dataset.tab = activeTab;
  for (const seg of document.querySelectorAll('.seg')) {
    seg.classList.toggle('active', seg.dataset.tab === activeTab);
  }
}

function renderSourceGrid() {
  const isScreen = activeTab === 'screen';
  const list = allSources.filter((s) => s.id.startsWith('screen:') === isScreen);

  sourceGrid.innerHTML = '';
  sourceEmpty.classList.toggle('hidden', list.length > 0);

  list.forEach((source, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'source-card' + (source.id === selectedSourceId ? ' selected' : '');
    card.dataset.id = source.id;
    // Cascata curta: as miniaturas aparecem uma depois da outra
    card.style.animationDelay = `${Math.min(i * 35, 280)}ms`;
    card.innerHTML = `
      <div class="source-thumb">
        ${source.thumbnailDataUrl
          ? `<img src="${source.thumbnailDataUrl}" alt="" />`
          : `<span class="placeholder">${icon(isScreen ? 'ic-display' : 'ic-window', 'ic ic-lg')}</span>`}
        <span class="source-check">${icon('ic-check')}</span>
      </div>
      <div class="source-name">
        ${icon(isScreen ? 'ic-display' : 'ic-window')}
        <span title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      selectedSourceId = source.id;
      for (const c of sourceGrid.children) c.classList.toggle('selected', c.dataset.id === selectedSourceId);
      updatePickerFooter();
    });
    card.addEventListener('dblclick', () => {
      selectedSourceId = source.id;
      confirmPicker.click();
    });

    sourceGrid.appendChild(card);
  });
}

function updatePickerFooter() {
  const chosen = allSources.find((s) => s.id === selectedSourceId);
  confirmPicker.disabled = !chosen;
  pickerSelection.textContent = chosen ? chosen.name : 'Nada selecionado';
}

for (const seg of document.querySelectorAll('.seg')) {
  seg.addEventListener('click', () => {
    activeTab = seg.dataset.tab;
    renderTabs();
    renderSourceGrid();
  });
}

cancelPicker.addEventListener('click', () => closeModal(sourcePicker));
closePicker.addEventListener('click', () => closeModal(sourcePicker));
confirmPicker.addEventListener('click', () => {
  const id = selectedSourceId;
  closeModal(sourcePicker);
  if (id) startScreenShare(id);
});

// A qualidade é limitada em dois lugares independentes, e os dois
// precisam subir juntos: a CAPTURA (o que o Electron entrega) e a
// PUBLICAÇÃO (o que o LiveKit codifica e envia).
const SHARE_QUALITY = {
  '720p30':  { w: 1280, h: 720,  fps: 30, bitrate: 2500000 },
  '1080p30': { w: 1920, h: 1080, fps: 30, bitrate: 5000000 },
  '1080p60': { w: 1920, h: 1080, fps: 60, bitrate: 8000000 },
  '1440p60': { w: 2560, h: 1440, fps: 60, bitrate: 12000000 },
};

// Caminho legado: captura só vídeo, com controle fino de resolução.
// É o que já funcionava antes de existir a opção de áudio.
function captureVideoOnly(sourceId, q) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: q.w,
        maxHeight: q.h,
        maxFrameRate: q.fps,
      },
    },
  });
}

// Caminho com áudio: o loopback do sistema só pode ser concedido pelo
// processo principal, então avisamos qual fonte foi escolhida e
// deixamos o handler do main.js montar o stream.
async function captureWithAudio(sourceId, q) {
  await ipcRenderer.invoke('prepare-share', { id: sourceId, audio: true });
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { max: q.w }, height: { max: q.h }, frameRate: { max: q.fps } },
    audio: true,
  });
}

async function startScreenShare(sourceId) {
  const q = SHARE_QUALITY[qualitySelect.value] || SHARE_QUALITY['1080p30'];
  const degradationPreference = modeSelect.value;
  const wantAudio = shareAudioToggle.checked;

  let stream = null;
  let audioFailed = false;

  if (wantAudio) {
    try {
      stream = await captureWithAudio(sourceId, q);
      if (!stream.getAudioTracks().length) audioFailed = true;
    } catch (err) {
      console.error('Captura com áudio falhou, tentando sem:', err);
      audioFailed = true;
      stream = null;
    }
  }

  if (!stream) {
    try {
      stream = await captureVideoOnly(sourceId, q);
    } catch (err) {
      console.error('Erro ao compartilhar tela:', err);
      toast('Não foi possível compartilhar essa fonte.', true);
      return;
    }
  }

  try {
    const videoTrack = stream.getVideoTracks()[0];

    // Sem contentHint o Chromium trata captura de tela como "detalhe" e
    // sacrifica framerate pra preservar nitidez — é a causa mais comum
    // de compartilhamento a 2 fps.
    videoTrack.contentHint = degradationPreference === 'maintain-framerate' ? 'motion' : 'detail';

    await room.localParticipant.publishTrack(videoTrack, {
      source: Track.Source.ScreenShare,
      name: 'screen',
      // simulcast manda várias versões em resoluções menores ao mesmo
      // tempo; para tela isso rouba banda da camada boa sem ganho real
      simulcast: false,
      degradationPreference,
      // Para fonte de tela o SDK IGNORA videoEncoding e usa apenas
      // screenShareEncoding (ver computeVideoEncodings no livekit-client).
      // O padrão dele é h1080fps15 — daí o teto de 15 fps.
      screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: q.fps },
    });

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      await room.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.ScreenShareAudio,
        name: 'screen-audio',
      });
    }

    localScreenStream = stream;
    isSharingScreen = true;
    screenshareBtn.classList.add('on');
    screenshareBtn.title = 'Parar de compartilhar';

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;   // o próprio áudio já sai pelas caixas
    video.srcObject = new MediaStream([videoTrack]);

    addShare('local', {
      name: `${displayName(room.localParticipant)} (você)`,
      element: video,
      hasAudio: Boolean(audioTrack),
      participant: room.localParticipant,
    });

    videoTrack.addEventListener('ended', () => stopScreenShare());

    if (wantAudio && audioFailed) {
      toast('Compartilhando sem áudio: o sistema não liberou a captura.', true);
    } else {
      toast(`Compartilhando em ${qualitySelect.value.replace('p', 'p · ')} fps` +
            (audioTrack ? ' com áudio' : ''));
    }
  } catch (err) {
    console.error('Erro ao publicar a tela:', err);
    stream.getTracks().forEach((t) => t.stop());
    toast('Não foi possível publicar a transmissão.', true);
  }
}

async function stopScreenShare() {
  if (!room) return;

  for (const pub of room.localParticipant.trackPublications.values()) {
    const isShare = pub.source === Track.Source.ScreenShare ||
                    pub.source === Track.Source.ScreenShareAudio;
    if (isShare && pub.track) await room.localParticipant.unpublishTrack(pub.track);
  }

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
  }

  isSharingScreen = false;
  screenshareBtn.classList.remove('on');
  screenshareBtn.title = 'Compartilhar tela';

  removeShare('local');
  toast('Compartilhamento encerrado');
}

// ============================================================
// Palco: várias transmissões ao mesmo tempo
// ============================================================

function addShare(key, info) {
  shares.set(key, info);
  // Quem acabou de começar a transmitir vira o foco
  activeShareKey = key;
  renderStage();
}

function removeShare(key) {
  const share = shares.get(key);
  if (!share) return;

  share.element?.remove();
  shares.delete(key);

  if (activeShareKey === key) {
    activeShareKey = shares.size ? [...shares.keys()][0] : null;
  }
  renderStage();
}

function selectShare(key) {
  if (!shares.has(key) || activeShareKey === key) return;
  activeShareKey = key;
  renderStage();
}

function renderStage() {
  const share = activeShareKey ? shares.get(activeShareKey) : null;

  // Sem ninguém transmitindo: volta para a grade de participantes
  if (!share) {
    shareView.querySelectorAll('video').forEach((v) => v.remove());
    shareView.classList.add('hidden');
    tiles.classList.remove('dimmed');
    streamVolWrap.classList.remove('open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    renderShareBar();
    return;
  }

  // Só o vídeo em foco fica no DOM. Com adaptiveStream ligado, o
  // LiveKit pausa o recebimento das faixas que não estão sendo
  // exibidas — então as outras transmissões não gastam banda.
  const current = shareView.querySelector('video');
  if (current !== share.element) {
    shareView.querySelectorAll('video').forEach((v) => v.remove());
    shareView.insertBefore(share.element, shareView.firstChild);
    shareView.style.animation = 'none';
    void shareView.offsetWidth;
    shareView.style.animation = '';
  }

  stageBadgeText.textContent = share.name;
  shareView.classList.remove('hidden');
  tiles.classList.add('dimmed');

  // O controle de volume só faz sentido se a transmissão tiver som
  streamVolWrap.classList.toggle('hidden', !share.hasAudio || share.participant === room?.localParticipant);
  if (!share.hasAudio) streamVolWrap.classList.remove('open');

  renderShareBar();
}

function renderShareBar() {
  // Com uma transmissão só não há o que escolher
  if (shares.size < 2) {
    shareBar.classList.add('hidden');
    shareBar.innerHTML = '';
    return;
  }

  shareBar.innerHTML = '';
  for (const [key, share] of shares) {
    const name = share.participant ? displayName(share.participant) : share.name;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'share-chip' + (key === activeShareKey ? ' active' : '');
    chip.innerHTML = `
      <span class="dot" style="background:${colorFor(name)}">${escapeHtml(initialsOf(name))}</span>
      <span class="nm">${escapeHtml(share.name)}</span>
      ${share.hasAudio ? `<span class="audio-ic">${icon('ic-speaker')}</span>` : ''}
    `;
    chip.addEventListener('click', () => selectShare(key));
    shareBar.appendChild(chip);
  }
  shareBar.classList.remove('hidden');
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else stage.requestFullscreen().catch(() => {});
}

fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const on = Boolean(document.fullscreenElement);
  fullscreenBtn.querySelector('use').setAttribute('href', on ? '#ic-collapse' : '#ic-expand');
  fullscreenBtn.title = on ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)';
});

// Volume da transmissão em foco
streamVolBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  streamVolWrap.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!streamVolWrap.contains(e.target)) streamVolWrap.classList.remove('open');
});

streamVol.addEventListener('input', () => {
  settings.streamVolume = Number(streamVol.value) / 100;
  streamVolValue.textContent = `${streamVol.value}%`;
  applyStreamVolume();
});
streamVol.addEventListener('change', saveSettings);

function applyStreamVolume() {
  const share = activeShareKey ? shares.get(activeShareKey) : null;
  if (!share?.participant || share.participant === room?.localParticipant) return;
  try {
    share.participant.setVolume(settings.streamVolume, Track.Source.ScreenShareAudio);
  } catch { /* SDK sem esse método */ }
}

// ---------- Faixas recebidas ----------

function handleTrackSubscribed(track, publication, participant) {
  if (track.kind === Track.Kind.Video) {
    // O áudio da transmissão pode ter chegado antes do vídeo, então
    // não dá para assumir que ainda não existe
    const hasAudio = [...participant.trackPublications.values()]
      .some((pub) => pub.source === Track.Source.ScreenShareAudio && pub.isSubscribed);

    addShare(participant.sid, {
      name: `${displayName(participant)} está compartilhando`,
      element: track.attach(),
      hasAudio,
      participant,
    });
    return;
  }

  if (track.kind !== Track.Kind.Audio) return;

  const el = track.attach();
  el.dataset.owner = participant.identity;
  document.body.appendChild(el); // áudio não precisa aparecer na tela

  if (publication.source === Track.Source.ScreenShareAudio) {
    const share = shares.get(participant.sid);
    if (share) {
      share.hasAudio = true;
      renderStage();
    }
    applyStreamVolume();
  } else {
    // Microfone: aplica volume e supressão individuais desta pessoa
    applyPeerAudio(participant);
  }
}

function handleTrackUnsubscribed(track, publication, participant) {
  track.detach().forEach((el) => el.remove());

  if (track.kind === Track.Kind.Video) {
    removeShare(participant.sid);
  } else if (publication.source === Track.Source.ScreenShareAudio) {
    const share = shares.get(participant.sid);
    if (share) { share.hasAudio = false; renderStage(); }
  } else {
    destroyChain(participant.identity);
  }
}

// ============================================================
// Chat
// ============================================================

function setChatCollapsed(collapsed) {
  chat.classList.toggle('collapsed', collapsed);
  settings.chatCollapsed = collapsed;
  saveSettings();
  if (!collapsed) {
    unreadCount = 0;
    chatUnread.classList.add('hidden');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

chatToggle.addEventListener('click', () => setChatCollapsed(!chat.classList.contains('collapsed')));
chatToggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    setChatCollapsed(!chat.classList.contains('collapsed'));
  }
});
setChatCollapsed(settings.chatCollapsed);

function renderChatEmptyState() {
  if (!chatMessages.querySelector('.chat-message')) {
    chatMessages.innerHTML = '<p class="chat-empty">Nenhuma mensagem ainda.</p>';
  }
}

function clearChatEmptyState() {
  chatMessages.querySelector('.chat-empty')?.remove();
}

chatText.addEventListener('input', () => {
  sendBtn.disabled = chatText.value.trim().length === 0;

  // Avisa que está digitando, no máximo uma vez a cada 2s
  const now = Date.now();
  if (room && chatText.value && now - lastTypingSent > 2000) {
    lastTypingSent = now;
    publish({ t: 'typing' }, false);
  }
});

function publish(payload, reliable = true) {
  if (!room) return;
  const data = new TextEncoder().encode(JSON.stringify(payload));
  room.localParticipant.publishData(data, { reliable }).catch(() => {});
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatText.value.trim();
  if (!text || !room) return;

  addChatMessage(displayName(room.localParticipant), text, true);
  publish({ t: 'chat', text });

  chatText.value = '';
  sendBtn.disabled = true;
  lastTypingSent = 0;
});

function handleDataReceived(payload, participant) {
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload));
    // A identidade vem do LiveKit, não do corpo da mensagem: assim
    // ninguém consegue se passar por outra pessoa no chat.
    const author = displayName(participant);

    if (msg.t === 'typing') {
      typingUntil.set(author, Date.now() + 3500);
      renderTyping();
      return;
    }

    typingUntil.delete(author);
    renderTyping();
    addChatMessage(author, msg.text, false);
  } catch (err) {
    console.error('Mensagem de chat inválida:', err);
  }
}

function renderTyping() {
  const now = Date.now();
  for (const [name, t] of typingUntil) if (t <= now) typingUntil.delete(name);
  const names = [...typingUntil.keys()];

  if (!names.length) { typingEl.classList.add('hidden'); return; }
  typingText.textContent = names.length === 1
    ? `${names[0]} está digitando`
    : `${names.length} pessoas estão digitando`;
  typingEl.classList.remove('hidden');
}

setInterval(renderTyping, 1000);

const timeNow = () =>
  new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function addChatMessage(author, text, isMine) {
  clearChatEmptyState();

  const el = document.createElement('div');
  // Mensagens seguidas da mesma pessoa perdem o cabeçalho repetido
  const grouped = lastChatAuthor === author;
  el.className = 'chat-message' + (grouped ? ' grouped' : '');
  el.innerHTML = `
    <span class="av" style="background:${colorFor(author)}">${escapeHtml(initialsOf(author))}</span>
    <div class="body">
      <div class="meta">
        <span class="author" style="color:${isMine ? 'var(--label)' : colorFor(author)}">
          ${escapeHtml(author)}
        </span>
        <span class="time">${timeNow()}</span>
      </div>
      <div class="text">${escapeHtml(text)}</div>
    </div>
  `;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  lastChatAuthor = author;

  if (!isMine && chat.classList.contains('collapsed')) {
    unreadCount += 1;
    chatUnread.textContent = String(unreadCount);
    chatUnread.classList.remove('hidden');
  }
}

function addSystemMessage(text) {
  clearChatEmptyState();
  const el = document.createElement('div');
  el.className = 'chat-message system';
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  lastChatAuthor = null;
}

// ============================================================
// Painel de conexão
// ============================================================

const QUALITY = {
  excellent: { label: 'Conexão excelente', bars: 4 },
  good:      { label: 'Conexão boa',       bars: 3 },
  poor:      { label: 'Conexão ruim',      bars: 2 },
  lost:      { label: 'Conexão perdida',   bars: 1 },
  unknown:   { label: 'Medindo…',          bars: 0 },
};

let statsTimer = null;
let lastSample = null;

netToggle.addEventListener('click', () => netPanel.classList.toggle('open'));
netToggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); netPanel.classList.toggle('open'); }
});

function handleQualityChanged(quality, participant) {
  if (!room || participant !== room.localParticipant) return;
  const info = QUALITY[String(quality || 'unknown').toLowerCase()] || QUALITY.unknown;
  netBars.dataset.level = String(info.bars);
  netLabel.textContent = info.label;
}

function fmtBitrate(bps) {
  if (!isFinite(bps) || bps <= 0) return '—';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mb/s` : `${Math.round(bps / 1e3)} kb/s`;
}

// Percorre todas as faixas publicadas e recebidas somando os contadores
// do WebRTC. É a mesma fonte que o "webrtc-internals" do Chrome usa.
async function collectStats() {
  const tracks = [];
  for (const pub of room.localParticipant.trackPublications.values()) {
    if (pub.track) tracks.push({ track: pub.track, local: true });
  }
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      if (pub.track) tracks.push({ track: pub.track, local: false });
    }
  }

  const acc = {
    rtt: null, packetsLost: 0, packetsTotal: 0,
    bytesSent: 0, bytesReceived: 0,
    width: 0, height: 0, fps: 0,
    srcWidth: 0, srcHeight: 0, srcFps: 0,
  };

  for (const { track, local } of tracks) {
    let report;
    try { report = await track.getRTCStatsReport(); } catch { continue; }
    if (!report) continue;

    report.forEach((s) => {
      if (s.type === 'outbound-rtp' && !s.isRemote) {
        acc.bytesSent += s.bytesSent || 0;
        acc.packetsTotal += s.packetsSent || 0;
        if (s.kind === 'video' && s.frameWidth) {
          acc.width = s.frameWidth; acc.height = s.frameHeight;
          acc.fps = Math.round(s.framesPerSecond || 0);
        }
      } else if (s.type === 'remote-inbound-rtp') {
        if (typeof s.roundTripTime === 'number') {
          acc.rtt = acc.rtt === null ? s.roundTripTime : Math.max(acc.rtt, s.roundTripTime);
        }
        acc.packetsLost += Math.max(0, s.packetsLost || 0);
      } else if (s.type === 'inbound-rtp' && !local) {
        acc.bytesReceived += s.bytesReceived || 0;
        acc.packetsLost += Math.max(0, s.packetsLost || 0);
        acc.packetsTotal += s.packetsReceived || 0;
        if (s.kind === 'video' && s.frameWidth) {
          acc.width = s.frameWidth; acc.height = s.frameHeight;
          acc.fps = Math.round(s.framesPerSecond || 0);
        }
      } else if (s.type === 'media-source' && s.kind === 'video') {
        // "media-source" é a captura antes do codificador. Comparar com
        // o outbound-rtp diz se o gargalo é a captura ou a codificação.
        if (s.width) {
          acc.srcWidth = s.width; acc.srcHeight = s.height;
          acc.srcFps = Math.round(s.framesPerSecond || 0);
        }
      } else if (s.type === 'candidate-pair' && s.state === 'succeeded') {
        if (typeof s.currentRoundTripTime === 'number' && acc.rtt === null) {
          acc.rtt = s.currentRoundTripTime;
        }
      }
    });
  }

  return acc;
}

function paint(id, value, level = '') {
  const el = $(id);
  el.textContent = value;
  el.className = level;
}

async function sampleStats() {
  if (!room) return;

  let acc;
  try { acc = await collectStats(); } catch { return; }

  if (acc.rtt !== null) {
    const ms = Math.round(acc.rtt * 1000);
    paint('net-rtt', `${ms} ms`, ms > 200 ? 'bad' : ms > 100 ? 'warn' : '');
  }

  if (acc.packetsTotal > 0) {
    const pct = (acc.packetsLost / (acc.packetsTotal + acc.packetsLost)) * 100;
    paint('net-loss', `${pct.toFixed(1)}%`, pct > 3 ? 'bad' : pct > 1 ? 'warn' : '');
  }

  const now = performance.now();
  if (lastSample) {
    const seconds = (now - lastSample.t) / 1000;
    if (seconds > 0) {
      paint('net-up', fmtBitrate(((acc.bytesSent - lastSample.bytesSent) * 8) / seconds));
      paint('net-down', fmtBitrate(((acc.bytesReceived - lastSample.bytesReceived) * 8) / seconds));
    }
  }
  lastSample = { t: now, bytesSent: acc.bytesSent, bytesReceived: acc.bytesReceived };

  paint('net-capture', acc.srcWidth ? `${acc.srcWidth}×${acc.srcHeight} · ${acc.srcFps} fps` : '—',
    acc.srcWidth && acc.srcFps < 10 ? 'warn' : '');
  paint('net-video', acc.width ? `${acc.width}×${acc.height} · ${acc.fps} fps` : '—',
    acc.width && acc.fps < 10 ? 'warn' : '');

  // Com dynacast ligado, o LiveKit pausa o envio quando ninguém assina
  // a faixa. Sozinho na sala o fps despenca — e isso é esperado.
  const others = room.remoteParticipants.size;
  paint('net-subs', others === 0 ? 'ninguém' : `${others} pessoa${others > 1 ? 's' : ''}`,
    others === 0 && isSharingScreen ? 'warn' : '');
}

function startStatsLoop() {
  stopStatsLoop();
  lastSample = null;
  netBars.dataset.level = '0';
  netLabel.textContent = QUALITY.unknown.label;
  statsTimer = setInterval(sampleStats, 2000);
  sampleStats();
}

function stopStatsLoop() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
  for (const id of ['net-rtt', 'net-loss', 'net-up', 'net-down',
                    'net-capture', 'net-video', 'net-subs']) paint(id, '—');
}

// ============================================================
// Saída
// ============================================================

leaveBtn.addEventListener('click', () => {
  askConfirm({
    title: 'Sair da sala?',
    text: 'Você vai se desconectar da voz, do chat e do compartilhamento de tela.',
    okLabel: 'Sair',
    onAccept: () => { if (room) room.disconnect(); },
  });
});

function handleDisconnected() {
  room = null;
  isSharingScreen = false;
  micEnabled = true;
  selectedSourceId = null;
  lastChatAuthor = null;
  lastCount = 0;
  unreadCount = 0;

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
  }
  disposeGainChain();
  for (const identity of [...chains.keys()]) destroyChain(identity);
  stopStatsLoop();
  stopLevelLoop();

  while (openModals.length) closeTopModal();

  shares.clear();
  activeShareKey = null;
  renderStage();

  document.querySelectorAll('body > audio').forEach((el) => el.remove());
  chatMessages.innerHTML = '';
  participantsList.innerHTML = '';
  tiles.innerHTML = '';
  typingUntil.clear();
  renderTyping();

  screenshareBtn.classList.remove('on');
  setMicButton(true);
  reconnectBanner.classList.add('hidden');
  titlebarRoom.classList.add('hidden');
  chatUnread.classList.add('hidden');

  switchScreen(mainScreen, joinScreen);
  clearError();
}

renderStage();
