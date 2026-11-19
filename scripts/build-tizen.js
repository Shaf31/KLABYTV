#!/usr/bin/env node
// Builds the Samsung TV (Tizen) app: dist/tizen/KLABYTV is a Tizen web project (the same interface
// as the other apps + src/web/core.js + src/web/tizen.js), written for older TV browsers too.
//
//   node scripts/build-tizen.js                -> dist/tizen/KLABYTV (the project)
//   node scripts/build-tizen.js --package NAME -> also dist/tizen/KLABYTV.wgt, signed with the Tizen
//                                                 Studio security profile NAME (needs the tizen CLI)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const css = require('lightningcss');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'tizen', 'KLABYTV');
const pkg = require(path.join(ROOT, 'package.json'));
// Oldest TV browser supported: Chromium 69 (Samsung TVs from 2020, Tizen 5.5).
const JS_TARGET = 'chrome69';
const CSS_TARGETS = { chrome: 69 << 16 };

const version = (pkg.version.match(/^\d+\.\d+\.\d+/) || ['1.0.0'])[0]; // Tizen allows digits only
const PACKAGE_ID = 'KLABYTVapp'; // 10 letters/digits, fixed: changing it makes a different app on the TV

function js(from, to) {
  const out = esbuild.transformSync(fs.readFileSync(from, 'utf8'), { loader: 'js', target: JS_TARGET, charset: 'utf8', sourcefile: path.basename(from) });
  fs.writeFileSync(to, out.code);
}

// Split a CSS value on top-level spaces ("calc(-1 * x) 4px" -> 2 parts).
function cssParts(value) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) {
      if (cur) parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function cssFile(from, to) {
  let { code } = css.transform({ filename: path.basename(from), code: fs.readFileSync(from), targets: CSS_TARGETS, minify: false });
  // lightningcss keeps the *-inline shorthands when their value uses var(); Chromium only knows them
  // from version 87. With one value they are the same on both sides, so left/right says the same.
  code = code.toString().replace(/(^|[;{\s])(inset|margin|padding|scroll-padding)-inline:\s*([^;}]+);/g, (m, pre, prop, value) => {
    const v = cssParts(value);
    if (v.length !== 1) throw new Error(`${prop}-inline with two values: ${value}`);
    const side = (s) => (prop === 'inset' ? s : `${prop}-${s}`);
    return `${pre}${side('left')}: ${v[0]}; ${side('right')}: ${v[0]};`;
  });
  fs.writeFileSync(to, code);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else if (e.name.endsWith('.js')) js(a, b);
    else if (e.name.endsWith('.css')) cssFile(a, b);
    else if (e.name !== 'index.html') fs.copyFileSync(a, b);
  }
}

function indexHtml() {
  let html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
    .replace(/\s*<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
    .replace(/\s*<script src="\.\.\/\.\.\/node_modules\/[^"]+"><\/script>/g, '') // Samsung's player instead of hls.js / mpegts.js
    .replace('<script src="i18n.js"></script>', [
      '<script src="i18n.js"></script>',
      '  <script src="$WEBAPIS/webapis/webapis.js"></script>',
      '  <script src="web/core.js"></script>',
      '  <script src="web/tizen.js"></script>',
    ].join('\n'));
  if (!html.includes('web/tizen.js') || html.includes('node_modules')) throw new Error('index.html: unexpected layout');
  return html;
}

function configXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="https://github.com/Shaf31/KLABYTV" version="${version}" viewmodes="maximized">
    <tizen:application id="${PACKAGE_ID}.KLABYTV" package="${PACKAGE_ID}" required_version="3.0"/>
    <tizen:profile name="tv-samsung"/>
    <content src="index.html"/>
    <icon src="icon.png"/>
    <name>KLABYTV</name>
    <description>IPTV player for Xtream Codes and M3U playlists. A player only: it needs your own IPTV subscription.</description>
    <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>
    <!-- IPTV servers can be anywhere, on any port, over http or https -->
    <access origin="*" subdomains="true"/>
    <!-- without a policy the TV applies a strict default; streams, images and Samsung's player
         (an <object>) come from anywhere -->
    <tizen:content-security-policy>default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; object-src *; media-src * data: blob:; img-src * data: blob:; connect-src *; style-src * 'unsafe-inline'; font-src * data:</tizen:content-security-policy>
    <tizen:allow-navigation>*</tizen:allow-navigation>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.audio"/>
    <tizen:privilege name="http://tizen.org/privilege/download"/>
    <tizen:privilege name="http://tizen.org/privilege/filesystem.read"/>
    <tizen:privilege name="http://tizen.org/privilege/filesystem.write"/>
    <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
}

fs.rmSync(path.dirname(OUT), { recursive: true, force: true });
copyTree(path.join(ROOT, 'src/renderer'), OUT);
fs.mkdirSync(path.join(OUT, 'web'), { recursive: true });
js(path.join(ROOT, 'src/web/core.js'), path.join(OUT, 'web/core.js'));
js(path.join(ROOT, 'src/web/tizen.js'), path.join(OUT, 'web/tizen.js'));
fs.writeFileSync(path.join(OUT, 'index.html'), indexHtml());
fs.writeFileSync(path.join(OUT, 'config.xml'), configXml());
fs.copyFileSync(path.join(ROOT, 'tizen/icon.png'), path.join(OUT, 'icon.png'));
console.log(`Tizen project: ${path.relative(ROOT, OUT)} (version ${version})`);

const i = process.argv.indexOf('--package');
if (i > 0) {
  const profile = process.argv[i + 1];
  if (!profile) throw new Error('--package needs the name of a Tizen Studio security profile');
  const tizen = process.env.TIZEN_CLI || 'tizen';
  execFileSync(tizen, ['package', '-t', 'wgt', '-s', profile, '-o', path.dirname(OUT), '--', OUT], { stdio: 'inherit' });
  console.log(`Package: ${path.relative(ROOT, path.dirname(OUT))}/KLABYTV.wgt`);
}
