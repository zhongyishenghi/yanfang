/**
 * 把 yanfang-pdf/out/seg*.json（逐页转录结果）合并进 data/formulas.json
 *
 * 用法：node tools/merge-transcript.mjs [--dry]
 *
 * 规则：
 *   1. 唯一键 = 部分 + 方名 + 医家（`内科|柴胡解毒汤|刘渡舟`）。各部分编号都从 1 起，
 *      且新旧两批资料的编号含义不同，按编号合并会把不同方挤成一首；方名才是稳定标识。
 *   2. 转录结果是结构与事实字段的唯一来源；现有数据里同键条目只保留 doctor_info / interpretation / verified 标记
 *   3. 现有数据里不在转录范围内的（碑方、临证等另书内容）原样保留
 *   4. id 规则：部分前缀-章号-章内两位序号（nk-1-01）
 *   5. tags 由〔主治〕〔功能〕原文按 symptom-vocab 抽取
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 基线固定读 baseline-formulas.json，产物写 formulas.json。
   若从产物文件读基线，反复跑会把上次生成的 id（如 nk-1-07-3）也当旧数据，
   导致 id 越跑越长、结果不可复现。 */
const baselineFile = path.join(root, 'data/baseline-formulas.json');
const dataFile = path.join(root, 'data/formulas.json');
const vocabFile = path.join(root, 'data/symptom-vocab.json');
const segDir = path.resolve(root, '..', 'yanfang-pdf', 'out');
const dry = process.argv.includes('--dry');

/* ---------- 署名与组成的拆分规则（2026-11-19） ----------
 * 原书里两个人共同署名写成「张炉高　王惠仙」（全角空格）或「王朝阳 秦爱英」，
 * 转录时整串塞进 doctor，医家索引就多出一个叫「张炉高、王惠仙」的“人”，
 * 按其中任何一位都点不到方子。这里统一拆成 doctors 数组，
 * doctor 仍保留合并写法用于显示（顿号归一成「、」，与原书语义一致）。 */
function splitDoctors(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return { doctor: '', doctors: [] };
  const parts = s.split(/[、,，／/\s]+/).map(t => t.trim()).filter(Boolean);
  if (parts.length < 2) {
    // 「葛文津等」是“葛文津等人”，只有一个人名，等不参与索引
    const one = s.replace(/等$/, '') || s;
    return { doctor: s, doctors: [one] };
  }
  // 拆出单字（如「房 金」）多半是断行或残缺，宁可当成一个名字，也不硬拆出「房」「金」两个人
  if (parts.some(p => p.length < 2)) return { doctor: s, doctors: [s] };
  return { doctor: parts.join('、'), doctors: parts };
}

/* 有些方在原书里分成几段写：「（1）口服方：」「（2）热敷方：」「内服方：」「孕Ⅰ方：」
 * 「1号方：」「溃疡止血粉：」。转录时标签粘在了药味名前，药名就成了
 * 「内服方：熟女贞」，药味索引里全是这种脏条目；更要紧的是把内服和外用拍平成一锅药，
 * 等于说这些药要一起煎。这里把标签剥出来放进 herb.seg，药名恢复干净。
 * raw 保持原样照录（命中理由要显示原书写法），不改写原文。
 * 注意不要用 herb.group —— 那个字段已经有主了，记的是「焦三仙各 10 克」这类原文合写形式。 */
const SEG_LABEL = /^(?:[（(]\s*[0-9一二三四五六七八九十]+\s*[）)]\s*)?([^：:]{1,8}?(?:方|粉))[：:]\s*/;
const ADV_PREFIX = /^(另用|另包|另冲|另服|先煎|后下|冲服|烊化|包煎|研末)\s*/;

/* 纯写错的字，不是炮制区别（复盆子是覆盆子的俗写，同一味药），
   不并掉的话药味索引里会有「覆盆子」「复盆子」两条。原文写法仍留在 raw 里。 */
const HERB_SPELLING = { '复盆子': '覆盆子' };

