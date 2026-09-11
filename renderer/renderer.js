// Lógica principal do app. Roda dentro da janela do Electron.
// Usa o SDK "livekit-client" para voz, vídeo (compartilhamento de tela)
// e mensagens de texto (via "data channel" do LiveKit).

const { ipcRenderer } = require('electron');
const { Room, RoomEvent, Track, ConnectionQuality } = require('livekit-client');

// ---------- Referências de elementos da tela ----------

const $ = (id) => document.getElementById(id);

const joinScreen = $('join-screen');
const mainScreen = $('main-screen');

const joinForm = $('join-form');
const serverUrlInput = $('server-url');
const roomNameInput = $('room-name');
const userNameInput = $('user-name');
const roomPasswordInput = $('room-password');
const joinBtn = $('join-btn');
const joinError = $('join-error');

const currentRoomNameEl = $('current-room-name');
const participantsList = $('participants-list');
const participantCount = $('participant-count');
const videoArea = $('video-area');

const micBtn = $('mic-btn');
const screenshareBtn = $('screenshare-btn');
const leaveBtn = $('leave-btn');

const chatMessages = $('chat-messages');
const chatForm = $('chat-form');
const chatText = $('chat-text');
const sendBtn = $('send-btn');

const sourcePicker = $('source-picker');
const sourceGrid = $('source-grid');
const sourceEmpty = $('source-empty');
const cancelPicker = $('cancel-picker');
const closePicker = $('close-picker');
const confirmPicker = $('confirm-picker');
const pickerSelection = $('picker-selection');
const qualitySelect = $('quality-select');
const modeSelect = $('mode-select');

const confirmDialog = $('confirm-dialog');
const confirmTitle = $('confirm-title');
const confirmText = $('confirm-text');
const confirmOk = $('confirm-ok');
const confirmCancel = $('confirm-cancel');

const toastWrap = $('toast-wrap');

const netPanel = $('net-panel');
const netToggle = $('net-toggle');
const netDot = $('net-dot');
const netLabel = $('net-label');

// ---------- Estado ----------

let room = null;
let micEnabled = true;
let isSharingScreen = false;
let myUsername = '';
let localScreenStream = null;

let allSources = [];       // fontes de captura devolvidas pelo Electron
let activeTab = 'screen';  // aba atual do seletor: "screen" ou "window"
let selectedSourceId = null;

let onConfirmAccept = null; // callback do alerta genérico

const LAST_USED_KEY = 'voicechat.lastUsed';

// ============================================================
// Utilidades de interface
// ============================================================

function icon(name, cls = 'ic ic-sm') {
  return `<svg class="${cls}"><use href="#${name}" /></svg>`;
}

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
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function showError(message) {
  joinError.innerHTML = `${icon('ic-alert')}<span>${escapeHtml(message)}</span>`;
  joinError.classList.remove('hidden');
}

function clearError() {
  joinError.classList.add('hidden');
  joinError.textContent = '';
}

// Cor estável por nome, para o avatar não mudar a cada render
const AVATAR_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a'];

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------- Camada de modais ----------
// Um único lugar controlando abertura/fechamento garante que Esc,
// clique no fundo e botão de fechar funcionem para todos os modais.

const openModals = [];

function openModal(el, onClose) {
  el.classList.remove('hidden');
  openModals.push({ el, onClose });
  const target = el.querySelector('.btn-primary:not(:disabled), .btn');
  if (target) target.focus();
}

function closeModal(el) {
  const i = openModals.findIndex((m) => m.el === el);
  if (i === -1) return;
  const [entry] = openModals.splice(i, 1);
  el.classList.add('hidden');
  if (entry.onClose) entry.onClose();
}

function closeTopModal() {
  if (!openModals.length) return false;
  closeModal(openModals[openModals.length - 1].el);
  return true;
}

// Clique no fundo escuro fecha; clique dentro da folha, não.
for (const backdrop of document.querySelectorAll('.backdrop')) {
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModal(backdrop);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (closeTopModal()) e.preventDefault();
    return;
  }

  // Enter confirma o modal aberto, se houver um botão primário ativo
  if (e.key === 'Enter' && openModals.length) {
    const top = openModals[openModals.length - 1].el;
    const primary = top.querySelector('.btn-primary:not(:disabled), .btn-danger:not(:disabled)');
    if (primary && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      primary.click();
    }
    return;
  }

  // Atalho: M liga/desliga o microfone fora de campos de texto
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (!typing && !openModals.length && room && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    toggleMic();
  }
});

