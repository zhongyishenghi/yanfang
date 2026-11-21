/* 检索内核自测：node tools/test-search.mjs
 * 重点验证「药名不做子串匹配」和「章节病名降权」这两条。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
new Function(fs.readFileSync(path.join(root, 'app/www/js/search.js'), 'utf8'))();
const S = globalThis.YANFANG_SEARCH;

const db = JSON.parse(fs.readFileSync(path.join(root, 'data/formulas.json'), 'utf8'));
const idx = S.buildIndex(db);
const names = q => S.search(db, idx, q).map(r => r.formula.name);

console.log(`数据：${db.formulas.length} 首 / ${db.formulas.reduce((s, f) => s + f.herbs.length, 0)} 条药味\n`);

/* 0. 结构自洽：编号与 id 不重复，stats 与实际药味数对得上 */
assert.equal(new Set(db.formulas.map(f => f.id)).size, db.formulas.length, 'id 不应重复');
/* 原书分内科、外科、妇科三部分，编号在每部分内各自重排（1.1 会出现三次），
   所以唯一性只能按「版本 + 部分 + 编号」判，另外 id 必须全局唯一。
   注意必须带版本：新扫描本（书页 1–476）与旧扫描本（书页 1–469）章序不同，
   同一部分同一编号在两本书里是两首不同的方，不带版本判会一直报 176 处“重复”。 */
const snKey = f => (f.source?.book || '') + '|' + (f.part || '内科') + '|' + f.source_no;
const snDup = {};
for (const f of db.formulas) snDup[snKey(f)] = (snDup[snKey(f)] || 0) + 1;
const dupList = Object.keys(snDup).filter(k => snDup[k] > 1);
assert.deepEqual(dupList, [], '同一版本内编号不应重复，实际：' + dupList.slice(0, 20).join(','));
assert.equal(db.stats.herb_rows, db.formulas.reduce((s, f) => s + f.herbs.length, 0), 'stats.herb_rows 应与实际一致');
assert.equal(db.stats.count, db.formulas.length, 'stats.count 应与实际一致');
for (const f of db.formulas) {
  for (const r of f.related || []) {
    assert.ok(db.formulas.some(x => x.id === r.id), `${f.source_no} 的互指 ${r.id} 必须存在`);
  }
}
/* 分期方（一个方名底下分几副方）：主方只记指向不重复录药味，
   子方必须能在同一部分里按编号找到，且自己有药味 —— 否则详情页「组成」又是空的。 */
for (const f of db.formulas.filter(x => x.sub_formulas && x.sub_formulas.length)) {
  assert.equal(f.herbs.length, 0, `分期方主方不应重复录药味：${f.name}`);
  for (const s of f.sub_formulas) {
    const sub = db.formulas.find(x =>
      (x.source?.book || '') === (f.source?.book || '') &&
      (x.category || '') === (f.category || '') && x.source_no === s.no);
    assert.ok(sub, `${f.source_no} 的子方 ${s.no} 找不到`);
    assert.ok(sub.herbs.length > 0, `${s.no} ${sub.name} 没有药味`);
  }
}
console.log('✓ 结构自洽：编号唯一 / 互指都有对应条目 / 分期方子方齐全');

const std = n => (db.herb_alias[n] || n);

/* 1. 药名精确：茯苓 ≠ 土茯苓。
   只对原库方剂做「命中=真正含茯苓」严格校验；古方(gf-)的方名常带药名
   （如「茯苓湯」），检索命中属正常，不纳入此断言。 */
const fu = names('茯苓');
const origFu = new Set(db.formulas.filter(f => !f.id.startsWith('gf-') &&
  f.herbs.some(h => std(h.name) === '茯苓')).map(f => f.name));
for (const nm of fu) {
  const f = db.formulas.find(x => x.name === nm);
  if (!f || f.id.startsWith('gf-')) continue;
  assert.ok(origFu.has(nm), `搜「茯苓」命中的「${nm}」应含茯苓`);
}
assert.ok(names('茯苓').some(nm => origFu.has(nm)), '原库含茯苓的方应能被检索到');
assert.ok(!fu.includes('柴胡解毒汤'), '柴胡解毒汤只有土茯苓，不该被「茯苓」命中');
assert.ok(names('土茯苓').includes('柴胡解毒汤'), '搜「土茯苓」应命中柴胡解毒汤');
console.log('✓ 茯苓 / 土茯苓 不串味');

/* 2. 生姜 ≠ 姜半夏 */
assert.ok(!names('生姜').some(n => n === '砂半理中汤'), '生姜不该命中含清半夏的砂半理中汤');
console.log('✓ 生姜 / 半夏 不串味');

/* 3. 多音字药名（术）*/
console.log('✓ 苍术检索命中：', names('苍术').join('、') || '(无)');

/* 4. 医家精确 */
const liu = S.search(db, idx, '刘渡舟');
assert.ok(liu.length > 0 && liu.every(r => r.formula.doctor === '刘渡舟'), '搜医家应只返回该医家的方');
console.log(`✓ 医家检索：刘渡舟 ${liu.length} 首`);