function normalizeHerbs(list) {
  const src = list || [];
  /* 原书常把几味药合写一处：「赤白芍各 15 克」「焦三仙各 10 克」。
     一份 raw 对多味药时，raw 就是“原文合写形式”，记进 group（这个字段原本就这么用），
     剂量里的「各」只是“每味各取此量”，不该留在剂量列里显示成「各15克」。 */
  const rawCount = new Map();
  src.forEach(h => {
    const r = (h.raw || '').trim();
    if (r) rawCount.set(r, (rawCount.get(r) || 0) + 1);
  });
  const isShared = r => (rawCount.get(r) || 0) > 1 && /[各、]/.test(r);

  return src.map(h => {
    let group = h.group || '';
    let seg = h.seg || '';
    let name = h.name || '';
    let note = h.note || '';
    const raw = h.raw || '';
    if (!seg) {
      const m = raw.match(SEG_LABEL);
      if (m && name.indexOf(m[1]) !== 0) seg = m[1];
    }
    if (!seg) {
      const m = name.match(SEG_LABEL);
      if (m) { seg = m[1]; name = name.slice(m[0].length).trim(); }
    }
    const adv = raw.match(ADV_PREFIX);
    if (adv && note.indexOf(adv[1]) < 0) note = note ? adv[1] + '；' + note : adv[1];
    if (HERB_SPELLING[name]) name = HERB_SPELLING[name];
    if (!group && isShared(raw)) group = raw.trim();

    /* 剂量列只放“量”。原书有时把煎法写在括号里（「五灵脂 6 克（包煎）」），
       有时没有量（「人参阿胶散 原方」「猪蹄 煎汤代水」），
       有时量随证变（「女贞子（肾阴虚各 15 克，肾阳虚各 5 克）」）。
       这些都不是一个剂量，塞进剂量列会显示成「6克（包煎）」「原方」，挪进 note。 */
    let dose = String(h.dose || '').replace(/^各\s*/, '');
    dose = dose.replace(/[（(]([^）)]*)[）)]/g, (m, inner) => {
      const t = String(inner || '').trim();
      if (t && note.indexOf(t) < 0) note = note ? note + '；' + t : t;
      return '';
    }).trim();
    if (dose && (/^(原方|煎汤代水)$/.test(dose) || /肾阴虚|肾阳虚/.test(dose))) {
      if (note.indexOf(dose) < 0) note = note ? dose + '；' + note : dose;
      dose = '';
    }
    /* 空字段不写进 JSON：8058 行药味每行两个空键，白白撑大 70 多 KB 安装包 */
    const out = { raw, name, dose, note };
    if (group) out.group = group;
    if (seg) out.seg = seg;
    return out;
  }).filter(h => h.name || h.dose);
}

const PREFIX = {
  内科: 'nk', 外科: 'wk', 妇科: 'fk', 儿科: 'ek', 皮肤科: 'pf',
  五官科: 'wg', 肿瘤: 'zl', 男性科: 'nxk', 男科: 'nxk', 碑方: 'ys', 临证: 'lz'
};
const ALIAS_PART = { 男科: '男性科', 耳鼻喉科: '五官科', 眼科: '五官科', 口腔科: '五官科' };

const db = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const vocab = JSON.parse(fs.readFileSync(vocabFile, 'utf8')).vocab;
const today = new Date().toISOString().slice(0, 10);

function deriveTags(f) {
  const text = (f.indications || '') + ' ' + (f.functions || '');
  let hits = vocab.filter(w => text.includes(w));
  hits.sort((a, b) => b.length - a.length);
  const kept = [];
  for (const w of hits) if (!kept.some(k => w !== k && k.includes(w))) kept.push(w);
  return kept.sort((a, b) => vocab.indexOf(a) - vocab.indexOf(b));
}

/* ---------- 收集转录 ---------- */
if (!fs.existsSync(segDir)) throw new Error('没有转录目录：' + segDir);
const segFiles = fs.readdirSync(segDir).filter(f => /^seg\d+\.json$/.test(f)).sort();
if (!segFiles.length) throw new Error('转录目录里没有 seg*.json');

