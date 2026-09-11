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
const streamVolBtn = $('stream-vol-btn');
const ctxMenu = $('ctx');

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
  peers: {},          // identidade -> { volume, nr, streamVolume }
  myAvatar: { icon: '', color: '' },
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

// ---------- Aparência do participante ----------

const AVATAR_ICONS = [
  '🐼', '🦊', '🐸', '🐵', '🐱', '🐶', '🦁', '🐯', '🐨', '🐷',
  '🐙', '🦄', '🐢', '🦉', '🐝', '🦖', '🌵', '🍀', '🍄', '🌙',
  '⭐', '⚡', '🔥', '🎧', '🎮', '🎲', '🍕', '☕', '🚀', '👾',
];

// A aparência viaja nos metadados do participante, que o LiveKit
// replica para todos e mantém sincronizado. Guardar só localmente
// faria cada pessoa ver um avatar diferente da mesma pessoa.
function avatarOf(p) {
  const name = displayName(p);
  let meta = null;
  try { meta = p?.metadata ? JSON.parse(p.metadata) : null; } catch { /* metadados de outra versão */ }

  return {
    icon: meta?.icon || '',
    color: meta?.color || colorFor(name),
    initials: initialsOf(name),
  };
}

// Preenche um elemento .av / .tile-av com o ícone ou as iniciais
function paintAvatar(el, p) {
  const { icon: glyph, color, initials } = avatarOf(p);
  el.style.background = color;
  const slot = el.querySelector('.ini');
  slot.textContent = glyph || initials;
  slot.classList.toggle('glyph', Boolean(glyph));
}