// Alerta genérico com confirmar/cancelar
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

// ============================================================
// Entrar na sala
// ============================================================

// Repõe o que foi usado da última vez, pra não redigitar toda hora
try {
  const saved = JSON.parse(localStorage.getItem(LAST_USED_KEY) || '{}');
  if (saved.username) userNameInput.value = saved.username;
  if (saved.room) roomNameInput.value = saved.room;
  if (saved.serverUrl) serverUrlInput.value = saved.serverUrl;
  // Senha da sala é combinada do grupo, não credencial pessoal: guardar
  // localmente evita que todo mundo redigite a cada entrada.
  if (saved.password) roomPasswordInput.value = saved.password;
} catch { /* preferências corrompidas não podem impedir o app de abrir */ }

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const roomName = roomNameInput.value.trim();
  const username = userNameInput.value.trim();
  const password = roomPasswordInput.value;

  clearError();

  if (!username)   return showError('Digite o seu nome.');
  if (!roomName)   return showError('Digite o nome da sala.');
  if (!serverUrl)  return showError('Informe o endereço do servidor de tokens.');

  joinBtn.disabled = true;
  joinBtn.textContent = 'Entrando…';

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

    joinScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    chatText.focus();
    toast(`Você entrou em #${roomName}`);
  } catch (err) {
    console.error(err);
    const msg = err.message === 'Failed to fetch'
      ? 'Não foi possível falar com o servidor de tokens. Ele está rodando nesse endereço?'
      : err.message;
    showError(msg);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Entrar na sala';
  }
});

async function connectToRoom(url, token, roomName) {
  room = new Room({ adaptiveStream: true, dynacast: true });

  currentRoomNameEl.textContent = roomName;

  room
    .on(RoomEvent.ParticipantConnected, (p) => {
      renderParticipants();
      addSystemMessage(`${p.identity} entrou na sala`);
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      renderParticipants();
      addSystemMessage(`${p.identity} saiu da sala`);
    })
    .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    .on(RoomEvent.TrackMuted, renderParticipants)
    .on(RoomEvent.TrackUnmuted, renderParticipants)
    .on(RoomEvent.DataReceived, handleDataReceived)
    .on(RoomEvent.Disconnected, handleDisconnected)
    .on(RoomEvent.ActiveSpeakersChanged, renderParticipants)
    .on(RoomEvent.ConnectionQualityChanged, handleQualityChanged);

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  micEnabled = true;
  setMicButton(true);

  renderStage();
  renderParticipants();
  renderChatEmptyState();
  startStatsLoop();
}

// ============================================================
// Participantes
// ============================================================

function renderParticipants() {
  if (!room) return;

  const speaking = new Set(room.activeSpeakers.map((p) => p.sid));
  const all = [room.localParticipant, ...room.remoteParticipants.values()];

  participantCount.textContent = String(all.length);
  participantsList.innerHTML = '';

  for (const p of all) {
    const isLocal = p === room.localParticipant;
    const name = p.identity || 'sem nome';

    let micOn = true;
    try { micOn = p.isMicrophoneEnabled; } catch { /* SDK sem esse getter */ }

    const el = document.createElement('div');
    el.className = 'participant' + (speaking.has(p.sid) ? ' speaking' : '');
    el.innerHTML = `
      <span class="avatar" style="background:${colorFor(name)}">${escapeHtml(initialsOf(name))}</span>
      <span class="name">${escapeHtml(name)}${isLocal ? ' (você)' : ''}</span>
      ${micOn ? '' : `<span class="muted-ic">${icon('ic-mic-off')}</span>`}
    `;
    participantsList.appendChild(el);
  }
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
  renderParticipants();
  toast(micEnabled ? 'Microfone ligado' : 'Microfone desligado');
}

micBtn.addEventListener('click', toggleMic);

