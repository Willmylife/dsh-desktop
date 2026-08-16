const { app, BrowserWindow, shell } = require('electron');
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

function dshBinPath() {
  // The server tree ships verbatim under resources/app-server (extraResources,
  // immune to electron-builder's node_modules pruning).
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app-server')
    : path.join(__dirname, 'server');
  const pkgPath = path.join(base, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && pkg.bin.dsh);
  return path.join(base, 'node_modules', '@deepseek-ai', 'dsh', bin);
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

  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadAppWhenReady() {
  checkServer().then((alreadyUp) => {
    const ready = alreadyUp ? Promise.resolve() : startServer();
    ready.then(() => {
      if (mainWindow) mainWindow.loadURL(URL).catch(() => {});
    }).catch((err) => {
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    loadAppWhenReady();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        loadAppWhenReady();
      }
    });
  });

  app.on('before-quit', killServer);
  app.on('window-all-closed', () => {
    killServer();
    app.quit();
  });
}
