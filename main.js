// Processo principal do Electron.
// Responsável por abrir a janela do app e liberar permissões de
// microfone e captura de tela (necessárias para voz e screen share).

const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#1c1c1e',
    show: false, // evita o flash branco antes do CSS carregar
    // Esconde a moldura nativa e desenha só os botões de janela por
    // cima: a barra de título passa a ser a <div class="titlebar">
    // do index.html, que tem -webkit-app-region: drag.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1c1c1e',
      symbolColor: '#98989d',
      height: 38,
    },
    webPreferences: {
      // Este app só carrega os próprios arquivos locais (renderer/index.html),
      // nunca páginas remotas — por isso é seguro usar nodeIntegration aqui,
      // o que deixa o renderer.js usar "require('livekit-client')" direto,
      // sem precisar de um bundler (webpack/vite) no projeto.
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setupUpdates(mainWindow);
  });

  // Por segurança, mesmo sendo um app confiável: nunca deixa esta janela
  // navegar para um site externo nem abrir novas janelas para fora do app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Permite que o navegador embutido use o microfone sem perguntar
  // a cada vez (o usuário já vai autorizar a captura de tela via
  // desktopCapturer abaixo).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Captura de tela COM áudio do sistema.
  //
  // O áudio de loopback (o que sai pelas caixas) não é acessível pelo
  // renderer sozinho: só o processo principal pode concedê-lo, através
  // deste handler. O renderer avisa antes qual fonte escolheu, via
  // "prepare-share", e depois chama getDisplayMedia — é esta função
  // que decide o que realmente será entregue.
  //
  // 'loopback' é suportado apenas no Windows. Em outros sistemas o
  // pedido segue sem áudio, em vez de falhar.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const chosen = sources.find((s) => s.id === pendingShare?.id) || sources[0];

      if (!chosen) return callback({});

      const wantsAudio = pendingShare?.audio && process.platform === 'win32';
      callback({ video: chosen, audio: wantsAudio ? 'loopback' : undefined });
    } catch (err) {
      console.error('Falha ao preparar a captura de tela:', err);
      callback({});
    }
  });
}

// Qual fonte o usuário escolheu no seletor do app, e se pediu áudio.
// Fica aqui porque o handler acima roda no processo principal.
let pendingShare = null;

ipcMain.handle('prepare-share', (_event, payload) => {
  pendingShare = payload || null;
  return process.platform === 'win32';
});

ipcMain.handle('app-version', () => app.getVersion());

// ---------- Atualização automática ----------
//
// O app consulta os Releases do repositório no GitHub, compara com a
// versão instalada e baixa a nova em segundo plano. A instalação só
// acontece quando o usuário aceita reiniciar (ou ao fechar o app).
//
// Só funciona no app empacotado: em desenvolvimento não existe versão
// instalada com que comparar, e o updater reclamaria.

function setupUpdates(win) {
  if (!app.isPackaged) return;

  const send = (payload) => {
    if (win && !win.isDestroyed()) win.webContents.send('update-status', payload);
  };

  autoUpdater.autoDownload = true;
  // Se a pessoa não reiniciar na hora, a atualização entra no próximo
  // fechamento do app — sem pedir nada de novo.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    // Falha de atualização nunca pode atrapalhar quem só quer conversar
    console.error('Atualização falhou:', err);
    send({ state: 'idle' });
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  // Reconfere de tempos em tempos, para quem deixa o app aberto por dias
  setInterval(check, 2 * 60 * 60 * 1000);
}

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Lista as janelas/telas disponíveis para compartilhar.
// O renderer chama isso via preload.js -> ipcRenderer.
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 200 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
  }));
});

app.whenReady().then(() => {
  // O app não usa nenhum item do menu padrão (File/Edit/View/Window/Help),
  // e ele só polui a janela — então some com ele.
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