// ============================================================
// Compartilhamento de tela
// ============================================================

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
  const counts = {
    screen: allSources.filter((s) => s.id.startsWith('screen:')).length,
    window: allSources.filter((s) => !s.id.startsWith('screen:')).length,
  };
  $('count-screen').textContent = counts.screen ? `(${counts.screen})` : '';
  $('count-window').textContent = counts.window ? `(${counts.window})` : '';

  for (const seg of document.querySelectorAll('.seg')) {
    seg.classList.toggle('active', seg.dataset.tab === activeTab);
  }
}

function renderSourceGrid() {
  const isScreen = activeTab === 'screen';
  const list = allSources.filter((s) => s.id.startsWith('screen:') === isScreen);

  sourceGrid.innerHTML = '';
  sourceEmpty.classList.toggle('hidden', list.length > 0);

  for (const source of list) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'source-card' + (source.id === selectedSourceId ? ' selected' : '');
    card.dataset.id = source.id;
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
      for (const c of sourceGrid.children) {
        c.classList.toggle('selected', c.dataset.id === selectedSourceId);
      }
      updatePickerFooter();
    });

    // Duplo clique compartilha direto, sem passar pelo botão
    card.addEventListener('dblclick', () => {
      selectedSourceId = source.id;
      confirmPicker.click();
    });

    sourceGrid.appendChild(card);
  }
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
// precisam subir juntos: a CAPTURA (o que o Electron entrega, via
// getUserMedia) e a PUBLICAÇÃO (o que o LiveKit codifica e envia).
// Mexer só num deles não muda nada na prática.
const SHARE_QUALITY = {
  '720p30':  { w: 1280, h: 720,  fps: 30, bitrate: 2500000 },
  '1080p30': { w: 1920, h: 1080, fps: 30, bitrate: 5000000 },
  '1080p60': { w: 1920, h: 1080, fps: 60, bitrate: 8000000 },
  '1440p60': { w: 2560, h: 1440, fps: 60, bitrate: 12000000 },
};

const SHARE_PREFS_KEY = 'voicechat.sharePrefs';

try {
  const prefs = JSON.parse(localStorage.getItem(SHARE_PREFS_KEY) || '{}');
  if (prefs.quality && SHARE_QUALITY[prefs.quality]) qualitySelect.value = prefs.quality;
  if (prefs.mode) modeSelect.value = prefs.mode;
} catch { /* preferências corrompidas não podem impedir o app de abrir */ }

function saveSharePrefs() {
  localStorage.setItem(SHARE_PREFS_KEY, JSON.stringify({
    quality: qualitySelect.value,
    mode: modeSelect.value,
  }));
}

qualitySelect.addEventListener('change', saveSharePrefs);
modeSelect.addEventListener('change', saveSharePrefs);