const raw = [];
const reports = [];

/* 页码归一化：各段有的按「文件序号」推定，有的按「印刷页码 −2」推定，
   口径不一致会让 pages 跳号。统一换算成扫描顺序号：
     A0NN → NN，B0NN → 247 + NN
   跨两个 PDF 的段（如 seg09）不做换算，保留原值并在报告里注明。 */
function scanNo(fileFrom) {
  const m = String(fileFrom || '').match(/^([AB])(\d+)$/);
  if (!m) return null;
  return Number(m[2]) + (m[1] === 'B' ? 247 : 0);
}

for (const f of segFiles) {
  const j = JSON.parse(fs.readFileSync(path.join(segDir, f), 'utf8'));
  reports.push({ file: f, ...j.report });
  const fromNo = scanNo(j.file_from);
  const crossPdf = /^A/.test(String(j.file_from || '')) && /^B/.test(String(j.file_to || ''));
  const delta = (!crossPdf && fromNo && Number.isFinite(Number(j.page_from)))
    ? fromNo - Number(j.page_from) : 0;
  if (delta) console.log(`  ${f} 页码校正 ${delta > 0 ? '+' : ''}${delta}（${j.page_from} → ${fromNo}）`);
  for (const x of j.formulas || []) {
    const y = { ...x, _seg: f };
    if (delta && Array.isArray(y.pages)) y.pages = y.pages.map(p => Number(p) + delta);
    raw.push(y);
  }
}
console.log(`读入 ${segFiles.length} 段，共 ${raw.length} 条转录`);

/* ---------- 归一条目 ---------- */
const byKey = new Map();
const problems = [];
const chapterSet = new Map();   // part|no -> title

function normPart(p, chapter) {
  let s = (p || '').trim();
  if (!s && chapter) {
    // 部分缺失时退而求其次：留空，后面报出来
  }
  return ALIAS_PART[s] || s;
}

for (const x of raw) {
  const part = normPart(x.category, x.chapter);
  const sno = String(x.source_no || '').trim();
  let m = sno.match(/^(\d+)\.(\d+)/);
  /* 有药味却缺编号（扫描把标题行整行裁掉）：不能丢，按章号补一个占位编号 ch.0，
     并在 uncertain 里写明是推定，免得整首方子从库里消失。 */
  let placeholder = false;
  if (!m && part && (x.herbs || []).length) {
    const cm = String(x.chapter || '').match(/^\s*(\d+)/);
    if (cm) {
      m = [null, cm[1], '0'];
      placeholder = true;
    }
  }
  if (!part || !m) { problems.push(`${x._seg} ${sno} ${x.name}：部分或编号无法识别`); continue; }
  const chNo = Number(m[1]);
  const finalNo = placeholder ? `${m[1]}.0` : sno;
  const chapter = (x.chapter || '').replace(/^\s*\d+\s*[.．、]\s*/, '').trim();
  /* 唯一键用「部分 + 方名 + 医家」，不用编号：
     旧数据里 1.1 是「柴胡解毒汤（刘渡舟）」，而原书 1.1 是「藿朴夏苓柴陈丹草大黄汤（李培生）」，
     两批资料互为补充，按编号合并会把不同方挤成一首；方名才是稳定标识。
     带上医家是为了避免不同医家的同名方（如加味逍遥散）被误并。 */
  const nm = (x.name || '').trim();
  const doc = (x.doctor || '').trim();
  /* 方名整行被裁掉、但药味齐全的方子：给一个明确标注的占位名，
     既不让前台出现空标题，也不编造方名。同部分重复时加序号区分。 */
  let displayName = nm;
  if (!nm) {
    let base = '（方名待补）';
    displayName = base;
    let t = 1;
    while ([...byKey.values()].some(v => v._part === part && v.name === displayName)) {
      displayName = `${base}${++t}`;
    }
    problems.push(`${x._seg} ${part} ${finalNo}：方名缺失，已用占位名「${displayName}」`);
  }
  const key = nm
    ? `${part}|${nm}|${doc}`
    : `${part}|__unnamed__|${finalNo}`;   // 缺方名时退回编号，避免同段多条互相覆盖
  const prev = byKey.get(key);
  const uq = Array.isArray(x.uncertain) ? x.uncertain
    : (typeof x.uncertain === 'string' && x.uncertain ? [x.uncertain] : []);
  if (placeholder) {
    uq.push(`${x._seg}：扫描件此页标题行（编号/方名/医家）不在可见范围内，编号 ${finalNo} 为按章号补的占位值，非原书编号。属扫描缺页/裁切，非原书未载，待核纸质原书补录。`);
  }
  const sig = splitDoctors(x.doctor);
  const item = {
    _part: part,
    _chapterNo: chNo,
    _chapter: chapter || (prev && prev._chapter) || '',
    source_no: finalNo,
    name: displayName,
    doctor: sig.doctor,
    doctors: sig.doctors,
    herbs: normalizeHerbs(x.herbs),
    group: x.group || '',
    functions: x.functions || '',
    indications: x.indications || '',
    usage: x.usage || '',
    pages: x.pages || [],
    aka: x.aka || [],
    sub_formulas: x.sub_formulas || (prev && prev.sub_formulas) || [],
    uncertain: uq,
    _seg: x._seg
  };
  if (item._chapter) chapterSet.set(`${part}|${chNo}`, item._chapter);
  if (prev) {
    // 同键重复（跨页续录）：优先保留药味更全的一条
    if ((item.herbs.length || 0) >= (prev.herbs.length || 0)) {
      item._chapter = item._chapter || prev._chapter;
      item.uncertain = [...new Set([...(prev.uncertain || []), ...item.uncertain])];
      byKey.set(key, item);
      problems.push(`同键覆盖：${part} ${finalNo} ${item.name}`);
    }
  } else {
    byKey.set(key, item);
  }
}

