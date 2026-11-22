/**
 * CSV 批量录入：tools/import-csv.mjs <文件.csv> [--dry]
 *
 * 追加或更新方剂，写回 data/formulas.json。改完记得跑：
 *   node tools/build-data.mjs
 *
 * CSV 表头（顺序不限，中英文都可）：
 *   id          已有方子的 id（可选；填了按 id 更新，不填按「方名+医家」匹配）
 *   source_no   原书编号，如 5.3（可选。各分部编号都从 1.1 起，会重复，不能当唯一键）
 *   name        方名（必需）
 *   doctor      医家（必需）
 *   part        分部，如 内科 / 妇科 / 儿科（可选，默认 内科）
 *   disease_group 病名章节，如 慢性胃炎
 *   herbs       组成，如「柴胡 10 克；黄芩 10 克；茵陈 12 克（后下）」
 *   functions   功能
 *   indications 主治
 *   usage       用法
 *   book        出处书名（可选）
 *   pages       书页，逗号分隔，如 364,365（可选）
 *   review      verified / draft，默认 draft
 *   interpretation 原创解读正文（可选）
 *
 * 组成写法约定：药名与剂量用空格分开，多味用 ；或 ; 或 | 分隔。
 * 括号内容会存进备注（如「后下」「打碎」「或炒枳实」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(root, 'data/formulas.json');
const vocabFile = path.join(root, 'data/symptom-vocab.json');

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const dry = args.includes('--dry');
if (!csvPath) {
  console.error('用法：node tools/import-csv.mjs <文件.csv> [--dry]');
  process.exit(1);
}

/* ---------- CSV 解析（支持引号包裹与换行） ---------- */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else cell += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* 跳过 */ }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

const HEAD_ALIAS = {
  id: 'id', 编号id: 'id',
  source_no: 'source_no', 编号: 'source_no', 方剂编号: 'source_no',
  name: 'name', 方名: 'name',
  doctor: 'doctor', 医家: 'doctor', 医生: 'doctor',
  part: 'part', 分部: 'part', 科别: 'part',
  disease_group: 'disease_group', 病名: 'disease_group', 章节: 'disease_group',
  herbs: 'herbs', 组成: 'herbs',
  functions: 'functions', 功能: 'functions',
  indications: 'indications', 主治: 'indications',
  usage: 'usage', 用法: 'usage',
  book: 'book', 书名: 'book', 出处: 'book',
  pages: 'pages', 书页: 'pages',
  review: 'review', 状态: 'review',
  interpretation: 'interpretation', 解读: 'interpretation'
};

/* ---------- 单味药解析 ---------- */
function parseHerb(text) {
  const raw = String(text).trim();
  if (!raw) return null;
  const notes = [];
  raw.replace(/[（(]([^）)]*)[）)]/g, (_, n) => { if (n.trim()) notes.push(n.trim()); return ''; });
  const clean = raw.replace(/[（(][^）)]*[）)]/g, '').trim();
  const m = clean.match(/^([^\d０-９]+?)\s*([\d０-９][\d０-９.,，\-—~～至\s]*(?:克|g|G|钱|两|毫升|ml|ML|枚|片|个|只|条|寸|分)?)$/);
  if (m) {
    return { raw: clean, name: m[1].trim(), dose: m[2].replace(/\s+/g, ''), note: notes.join('；') };
  }
  return { raw: clean, name: clean, dose: '等分', note: notes.join('；') };
}

/* ---------- 标签派生（与 tools/merge-data.py 同一份词表、同一套规则） ---------- */
const vocab = JSON.parse(fs.readFileSync(vocabFile, 'utf8')).vocab;
function deriveTags(f) {
  const text = (f.indications || '') + ' ' + (f.functions || '');
  let hits = vocab.filter(w => text.includes(w));
  hits.sort((a, b) => b.length - a.length);
  const kept = [];
  for (const w of hits) if (!kept.some(k => w !== k && k.includes(w))) kept.push(w);
  return kept.sort((a, b) => vocab.indexOf(a) - vocab.indexOf(b));
}

/* ---------- 主流程 ---------- */
const db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const rows = parseCSV(fs.readFileSync(path.resolve(csvPath), 'utf8'));
if (!rows.length) throw new Error('CSV 是空的');

const header = rows[0].map(h => HEAD_ALIAS[String(h).trim()] || String(h).trim());
const missing = ['name', 'doctor', 'herbs'].filter(k => !header.includes(k));
if (missing.length) throw new Error('缺少必需列：' + missing.join('、'));

