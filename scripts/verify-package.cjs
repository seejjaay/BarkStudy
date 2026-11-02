// Checks the unpacked build that `npm run package` leaves in release/win-unpacked, and prints PASS/FAIL per line.
//   node scripts/verify-package.cjs
// Exits 1 on any FAIL. It never starts the app except for the tamper check, and that copy is expected to die before any of
// our code runs. (A run-as-node behaviour test is left out on purpose: with the fuse off, the exe would start the real app
// against the real %APPDATA%\BarkStudy, so the fuse bytes are the check.)
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const unpacked = path.join(__dirname, '..', 'release', 'win-unpacked');
const exe = path.join(unpacked, 'BarkStudy.exe');
let failed = 0;
const report = (ok, line) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
  if (!ok) failed++;
};

function running() {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq BarkStudy.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return out.toLowerCase().includes('barkstudy.exe');
}

async function fuses() {
  const { getCurrentFuseWire, FuseV1Options, FuseState } = await import('@electron/fuses');
  const wire = await getCurrentFuseWire(exe);
  const want = [
    ['RunAsNode', FuseV1Options.RunAsNode, FuseState.DISABLE],
    ['EnableNodeOptionsEnvironmentVariable', FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    ['EnableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    ['OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    ['EnableEmbeddedAsarIntegrityValidation', FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  ];
  for (const [name, key, state] of want) report(wire[key] === state, `fuse ${name} is ${state === FuseState.ENABLE ? 'on' : 'off'}`);
}

function layout() {
  const res = path.join(unpacked, 'resources');
  report(fs.existsSync(path.join(res, 'app.asar')), 'the app is packed in app.asar');
  report(fs.existsSync(path.join(res, 'app.asar.unpacked', 'node_modules', 'koffi')), 'koffi is unpacked beside the asar');
  const update = fs.existsSync(path.join(res, 'app-update.yml')) ? fs.readFileSync(path.join(res, 'app-update.yml'), 'utf8') : '';
  report(/^provider: github$/m.test(update) && /^owner: seejjaay$/m.test(update) && /^repo: BarkStudy$/m.test(update), 'app-update.yml points at the seejjaay/BarkStudy GitHub releases');
}

/**
 * Flips one byte inside the app.asar header of a throwaway copy and expects the exe to refuse to start. Electron's embedded
 * integrity check hashes the archive header (the file table), not the file data, so the byte has to be in the header.
 */
async function tamper() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'barkstudy-tamper-'));
  try {
    fs.cpSync(unpacked, copy, { recursive: true });
    const asar = path.join(copy, 'resources', 'app.asar');
    const fd = fs.openSync(asar, 'r+');
    const at = 24; // the asar header is JSON starting at byte 16
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, at);
    b[0] ^= 0xff;
    fs.writeSync(fd, b, 0, 1, at);
    fs.closeSync(fd);

    const child = spawn(path.join(copy, 'BarkStudy.exe'), [], { stdio: 'ignore' });
    const outcome = await new Promise((resolve) => {
      child.on('exit', (code) => resolve({ exited: true, code }));
      setTimeout(() => resolve({ exited: false }), 10_000);
    });
    if (!outcome.exited) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      } catch {
        // already gone
      }
    }
    report(outcome.exited && outcome.code !== 0, outcome.exited ? `a tampered app.asar is refused (exit code ${outcome.code})` : 'a tampered app.asar is refused (it kept running!)');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // let a killed process release its files
    fs.rmSync(copy, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}

(async () => {
  if (!fs.existsSync(exe)) {
    console.log(`FAIL  ${exe} not found: run npm run package first`);
    process.exit(1);
  }
  await fuses();
  layout();
  if (running()) {
    console.log('SKIP  tamper check: BarkStudy is already running, so a stray start could clash with it. Quit it and run again.');
    failed++;
  } else {
    await tamper();
    report(!running(), 'no BarkStudy process is left behind');
  }
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
