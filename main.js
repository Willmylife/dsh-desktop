const { app, BrowserWindow, shell, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PORT = 3080;
const URL = `http://127.0.0.1:${PORT}/`;

let mainWindow = null;
let serverProcess = null;
let serverSpawned = false;
let tray = null;
let hideHintShown = false;

function iconPath() {
  // In packaged builds only main.js + build/ ship in the app dir (asar disabled).
  return path.join(__dirname, 'build', 'dsh.ico');
}

function createTray() {
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('DeepSeek Harness');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示窗口 / Show',
      click: () => showMainWindow()
    },
    {
      label: '退出 / Quit',
      click: () => {
        app.quit();
      }
    }
  ]));
  tray.on('click', () => showMainWindow());
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    loadAppWhenReady();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function dshBinPath() {
  // The server tree ships verbatim under resources/app-server (extraResources,
  // immune to electron-builder's node_modules pruning). In dev, prepare.ps1
  // renames server/node_modules to dsh-modules for the same reason.
  const bases = app.isPackaged
    ? [path.join(process.resourcesPath, 'app-server', 'node_modules')]
    : [path.join(__dirname, 'server', 'dsh-modules'), path.join(__dirname, 'server', 'node_modules')];
  for (const base of bases) {
    const pkgPath = path.join(base, '@deepseek-ai', 'dsh', 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin.dsh);
    return path.join(base, '@deepseek-ai', 'dsh', bin);
  }
  throw new Error(`dsh server tree not found (looked in: ${bases.join(', ')})`);
}

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function nodeRuntimePath() {
  // The bundled Node 22 runtime keeps dsh's native modules (node-pty) and the
  // profile plugin resolver working exactly as under a plain `npx dsh web` setup.
  if (app.isPackaged) return path.join(process.resourcesPath, 'node', 'node.exe');
  const devNode = path.join(__dirname, 'runtime', 'node', 'node.exe');
  return fs.existsSync(devNode) ? devNode : 'node';
}

function startServer() {
  return new Promise((resolve, reject) => {
    const logFile = path.join(app.getPath('userData'), 'dsh-server.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    logStream.write(`\n[${new Date().toISOString()}] starting dsh web\n`);

    try {
      serverProcess = spawn(nodeRuntimePath(), [dshBinPath(), 'web'], {
        cwd: app.getPath('home'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      serverSpawned = true;
    } catch (err) {
      reject(err);
      return;
    }

    serverProcess.stdout.pipe(logStream, { end: false });
    serverProcess.stderr.pipe(logStream, { end: false });
    serverProcess.on('error', (err) => {
      logStream.write(`[${new Date().toISOString()}] spawn error: ${err.message}\n`);
      serverProcess = null;
    });
    serverProcess.on('exit', (code) => {
      logStream.write(`[${new Date().toISOString()}] dsh web exited with code ${code}\n`);
      serverProcess = null;
    });

    // Wait until the server answers HTTP (dsh reloads bundles on start; can take a while).
    const deadline = Date.now() + 180000;
    (function poll() {
      checkServer().then((up) => {
        if (up) { resolve(true); return; }
        if (Date.now() > deadline || !serverProcess) { reject(new Error('dsh web did not start')); return; }
        setTimeout(poll, 1500);
      });
    })();
  });
}

function killServer() {
  if (serverProcess && serverProcess.pid) {
    try { execSync(`taskkill /PID ${serverProcess.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    serverProcess = null;
  }
}

const loadingPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title><style>body{font-family:system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}.spinner{width:44px;height:44px;border:4px solid #45475a;border-top-color:#89b4fa;border-radius:50%;animation:r 1s linear infinite;margin-bottom:18px}@keyframes r{to{transform:rotate(360deg)}}p{font-size:14px}</style></head><body><div class="spinner"></div><p>DeepSeek Harness </p></body></html>`)}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'dsh.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#1e1e2e',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(loadingPage);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links (docs, market pages) in the system browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:3080') || url.startsWith('http://localhost:3080')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing hides to the tray: the app and its dsh server keep running
  // so sessions stay alive; quit from the tray menu instead.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (!hideHintShown && tray) {
        hideHintShown = true;
        tray.displayBalloon({
          iconType: 'info',
          title: 'DeepSeek Harness',
          content: '已最小化到系统托盘，服务器保持运行。右键托盘图标可退出。 / Still running in the tray — right-click the tray icon to quit.'
        });
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadAppWhenReady() {
  checkServer().then((alreadyUp) => {
    const ready = alreadyUp ? Promise.resolve() : startServer();
    ready.then(() => {
      if (mainWindow) mainWindow.loadURL(URL).catch(() => {});
    }).catch((err) => {
      const logFile = path.join(app.getPath('userData'), 'dsh-server.log');
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] load failed: ${err.message}\n`);
      if (!mainWindow) return;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title>` +
        `<style>body{font-family:system-ui,sans-serif;background:#1e1e2e;color:#f38ba8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}pre{white-space:pre-wrap;max-width:70ch}</style></head>` +
        `<body><pre>DeepSeek Harness : ${err.message}\n\n${path.join(app.getPath('userData'), 'dsh-server.log')}</pre></body></html>`
      )}`);
    });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    createTray();
    createWindow();
    loadAppWhenReady();

    app.on('activate', () => {
      showMainWindow();
    });
  });

  // Quit flow: tray menu Quit or OS shutdown. The 'close' handler hides the
  // window instead of destroying it, so window-all-closed only fires on real quit.
  app.on('before-quit', () => {
    app.isQuitting = true;
    if (tray) { tray.destroy(); tray = null; }
    killServer();
  });
}
