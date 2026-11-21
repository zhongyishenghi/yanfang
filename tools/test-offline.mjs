/**
 * 离线版冒烟测试：证明「不联网」是真的，不是文案
 * 用法：node tools/test-offline.mjs
 *
 * 做法：把 dist/易圣验方-离线版 拷到英文临时目录，注入 fetch / XHR 计数桩，
 *      用 Edge headless 跑一遍，读回标题里的统计，断言：
 *        1. 网络调用次数 = 0
 *        2. 列表渲染出全部条目（不是 0 条）
 *        3. 关于页没有「检查更新」输入框，且有「数据与隐私」一节
 *        4. 详情页没有「对照原页」按钮
 *        5. 本地残留的旧版本副本不会盖住安装包里的新数据
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
  console.log('跳过：本机没找到 Edge / Chrome，无法做浏览器冒烟测试（静态检查仍由构建脚本把关）');
  process.exit(0);
}

const tmp = path.join(os.tmpdir(), 'shifang-offline-test');

/* Edge 无头进程退出比 execFileSync 返回稍晚，profile 的 lockfile 常被占住几百毫秒，
   直接 rmSync 会 EBUSY 把测试结果一起吞掉——重试几次再放弃。 */
function rmTmp() {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); return; }
    catch (e) { Atomics.wait(buf, 0, 0, 400); }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); }
  catch (e) { console.log('（提示：临时目录 ' + tmp + ' 未能删除，不影响测试结论）'); }
}
rmTmp();
fs.mkdirSync(tmp, { recursive: true });

/* Node 22 的 fs.cpSync 在 Windows 上对这个目录会直接段错误，手工递归拷 */
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
const STUB = `<script>
window.__net = 0;
var _f = window.fetch;
window.fetch = function (u) { window.__net++; window.__netUrl = String(u); return Promise.reject(new Error('offline')); };
var _o = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function (u) { window.__net++; window.__netUrl = String(u); return _o.apply(this, arguments); };
</script>`;

const db = JSON.parse(fs.readFileSync(path.join(root, 'data/formulas.json'), 'utf8'));
if (db.formulas.length < 50) {
  console.log(`当前数据只有 ${db.formulas.length} 副（公开样例），本用例针对完整库，跳过；样例请跑 tools/test-search-sample.mjs。`);
  process.exit(0);
}