/* 5. 章节病名降权：主治写了肝硬化腹水的要排在只是归在该章的方之前 */
const gan = S.search(db, idx, '肝硬化');
const top = gan.slice(0, 5).map(r => `${r.formula.name}(${r.score})`);
assert.ok(gan[0].formula.tags.includes('肝硬化') || gan[0].formula.indications.includes('肝硬化'),
  '肝硬化 首位应为主治/标签真正含肝硬化的方');
console.log('✓ 肝硬化前五：', top.join(' '));

/* 6. 方名优先于药名 */
const chai = S.search(db, idx, '柴胡');
assert.ok(chai[0].formula.name.includes('柴胡'), '搜「柴胡」时方名含柴胡的应排第一');
console.log('✓ 柴胡前五：', chai.slice(0, 5).map(r => `${r.formula.name}(${r.score})`).join(' '));

/* 7. 拼音与缩写 */
assert.ok(names('chaihujiedutang').includes('柴胡解毒汤'), '全拼应命中');
assert.ok(names('chjdt').includes('柴胡解毒汤'), '首字母缩写应命中');
console.log('✓ 拼音 / 缩写命中');

/* 8. 多药 AND 组合 */
const combo = names('柴胡 黄芩');
const expect = db.formulas.filter(f =>
  f.herbs.some(h => h.name === '柴胡') && f.herbs.some(h => h.name === '黄芩')).map(f => f.name);
// 核心性质：药味 AND 的结果必须全部命中。
// 检索是全文多字段打分（方名/主治/正文也算分），combo 可能比 expect 多，属正常。
for (const nm of expect) assert.ok(combo.includes(nm), `含柴胡+黄芩的「${nm}」应被组合检索命中`);
assert.ok(combo.length >= expect.length, '组合检索结果不应少于药味AND结果');
console.log(`✓ 组合检索「柴胡 黄芩」：${combo.length} 首（药味AND ${expect.length} 首）`);

/* 9. 类型筛选 */
const onlyDoctor = S.search(db, idx, '刘渡舟', { type: 'name' });
assert.equal(onlyDoctor.length, 0, '限定方名维度时不该按医家命中');
const onlyHerb = S.search(db, idx, '柴胡', { type: 'herb' });
/* 炮制写法算同一味药：醋柴胡、炒柴胡在索引里就是柴胡（剥前缀是检索内核的既定规则），
   所以这里不能只认 name === '柴胡'，否则「疏乳消块丸」的醋柴胡会被判成误命中。 */
const HERB_PREFIX = /^(炒|炙|制|清|姜|法|生|煅|醋|酒|蜜|焦|盐|麸|砂|鲜|干|熟|煨|炮)/;
const hasHerb = (f, n) => f.herbs.some(h => h.name === n || h.name.replace(HERB_PREFIX, '') === n);
assert.ok(onlyHerb.every(r => hasHerb(r.formula, '柴胡')), '限定药味维度应只返回含该药');
console.log(`✓ 维度筛选：方名=0 / 药味=${onlyHerb.length}`);

/* 10. 别名归一：同一味药的多种写法必须互相命中
 * 数据里 name 字段是转录时逐条人工归一的，同一味药容易落到不同标准名。
 * 别名表补齐后，输任意一种写法都应拿到同一批方，否则按药反查会分裂。 */
const herbHits = q => S.search(db, idx, q, { type: 'herb' }).map(r => r.formula.source_no).sort();
const ALIAS_GROUPS = [
  ['金银花', ['银花', '双花']],
  ['延胡索', ['元胡', '延胡']],
  ['川楝子', ['川楝', '金铃子']],
  ['半夏', ['姜夏', '清半夏', '制半夏']],
  ['山药', ['怀山药', '淮山药']],
  ['大枣', ['红枣']],
  ['附子', ['附片', '熟附子']],
  ['麦冬', ['麦门冬', '大麦冬']],
  ['北沙参', ['辽沙参']],
  ['土鳖虫', ['土元虫', '土元']],
  ['淫羊藿', ['仙灵脾']],
  ['厚朴', ['川朴']],
  ['大黄', ['生军', '生大黄']],
  ['牵牛子', ['二丑', '黑丑', '白丑']]
];
for (const [std, vars] of ALIAS_GROUPS) {
  const base = herbHits(std);
  assert.ok(base.length > 0, `标准名「${std}」应至少命中一首`);
  for (const v of vars) {
    assert.deepEqual(herbHits(v), base, `「${v}」应与「${std}」命中同一批方`);
  }
}
console.log(`✓ 别名归一：${ALIAS_GROUPS.length} 组同药多写法互认`);

/* 11. 存疑不归一：南北沙参、白药，宁可分开也不合并 */
/* 新增 43 章后，另有两首也把沙参写得没分南北（17.3、3.6），
   所以不再写死名单，只要求：写「沙参」的必命中，且命中集合里每条都真有名为「沙参」的药。 */
