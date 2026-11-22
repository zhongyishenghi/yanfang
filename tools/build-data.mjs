/**
 * 构建离线种子数据：data/formulas.json → app/www/js/db.js
 *
 * 为什么生成 db.js 而不是直接 fetch json：
 * Capacitor 的 WebView 与本地 file:// 预览都没有可靠的同源 fetch，
 * 把数据挂成全局变量可以保证「双击 index.html 就能用」「装进 APK 立刻能搜」。
 * 拼音用构建期生成（pinyin-map.json），运行时零依赖。
 *
 * 用法：node tools/build-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data/formulas.json');
const outDir = path.join(root, 'app/www');
const mapFile = path.join(root, 'tools/pinyin-map.json');
const appRequire = createRequire(pathToFileURL(path.join(root, 'app/package.json')).href);

const db = JSON.parse(fs.readFileSync(src, 'utf8'));

/* ---------- 拼音 ---------- */
/* 拼音一律走本地字典 pinyin-map.json。
   之前装了 pinyin npm 包的仓库会走 npm，没装的走字典，两仓生成的 db.js 就不一致
   （2026-11-22 实测 md5 不同）。字典已逐字校验，比多音字自动转换更可控。 */
const pinyinFn = null;
const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
let mapDirty = false;

const CJK = /[\u4e00-\u9fff]/;

function charsOf(text) {
  return [...text].filter(c => CJK.test(c));
}

/** 把字表补进字典（有 pinyin 包时） */
function extendMap(text) {
  if (!pinyinFn) return;
  for (const ch of charsOf(text)) {
    if (map[ch]) continue;
    try {
      const py = pinyinFn(ch, { style: 'normal', heteronym: false, segment: false });
      if (py && py[0] && py[0][0]) {
        map[ch] = py[0][0];
        mapDirty = true;
      }
    } catch { /* 忽略单字失败 */ }
  }
}

function toPinyin(text) {
  extendMap(text);
  let full = '';
  let abbr = '';
  let ok = 0;
  for (const ch of [...text]) {
    if (CJK.test(ch)) {
      const py = map[ch];
      if (py) { full += py; abbr += py[0]; ok++; }
      else { full += ch; abbr += ch; }
    } else if (/[a-z0-9]/i.test(ch)) {
      full += ch.toLowerCase();
      abbr += ch.toLowerCase();
    }
  }
  return { full, abbr, coverage: charsOf(text).length ? ok / charsOf(text).length : 1 };
}

let weak = 0;
const allChars = [];
for (const f of db.formulas) {
  const a = toPinyin(f.name || '');
  const b = toPinyin(f.doctor || '');
  f.pinyin = a.full;
  f.abbr = a.abbr;
  f.doctor_pinyin = b.full;
  if (a.coverage < 1) weak++;
  allChars.push(f.name || '', f.doctor || '');
}
for (const t of Object.keys(db.herb_alias || {})) allChars.push(t);
for (const ch of CHAPTERS_TEXT(db)) allChars.push(ch);
for (const f of db.formulas) allChars.push(...f.tags || []);

function CHAPTERS_TEXT(d) {
  return (d.chapters || []).map(c => c.title).join(' ');
}

if (mapDirty) {
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 0) + '\n', 'utf8');
}

/* ---------- 输出 ---------- */
db.generated_at = new Date().toISOString().slice(0, 10);
db.built_with = { pinyin: pinyinFn ? 'pinyin(npm)' : 'pinyin-map.json', formulas: db.formulas.length };

// 拼音回写数据源，保证 formulas.json 自洽（CSV 录入后重跑一次即可补齐）
fs.writeFileSync(src, JSON.stringify(db, null, 1) + '\n', 'utf8');

// 解读模块已下线（2026-11-14）：发给客户端的副本里不带 interpretation。
// 源文件 data/formulas.json 仍保留全部解读；将来恢复时把这里与 app/www/js/app.js 的 SHOW_INTERP 一起改回。
//
// 校记字段（editor_note / uncertain / herb.group / herb.note）保留随包分发（2026-11-14 用户要求回退），
// 前台不渲染——渲染开关在 app/www/js/app.js 的 detailHTML()，去掉那里的判断即可恢复显示。
// 这样数据留痕完整，将来要重新展示校记不必回溯原始转录。
const pub = JSON.parse(JSON.stringify(db));
pub.formulas.forEach((f) => {
  delete f.interpretation;
});

const jsBody = `/* 由 tools/build-data.mjs 自动生成，请勿手改。
 * 数据源：data/formulas.json（version ${db.version}，${db.formulas.length} 副）
 * 生成时间：${db.generated_at}
 */
window.YANFANG_SEED = ${JSON.stringify(pub)};
`;
fs.mkdirSync(path.join(outDir, 'js'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'js/db.js'), jsBody, 'utf8');

// 同步一份原始 JSON，供网页版 / 调试 / 将来做在线检索
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'data/formulas.json'), JSON.stringify(pub, null, 1) + '\n', 'utf8');

// 版本清单：在线增量更新的入口文件
const versionFile = path.join(root, 'data/version.json');
const prev = fs.existsSync(versionFile) ? JSON.parse(fs.readFileSync(versionFile, 'utf8')) : { patches: [] };
const version = {
  latest: db.version,
  updated_at: db.generated_at,
  min_supported: 1,
  count: db.formulas.length,
  patches: (prev.patches || []).filter(p => p.to <= db.version)
};
fs.writeFileSync(versionFile, JSON.stringify(version, null, 2) + '\n', 'utf8');

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`db.js  ${kb(Buffer.byteLength(jsBody))}   ${db.formulas.length} 副 / ${db.formulas.reduce((s, f) => s + f.herbs.length, 0)} 条药味`);
console.log(`拼音来源 ${db.built_with.pinyin}，字典 ${Object.keys(map).length} 字，缺字方名 ${weak} 副`);
console.log(`version.json → latest ${version.latest}`);