function page(extra, done, wait = 3200) {
  /* extra 是若干条 setTimeout，必须包进 <script> 才会执行 */
  const html = INDEX.replace('<head>', '<head>' + STUB).replace('</body>',
    `<script>${extra}</script>` + `<script>setTimeout(function(){ document.title = ${done}; }, ${wait});</script></body>`);
  const file = path.join(tmp, '_t' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(file, html);
  const out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + path.join(tmp, '_profile'),
    /* 虚拟时间预算给足：页面要渲染 292 张卡片，预算太紧会让 setTimeout 来不及跑完 */
    '--virtual-time-budget=' + Math.max(9000, wait + 3000),
    '--dump-dom', 'file:///' + file.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const m = out.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : '(无标题)';
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

/* 1. 首页：完全不联网（2026-11-20 起版本检查与装机统计整体下线），卡片与检索条照常 */
const home = page('', `'NET=' + window.__net + ' URL=' + (window.__netUrl || '')
  + ' UPD=' + (document.getElementById('upd') ? '有' : '无')
  + ' CARDS=' + document.querySelectorAll('.card').length
  + ' HEAD=' + getComputedStyle(document.getElementById('searchhead')).position
  + ' BAR=' + getComputedStyle(document.getElementById('searchbar')).position
  + ' FULL=' + (Math.abs(
      document.getElementById('searchhead').getBoundingClientRect().width -
      document.getElementById('view-search').clientWidth) < 1 ? 'y' : 'n')`);
check('启动不发任何网络请求（零联网）', /NET=0\b/.test(home), home);
check('没有版本提示条（已下线）', /UPD=无/.test(home), home);
check('条目全部渲染', new RegExp('CARDS=' + db.formulas.length + '\\b').test(home), home);
/* 吸顶的必须是外面那条铺满整行的 .searchhead；
   如果还让圆角卡片自己 sticky，卡片两侧和圆角外会透出后面的文字 */
check('搜索条吸顶且整条铺满（卡片自身不吸顶）',
  /HEAD=sticky/.test(home) && /BAR=static/.test(home) && /FULL=y/.test(home), home);

/* 2. 关于页 */
const about = page(
  `setTimeout(function(){ document.querySelector('[data-view=about]').click(); }, 1200);
   setTimeout(function(){ var b = document.getElementById('donate-qr'); if (b) b.click(); }, 2200);`,
  `'NET=' + window.__net
    + ' UPDATE=' + (document.getElementById('update-url') ? '有' : '无')
    + ' CHK=' + (document.getElementById('check-app-update') ? '有' : '无')
    + ' PRIV=' + ([].some.call(document.querySelectorAll('#view-about h3'), function(h){ return h.textContent === '数据与隐私'; }) ? '有' : '无')
    + ' QR=' + ((function(){ var i = document.querySelector('#donate-qr img'); return i ? i.naturalWidth : 0; })())
    + ' LB=' + ((function(){
        var l = document.getElementById('lightbox');
        var i = l && l.querySelector('img');
        return (!l || l.hidden ? 'closed' : 'open') + (i ? i.naturalWidth : 0);
      })())
    + ' TERMS=' + ((function(){
        var t = (document.querySelector('#view-about .terms') || {}).textContent || '';
        var miss = ['完全自愿', '不换取任何承诺', '无法退款', '不开具发票'].filter(function(k){ return t.indexOf(k) < 0; });
        return miss.length ? miss.join(',') : 'ok';
      })())`,
  4000
);
check('关于页无「检查更新」', /UPDATE=无/.test(about), about);
check('关于页无「检查新版本」按钮', /CHK=无/.test(about), about);
check('关于页不发任何网络请求', /NET=0\b/.test(about), about);
check('关于页有「数据与隐私」', /PRIV=有/.test(about), about);
/* 收款码必须真的打得开（本地图随包分发），条款四条缺一不可 */
check('关于页有收款码且图片可加载', /QR=[1-9]\d*/.test(about), about);
check('点按收款码可放大查看', /LB=open[1-9]\d*/.test(about), about);
check('打赏条款含 自愿/不承诺/不退款/无发票', /TERMS=ok/.test(about), about);

/* 3. 详情页 */
const detail = page(
  `setTimeout(function(){ var q = document.getElementById('q'); q.value = '柴胡解毒汤'; q.dispatchEvent(new Event('input', {bubbles:true})); }, 900);
   setTimeout(function(){ var c = document.querySelector('.card'); if (c) c.click(); }, 1800);`,
  `'NET=' + window.__net
    + ' NAME=' + (document.querySelector('.d-head h2') || {}).textContent
    + ' PAGEBTN=' + (document.querySelector('[data-page]') ? '有' : '无')
    + ' HERBS=' + document.querySelectorAll('.herbs li').length
    + ' EDIT=' + ([].some.call(document.querySelectorAll('#detail h4'), function(h){ return h.textContent.indexOf('编校记') >= 0; }) ? '有' : '无')
    + ' RAWN=' + ([].some.call(document.querySelectorAll('.herbs em'), function(e){ return /原书|存疑/.test(e.textContent); }) ? '有' : '无')`,
  3600
);
check('详情页可打开', /NAME=柴胡解毒汤/.test(detail), detail);
check('详情页无「对照原页」按钮', /PAGEBTN=无/.test(detail), detail);
check('详情页组成渲染', /HERBS=[1-9]/.test(detail), detail);
check('详情页无「编校记」', /EDIT=无/.test(detail), detail);
check('药味行无原书/存疑备注', /RAWN=无/.test(detail), detail);

/* 3b. 详情页左右翻方：序列 = 进详情时的列表顺序，到头有提示 */
const flip = page(
  `window.__log = [];
   setTimeout(function(){ document.querySelectorAll('#list .card')[0].click(); }, 1000);
   setTimeout(function(){
     window.__log.push('A=' + (document.querySelector('.d-head h2')||{}).textContent + '/' + (document.querySelector('.d-pos')||{}).textContent);
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
   }, 1600);
   setTimeout(function(){
     window.__log.push('B=' + (document.querySelector('.d-head h2')||{}).textContent + '/' + (document.querySelector('.d-pos')||{}).textContent);
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
   }, 2000);
   setTimeout(function(){
     window.__log.push('C=' + (document.querySelector('.d-head h2')||{}).textContent + '/' + (document.querySelector('.d-pos')||{}).textContent);
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
   }, 2300);`,
  `'LOG=' + window.__log.join('|').replace(/\\s/g, '')
    + ' EDGE=' + ((document.getElementById('d-edge') || {}).textContent || 'none')
    + ' NAV=' + document.querySelectorAll('.d-nav button').length
    + ' DISABLED=' + ([].filter.call(document.querySelectorAll('.d-nav button'), function(b){ return b.disabled; }).length)`,
  3800
);
const N = db.formulas.length;   // 条数随数据增长，别写死
/* 首条是哪一副由数据顺序决定（现在是儿科 1.1 百日咳病方），不再写死方名，
   否则数据一换顺序这三条就假报错。 */
const FIRST = db.formulas[0].name;
const SECOND = db.formulas[1].name;
const esc1 = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
check('详情页显示序号', new RegExp('A=' + esc1(FIRST) + '/1/' + N + '\\b').test(flip), flip);
check('右翻到下一副', new RegExp('B=' + esc1(SECOND) + '/2/' + N + '\\b').test(flip), flip);
check('左翻回上一副', new RegExp('C=' + esc1(FIRST) + '/1/' + N + '\\b').test(flip), flip);
check('第一副左翻到头给提示', /EDGE=已经是第一副/.test(flip), flip);
check('翻方按钮成对且第一条禁用上一副', /NAV=2\b/.test(flip) && /DISABLED=1\b/.test(flip), flip);

/* 4. 旧本地副本不覆盖新种子 */
const stale = page(
  `<script>try{localStorage.setItem('shifang.db.v1', JSON.stringify({version:5,formulas:[],herb_alias:{},parts:[],chapters:[],stats:{}}));}catch(e){}</script>`,
  `'NET=' + window.__net + ' CARDS=' + document.querySelectorAll('.card').length`,
  3200
);
check('旧本地副本不覆盖安装包数据', new RegExp('CARDS=' + db.formulas.length + '\\b').test(stale), stale);

rmTmp();

let fail = 0;
for (const r of results) {
  console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '　→ ' + r.detail));
  if (!r.ok) fail++;
}
console.log(`\n离线版冒烟：${results.length - fail}/${results.length} 通过`);
process.exit(fail ? 1 : 0);