async function startScreenShare(sourceId) {
  const q = SHARE_QUALITY[qualitySelect.value] || SHARE_QUALITY['1080p30'];
  const degradationPreference = modeSelect.value;

  try {
    // No Electron, a captura de tela usa a API getUserMedia com um
    // "chromeMediaSourceId" apontando pra janela/tela escolhida.
    const stream = await navigator.mediaDevices.getUserMedia({
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

    const videoTrack = stream.getVideoTracks()[0];

    // Sem contentHint o Chromium trata captura de tela como "detalhe" e
    // sacrifica framerate pra preservar nitidez — é a causa mais comum
    // de compartilhamento a 2 fps. O SDK só aplica esse ajuste pelo
    // caminho do setScreenShareEnabled, então setamos na própria faixa.
    videoTrack.contentHint =
      degradationPreference === 'maintain-framerate' ? 'motion' : 'detail';

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

    localScreenStream = stream;
    isSharingScreen = true;
    screenshareBtn.classList.add('on');
    screenshareBtn.title = 'Parar de compartilhar';

    renderStage({ stream, label: 'Você está compartilhando' });
    videoTrack.addEventListener('ended', () => stopScreenShare());
    toast(`Compartilhando em ${qualitySelect.value.replace('p', 'p · ')} fps`);
  } catch (err) {
    console.error('Erro ao compartilhar tela:', err);
    toast('Não foi possível compartilhar essa fonte.', true);
  }
}

async function stopScreenShare() {
  if (!room) return;

  for (const pub of room.localParticipant.trackPublications.values()) {
    if (pub.source === Track.Source.ScreenShare && pub.track) {
      await room.localParticipant.unpublishTrack(pub.track);
    }
  }

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
  }

  isSharingScreen = false;
  screenshareBtn.classList.remove('on');
  screenshareBtn.title = 'Compartilhar tela';
  screenshareBtn.querySelector('use').setAttribute('href', '#ic-screen');

  if (videoArea.querySelector('video[data-owner="local"]')) renderStage();
  toast('Compartilhamento encerrado');
}

// ============================================================
// Palco (vídeo)
// ============================================================

function renderStage(share) {
  videoArea.innerHTML = '';

  if (!share) {
    videoArea.innerHTML = `
      <div class="empty-state">
        <span class="glyph">${icon('ic-screen-off', 'ic ic-lg')}</span>
        <h3>Ninguém está compartilhando a tela</h3>
        <p>Use o botão de tela na barra lateral para começar</p>
      </div>
    `;
    return;
  }

  const badge = document.createElement('div');
  badge.className = 'stage-badge';
  badge.innerHTML = `<span class="live"></span><span>${escapeHtml(share.label)}</span>`;

  let video;
  if (share.element) {
    video = share.element;
  } else {
    video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.srcObject = share.stream;
  }
  video.dataset.owner = share.owner || 'local';

  videoArea.appendChild(video);
  videoArea.appendChild(badge);
}

// ---------- Recebendo tela/áudio de outras pessoas ----------

function handleTrackSubscribed(track, publication, participant) {
  if (track.kind === Track.Kind.Video) {
    const el = track.attach();
    renderStage({
      element: el,
      owner: participant.identity,
      label: `${participant.identity} está compartilhando`,
    });
  } else if (track.kind === Track.Kind.Audio) {
    const el = track.attach();
    el.dataset.owner = participant.identity;
    document.body.appendChild(el); // áudio não precisa aparecer na tela
  }
}

function handleTrackUnsubscribed(track) {
  track.detach().forEach((el) => el.remove());
  if (!videoArea.querySelector('video')) renderStage();
}

// ============================================================
// Chat de texto
// ============================================================

function renderChatEmptyState() {
  if (chatMessages.children.length === 0) {
    chatMessages.innerHTML = '<p class="chat-empty">Nenhuma mensagem ainda.</p>';
  }
}

function clearChatEmptyState() {
  const empty = chatMessages.querySelector('.chat-empty');
  if (empty) empty.remove();
}

chatText.addEventListener('input', () => {
  sendBtn.disabled = chatText.value.trim().length === 0;
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatText.value.trim();
  if (!text || !room) return;

  addChatMessage(myUsername, text, true);

  const data = new TextEncoder().encode(JSON.stringify({ from: myUsername, text }));
  await room.localParticipant.publishData(data, { reliable: true });

  chatText.value = '';
  sendBtn.disabled = true;
});

function handleDataReceived(payload, participant) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    // A identidade vem do LiveKit, não do corpo da mensagem: assim
    // ninguém consegue se passar por outra pessoa no chat.
    const author = participant?.identity || parsed.from || 'desconhecido';
    addChatMessage(author, parsed.text, false);
  } catch (err) {
    console.error('Mensagem de chat inválida:', err);
  }
}