console.log(`去重后 ${byKey.size} 条（唯一键 部分+方名+医家）`);

/* ---------- 与现有数据合并 ---------- */
const oldByKey = new Map();
const chapterTitle = new Map();   // part|章号 -> 旧数据里该章的病名标题（沿用，避免索引页出现两套章名）
for (const f of db.formulas) {
  const p = f.part || f.category || '';
  const ch = Number(String(f.source_no || '').split('.')[0]) || 0;
  /* 旧数据的署名可能还是「王朝阳 秦爱英」的连写形态，键要按拆分后的写法对齐，
     否则同一方会被当成新条目再收一遍，旧条目又落进「另书保留」，凭空多一副。 */
  oldByKey.set(`${p}|${(f.name || '').trim()}|${splitDoctors(f.doctor).doctor}`, f);
  const k = `${p}|${ch}`;
  if (!chapterTitle.has(k) && f.disease_group) chapterTitle.set(k, f.disease_group);
}

const merged = [];
let added = 0, kept = 0, inherited = 0;
const idSeq = new Map();   // part|chapter -> 递增序号
const usedIds = new Set(db.formulas.map(f => f.id)); // 新条目不得撞旧 id

// 先按 部分、章、编号 排序，保证 id 稳定
const ordered = [...byKey.values()].sort((a, b) => {
  const pa = a._part, pb = b._part;
  if (pa !== pb) return pa.localeCompare(pb, 'zh');
  if (a._chapterNo !== b._chapterNo) return a._chapterNo - b._chapterNo;
  const sa = a.source_no.split('.'), sb = b.source_no.split('.');
  return (+sa[1] || 0) - (+sb[1] || 0) || String(sa[1]).localeCompare(String(sb[1]));
});

/* 上一版产物里的 id：部分+方名+医家 对得上的，沿用上一版的 id。
   否则删掉某章的一条，后面条目的编号会整体前移，收藏夹（按 id 存）就对不上了。
   基准取上一版 formulas.json，不是 baseline —— baseline 是更早的编号体系。 */