/* 判重不能只看 source_no：各分部编号都从 1.1 起（儿科 1.1、内科 1.1…），
   2086 首里只有 1623 个不同的 source_no，按它建 Map 会互相覆盖、一次丢掉 460 多首。
   改为：CSV 填了 id 就按 id，否则按「方名+医家」。 */
const byId = new Map(db.formulas.map(f => [f.id, f]));
const byNameDoctor = new Map(db.formulas.map(f => [(f.name || '') + '|' + (f.doctor || ''), f]));
const usedIds = new Set(db.formulas.map(f => f.id));
let idSeq = 0;
function nextId() {
  let id;
  do { idSeq++; id = 'hx-' + String(idSeq).padStart(4, '0'); } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}
const parsePages = s => String(s || '').split(/[,，;；\s]+/).map(x => parseInt(x, 10)).filter(n => n > 0);
const today = new Date().toISOString().slice(0, 10);
let added = 0, updated = 0;
const problems = [];

for (let i = 1; i < rows.length; i++) {
  const rec = {};
  header.forEach((k, j) => { rec[k] = (rows[i][j] || '').trim(); });
  if (!rec.name) continue;

  const sno = rec.source_no || '';
  if (sno && !/^\d+\.\d+$/.test(sno)) { problems.push(`第 ${i + 1} 行编号不规范：${sno}`); continue; }

  const herbs = rec.herbs.split(/[;；|]/).map(parseHerb).filter(Boolean);
  if (!herbs.length) { problems.push(`第 ${i + 1} 行没有解析出药味：${rec.herbs}`); continue; }

  const old = (rec.id && byId.get(rec.id)) || byNameDoctor.get(rec.name + '|' + rec.doctor);
  const formula = {
    id: old ? old.id : (rec.id || nextId()),
    source_no: sno || (old && old.source_no) || '',
    name: rec.name,
    doctor: rec.doctor,
    doctors: (old && old.doctors && old.doctors.length) ? old.doctors : (rec.doctor ? [rec.doctor] : []),
    doctor_info: (old && old.doctor_info) || '',
    category: rec.part || (old && old.category) || '内科',
    part: rec.part || (old && old.part) || '内科',
    group: (old && old.group) || '',
    disease_group: rec.disease_group || (old && old.disease_group) || '',
    herbs,
    functions: rec.functions || (old && old.functions) || '',
    indications: rec.indications || (old && old.indications) || '',
    usage: rec.usage || (old && old.usage) || '',
    source: rec.book
      ? { book: rec.book, pages: parsePages(rec.pages) }
      : ((old && old.source) || { book: '未注明', pages: [] }),
    review: rec.review === 'verified' ? 'verified' : (old && old.review) || 'draft',
    updated_at: today,
    v: db.version
  };
  formula.tags = deriveTags(formula);

  if (rec.interpretation) {
    formula.interpretation = {
      text: rec.interpretation,
      author: '易圣验方整理',
      basis: '依据组成、剂量与主治字段独立撰写',
      reviewed: today
    };
  } else if (old && old.interpretation) {
    formula.interpretation = old.interpretation;
  }

  byId.set(formula.id, formula);
  byNameDoctor.set(formula.name + '|' + formula.doctor, formula);
  if (old) updated++; else added++;
}

const isNum = s => /^\d+\.\d+$/.test(s || '');
const formulas = [...byId.values()].sort((a, b) => {
  const an = isNum(a.source_no), bn = isNum(b.source_no);
  if (an && bn) {
    const ka = a.source_no.split('.'), kb = b.source_no.split('.');
    return (+ka[0] - +kb[0]) || (+ka[1] - +kb[1]);
  }
  /* 有原书编号的排前面；药典方、手工新增没有编号，保持原相对顺序放在后面 */
  return an === bn ? 0 : (an ? -1 : 1);
});

console.log(`新增 ${added} 首，更新 ${updated} 首，合计 ${formulas.length} 首`);
if (added) {
  console.log('提示：新方子的病名若不在 data/formulas.json 的 chapters 里，索引页不会列出该章（搜索仍能命中）。');
  console.log('      出处可在 data/formulas.json 里补 source.book / source.pages。');
}
if (problems.length) {
  console.log('需人工处理：');
  problems.forEach(p => console.log('  · ' + p));
}

if (dry) {
  console.log('（--dry 预览，未写入）');
} else {
  db.formulas = formulas;
  delete db.built_with;
  delete db.generated_at;
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 1) + '\n', 'utf8');
  console.log('已写入 data/formulas.json，下一步：node tools/build-data.mjs');
}
