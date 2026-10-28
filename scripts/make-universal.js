// Builds one universal macOS app (Apple Silicon + Intel) from the arm64 and x64 builds, without a Mac:
// every Mach-O file that differs between the two is joined with lipo (llvm-lipo works on Linux),
// everything else must be identical and is copied as is. Symlinks inside the frameworks are kept.
//
//   node scripts/make-universal.js <x64.app> <arm64.app> <out.app>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [x64App, armApp, outApp] = process.argv.slice(2);
if (!outApp) {
  console.error('usage: make-universal.js <x64.app> <arm64.app> <out.app>');
  process.exit(1);
}

const LIPO = ['lipo', 'llvm-lipo', 'llvm-lipo-18', 'llvm-lipo-17'].find((bin) => {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!LIPO) throw new Error('lipo / llvm-lipo not found (apt install llvm)');

const MACHO_MAGIC = new Set([0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe, 0xbebafeca]);
function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(4);
  const n = fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  return n === 4 && MACHO_MAGIC.has(buf.readUInt32BE(0));
}

const same = (a, b) => fs.statSync(a).size === fs.statSync(b).size && fs.readFileSync(a).equals(fs.readFileSync(b));

fs.rmSync(outApp, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outApp), { recursive: true });
execFileSync('cp', ['-a', armApp, outApp]); // start from arm64, keeping symlinks and permissions

let merged = 0;
const problems = [];
function walk(rel) {
  const out = path.join(outApp, rel);
  const x64 = path.join(x64App, rel);
  const st = fs.lstatSync(out);
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(out)) walk(path.join(rel, name));
    return;
  }
  if (!fs.existsSync(x64)) return; // e.g. v8_context_snapshot.arm64.bin: each arch has its own
  if (same(out, x64)) return;
  if (isMachO(out) && isMachO(x64)) {
    execFileSync(LIPO, ['-create', x64, path.join(armApp, rel), '-output', out]);
    fs.chmodSync(out, st.mode);
    merged++;
  } else if (!/(LICENSE|README)[^/]*$/.test(rel)) problems.push(`differs and is not a binary: ${rel}`);
}
walk('');

// Files only the Intel build has (v8_context_snapshot.x86_64.bin ...) are added next to the arm64 ones.
let added = 0;
function addMissing(rel) {
  const src = path.join(x64App, rel);
  const dst = path.join(outApp, rel);
  const st = fs.lstatSync(src);
  if (!fs.existsSync(dst) && !isLink(dst)) {
    execFileSync('cp', ['-a', src, dst]);
    added++;
    return;
  }
  if (st.isDirectory() && !st.isSymbolicLink()) for (const name of fs.readdirSync(src)) addMissing(path.join(rel, name));
}
function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
addMissing('');

console.log(`universal app: ${merged} binaries joined with ${LIPO}, ${added} Intel-only files added`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
