/* 公开样例的检索冒烟测试：node tools/test-search-sample.mjs
 *
 * 公开仓库只带 5 首《伤寒论》《金匮要略》古方，而 test-search.mjs 是针对完整库写的
 * （硬编码编号与别名组），在样例上必然失败。这份用例只验证「检索内核在最小数据集上
 * 能跑、结果合理」，与完整库的严格用例互补。CI 跑这份；拿到完整数据后可改跑 test-search.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
new Function(fs.readFileSync(path.join(root, 'app/www/js/search.js'), 'utf8'))();
const S = globalThis.YANFANG_SEARCH;
assert.ok(S && typeof S.buildIndex === 'function' && typeof S.search === 'function', '检索内核应导出 buildIndex / search');

const db = JSON.parse(fs.readFileSync(path.join(root, 'data/formulas.json'), 'utf8'));
const idx = S.buildIndex(db);
const names = q => S.search(db, idx, q).map(r => r.formula.name);

console.log(`数据：${db.formulas.length} 首 / ${db.formulas.reduce((s, f) => s + f.herbs.length, 0)} 条药味\n`);

/* 0. 结构自洽 + 五项齐备 */
assert.equal(db.formulas.length, 5, '公开样例应为 5 副');
assert.equal(new Set(db.formulas.map(f => f.id)).size, db.formulas.length, 'id 不应重复');
assert.equal(db.stats.count, db.formulas.length, 'stats.count 应与实际一致');
assert.equal(db.stats.herb_rows, db.formulas.reduce((s, f) => s + f.herbs.length, 0), 'stats.herb_rows 应与实际一致');
for (const f of db.formulas) {
  for (const k of ['name', 'functions', 'indications', 'usage']) {
    assert.ok(f[k] && f[k].trim(), `${f.name} 缺字段 ${k}`);
  }
  assert.ok(f.herbs.length > 0, `${f.name} 没有组成`);
  assert.ok(f.herbs.every(h => h.name && h.dose), `${f.name} 有药味缺剂量`);
  assert.ok(f.source && f.source.book, `${f.name} 缺出处`);
}
console.log('✓ 结构自洽：5 副 / id 唯一 / 五项齐备 / 药味均有剂量');

/* 1. 方名检索 */
assert.ok(names('桂枝汤').includes('桂枝汤'), '完整方名应命中');
assert.ok(names('桂枝').length >= 3, '「桂枝」应命中含桂枝的三首方');
console.log('✓ 方名检索：', names('桂枝').join('、'));

/* 2. 医家检索 */
const zhang = S.search(db, idx, '张仲景');
assert.ok(zhang.length === 5 && zhang.every(r => r.formula.doctor === '张仲景'), '搜医家应只返回该医家的方');
console.log(`✓ 医家检索：张仲景 ${zhang.length} 首`);

/* 3. 药名精确：库里有「炙甘草」没有「甘草」，搜甘草就该空
      —— 子串误匹配是这类检索最经典的坑，正好用样例里的炙甘草验它 */
assert.equal(names('甘草').length, 0, '「甘草」不应匹配到「炙甘草」');
assert.ok(names('炙甘草').length === 4, '「炙甘草」应命中四首方');
console.log('✓ 药名精确：甘草 ≠ 炙甘草');

/* 4. 空格多味药反查：同时含两味才命中 */
const both = S.search(db, idx, '柴胡 黄芩');
assert.ok(both.length > 0, '「柴胡 黄芩」应有命中');
assert.ok(both.every(r => {
  const hs = r.formula.herbs.map(h => h.name);
  return hs.includes('柴胡') && hs.includes('黄芩');
}), '多味药反查结果必须同时含两味');
console.log(`✓ 多味药反查：柴胡 黄芩 → ${both.length} 首`);

/* 5. 拼音 / 首字母 */
assert.ok(names('gzt').includes('桂枝汤'), '首字母 gzt 应命中桂枝汤');
assert.ok(names('lingguishugantang').includes('苓桂术甘汤'), '全拼应命中苓桂术甘汤');
console.log('✓ 拼音：gzt → 桂枝汤；全拼 → 苓桂术甘汤');

/* 6. 空查询与无匹配不抛错 */
assert.doesNotThrow(() => S.search(db, idx, ''), '空查询不应抛错');
assert.doesNotThrow(() => S.search(db, idx, '不存在的方剂xyz'), '无匹配不应抛错');
console.log('✓ 边界：空查询 / 无匹配 均正常返回');

console.log('\n全部通过：结构 / 方名 / 医家 / 药名精确 / 多味反查 / 拼音 / 边界');
