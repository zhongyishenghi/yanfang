/**
 * 出「离线版」：不联网、不请求任何接口，数据全内置
 * 用法：node tools/build-offline.mjs
 *
 * 做的事：
 *   1. 先把 data/formulas.json 重新构建成 app/www/js/db.js（保证种子是最新的）
 *   2. 拷一份 www 到 dist/易圣验方-离线版/，去掉 js/update.js 与它的 <script>
 *   3. 把 js/mode.js 改成 { online:false }——不显示「检查更新」
 *   4. 断言产物里没有任何 fetch / XMLHttpRequest / 外部 http(s) 资源
 *   5. 打一个 zip，方便直接发到手机或塞进 Capacitor 工程
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'app/www');
const dist = path.join(root, 'dist');
const out = path.join(dist, '易圣验方-离线版');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

/* ---------- 0. 版本号：从 build.gradle 抄一份到 js/appver.js ---------- */
/* 网页要知道自己装的是哪一版，才能判断版本号文件里的最新版是不是真的更新。
   单一来源仍是 build.gradle，这里每次出包前重新生成，避免两处手改走样。 */
const gradlePath = path.join(root, 'app/android/app/build.gradle');
const gradle = fs.readFileSync(gradlePath, 'utf8');
const vCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1]);
const vName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1];
if (!vCode || !vName) throw new Error('没能从 build.gradle 里读到 versionCode / versionName');
const appverPath = path.join(www, 'js/appver.js');
fs.writeFileSync(appverPath, `/* 由 tools/build-offline.mjs 依 app/android/app/build.gradle 生成，勿手改 */
window.YANFANG_APPVER = { name: '${vName}', code: ${vCode}, built: '${new Date().toISOString().slice(0, 10)}' };
`, 'utf8');

/* ---------- 1. 重建种子数据 ---------- */
execFileSync(process.execPath, [path.join(root, 'tools/build-data.mjs')], { stdio: 'inherit' });

/* ---------- 2. 拷贝 ---------- */
rmrf(out);
fs.mkdirSync(path.join(out, 'js'), { recursive: true });
fs.mkdirSync(path.join(out, 'css'), { recursive: true });

fs.copyFileSync(path.join(www, 'index.html'), path.join(out, 'index.html'));
for (const f of fs.readdirSync(path.join(www, 'css'))) {
  fs.copyFileSync(path.join(www, 'css', f), path.join(out, 'css', f));
}
const imgDir = path.join(www, 'img');                 // 打赏收款码等本地图，跟随包分发
if (fs.existsSync(imgDir)) {
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });
  for (const f of fs.readdirSync(imgDir)) {
    fs.copyFileSync(path.join(imgDir, f), path.join(out, 'img', f));
  }
}
for (const f of fs.readdirSync(path.join(www, 'js'))) {
  if (f === 'update.js') continue;                 // 增量同步客户端不进离线包
  fs.copyFileSync(path.join(www, 'js', f), path.join(out, 'js', f));
}

/* ---------- 3. 改模式与 script 引用 ---------- */
fs.writeFileSync(path.join(out, 'js/mode.js'), `/* 易圣验方 · 离线版运行模式（由 tools/build-offline.mjs 生成，不要手改） */
window.YANFANG_MODE = {
  online: false
};
`, 'utf8');

const idxPath = path.join(out, 'index.html');
let html = fs.readFileSync(idxPath, 'utf8');
const before = html;
html = html
  .replace(/\s*<script src="js\/update\.js"><\/script>/, '')
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="易圣验方 · 方剂资料检索（离线版）。全部资料内置，不联网。">');
if (html === before) throw new Error('index.html 里没找到 js/update.js 的 <script>，构建脚本需要更新');
fs.writeFileSync(idxPath, html, 'utf8');

/* ---------- 4. 断言：产物里不许有联网代码 ---------- */
/* 2026-11-20 起不再有任何例外：版本检查与匿名装机统计整体下线（1.0.7），
   安装包也不申请 INTERNET 权限。这里改成零容忍，以后谁再写回 fetch 就出不了包。 */
const NET = /fetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/;
const EXT = /(?:src|href)\s*=\s*["']https?:\/\//i;      // 外链资源（脚本/样式/图片）
const offenders = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!/\.(js|html|css)$/.test(e.name)) return;
  const text = fs.readFileSync(p, 'utf8');
  const rel = path.relative(out, p).split(path.sep).join('/');
  if (NET.test(text)) offenders.push(rel + '（联网调用）');
  if (EXT.test(text)) offenders.push(rel + '（外部资源引用）');
});
walk(out);
if (offenders.length) throw new Error('离线包内仍有联网代码或外部资源：' + offenders.join('、'));

