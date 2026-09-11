// Processo principal do Electron.
// Responsável por abrir a janela do app e liberar permissões de
// microfone e captura de tela (necessárias para voz e screen share).

const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, session } = require('electron');
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
  mainWindow.once('ready-to-show', () => mainWindow.show());

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
}

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