async function publishAppearance() {
  if (!room) return;
  const { icon: glyph, color } = settings.myAvatar || {};
  try {
    await room.localParticipant.setMetadata(JSON.stringify({ icon: glyph || '', color: color || '' }));
  } catch (err) {
    console.error('Não foi possível publicar a aparência:', err);
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Níveis de supressão de ruído.
//
// Os limiares são MULTIPLICADORES sobre o piso de ruído medido, não
// valores absolutos. Essa é a diferença que faz o recurso funcionar:
// um limiar fixo depende do microfone, do ganho e da distância de quem
// fala — num setup corta a voz, noutro deixa o ruído passar inteiro.
//
//   open/close  quantas vezes acima do piso o som precisa estar
//   hold        quanto tempo o portão fica aberto depois da última voz,
//               para não fechar entre uma palavra e outra
//   release     velocidade com que fecha (em segundos)
const NR_LEVELS = {
  off:    { label: 'Desligada' },
  light:  { label: 'Leve',  hp: 80,  open: 2.4, close: 1.6, hold: 420, release: 0.20 },
  medium: { label: 'Média', hp: 100, open: 3.2, close: 2.0, hold: 320, release: 0.13 },
  strong: { label: 'Forte', hp: 140, open: 4.8, close: 2.8, hold: 240, release: 0.08 },
};
const NR_ORDER = ['off', 'light', 'medium', 'strong'];

// Preferências por pessoa, guardadas pela identidade (que é estável,
// ao contrário do nome de exibição e do sid)
function peerPrefs(identity) {
  const saved = settings.peers[identity];
  if (!saved) {
    settings.peers[identity] = { volume: 1, nr: 'off', streamVolume: 1 };
  } else {
    // Versões antigas guardavam um booleano "gate"
    if (typeof saved.gate === 'boolean' && !saved.nr) {
      saved.nr = saved.gate ? 'medium' : 'off';
      delete saved.gate;
    }
    if (!saved.nr) saved.nr = 'off';
    if (typeof saved.streamVolume !== 'number') saved.streamVolume = 1;
  }
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
    .on(RoomEvent.ParticipantMetadataChanged, syncParticipants)
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
  await publishAppearance();

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

  // Duas portas para o mesmo menu: o botão (descobrível) e o clique
  // com o botão direito (rápido, para quem já sabe)
  const isLocal = room && p === room.localParticipant;
  const btn = el.querySelector('.vol-btn');

  if (isLocal) {
    // O próprio usuário tem opções diferentes: nome, microfone e
    // captação — nada de volume, que só faz sentido para os outros
    btn.innerHTML = icon('ic-gear');
    btn.title = 'Suas opções';
    btn.setAttribute('aria-label', 'Suas opções');
    el.classList.add('is-me');
  } else {
    btn.title = 'Áudio desta pessoa';
  }

  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const x = e.clientX || r.right;
    const y = e.clientY || r.bottom;
    if (isLocal) openSelfMenu(x, y);
    else openPeerMenu(p, x, y);
  };

  btn.addEventListener('click', open);
  el.addEventListener('contextmenu', open);

  return el;
}

function updateRow(el, p) {
  const name = displayName(p);
  const isLocal = room && p === room.localParticipant;

  el.classList.toggle('speaking', Boolean(p.isSpeaking));
  paintAvatar(el.querySelector('.av'), p);
  el.querySelector('.name').textContent = name + (isLocal ? ' (você)' : '');

  const slot = el.querySelector('.mute-slot');
  const muted = !micOnFor(p);
  if (muted && !slot.firstChild) slot.innerHTML = `<span class="muted-ic">${icon('ic-mic-off')}</span>`;
  if (!muted && slot.firstChild) slot.innerHTML = '';

  if (!isLocal) {
    const prefs = peerPrefs(p.identity);
    el.classList.toggle('turned-down', prefs.volume !== 1 || prefs.nr !== 'off');
  }
}

function makeTile(p) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <div class="tile-av"><span class="tile-ring"></span><span class="ini"></span></div>
    <div class="tile-foot"><span class="nm"></span><span class="mute-slot"></span></div>
  `;

  if (room && p !== room.localParticipant) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openPeerMenu(p, e.clientX, e.clientY);
    });
  }

  return el;
}

function updateTile(el, p) {
  const name = displayName(p);
  const isLocal = room && p === room.localParticipant;

  el.classList.toggle('speaking', Boolean(p.isSpeaking));
  paintAvatar(el.querySelector('.tile-av'), p);
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

// ============================================================
// Menu de contexto
// ============================================================

let ctxCleanup = null;

function closeCtx() {
  ctxMenu.classList.add('hidden');
  ctxMenu.innerHTML = '';
  if (ctxCleanup) { ctxCleanup(); ctxCleanup = null; }
}

function buildCtxNode(item) {
  if (item.type === 'header') {
    const el = document.createElement('div');
    el.className = 'ctx-header';
    el.innerHTML = `<span class="dot"><span class="ini"></span></span>
                    <span class="nm">${escapeHtml(item.label)}</span>`;

    const dot = el.querySelector('.dot');
    if (item.participant) {
      paintAvatar(dot, item.participant);
    } else {
      dot.style.background = colorFor(item.label);
      dot.querySelector('.ini').textContent = initialsOf(item.label);
    }
    return el;
  }

  if (item.type === 'label') {
    const el = document.createElement('div');
    el.className = 'ctx-label';
    el.textContent = item.label;
    return el;
  }

  if (item.type === 'sep') {
    const el = document.createElement('div');
    el.className = 'ctx-sep';
    return el;
  }

  if (item.type === 'slider') {
    const el = document.createElement('div');
    el.className = 'ctx-slider';
    const pct = Math.round(item.value * 100);
    el.innerHTML = `
      <input class="range" type="range" min="0" max="${item.max || 150}" value="${pct}" />
      <span class="range-value">${pct}%</span>
    `;
    const range = el.querySelector('.range');
    const label = el.querySelector('.range-value');
    range.addEventListener('input', () => {
      label.textContent = `${range.value}%`;
      item.onInput(Number(range.value) / 100);
    });
    range.addEventListener('change', () => item.onCommit?.());
    return el;
  }

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ctx-item' + (item.on ? ' on' : '') + (item.danger ? ' danger' : '');
  el.innerHTML = `
    ${item.icon ? icon(item.icon) : ''}
    <span>${escapeHtml(item.label)}</span>
    ${item.hint ? `<span class="hint">${escapeHtml(item.hint)}</span>` : ''}
    ${item.checkable ? `<span class="check">${icon('ic-check')}</span>` : ''}
  `;
  el.addEventListener('click', () => {
    if (item.keepOpen) item.onClick();
    else { closeCtx(); item.onClick(); }
  });
  return el;
}

function openCtx(items, x, y) {
  closeCtx();

  for (const item of items) {
    if (item) ctxMenu.appendChild(buildCtxNode(item));
  }
  ctxMenu.classList.remove('hidden', 'from-right');

  // Mantém o menu dentro da janela, virando o ponto de origem quando
  // não couber para a direita ou para baixo
  const rect = ctxMenu.getBoundingClientRect();
  const pad = 8;
  let left = x;
  let top = y;

  if (left + rect.width + pad > window.innerWidth) {
    left = x - rect.width;
    ctxMenu.classList.add('from-right');
  }
  if (top + rect.height + pad > window.innerHeight) {
    top = y - rect.height;
  }

  ctxMenu.style.left = `${Math.max(pad, left)}px`;
  ctxMenu.style.top = `${Math.max(pad, top)}px`;

  const onDown = (e) => { if (!ctxMenu.contains(e.target)) closeCtx(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCtx(); } };

  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeCtx);

  ctxCleanup = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeCtx);
  };
}

// Menu de uma pessoa: volume da voz, supressão de ruído e, se ela
// estiver transmitindo, o volume da transmissão dela.
function openPeerMenu(participant, x, y) {
  const prefs = peerPrefs(participant.identity);
  const name = displayName(participant);
  const share = shares.get(participant.sid);

  const items = [
    { type: 'header', label: name, participant },
    { type: 'sep' },
    { type: 'label', label: 'Volume da voz' },
    {
      type: 'slider',
      value: prefs.volume,
      onInput: (v) => { prefs.volume = v; applyPeerVolume(participant); syncParticipants(); },
      onCommit: saveSettings,
    },
    { type: 'label', label: 'Supressão de ruído' },
    ...NR_ORDER.map((key) => ({
      label: NR_LEVELS[key].label,
      checkable: true,
      on: prefs.nr === key,
      keepOpen: true,
      onClick: () => {
        prefs.nr = key;
        saveSettings();
        applyPeerAudio(participant);
        syncParticipants();
        // Reabre com a marca no lugar certo, sem fechar o menu
        openPeerMenu(participant, x, y);
      },
    })),
  ];

  if (share?.hasAudio) {
    items.push(
      { type: 'sep' },
      { type: 'label', label: 'Volume da transmissão' },
      {
        type: 'slider',
        value: prefs.streamVolume,
        onInput: (v) => { prefs.streamVolume = v; applyStreamVolume(participant); },
        onCommit: saveSettings,
      },
      {
        label: share === shares.get(activeShareKey) ? 'Já está em foco' : 'Ver esta transmissão',
        icon: 'ic-display',
        onClick: () => selectShare(participant.sid),
      },
    );
  }

  openCtx(items, x, y);
}

// Menu do próprio usuário: identidade e captação. Volume não entra
// aqui porque você não se ouve — isso só faz sentido para os outros.
function openSelfMenu(x, y) {
  if (!room) return;
  const me = room.localParticipant;

  const toggleCapture = (key, label) => ({
    label,
    checkable: true,
    on: settings[key],
    keepOpen: true,
    onClick: () => {
      settings[key] = !settings[key];
      saveSettings();
      applyMicSettings();
      openSelfMenu(x, y);
    },
  });

  openCtx([
    { type: 'header', label: displayName(me), participant: me },
    { type: 'sep' },
    {
      label: micEnabled ? 'Desligar microfone' : 'Ligar microfone',
      icon: micEnabled ? 'ic-mic-off' : 'ic-mic',
      hint: 'M',
      onClick: toggleMic,
    },
    { type: 'label', label: 'Ganho do microfone' },
    {
      type: 'slider',
      value: settings.gain,
      max: 200,
      // Mexer no ganho republica a faixa, então só aplica ao soltar
      onInput: (v) => { settings.gain = v; },
      onCommit: () => { saveSettings(); applyMicSettings(); },
    },
    { type: 'label', label: 'Captação' },
    toggleCapture('noise', 'Supressão de ruído'),
    toggleCapture('echo', 'Cancelamento de eco'),
    toggleCapture('agc', 'Volume automático'),
    { type: 'sep' },
    {
      label: 'Escolher ícone…',
      icon: 'ic-user',
      onClick: openAvatarPicker,
    },
    {
      label: 'Alterar nome…',
      icon: 'ic-user',
      onClick: () => {
        openSettings();
        setTimeout(() => { displayNameInput.focus(); displayNameInput.select(); }, 120);
      },
    },
    {
      label: 'Configurações…',
      icon: 'ic-gear',
      hint: ',',
      onClick: openSettings,
    },
  ], x, y);
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

  const cfg = NR_LEVELS[prefs.nr];
  // Trocar de nível refaz a cadeia: o filtro e os limiares mudam
  destroyChain(participant.identity);
  if (cfg && prefs.nr !== 'off') buildChain(participant, el, cfg);

  applyPeerVolume(participant);
}

function buildChain(participant, el, cfg) {
  const stream = el.srcObject;
  const track = stream?.getAudioTracks?.()[0];
  if (!track) return;

  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = cfg.hp;   // abaixo disso é quase só zumbido

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;

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
      ctx, gate, vol, analyser, el, cfg,
      data: new Float32Array(analyser.fftSize),
      floor: 0.01,     // piso de ruído estimado, ajustado a cada quadro
      open: true,
      holdUntil: 0,
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

// Um único laço cuida de todos os portões abertos.
//
// O limiar não é fixo: a cadeia estima o piso de ruído da pessoa e
// decide em relação a ele. Um valor absoluto não funciona porque
// depende do microfone, do ganho e da distância de quem fala.
function runGates() {
  const now = performance.now();

  for (const [, c] of chains) {
    c.analyser.getFloatTimeDomainData(c.data);

    let sum = 0;
    for (let i = 0; i < c.data.length; i++) sum += c.data[i] * c.data[i];
    const rms = Math.sqrt(sum / c.data.length);

    // O piso desce rápido e sobe devagar: assim ele aprende o silêncio
    // da sala sem ser puxado para cima pela própria voz.
    c.floor += (rms - c.floor) * (rms < c.floor ? 0.25 : 0.0006);
    const floor = Math.max(c.floor, 0.0008);

    if (rms > floor * c.cfg.open) {
      c.open = true;
      c.holdUntil = now + c.cfg.hold;
    } else if (c.open && rms < floor * c.cfg.close && now > c.holdUntil) {
      c.open = false;
    }

    // Abre quase instantaneamente e fecha devagar. Cortar o começo de
    // uma palavra incomoda muito mais do que deixar escapar ruído, e o
    // "hold" impede que ele feche no meio de uma frase.
    c.gate.gain.setTargetAtTime(
      c.open ? 1 : 0,
      c.ctx.currentTime,
      c.open ? 0.008 : c.cfg.release,
    );
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
  for (const p of room.remoteParticipants.values()) {
    applyPeerVolume(p);
    applyStreamVolume(p);
  }
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
// Escolha de ícone
// ============================================================

const avatarDialog = $('avatar-dialog');
const avatarPreview = $('avatar-preview');
const colorGrid = $('color-grid');
const iconGrid = $('icon-grid');

let draftAvatar = { icon: '', color: '' };

function paintPreview() {
  const name = room ? displayName(room.localParticipant) : myUsername || '?';
  avatarPreview.style.background = draftAvatar.color || colorFor(name);
  const slot = avatarPreview.querySelector('.ini');
  slot.textContent = draftAvatar.icon || initialsOf(name);
  slot.classList.toggle('glyph', Boolean(draftAvatar.icon));

  for (const cell of iconGrid.children) {
    cell.classList.toggle('selected', cell.textContent === draftAvatar.icon);
  }
  for (const dot of colorGrid.children) {
    dot.classList.toggle('selected', dot.dataset.color === draftAvatar.color);
  }
}

function openAvatarPicker() {
  draftAvatar = { ...(settings.myAvatar || { icon: '', color: '' }) };

  if (!colorGrid.children.length) {
    for (const color of AVATAR_COLORS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'color-dot';
      dot.dataset.color = color;
      dot.style.background = color;
      dot.style.color = color;   // o anel de seleção usa currentColor
      dot.addEventListener('click', () => { draftAvatar.color = color; paintPreview(); });
      colorGrid.appendChild(dot);
    }
  }

  if (!iconGrid.children.length) {
    for (const glyph of AVATAR_ICONS) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'icon-cell';
      cell.textContent = glyph;
      cell.addEventListener('click', () => {
        // Clicar no que já está escolhido desmarca
        draftAvatar.icon = draftAvatar.icon === glyph ? '' : glyph;
        paintPreview();
      });
      iconGrid.appendChild(cell);
    }
  }

  paintPreview();
  openModal(avatarDialog);
}

async function commitAvatar() {
  settings.myAvatar = { ...draftAvatar };
  saveSettings();
  await publishAppearance();
  syncParticipants();
}

$('close-avatar').addEventListener('click', () => closeModal(avatarDialog));

$('avatar-save').addEventListener('click', async () => {
  closeModal(avatarDialog);
  await commitAvatar();
  toast('Ícone atualizado');
});

$('avatar-reset').addEventListener('click', () => {
  draftAvatar = { icon: '', color: '' };
  paintPreview();
});

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
    closeCtx();
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

  // O botão de áudio só aparece quando há som de outra pessoa para
  // controlar — mas o menu do botão direito continua valendo sempre
  streamVolBtn.classList.toggle(
    'hidden',
    !share.hasAudio || share.participant === room?.localParticipant,
  );

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
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (share.participant && share.participant !== room?.localParticipant) {
        openPeerMenu(share.participant, e.clientX, e.clientY);
      }
    });
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

// O volume da transmissão é por pessoa, não global: baixar o jogo de
// um amigo não pode baixar o de outro.
function applyStreamVolume(participant) {
  const target = participant
    || (activeShareKey ? shares.get(activeShareKey)?.participant : null);

  if (!target || target === room?.localParticipant) return;

  const prefs = peerPrefs(target.identity);
  try {
    target.setVolume(prefs.streamVolume * settings.outVolume, Track.Source.ScreenShareAudio);
  } catch { /* SDK sem esse método */ }
}

// Menu do palco: volume da transmissão em foco, troca entre
// transmissões e tela cheia
function openStageMenu(x, y) {
  const share = activeShareKey ? shares.get(activeShareKey) : null;
  if (!share) return;

  const isLocal = share.participant === room?.localParticipant;
  const items = [{ type: 'header', label: share.name, participant: share.participant }];

  if (!isLocal && share.hasAudio) {
    const prefs = peerPrefs(share.participant.identity);
    items.push(
      { type: 'sep' },
      { type: 'label', label: 'Volume da transmissão' },
      {
        type: 'slider',
        value: prefs.streamVolume,
        onInput: (v) => { prefs.streamVolume = v; applyStreamVolume(share.participant); },
        onCommit: saveSettings,
      },
    );
  } else if (!isLocal) {
    items.push(
      { type: 'sep' },
      { label: 'Esta transmissão não tem áudio', hint: '—', onClick: () => {} },
    );
  }

  // Outras transmissões acontecendo agora
  const others = [...shares.entries()].filter(([key]) => key !== activeShareKey);
  if (others.length) {
    items.push({ type: 'sep' }, { type: 'label', label: 'Trocar para' });
    for (const [key, other] of others) {
      items.push({
        label: other.name,
        icon: 'ic-display',
        onClick: () => selectShare(key),
      });
    }
  }

  items.push(
    { type: 'sep' },
    {
      label: document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia',
      icon: document.fullscreenElement ? 'ic-collapse' : 'ic-expand',
      hint: 'F',
      onClick: toggleFullscreen,
    },
  );

  if (isLocal) {
    items.push({
      label: 'Parar de compartilhar',
      icon: 'ic-screen-off',
      danger: true,
      onClick: stopScreenShare,
    });
  }

  openCtx(items, x, y);
}

streamVolBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const r = streamVolBtn.getBoundingClientRect();
  openStageMenu(r.right, r.bottom + 6);
});

stage.addEventListener('contextmenu', (e) => {
  // Sem transmissão o palco mostra os ladrilhos, que têm menu próprio
  if (!activeShareKey || e.target.closest('.tile')) return;
  e.preventDefault();
  openStageMenu(e.clientX, e.clientY);
});

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
    applyStreamVolume(participant);
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

  addChatMessage(displayName(room.localParticipant), text, true, room.localParticipant);
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
    addChatMessage(author, msg.text, false, participant);
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

function addChatMessage(author, text, isMine, participant) {
  clearChatEmptyState();

  const el = document.createElement('div');
  // Mensagens seguidas da mesma pessoa perdem o cabeçalho repetido
  const grouped = lastChatAuthor === author;
  el.className = 'chat-message' + (grouped ? ' grouped' : '');
  el.innerHTML = `
    <span class="av"><span class="ini"></span></span>
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
  const av = el.querySelector('.av');
  if (participant) {
    paintAvatar(av, participant);
  } else {
    av.style.background = colorFor(author);
    av.querySelector('.ini').textContent = initialsOf(author);
  }

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

// ============================================================
// Atualização automática
// ============================================================

const updateBanner = $('update-banner');
const updateText = $('update-text');
const updateSpinner = $('update-spinner');
const updateInstall = $('update-install');

ipcRenderer.invoke('app-version')
  .then((v) => { $('app-version').textContent = `v${v}`; })
  .catch(() => {});

ipcRenderer.on('update-status', (_event, status) => {
  if (!status || status.state === 'idle') {
    updateBanner.classList.add('hidden');
    return;
  }

  if (status.state === 'downloading') {
    updateSpinner.classList.remove('hidden');
    updateInstall.classList.add('hidden');
    updateText.textContent = status.percent
      ? `Baixando atualização… ${status.percent}%`
      : 'Baixando atualização…';
    updateBanner.classList.remove('hidden');
    return;
  }

  if (status.state === 'ready') {
    updateSpinner.classList.add('hidden');
    updateInstall.classList.remove('hidden');
    updateText.textContent = `Versão ${status.version} pronta para instalar`;
    updateBanner.classList.remove('hidden');
  }
});

updateInstall.addEventListener('click', () => {
  // Sair no meio de uma conversa seria grosseiro: avisa antes
  if (room) {
    askConfirm({
      title: 'Reiniciar para atualizar?',
      text: 'Você vai sair da sala e o app reabre já atualizado.',
      okLabel: 'Reiniciar',
      danger: false,
      onAccept: () => ipcRenderer.invoke('install-update'),
    });
  } else {
    ipcRenderer.invoke('install-update');
  }
});

renderStage();
