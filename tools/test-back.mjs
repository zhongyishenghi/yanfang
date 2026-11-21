/**
 * 返回键 / 返回手势的层级测试
 * 用法：node tools/test-back.mjs
 *
 * 背景（2026-11-20 用户反馈）：从索引页点进某个医家/病名/药味的方列表后，手机返回手势
 * 直接退出了应用。原因是原生层把返回交给 window.__yanfangBack，而它只按「当前页签」判断，
 * 索引下钻出来的列表页签已经是「检索」，于是被当成顶层直接 exit。
 *
 * 这个测试把用户点出来的每条路径都走一遍，逐层调 __yanfangBack，断言退的次序：
 *   方剂详情 → 从详情跳出的列表（回那副方）→ 索引下钻的列表（回索引首页）→ 检索页 → exit
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist/易圣验方-离线版');
if (!fs.existsSync(dist)) {
  console.error('没有 dist/易圣验方-离线版，先跑 node tools/build-offline.mjs');
  process.exit(1);
}

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(p => fs.existsSync(p));
if (!EDGE) {
  console.log('跳过：本机没找到 Edge / Chrome');
  process.exit(0);
}

const tmp = path.join(os.tmpdir(), 'shifang-back-test');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

/* Node 22 的 fs.cpSync 在 Windows 上拷这个目录会直接把进程带走（退出码 127，无任何输出），
   手工递归拷，别图省事。 */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
copyDir(dist, tmp);

const INDEX = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');

function page(script, done, wait = 3000) {
  const html = INDEX.replace('</body>',
    `<script>${script}</script><script>setTimeout(function(){ document.title = ${done}; }, ${wait});</script></body>`);
  const file = path.join(tmp, '_t' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(file, html);
  const out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + path.join(tmp, '_profile'),
    '--virtual-time-budget=' + Math.max(9000, wait + 3000),
    '--dump-dom', 'file:///' + file.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const m = out.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : '(无标题)';
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

/* 读当前界面状态：哪一屏在前台、详情开没开 */
const PROBE = `(function(){
  function shown(id){ var n = document.getElementById(id); return n && !n.hidden; }
  return (shown('view-index') ? 'index' : shown('view-search') ? 'search' : shown('view-fav') ? 'fav' : shown('view-about') ? 'about' : '?')
    + (document.body.classList.contains('showing-detail') ? '+detail' : '');
})()`;

/* 1. 索引页 → 点一个医家 → 方列表 → 返回应回索引首页，而不是退出 */
const viaDoctor = page(
  `setTimeout(function(){
     document.querySelector('[data-view=index]').click();
   }, 800);
   setTimeout(function(){
     var b = document.querySelector('#facets button[data-kind=doctor]');
     window.__doc = b ? b.getAttribute('data-facet-val') : '';
     b.click();
   }, 1400);`,
  `'AFTER=' + ${PROBE}
   + ' DOC=' + window.__doc
   + ' Q=' + document.getElementById('q').value
   + ' B1=' + window.__yanfangBack()
   + ' S1=' + ${PROBE}
   + ' B2=' + window.__yanfangBack()
   + ' S2=' + ${PROBE}
   + ' B3=' + window.__yanfangBack()`,
  4200
);
check('索引点医家进到方列表', /AFTER=search/.test(viaDoctor) && /DOC=\S+/.test(viaDoctor), viaDoctor);
check('列表页按返回 → 回索引首页（不退出）', /B1='?handled'?/.test(viaDoctor) && /S1=index/.test(viaDoctor), viaDoctor);
check('索引首页按返回 → 回检索页', /B2='?handled'?/.test(viaDoctor) && /S2=search/.test(viaDoctor), viaDoctor);
check('检索页按返回 → 才退出', /B3='?exit'?/.test(viaDoctor), viaDoctor);

/* 2. 索引 → 药味 → 点卡片进详情 → 返回：详情 → 列表 → 索引 */
const viaHerb = page(
  `setTimeout(function(){ document.querySelector('[data-view=index]').click(); }, 800);
   setTimeout(function(){
     var s = document.querySelector('#seg button[data-facet=herbs]'); if (s) s.click();
     var b = document.querySelector('#facets button[data-kind=herb]'); if (b) b.click();
   }, 1400);
   setTimeout(function(){
     var c = document.querySelector('#list .card'); if (c) c.click();
   }, 2000);`,
  `'L0=' + ${PROBE}
   + ' B1=' + window.__yanfangBack() + ' S1=' + ${PROBE}
   + ' B2=' + window.__yanfangBack() + ' S2=' + ${PROBE}
   + ' B3=' + window.__yanfangBack()`,
  4600
);
check('药味索引 → 列表 → 详情', /L0=search\+detail/.test(viaHerb), viaHerb);
check('详情按返回 → 回列表', /B1='?handled'?/.test(viaHerb) && /S1=search(?!\+detail)/.test(viaHerb), viaHerb);
check('列表再按返回 → 回索引', /B2='?handled'?/.test(viaHerb) && /S2=index/.test(viaHerb), viaHerb);
check('索引再按返回 → 回检索', /B3='?handled'?/.test(viaHerb), viaHerb);

/* 3. 详情里点病名标签 → 列表 → 返回应回到那副方（不是退出、也不是检索页） */
const viaTag = page(
  `setTimeout(function(){ var c = document.querySelector('#list .card'); if (c) c.click(); }, 900);
   setTimeout(function(){ var t = document.querySelector('#detail button[data-tag]'); if (t) t.click(); }, 1700);`,
  `'L0=' + ${PROBE}
   + ' ID=' + (window.__t = (function(){
       var c = document.querySelector('#list .card'); return c ? c.getAttribute('data-id') : ''; })())
   + ' B1=' + window.__yanfangBack() + ' S1=' + ${PROBE}
   + ' BACKID=' + (document.querySelector('#detail') && document.querySelector('#detail').innerHTML.indexOf('id="back"') >= 0 ? 'y' : 'n')
   + ' B2=' + window.__yanfangBack() + ' S2=' + ${PROBE}`,
  4200
);
check('详情点标签跳到方列表', /L0=search(?!\+detail)/.test(viaTag), viaTag);
check('列表按返回 → 回到那副方', /B1='?handled'?/.test(viaTag) && /S1=search\+detail/.test(viaTag), viaTag);
check('回到的详情能继续操作（有返回按钮）', /BACKID=y/.test(viaTag), viaTag);
check('详情再按返回 → 回列表', /B2='?handled'?/.test(viaTag) && /S2=search(?!\+detail)/.test(viaTag), viaTag);

/* 4. 顶层：点页签切换后，返回只回检索页，不连退 */
const viaTab = page(
  `setTimeout(function(){ document.querySelector('[data-view=fav]').click(); }, 900);`,
  `'L0=' + ${PROBE} + ' B1=' + window.__yanfangBack() + ' S1=' + ${PROBE}
   + ' B2=' + window.__yanfangBack()`,
  3000
);
check('收藏页按返回 → 回检索', /B1='?handled'?/.test(viaTab) && /S1=search/.test(viaTab), viaTab);
check('检索页再按返回 → 退出', /B2='?exit'?/.test(viaTab), viaTab);

console.log('\n返回键层级：' + results.filter(r => r.ok).length + '/' + results.length + ' 通过');
let bad = 0;
for (const r of results) {
  console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '\n    ' + r.detail));
  if (!r.ok) bad++;
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
