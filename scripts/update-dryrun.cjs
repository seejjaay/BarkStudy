// Spike S5, second half: does an installed 0.1.0 find, download and apply a newer 0.1.1? Uses a local server on a fixed port in
// place of GitHub Releases, so it tests the updater mechanics but not GitHub specifics.
//   node scripts/update-dryrun.cjs
// This INSTALLS BarkStudy on this PC (per user, under %LOCALAPPDATA%\Programs\BarkStudy) and runs it against the real
// %APPDATA%\BarkStudy folder, because a packaged build pins its data folder. The data and logs folders are copied away first
// and put back at the end, whatever happens. It refuses to start if BarkStudy is installed or running already.
// One step needs a person: when the script says so, click "Restart to update" in the tray menu.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const work = path.join(root, 'release', 'dryrun');
const PORT = 47613;
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'BarkStudy');
const installedExe = path.join(installDir, 'BarkStudy.exe');
const uninstaller = path.join(installDir, 'Uninstall BarkStudy.exe');
const userData = path.join(process.env.APPDATA, 'BarkStudy');
const keep = ['data', 'logs'];

let failed = 0;
const report = (ok, line) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
  if (!ok) failed++;
};
const step = (line) => console.log(`\n== ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npx', ...opts });

function running() {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq BarkStudy.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return out.toLowerCase().includes('barkstudy.exe');
}
function killApp() {
  try {
    execFileSync('taskkill', ['/F', '/T', '/IM', 'BarkStudy.exe'], { stdio: 'ignore' });
  } catch {
    // none running
  }
}
function fileVersion(exe) {
  return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim();
}
function logText() {
  try {
    return fs.readFileSync(path.join(userData, 'logs', 'app.log'), 'utf8');
  } catch {
    return '';
  }
}
async function waitFor(what, ms, test) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(2000);
  }
  console.log(`   (gave up waiting for ${what})`);
  return false;
}
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []);

/** Builds one version into release/dryrun/<name>, with the GitHub feed swapped for the local server. */
function build(name, version) {
  const out = path.join(work, name);
  const yml = fs
    .readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
    .replace(/publish:[\s\S]*$/, `publish:\n  provider: generic\n  url: http://127.0.0.1:${PORT}/\n`)
    .replace(/output: release/, `output: ${out.replace(/\\/g, '/')}`);
  const config = path.join(work, `config-${name}.yml`);
  fs.writeFileSync(config, yml);
  run('npx', ['electron-builder', '--win', '--publish', 'never', '--config', config, `-c.extraMetadata.version=${version}`]);
  return out;
}

function serve(dir) {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m) {
      const start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
      const end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': size });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', (err) => reject(new Error(err.code === 'EADDRINUSE' ? `port ${PORT} is taken by another process; not touching it` : err.message)));
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  step('Before anything: nothing installed or running');
  if (fs.existsSync(installDir) || running()) {
    console.log(`FAIL  BarkStudy is already installed (${installDir}) or running. Quit and uninstall it first; this script will not overwrite it.`);
    process.exit(1);
  }
  // The installed app reads the real settings: with update checks off it would never look, and the wait would just time out.
  try {
    if (JSON.parse(fs.readFileSync(path.join(userData, 'data', 'settings.json'), 'utf8')).data?.updateChecks === false) {
      console.log('FAIL  "Check for updates" is off in your BarkStudy settings, so the installed app would never look. Turn it on and run again.');
      process.exit(1);
    }
  } catch {
    // no settings yet: the defaults have checks on
  }

  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'barkstudy-dryrun-backup-'));
  for (const name of keep) if (fs.existsSync(path.join(userData, name))) fs.cpSync(path.join(userData, name), path.join(backup, name), { recursive: true });
  console.log(`   your data and logs are copied to ${backup} and restored at the end`);
  const dataBefore = listFiles(path.join(backup, 'data'));
  let server = null;
  let installed = false;

  try {
    step('Build 0.1.0 and 0.1.1 against the local feed');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    run('npx', ['electron-vite', 'build']);
    run('npx', ['tsx', 'scripts/make-icon.ts']);
    const a = build('a', '0.1.0');
    const b = build('b', '0.1.1');

    step('Serve 0.1.1 and install 0.1.0');
    server = await serve(b);
    const logStart = logText().length;
    execFileSync(path.join(a, 'BarkStudy-Setup-0.1.0.exe'), ['/S'], { stdio: 'inherit' });
    installed = true;
    report(fs.existsSync(installedExe), 'a silent per-user install put BarkStudy.exe under Programs');
    report(fileVersion(installedExe).startsWith('0.1.0'), `the installed version is ${fileVersion(installedExe)}`);
    await sleep(3000);
    if (!running()) spawn(installedExe, [], { detached: true, stdio: 'ignore' }).unref();
    report(await waitFor('the app to start', 30_000, running), 'BarkStudy 0.1.0 is running');

    step('Wait for the update check (30 s after launch) and the download');
    // Only this run's lines count: an app.log from an earlier run already says it downloaded.
    const downloaded = () => {
      const text = logText();
      return (text.length >= logStart ? text.slice(logStart) : text).includes('update 0.1.1 downloaded');
    };
    report(await waitFor('the download', 240_000, downloaded), 'the app found 0.1.1 and downloaded it (see the updater lines in app.log)');

    step('PERSON NEEDED: open the tray menu (bottom right, maybe under ^) and click "Restart to update to 0.1.1"');
    console.log('   Also worth a look first: start a session, and the item should read "...restarts after this session" and not click.');
    report(await waitFor('the restart', 600_000, () => fileVersion(installedExe).startsWith('0.1.1') && running()), 'the app restarted into 0.1.1 and is running');
    report(fileVersion(installedExe).startsWith('0.1.1'), `the installed version is now ${fileVersion(installedExe)}`);
    console.log('   0.1.1 is up: look at its window and the notification area now. It stays open for 45 s, then the script uninstalls it.');
    await sleep(45_000);
    const dataAfter = listFiles(path.join(userData, 'data'));
    report(dataBefore.every((f) => dataAfter.includes(f)), 'every data file from before is still there after the update');

    step('Silent uninstall: data stays, no prompt');
    killApp();
    await sleep(2000);
    execFileSync(uninstaller, ['/S'], { stdio: 'inherit' });
    report(await waitFor('the uninstall', 60_000, () => !fs.existsSync(installedExe)), 'BarkStudy.exe is gone');
    installed = false;
    report(dataBefore.every((f) => listFiles(path.join(userData, 'data')).includes(f)), 'a silent uninstall kept the data folder');
  } catch (err) {
    console.error(err);
    failed++;
  } finally {
    step('Cleanup: stop the app and the server, put your data back');
    killApp();
    if (server) server.close();
    await sleep(2000);
    // The run's own log is the evidence if a step failed, and the restore below replaces it.
    try {
      fs.copyFileSync(path.join(userData, 'logs', 'app.log'), path.join(work, 'app.log'));
      console.log(`   this run's app.log is kept at ${path.join(work, 'app.log')}`);
    } catch {
      // no log was written
    }
    if (installed && fs.existsSync(uninstaller)) {
      try {
        execFileSync(uninstaller, ['/S'], { stdio: 'ignore' });
        await sleep(5000);
      } catch {
        console.log('   could not remove the test install; remove BarkStudy in Settings > Apps');
      }
    }
    for (const name of keep) {
      fs.rmSync(path.join(userData, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      if (fs.existsSync(path.join(backup, name))) fs.cpSync(path.join(backup, name), path.join(userData, name), { recursive: true });
    }
    console.log(`   data restored; the copy stays at ${backup} until you delete it`);
  }
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