/* ---------- 4.5 同步到 Capacitor 的 webDir（app/www-offline） ---------- */
/* 装 APK 时 Gradle 只认 webDir 里的东西，这里直接同步一份，避免手工覆盖 app/www。
   路径刻意用 ASCII：Node 22 的 fs.cpSync 在中文目录上会段错误，所以手写递归拷贝。 */
const webOut = path.join(root, 'app/www-offline');
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
rmrf(webOut);
copyDir(out, webOut);

/* ---------- 5. 说明文件 + 体积 ---------- */
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/formulas.json'), 'utf8'));
/* 「味中药」口径与 app.js 的 countHerbs 一致：herb_alias 归并后的去重品种数 */
const alias = db.herb_alias || {};
const herbKinds = new Set();
db.formulas.forEach(f => f.herbs.forEach(h => {
  if (!h.name) return;
  let s = h.name, v = alias[s];
  while (typeof v === 'string' && v !== s) { s = v; v = alias[s]; }
  herbKinds.add(v === null ? h.name : s);
}));
const readme = [
  '易圣验方 · 离线版',
  '==================================================',
  '',
  '怎么打开',
  '  双击 index.html 即可，不需要装任何东西，也不需要联网。',
  '  手机上可用任意支持本地网页的浏览器打开，或直接装进安卓壳（见下）。',
  '',
  '内容',
  '  ' + db.formulas.length + ' 副方剂、' + herbKinds.size + ' 味中药，全部内置在这个文件夹里。',
  '  按方名、医家、病名、药味四类检索；空格分隔可反查同时含多味药的方子。',
  '  数据版本 v' + db.version + '（' + db.updated_at + '）。',
  '',
  '联网与隐私',
  '  完全不联网：没有版本检查、没有统计、没有推送、没有账号，不上传任何内容。',
  '  安装包未申请网络权限，系统层面就不允许本应用发出任何请求。',
  '  收藏只存在本机浏览器存储里，清除浏览器数据或卸载即消失。',
  '',
  '想做成安卓 APP',
  '  把本文件夹的内容整体替换到 Capacitor 工程的 www/ 目录，',
  '  再执行 npx cap sync android，然后按 README 打包即可；应用名与包名见 capacitor.config.json。',
  '',
  '说明',
  '  来源栏只列书名与页码，不提供原页图片。',
  '  内容只作资料检索与对照，不提供用药建议；方剂的使用须由执业中医师辨证决定。',
  ''
].join('\n');
fs.writeFileSync(path.join(out, '使用说明.txt'), readme, 'utf8');

/* 体积统计 */
function dirSize(d) {
  return fs.readdirSync(d).reduce((s, f) => {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    return s + (st.isDirectory() ? dirSize(p) : st.size);
  }, 0);
}
const size = dirSize(out);

/* ---------- 6. 打 zip ---------- */
const zipPath = path.join(dist, '易圣验方-离线版.zip');
fs.rmSync(zipPath, { force: true });
try {
  execFileSync('python', ['-c', `
import os, zipfile
root = r"${out}"
base = os.path.dirname(root)
z = zipfile.ZipFile(r"${zipPath}", "w", zipfile.ZIP_DEFLATED)
for dp, dn, fn in os.walk(root):
    for f in fn:
        p = os.path.join(dp, f)
        z.write(p, os.path.relpath(p, base))
z.close()
`], { stdio: 'inherit' });
} catch (e) {
  console.warn('zip 打包跳过（python 不可用）：', e.message);
}

console.log('离线包已生成：' + path.relative(root, out));
console.log(`  文件 ${db.formulas.length} 副方剂 / ${herbKinds.size} 味中药，体积 ${(size / 1048576).toFixed(2)} MB`);
if (fs.existsSync(zipPath)) console.log('  zip：' + path.relative(root, zipPath) + `（${(fs.statSync(zipPath).size / 1048576).toFixed(2)} MB）`);
console.log('  联网代码检查：通过（无 fetch / XHR / 外链资源，零联网）');
console.log('  版本：v' + vName + '（versionCode ' + vCode + '）');
