/* 增量更新自测：node tools/test-update.mjs
 * 覆盖校验和、原子合并、篡改拒绝、版本跳号、断链、下载失败回退。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* localStorage 替身：用来验证「失败绝不写盘」 */
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

new Function(fs.readFileSync(path.join(root, 'app/www/js/update.js'), 'utf8'))();
const U = globalThis.YANFANG_UPDATE;

const base = JSON.parse(fs.readFileSync(path.join(root, 'data/formulas.json'), 'utf8'));
const db = { version: base.version, formulas: base.formulas, herb_alias: base.herb_alias, updated_at: base.updated_at };
const total = db.formulas.length;
const from = db.version;
const to = from + 1;
console.log(`基础数据 v${db.version}，${total} 首`);

/* ---------- 造一个真实形态的增量包 ---------- */
const revised = { ...db.formulas[0], tags: [...db.formulas[0].tags, '测试新增标签'] };
const added = {
  id: 'nk-99-01', source_no: '99.1', name: '测试新方', doctor: '测试医家',
  disease_group: '测试病名', category: '内科',
  herbs: [{ raw: '黄芪 15 克', name: '黄芪', dose: '15克', note: '' }],
  functions: '测试。', indications: '测试。', usage: '水煎服。', tags: ['测试'],
  updated_at: '2026-11-20', v: 1
};
const removedId = db.formulas[db.formulas.length - 1].id;

const patch = U.signPatch({
  from, to,
  upserts: [revised, added],
  deletes: [removedId],
  alias: { 北芪: '黄芪' }
});

assert.equal(U.signPatch(patch).checksum, patch.checksum, '校验和应可复算');
const next = U.mergePatch(db, patch);
assert.equal(next.version, to, '版本 +1');
assert.equal(next.formulas.length, total, '删 1 增 1 后总数不变');
assert.ok(!next.formulas.some(f => f.id === removedId), '墓碑删除生效');
assert.ok(next.formulas.some(f => f.id === 'nk-99-01'), '新增方生效');
assert.equal(next.formulas.find(f => f.id === revised.id).tags.includes('测试新增标签'), true, '修改生效');
assert.equal(next.herb_alias['北芪'], '黄芪', '别名增量合并');
assert.equal(db.version, from, '不得改动原对象');
assert.equal(db.formulas.length, total, '原对象未被污染');

/* ---------- 拒绝异常包 ---------- */
assert.throws(() => U.mergePatch(db, { ...patch, alias: { 北芪: '被篡改' } }), /校验和/, '篡改内容应被拒');
assert.throws(() => U.mergePatch(db, U.signPatch({ ...patch, from, to: to + 1 })), /不连续/, 'to 跳号应被拒');
assert.throws(() => U.mergePatch(db, U.signPatch({ ...patch, from: from + 5, to: from + 6 })), /不一致/, '起点不符应被拒');
assert.throws(
  () => U.mergePatch(db, U.signPatch({ from, to, upserts: [{ id: 'bad', name: '坏记录', herbs: [] }], deletes: [] })),
  /整包拒绝/,
  '字段不全应整包拒绝'
);
assert.equal(db.version, from, '失败后本地版本不变');

/* ---------- 版本链 ---------- */
const meta = { latest: to, patches: [{ from, to, file: `patch-${to}.json` }] };
assert.equal(U.checkMeta(meta, from).length, 1, '旧版本应拿到 1 个包');
assert.equal(U.checkMeta({ latest: to, patches: meta.patches }, to), null, '已最新返回 null');
assert.throws(() => U.checkMeta({ latest: to + 1, patches: meta.patches }, from), /链不连续/, '断链应等待全量包');

const okFetch = async url => ({
  ok: true, status: 200,
  json: async () => (String(url).includes('version.json') ? meta : patch)
});
const plan = await U.checkUpdate({ baseUrl: 'https://example.com/d/', currentVersion: from, fetchImpl: okFetch });
assert.equal(plan.updated, true);
assert.equal(plan.chain.length, 1);
const applied = await U.applyChain(db, plan.chain, 'https://example.com/d', okFetch);
assert.equal(applied.version, to, '链式应用成功');

/* ---------- 下载中断：绝不写盘、原数据不变 ---------- */
store.clear();
const flakyFetch = async url => {
  if (String(url).includes('version.json')) return { ok: true, status: 200, json: async () => meta };
  throw new Error('断网');
};
const fb = await U.sync({ baseUrl: 'https://example.com/d', current: db, fetchImpl: flakyFetch });
assert.equal(fb.changed, false, '下载失败不改数据');
assert.equal(fb.db.version, from, '回退到旧版本');
assert.equal(store.size, 0, '失败时绝不写盘');
assert.match(fb.error, /断网/);

/* ---------- 正常同步会落盘 ---------- */
const ok2 = await U.sync({ baseUrl: 'https://example.com/d', current: db, fetchImpl: okFetch });
assert.equal(ok2.changed, true, '成功应标记已更新');
assert.equal(ok2.db.version, to);
assert.ok(store.get(U.STORAGE_KEY), '成功后写入本地存储');
const reloaded = U.load(base);
assert.equal(reloaded.version, to, '重启后读到新版本');
U.reset();
assert.equal(U.load({ version: 9 }).version, 9, '清空后回落到内置数据');

console.log('全部通过：校验和 / 原子合并 / 篡改拒绝 / 跳号 / 断链 / 下载失败回退 / 落盘 / 重启读回');
