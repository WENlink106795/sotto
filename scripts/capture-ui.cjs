const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'out', 'renderer-web', 'index.html');
const OUT_DIR = path.join(ROOT, 'screenshots');

const shots = [
  { name: '01-empty-fluent-dark', view: 'empty', theme: 'fluent', mode: 'dark' },
  { name: '02-workspace-fluent-dark', view: 'workspace', theme: 'fluent', mode: 'dark' },
  { name: '03-workspace-material-light', view: 'workspace', theme: 'material', mode: 'light' },
  { name: '04-workspace-studio-dark', view: 'workspace', theme: 'studio', mode: 'dark' },
  { name: '05-settings-fluent-dark', view: 'settings', theme: 'fluent', mode: 'dark' },
  { name: '06-settings-material-light', view: 'settings', theme: 'material', mode: 'light' },
  { name: '07-history-fluent-dark', view: 'history', theme: 'fluent', mode: 'dark' },
  { name: '08-empty-material-light', view: 'empty', theme: 'material', mode: 'light' }
];

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!fs.existsSync(INDEX)) {
    console.error('Renderer build not found at ' + INDEX + '. Run: npm run build:web');
    app.quit();
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const selected = only ? shots.filter((shot) => only.includes(shot.name)) : shots;
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#0d0d12',
    webPreferences: {
      offscreen: false,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[renderer:' + level + '] ' + message + ' (' + sourceId + ':' + line + ')');
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[capture] renderer gone:', JSON.stringify(details));
  });

  for (const shot of selected) {
    console.log('[capture] ' + shot.name);
    try {
      await win.loadFile(INDEX, {
        query: {
          view: shot.view,
          theme: shot.theme,
          mode: shot.mode,
          capture: '1'
        }
      });
      await win.webContents.executeJavaScript(
        'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true'
      );
      // Hidden windows throttle timers; give the demo bridge enough wall time
      // to finish boot + scan + plan before capturing.
      await timeout(5000);
      const image = await win.webContents.capturePage();
      const target = path.join(OUT_DIR, shot.name + '.png');
      fs.writeFileSync(target, image.toPNG());
      const size = image.getSize();
      console.log(
        '[capture] wrote ' + path.relative(ROOT, target) + ' ' + size.width + 'x' + size.height
      );
    } catch (error) {
      console.error('[capture] failed for ' + shot.name + ':', error && error.message ? error.message : error);
    }
    await timeout(300);
  }
  win.destroy();
  app.quit();
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