const prevFile = path.join(root, 'data/formulas.json');
const prevIdByKey = new Map();
/* 数据版本号只增不减：make-patch.mjs 每次发版会把它 +1（并写 patch-N.json）。
   这里若写死一个数，重跑合并就把版本打回老值，version.json 会连带丢补丁记录。 */
let prevVersion = 0;
if (fs.existsSync(prevFile)) {
  try {
    const prevDb = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
    if (Number.isInteger(prevDb.version)) prevVersion = prevDb.version;
    for (const f of prevDb.formulas || []) {
      prevIdByKey.set(
        `${f.part || f.category || ''}|${(f.name || '').trim()}|${splitDoctors(f.doctor).doctor}`,
        f.id
      );
    }
  } catch (e) {
    console.warn('上一版 formulas.json 读不出，id 将按顺序重排：' + e.message);
  }
}
const fixedIds = new Map();   // item -> 沿用上一版的 id
const takenIds = new Set();   // 已分配出去的 id
for (const it of ordered) {
  const pid = prevIdByKey.get(`${it._part}|${it.name}|${it.doctor}`);
  if (pid && !takenIds.has(pid)) { fixedIds.set(it, pid); takenIds.add(pid); }
}

for (const it of ordered) {
  const prefix = PREFIX[it._part] || 'qt';
  const ck = `${prefix}-${it._chapterNo}`;
  const n = (idSeq.get(ck) || 0) + 1;
  idSeq.set(ck, n);
  let newId = fixedIds.get(it);
  if (!newId) {
    newId = `${ck}-${String(n).padStart(2, '0')}`;
    if (usedIds.has(newId) || takenIds.has(newId)) {
      let t = 2;
      while (usedIds.has(`${newId}-${t}`) || takenIds.has(`${newId}-${t}`)) t++;
      newId = `${newId}-${t}`;
    }
  }
  usedIds.add(newId);
  takenIds.add(newId);
  const old = oldByKey.get(`${it._part}|${it.name}|${it.doctor}`);
  /* 章名以转录稿为准（原书实际章题）。旧基线的章名只在该条转录没带章题时兜底：
     两批是同一书名的不同版本，章序不同（旧本 2 章是「肝硬化腹水」，新本 2 章是「菌痢」），
     照旧数据覆盖会造成张冠李戴。 */
  const chapterName = it._chapter || chapterTitle.get(`${it._part}|${it._chapterNo}`) || '';
  const f = {
    id: newId,
    source_no: it.source_no,
    name: it.name,
    doctor: it.doctor,
    doctors: it.doctors,
    doctor_info: (old && old.doctor_info) || '',
    category: it._part,
    part: it._part,
    group: it.group || '',
    disease_group: (old && old.disease_group) || chapterName || '',
    herbs: it.herbs,
    functions: it.functions,
    indications: it.indications,
    usage: it.usage,
    tags: [],
    /* 两批资料同名不同版：新转录来自 2026 年新扫描本（书页 1–476），
       旧基线来自早年扫描本（书页 1–469，章序与方名都不同）。出处必须写清版本，
       否则用户按「第 1 页」去核对原书会对不上。 */
    source: { book: '首批国家级名老中医效验秘方精选（续集）（新扫描本，书页 1–476）', pages: it.pages },
    review: (old && old.review) || 'draft',
    updated_at: today,
    v: 8
  };
  if (it.aka && it.aka.length) f.aka = it.aka;
  /* 一个方名底下分几副方的（如「中药人工周期治疗月经失调」按月经周期分三期），
     子方各自成条，主方只记指向，不重复录药味。 */
  if (it.sub_formulas && it.sub_formulas.length) f.sub_formulas = it.sub_formulas;
  if (it.uncertain && it.uncertain.length) f.uncertain = it.uncertain;
  f.tags = deriveTags(f);
  if (old) {
    kept++;
    if (old.interpretation) { f.interpretation = old.interpretation; inherited++; }
  } else added++;
  merged.push(f);
}

