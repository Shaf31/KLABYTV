// Downloads ffmpeg builds into vendor/ffmpeg/<target>/ using the ffmpeg-static package:
// macOS arm64 + Intel and Windows x64. Runs automatically before the mac/win dist scripts.
// `node scripts/fetch-ffmpeg.js mac` or `... win` fetches only those.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const TARGETS = [
  { dir: 'mac-arm64', platform: 'darwin', arch: 'arm64', exe: 'ffmpeg' },
  { dir: 'mac-x64', platform: 'darwin', arch: 'x64', exe: 'ffmpeg' },
  { dir: 'win-x64', platform: 'win32', arch: 'x64', exe: 'ffmpeg.exe' },
];
const only = process.argv[2];
for (const { dir, platform, arch, exe } of TARGETS) {
  if (only && !dir.startsWith(only)) continue;
  const dest = path.join(root, 'vendor', 'ffmpeg', dir);
  if (fs.existsSync(path.join(dest, exe))) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
  console.log(`downloading ffmpeg for ${dir}…`);
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', '--no-audit', '--no-fund', 'ffmpeg-static@5.3.0'], {
    cwd: tmp,
    stdio: 'inherit',
    env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch },
  });
  fs.mkdirSync(dest, { recursive: true });
  const pkg = path.join(tmp, 'node_modules', 'ffmpeg-static');
  for (const f of [exe, 'ffmpeg.LICENSE', 'ffmpeg.exe.LICENSE']) {
    if (fs.existsSync(path.join(pkg, f))) fs.copyFileSync(path.join(pkg, f), path.join(dest, f.replace('.exe.', '.')));
  }
  fs.chmodSync(path.join(dest, exe), 0o755);
}