function timeNow() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function addChatMessage(author, text, isMine) {
  clearChatEmptyState();

  const el = document.createElement('div');
  el.className = 'chat-message';
  el.innerHTML = `
    <span class="avatar" style="background:${colorFor(author)}">${escapeHtml(initialsOf(author))}</span>
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
}

function addSystemMessage(text) {
  clearChatEmptyState();
  const el = document.createElement('div');
  el.className = 'chat-message system';
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================
// Painel de conexão: latência, perda e bitrate reais
// ============================================================

const QUALITY_LABEL = {
  excellent: 'Conexão excelente',
  good: 'Conexão boa',
  poor: 'Conexão ruim',
  lost: 'Conexão perdida',
  unknown: 'Medindo…',
};

let statsTimer = null;
let lastSample = null; // { t, bytesSent, bytesReceived }

netToggle.addEventListener('click', () => netPanel.classList.toggle('open'));
netToggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    netPanel.classList.toggle('open');
  }
});

function handleQualityChanged(quality, participant) {
  if (!room || participant !== room.localParticipant) return;
  const key = String(quality || 'unknown').toLowerCase();
  netDot.className = `net-dot ${key}`;
  netLabel.textContent = QUALITY_LABEL[key] || QUALITY_LABEL.unknown;
}

function fmtBitrate(bitsPerSecond) {
  if (!isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '—';
  if (bitsPerSecond >= 1e6) return `${(bitsPerSecond / 1e6).toFixed(1)} Mb/s`;
  return `${Math.round(bitsPerSecond / 1e3)} kb/s`;
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
    rtt: null, jitter: null,
    packetsLost: 0, packetsTotal: 0,
    bytesSent: 0, bytesReceived: 0,
    width: 0, height: 0, fps: 0,           // o que sai codificado
    srcWidth: 0, srcHeight: 0, srcFps: 0,  // o que a captura produz
  };

  for (const { track, local } of tracks) {
    let report;
    try {
      report = await track.getRTCStatsReport();
    } catch { continue; }
    if (!report) continue;

    report.forEach((s) => {
      if (s.type === 'outbound-rtp' && !s.isRemote) {
        acc.bytesSent += s.bytesSent || 0;
        acc.packetsTotal += s.packetsSent || 0;
        if (s.kind === 'video' && s.frameWidth) {
          acc.width = s.frameWidth;
          acc.height = s.frameHeight;
          acc.fps = Math.round(s.framesPerSecond || 0);
        }
      } else if (s.type === 'remote-inbound-rtp') {
        if (typeof s.roundTripTime === 'number') {
          acc.rtt = acc.rtt === null ? s.roundTripTime : Math.max(acc.rtt, s.roundTripTime);
        }
        if (typeof s.jitter === 'number') acc.jitter = s.jitter;
        acc.packetsLost += Math.max(0, s.packetsLost || 0);
      } else if (s.type === 'inbound-rtp' && !local) {
        acc.bytesReceived += s.bytesReceived || 0;
        acc.packetsLost += Math.max(0, s.packetsLost || 0);
        acc.packetsTotal += (s.packetsReceived || 0);
        if (s.kind === 'video' && s.frameWidth) {
          acc.width = s.frameWidth;
          acc.height = s.frameHeight;
          acc.fps = Math.round(s.framesPerSecond || 0);
        }
      } else if (s.type === 'media-source' && s.kind === 'video') {
        // "media-source" é a captura antes do codificador. Comparar com
        // o outbound-rtp diz se o gargalo é a captura ou a codificação.
        if (s.width) {
          acc.srcWidth = s.width;
          acc.srcHeight = s.height;
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

  // Latência: metade do RTT é o caminho de ida, mas o número que
  // importa pra percepção de atraso é o RTT completo.
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

  paint('net-capture',
    acc.srcWidth ? `${acc.srcWidth}×${acc.srcHeight} · ${acc.srcFps} fps` : '—',
    acc.srcWidth && acc.srcFps < 10 ? 'warn' : '');

  paint('net-video',
    acc.width ? `${acc.width}×${acc.height} · ${acc.fps} fps` : '—',
    acc.width && acc.fps < 10 ? 'warn' : '');

  // Com dynacast ligado, o LiveKit pausa o envio quando ninguém assina
  // a faixa. Sozinho na sala o fps despenca — e isso é esperado.
  const others = room.remoteParticipants.size;
  paint('net-subs',
    others === 0 ? 'ninguém' : `${others} pessoa${others > 1 ? 's' : ''}`,
    others === 0 && isSharingScreen ? 'warn' : '');
}

function startStatsLoop() {
  stopStatsLoop();
  lastSample = null;
  netDot.className = 'net-dot';
  netLabel.textContent = QUALITY_LABEL.unknown;
  statsTimer = setInterval(sampleStats, 2000);
  sampleStats();
}

function stopStatsLoop() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
  const rows = ['net-rtt', 'net-loss', 'net-up', 'net-down', 'net-capture', 'net-video', 'net-subs'];
  for (const id of rows) paint(id, '—');
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

  if (localScreenStream) {
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
  }

  stopStatsLoop();

  while (openModals.length) closeTopModal();

  chatMessages.innerHTML = '';
  participantsList.innerHTML = '';
  screenshareBtn.classList.remove('on');
  setMicButton(true);
  renderStage();

  mainScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  clearError();
}

// Estado inicial da tela de palco antes de qualquer conexão
renderStage();