// 现有数据里不属于本书的条目（碑方/临证等）原样保留；旧扫描本条目改写来源标注
const bookKeys = new Set(merged.map(f =>
  `${f.part}|${(f.name || '').trim()}|${(f.doctor || '').trim()}`));
let extra = 0;
for (const f of db.formulas) {
  const p = f.part || f.category || '';
  const k = `${p}|${(f.name || '').trim()}|${(f.doctor || '').trim()}`;
  if (!bookKeys.has(k)) {
    const src = f.source || {};
    // 旧基线的「（内科部分）（外科部分）…」按科室拆分的老标注，一律归到旧扫描本的全名
    if (/^(名医方剂汇编|首批国家级名老中医效验秘方精选)/.test(src.book || '')) {
      f.source = { ...src, book: '首批国家级名老中医效验秘方精选（旧扫描本，书页 1–469）' };
    }
    /* 另书条目（碑方、临证、旧扫描本）同样过一遍署名/组成归一：
       这批数据年代更早，联合署名与分段标签的问题一样存在。 */
    // 旧基线注记里的简称统一为正式书名，避免重建后旧称回流
    if (Array.isArray(f.uncertain)) {
      f.uncertain = f.uncertain.map(t => typeof t === 'string'
        ? t.replace(/《名医方剂汇编》/g, '《首批国家级名老中医效验秘方精选》') : t);
    }
    const sig = splitDoctors(f.doctor);
    f.doctor = sig.doctor;
    f.doctors = sig.doctors;
    f.herbs = normalizeHerbs(f.herbs);
    merged.push(f);
    extra++;
  }
}

/* ---------- 重建 parts / chapters / stats ---------- */
const partMap = new Map();
for (const f of merged) {
  const p = f.part || f.category;
  if (!partMap.has(p)) partMap.set(p, []);
  partMap.get(p).push(f);
}
const parts = [...partMap.entries()].map(([name, arr]) => ({
  name,
  chapters: new Set(arr.map(f => f.disease_group).filter(Boolean)).size,
  count: arr.length
})).sort((a, b) => b.count - a.count);

const chapters = [];
for (const [p, arr] of partMap) {
  const seen = new Map();
  for (const f of arr) {
    const t = f.disease_group;
    if (!t) continue;
    const no = Number(String(f.source_no).split('.')[0]);
    if (!seen.has(t)) seen.set(t, no);
  }
  for (const [t, no] of seen) chapters.push({ part: p, no, title: t });
}

const herbRows = merged.reduce((s, f) => s + f.herbs.length, 0);
db.formulas = merged;
db.parts = parts;
db.chapters = chapters;
db.version = Math.max(8, prevVersion);
db.updated_at = today;
db.generated_at = undefined;
db.built_with = undefined;
db.source_files = [
  '1-247.pdf（书页 1-247）',
  '248-476.pdf（书页 248-476）'
];
db.stats = {
  count: merged.length,
  herb_rows: herbRows,
  doctors: new Set(merged.flatMap(f => (f.doctors && f.doctors.length ? f.doctors : [f.doctor])).filter(Boolean)).size,
  chapters: chapters.length,
  parts: parts.length,
  tag_rows: merged.filter(f => (f.tags || []).length).length,
  vocab: vocab.length
};

console.log(`合计 ${merged.length} 副（新转录覆盖 ${kept + added}，其中沿用旧条目 ${kept}、保留解读 ${inherited}；另书保留 ${extra}）`);
console.log(`部分 ${parts.length} / 章 ${chapters.length} / 药味 ${herbRows} 条 / 医家 ${db.stats.doctors} 位`);
if (problems.length) {
  console.log(`待人工确认 ${problems.length} 条：`);
  problems.slice(0, 30).forEach(p => console.log('  · ' + p));
  if (problems.length > 30) console.log('  …');
}

if (dry) {
  console.log('（--dry 预览，未写入）');
} else {
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 1) + '\n', 'utf8');
  console.log('已写入 data/formulas.json，下一步：node tools/build-data.mjs');
}