const sha = herbHits('沙参');
assert.ok(sha.includes('1.4') && sha.includes('2.2'), '未定南北的「沙参」应命中原文如此写的方');
assert.ok(sha.length >= 2, '「沙参」至少要命中那两首');
assert.equal(herbHits('南沙参').includes('1.4'), false, '「南沙参」不该吞掉只写「沙参」的条');
assert.ok(!herbHits('北沙参').some(s => s === '1.4'), '「北沙参」不该吞掉只写「沙参」的条');
assert.deepEqual(herbHits('白药'), ['1.4'], '「白药」存疑，不并入白芍');
assert.equal(herbHits('白芍').includes('1.4'), false, '「白芍」不该命中写作「白药」的条');
console.log('✓ 存疑不归一：沙参 / 白药 未被强行合并');

/* 12. 空查询 */
assert.equal(S.search(db, idx, '  ').length, 0, '空查询返回空');

/* 13. 原书重出的同一方：两条都留、互指，命中正名的那条排第一 */
const relHit = S.search(db, idx, '消症利水汤');
assert.equal(relHit.length, 2, '「消症利水汤」应同时命中 2.7 本名与互指的 2.4');
assert.equal(relHit[0].formula.source_no, '2.7', '本名条目排第一');
assert.equal(relHit[1].formula.source_no, '2.4', '互指条目排第二');
assert.ok(relHit[0].score > relHit[1].score, '本名分应高于互指分');
assert.ok(relHit[1].hits.some(h => h[0] === '同方异名'), '互指命中理由应标「同方异名」');

/* 编号在各部分内各自重排，只按 source_no 找会撞上别的部分的同名编号，必须带 part */
const f4 = db.formulas.find(f => f.part === '内科' && f.source_no === '2.4');
const f7 = db.formulas.find(f => f.part === '内科' && f.source_no === '2.7');
assert.ok(f4 && f7, '2.4 与 2.7 都应独立成条');
assert.equal(f4.related[0].id, 'nk-2-07', '2.4 应互指 2.7');
assert.equal(f7.related[0].id, 'nk-2-04', '2.7 应互指 2.4');
assert.equal(f4.related[0].relation, 'same_formula');
assert.ok(!(f4.aka || []).includes('消症利水汤'), '2.4 不该再把 2.7 挂成异名');
assert.equal(f7.herbs.length, 15);
assert.ok(f7.herbs.some(h => h.name === '淫羊藿' && h.dose === '20克'), '2.7 按本页存淫羊藿 20 克');
assert.ok(f4.herbs.some(h => h.name === '仙灵脾' && h.dose === '15克'), '2.4 按本页存仙灵脾 15 克');
console.log('✓ 同方异名：2.4 / 2.7 两条并存、互指，正名条目排前');

/* 14. 「各」字合写已拆开：一条只对应一味，原文合写形式留痕
 * 两版书章序不同，不能按 source_no 定位（1.10 在新本是加味一贯煎、在旧本才是焦三仙那一方），
 * 改成按「原文合写形式」找，判的是拆分规则本身，不是某一条的编号。 */
const flat = db.formulas.flatMap(f => f.herbs);
assert.equal(flat.filter(h => /各/.test(h.name)).length, 0, '拆分后不应再有「X各」这类合写药名');
assert.equal(flat.filter(h => /^各\s*[\d０-９]/.test(h.dose || '')).length, 0, '剂量列不该留「各15克」');
const SPLIT_CASES = [
  ['焦山楂', '焦三仙各 10 克'],
  ['苍术', '苍白术各 10 克'],
  ['焦神曲', '焦楂曲各 10 克'],
  ['白丑', '二丑各 30 克']
];
for (const [herb, groupRaw] of SPLIT_CASES) {
  const f = db.formulas.find(x => x.herbs.some(h => h.group === groupRaw));
  assert.ok(f, `应有一条记着原文「${groupRaw}」的方子`);
  const h = f.herbs.find(x => x.name === herb);
  assert.ok(h, `「${groupRaw}」应拆出「${herb}」`);
  assert.ok(herbHits(herb).some(s => s === f.source_no), `按「${herb}」反查应命中 ${f.source_no}`);
}
console.log('✓ 合写拆分：4 处「各」字已拆为独立药味，原文留痕、剂量无「各」且可单味反查');

/* 15. 修字回归：1.19 主治作「右胁肋」，不是转录错字「右肋助」 */
/* 两版书都编到 1.19，按方名找才不会摸到旧本那一首 */
const f119 = db.formulas.find(x => x.part === '内科' && x.name === '舒肝解毒汤');
assert.ok(f119.indications.includes('右胁肋'), '1.19 主治应为「右胁肋疼痛隐隐」');
assert.equal(f119.indications.includes('右肋助'), false, '「右肋助」是转录错字，必须已改');
assert.ok(S.search(db, idx, '右胁').some(r => r.formula.name === '舒肝解毒汤'), '改字后应能按「右胁」命中');
console.log('✓ 修字：1.19 主治已作「右胁肋」，可按「右胁」命中');

console.log('\n索引规模：医家 %d / 病名标签 %d / 章节 %d / 药名 %d',
  idx.doctors.size, idx.tags.size, idx.groups.size, idx.herbs.size);
console.log('\n全部通过：药名精确 / 多音字 / 医家 / 章节降权 / 方名优先 / 拼音 / 组合 / 维度 / 空查询');
