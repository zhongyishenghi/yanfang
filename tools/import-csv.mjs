/**
 * CSV 批量录入：tools/import-csv.mjs <文件.csv> [--dry]
 *
 * 追加或更新方剂，写回 data/formulas.json。改完记得跑：
 *   node tools/build-data.mjs
 *
 * CSV 表头（顺序不限，中英文都可）：
 *   source_no   方剂编号，如 5.3（必需，作为唯一键）
 *   name        方名（必需）
 *   doctor      医家（必需）
 *   disease_group 病名章节，如 慢性胃炎
 *   herbs       组成，如「柴胡 10 克；黄芩 10 克；茵陈 12 克（后下）」
 *   functions   功能
 *   indications 主治
 *   usage       用法
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
  source_no: 'source_no', 编号: 'source_no', 方剂编号: 'source_no',
  name: 'name', 方名: 'name',
  doctor: 'doctor', 医家: 'doctor', 医生: 'doctor',
  disease_group: 'disease_group', 病名: 'disease_group', 章节: 'disease_group',
  herbs: 'herbs', 组成: 'herbs',
  functions: 'functions', 功能: 'functions',
  indications: 'indications', 主治: 'indications',
  usage: 'usage', 用法: 'usage',
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
const missing = ['source_no', 'name', 'doctor', 'herbs'].filter(k => !header.includes(k));
if (missing.length) throw new Error('缺少必需列：' + missing.join('、'));

const bySource = new Map(db.formulas.map(f => [f.source_no, f]));
const today = new Date().toISOString().slice(0, 10);
let added = 0, updated = 0;
const problems = [];

for (let i = 1; i < rows.length; i++) {
  const rec = {};
  header.forEach((k, j) => { rec[k] = (rows[i][j] || '').trim(); });
  if (!rec.name) continue;

  const sno = rec.source_no;
  if (!/^\d+\.\d+$/.test(sno)) { problems.push(`第 ${i + 1} 行编号不规范：${sno || '(空)'}`); continue; }

  const herbs = rec.herbs.split(/[;；|]/).map(parseHerb).filter(Boolean);
  if (!herbs.length) { problems.push(`第 ${i + 1} 行没有解析出药味：${rec.herbs}`); continue; }

  const [ch, seq] = sno.split('.');
  const old = bySource.get(sno);
  const formula = {
    id: old ? old.id : `nk-${Number(ch)}-${String(Number(seq)).padStart(2, '0')}`,
    source_no: sno,
    name: rec.name,
    doctor: rec.doctor,
    doctor_info: (old && old.doctor_info) || '',
    category: (old && old.category) || '内科',
    disease_group: rec.disease_group || (old && old.disease_group) || '',
    herbs,
    functions: rec.functions || (old && old.functions) || '',
    indications: rec.indications || (old && old.indications) || '',
    usage: rec.usage || (old && old.usage) || '',
    source: (old && old.source) || { book: '未注明', pages: [] },
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

  bySource.set(sno, formula);
  if (old) updated++; else added++;
}

const formulas = [...bySource.values()].sort((a, b) => {
  const ka = a.source_no.split('.'), kb = b.source_no.split('.');
  return (+ka[0] - +kb[0]) || (+ka[1] - +kb[1]);
});

console.log(`新增 ${added} 首，更新 ${updated} 首，合计 ${formulas.length} 首`);
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
