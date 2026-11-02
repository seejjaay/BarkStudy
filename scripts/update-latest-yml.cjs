// Keeps latest.yml (the file electron-updater reads) in step with the installer that is actually uploaded.
//   node scripts/update-latest-yml.cjs <latest.yml> <installer.exe>           rewrites its sha512 and size from the installer
//   node scripts/update-latest-yml.cjs --check <latest.yml> <installer.exe>   changes nothing; exits 1 if they do not match
// Signing changes the installer's bytes, so the hash electron-builder wrote before signing is wrong afterwards, and the
// updater refuses a download whose hash does not match. The release workflow rewrites after signing and always checks before
// uploading. A signed installer also has no matching blockmap, so the size of one is dropped and updates download in full.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

function hashFile(file) {
  const bytes = fs.readFileSync(file);
  return { sha512: crypto.createHash('sha512').update(bytes).digest('base64'), size: bytes.length };
}

function parse(text) {
  const doc = yaml.load(text);
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.files)) throw new Error('latest.yml has no files list');
  return doc;
}

/** The yaml with the entry for `installerName` (and the top-level hash, if it names that file) set to `hash`. */
function updateLatestYml(text, installerName, hash) {
  const doc = parse(text);
  const entry = doc.files.find((f) => f.url === installerName);
  if (!entry) throw new Error(`latest.yml does not list ${installerName}`);
  entry.sha512 = hash.sha512;
  entry.size = hash.size;
  delete entry.blockMapSize;
  if (doc.path === installerName) doc.sha512 = hash.sha512;
  return yaml.dump(doc, { lineWidth: -1 });
}

/** What is wrong with latest.yml for this installer: an empty list means the updater will accept it. */
function checkLatestYml(text, installerName, hash) {
  const problems = [];
  const doc = parse(text);
  const entry = doc.files.find((f) => f.url === installerName);
  if (!entry) return [`latest.yml does not list ${installerName}`];
  if (entry.sha512 !== hash.sha512) problems.push('the sha512 of the file entry does not match the installer');
  if (entry.size !== hash.size) problems.push(`the size is ${entry.size} but the installer is ${hash.size} bytes`);
  if (doc.path === installerName && doc.sha512 !== hash.sha512) problems.push('the top-level sha512 does not match the installer');
  return problems;
}

module.exports = { hashFile, updateLatestYml, checkLatestYml };

if (require.main === module) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  const [latest, installer] = check ? args.slice(1) : args;
  if (!latest || !installer) {
    console.error('usage: update-latest-yml.cjs [--check] <latest.yml> <installer.exe>');
    process.exit(2);
  }
  const text = fs.readFileSync(latest, 'utf8');
  const name = path.basename(installer);
  const hash = hashFile(installer);
  if (check) {
    const problems = checkLatestYml(text, name, hash);
    for (const p of problems) console.error(`FAIL  ${p}`);
    console.log(problems.length === 0 ? `PASS  ${path.basename(latest)} matches ${name}` : '');
    process.exit(problems.length === 0 ? 0 : 1);
  }
  fs.writeFileSync(latest, updateLatestYml(text, name, hash));
  console.log(`updated ${path.basename(latest)} for ${name}: ${hash.size} bytes`);
}
