/* 易圣验方 · 检索内核
 *
 * 设计要点（都是踩过的坑）：
 * 1. 药名只做「归一后的精确键匹配」，绝不做子串匹配 ——
 *    否则搜「茯苓」会命中所有含「土茯苓」的方子，搜「参」会命中「丹参/苦参/太子参」。
 * 2. 章节病名（disease_group）只给低权重 ——
 *    方子归在某章 ≠ 主治该病，否则「肝硬化」会把本章里根本不治肝硬化的方子排到前面。
 * 3. 同一个词在多个维度命中时取最高分，不累加，避免「柴胡」既中方名又中药名时分值虚高。
 * 4. 多个词之间是 AND：空格分开表示「同时满足」，用来做多药组合反查。
 */
(function (global) {
  'use strict';

  var W = {
    nameExact: 100,
    nameRelated: 92,
    nameContains: 66,
    namePinyin: 58,
    nameAbbr: 52,
    tagExact: 82,
    tagContains: 72,
    doctorExact: 70,
    doctorContains: 64,
    doctorPinyin: 56,
    herbExact: 60,
    indications: 40,
    groupExact: 32,
    groupContains: 27,
    body: 12,
    loose: 9
  };

  /* 常见「炮制」前缀，仅用于查不到时再退一步，不改变原文。
   * 刻意不含产地前缀（土 / 川 / 怀 / 广 / 云 / 杭）：
   * 土茯苓不是茯苓、川牛膝和牛膝是不同基原，剥前缀会把两种药混成一味。
   * 产地别名一律走 herb_alias 显式声明。 */
  var PREFIX = ['炒', '炙', '制', '清', '姜', '法', '生', '煅', '醋', '酒', '蜜', '焦', '盐',
    '麸', '砂', '鲜', '干', '熟', '煨', '炮'];

  function stripDose(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\s\u3000]*[\d０-９].*$/, '')
      .trim();
  }

  /* 从原书写法里抠出药名，只用于「按原书的别称也能搜到」这条通路，
     不参与药味索引的展示。
     原书组成并不总写成「药名 克数」：还有「内服方：熟女贞 15 克」「桂枝 等分」
     「蛤蚧一对」「复盆子 适量」「注射用水适量制成 1000 毫升」。stripDose 只按数字切，
     这些尾巴会整串留在名字里，索引里就冒出「内服方：熟女贞」「桂枝 等分」这种条目。
     这里按「分段标签 → 另用类付煎词 → 剂量尾巴 → 各」的顺序逐层剥，剥不干净的直接弃用。 */
  var SEG_LABEL_RE = /^(?:[（(]\s*[0-9一二三四五六七八九十]+\s*[）)]\s*)?[^：:]{1,8}?(?:方|粉)[：:]\s*/;
  var ADV_RE = /^(?:另用|另包|另冲|另服|先煎|后下|冲服|烊化|包煎|研末)\s*/;
  var DOSE_TAIL_RE = new RegExp(
    '(?:[0-9０-９]+(?:\\.[0-9]+)?\\s*(?:克|g|钱|两|毫升|ml|份|片|支|个)?' +
    '|[一二三四五六七八九十百]+(?:枚|对|具|条|只|个|片|支|把|撮)' +
    '|适量|等分|少许|若干)\\s*$'
  );

  function rawHerbName(raw) {
    if (!raw) return '';
    var s = String(raw)
      .replace(/[（(][^）)]*[）)]/g, '')   // 括号注：先煎、另包、去头足研末
      .replace(SEG_LABEL_RE, '')          // 分段标签：内服方／口服方／孕Ⅰ方／溃疡止血粉
      .replace(ADV_RE, '')
      .replace(/制成.*$/, '');            // 「适量制成 1000 毫升」
    for (var i = 0; i < 3 && DOSE_TAIL_RE.test(s); i++) s = s.replace(DOSE_TAIL_RE, '');
    s = s.replace(/[、，,]?\s*各\s*$/, '').trim();
    return s;
  }

  /* 只认像一味药的名字：2–8 个汉字，且不带任何残留的标点或说明词。
     宁可少一条别名，也不让「滑石、苏叶」这种两味药并写的串冒充药名。 */
  function isCleanHerbName(s) {
    return /^[\u4e00-\u9fa5]{2,8}$/.test(s) &&
      !/(各|适量|等分|少许|若干|另用|内服|外用|制成|研末|冲服)/.test(s);
  }

  /* 原书章名常把几个并列病名写在一起，用顿号连写，例如
   * 「病毒性肝炎、肝硬化」「急、慢性支气管炎」「冠心病、心绞痛、心肌梗塞」。
   * 索引与检索都按独立病名处理，否则索引里会堆一串复合词，点「肝硬化」也漏掉
   * 归在「病毒性肝炎、肝硬化」章下的方子。
   * 辨不清的字转录时写作 □，它不是病名，绝不进索引（曾出现过「□ 19」的怪条目）。 */
  function diseaseTerms(raw) {
    if (!raw) return [];
    // 中文简写：「急、慢性支气管炎」= 急性支气管炎 + 慢性支气管炎，
    // 不能拆成「急」和「慢性支气管炎」。这类共用后缀的省略只此一处，显式列出。
    var SHARED_TAIL = { '急、慢性支气管炎': ['急性支气管炎', '慢性支气管炎'] };
    if (SHARED_TAIL[raw]) return SHARED_TAIL[raw].slice();
    var out = [];
    // 括号里是补充说明，其中的顿号不是病名分隔，例如「不育症（少精、死精、不液化等）」
    String(raw).replace(/[（(][^）)]*[）)]/g, '').split(/[、,，]/).forEach(function (part) {
      var t = part.trim();
      if (!t || /^[□?？·\-—]+$/.test(t)) return;
      if (out.indexOf(t) < 0) out.push(t);
    });
    return out;
  }

  function buildIndex(db) {
    var alias = db.herb_alias || {};
    var herbs = new Map();   // 标准药名 -> Set(formula.id)
    var doctors = new Map(); // 医家 -> ids
    var tags = new Map();    // 病名 / 证候标签 -> ids
    var groups = new Map();  // 章节病名 -> ids
    var family = new Map();  // 同方不同剂型的族名 -> 方对象数组（要保序，用数组）

    function push(map, key, id) {
      if (!key) return;
      var s = map.get(key);
      if (!s) { s = new Set(); map.set(key, s); }
      s.add(id);
    }

    // 第一遍：收集全书出现过的药名，作为「剥前缀」的白名单。
    // 只有剥完仍是本书真实存在的药名才认，避免「焦三仙 → 三仙」这类臆造。
    var known = new Set();
    db.formulas.forEach(function (f) {
      f.herbs.forEach(function (h) {
        if (h.name) known.add(h.name);
        var s = rawHerbName(h.raw);
        if (s && isCleanHerbName(s)) known.add(s);
      });
    });
    Object.keys(alias).forEach(function (k) { known.add(k); });

    function addWithAlias(out, n) {
      if (out.indexOf(n) < 0) out.push(n);
      var m = alias[n];
      if (m && out.indexOf(m) < 0) out.push(m);
    }
    function variants(n) {
      var out = [n];
      var mapped = alias[n];
      if (mapped) out.push(mapped);
      // 剥括号炮制注：药典写法如「附子（制）」「半夏（制）」「茯苓（去皮）」
      var noParen = String(n).replace(/[（(][^）)]*[）)]/g, '').trim();
      if (noParen && noParen !== n) addWithAlias(out, noParen);
      for (var i = 0; i < PREFIX.length; i++) {
        var p = PREFIX[i];
        if (n.length > p.length + 1 && n.indexOf(p) === 0) {
          var rest = n.slice(p.length);
          if (known.has(rest) || alias[rest]) {
            out.push(rest);
            if (alias[rest] && out.indexOf(alias[rest]) < 0) out.push(alias[rest]);
          }
        }
        // 剥括号后再剥前缀：如「姜半夏（制）」→「半夏」
        if (noParen && noParen.length > p.length + 1 && noParen.indexOf(p) === 0) {
          var rest2 = noParen.slice(p.length);
          if (known.has(rest2) || alias[rest2]) addWithAlias(out, rest2);
        }
      }
      return out;
    }

    db.formulas.forEach(function (f) {
      var names = new Set();      // 检索命中用：标准名 + 别名 + 原书写法
      var canonical = new Set();  // 药味索引展示用：只收标准名及其别名、剥前缀变体
      var nameToRaw = {};   // 变体 -> 该味的原书写法，用于命中理由显示原文
      f.herbs.forEach(function (h) {
        /* 只辨出一个方框的味，转录时按规矩留「□」占位，它不是一个药名，
           进了索引就是一条空白按钮（病名那边早就这么处理）。数据里保留该行，索引里不出现。 */
        if (/^[□?？·\-—\s]+$/.test(h.name || '')) return;
        variants(h.name).forEach(function (n) {
          names.add(n); canonical.add(n);
          if (!nameToRaw[n]) nameToRaw[n] = h.raw;
        });
        /* 原书写法只做「别名」参与命中，不进索引。
           原书里「内服方：熟女贞」「桂枝 等分」「蛤蚧一对」这类写法剥不干净，
           一旦进索引就成了药味列表里的脏条目（2026-11-19 用户反馈）。 */
        var rn = rawHerbName(h.raw);
        if (rn && isCleanHerbName(rn)) {
          variants(rn).forEach(function (n) { names.add(n); if (!nameToRaw[n]) nameToRaw[n] = h.raw; });
        }
      });
      names.delete('');
      canonical.delete('');
      f._herbNames = names;
      f._herbRaw = nameToRaw;
      canonical.forEach(function (n) { push(herbs, n, f.id); });

      /* 联合署名拆成几个人就进几个索引项：点「王惠仙」也该弹出她参与署名的方子，
         而不是在医家列表里躺着一个叫「张炉高、王惠仙」的怪名字。 */
      (f.doctors && f.doctors.length ? f.doctors : [f.doctor]).forEach(function (d) {
        push(doctors, d, f.id);
      });
      diseaseTerms(f.disease_group).forEach(function (t) { push(groups, t, f.id); });
      (f.tags || []).forEach(function (t) { push(tags, t, f.id); });
      /* 同一处方不同剂型（六味地黄丸 / 软胶囊 / 颗粒…）归到一族，
         详情页据此列出同方其他剂型，互相跳转。 */
      if (f.family) {
        var arr = family.get(f.family);
        if (!arr) { arr = []; family.set(f.family, arr); }
        arr.push(f);
      }
    });

    return {
      alias: alias,
      herbs: herbs,
      doctors: doctors,
      tags: tags,
      groups: groups,
      family: family,
      byId: new Map(db.formulas.map(function (f) { return [f.id, f]; })),
      /* 按「版本+部分+编号」索引：两版扫描本的编号会重号（176 处），键里必须带书名。
         主方要用它找自己名下的分期子方（sub_formulas）。 */
      byNo: new Map(db.formulas.map(function (f) {
        return [((f.source && f.source.book) || '') + '|' + (f.category || '') + '|' + f.source_no, f];
      }))
    };
  }

  /** 词在某个维度上的得分与命中说明，返回 {score, hits[]}
   *  strict=true 表示该词被判定为药名：此时关掉一切子串兜底，
   *  否则「茯苓」会从正文里的「土茯苓」、从主治里的「土茯苓」蹭到分。 */
  function scoreOne(f, term, type, idx, strict) {
    var q = term.toLowerCase();
    var best = 0;
    var hits = [];
    var want = function (k) { return type === 'all' || type === k; };

    if (want('name')) {
      var n = f.name || '';
      // 异名（aka）：同一副方在数据里只留一条时，另一个方名记在这里。
      // 命中异名与命中方名同等权重 —— 它们是同一副方，不该因为条目里选了哪个名字而排在后面。
      var akas = f.aka || [];
      var akaExact = null;
      var akaPart = null;
      for (var k = 0; k < akas.length; k++) {
        if (akas[k] === term) { akaExact = akas[k]; break; }
        if (!akaPart && akas[k].indexOf(term) >= 0) akaPart = akas[k];
      }
      // 互指：原书重出的同一方，两条各自独立成条，用 related 交叉指路。
      // 命中互指名的分略低于命中本方名，让对方那条排在自己前面。
      var related = f.related || [];
      var relExact = null;
      var relPart = null;
      for (var r = 0; r < related.length; r++) {
        var rn = (related[r] && related[r].name) || '';
        if (!rn) continue;
        if (rn === term) { relExact = rn; break; }
        if (!relPart && rn.indexOf(term) >= 0) relPart = rn;
      }
      if (n === term) { best = Math.max(best, W.nameExact); hits.push(['方名', n]); }
      else if (akaExact) { best = Math.max(best, W.nameExact); hits.push(['异名', akaExact]); }
      else if (relExact) { best = Math.max(best, W.nameRelated); hits.push(['同方异名', relExact]); }
      else if (n.indexOf(term) >= 0) { best = Math.max(best, W.nameContains); hits.push(['方名', n]); }
      else if (akaPart) { best = Math.max(best, W.nameContains); hits.push(['异名', akaPart]); }
      else if (relPart) { best = Math.max(best, W.nameContains); hits.push(['同方异名', relPart]); }
      else if (f.pinyin && f.pinyin.indexOf(q) >= 0) { best = Math.max(best, W.namePinyin); hits.push(['方名拼音', n]); }
      else if (f.abbr && f.abbr.indexOf(q) === 0) { best = Math.max(best, W.nameAbbr); hits.push(['方名缩写', n]); }
    }

    if (want('doctor')) {
      var d = f.doctor || '';
      var ds = (f.doctors && f.doctors.length) ? f.doctors : [d];
      // 联合署名的方子，任一位单独命中都按「精确」算，不能被连写的整串压成分数更低的包含命中
      var exact = ds.indexOf(term) >= 0;
      if (exact) { best = Math.max(best, W.doctorExact); hits.push(['医家', term]); }
      else if (d.indexOf(term) >= 0) { best = Math.max(best, W.doctorContains); hits.push(['医家', d]); }
      else if (f.doctor_pinyin && f.doctor_pinyin.indexOf(q) >= 0) { best = Math.max(best, W.doctorPinyin); hits.push(['医家拼音', d]); }
    }

    if (want('herb')) {
      // 精确键：词本身，或词的归一结果
      var probes = [term];
      if (idx.alias[term]) probes.push(idx.alias[term]);
      for (var i = 0; i < PREFIX.length; i++) {
        if (term.length > PREFIX[i].length + 1 && term.indexOf(PREFIX[i]) === 0) probes.push(term.slice(PREFIX[i].length));
      }
      var found = null;
      for (var j = 0; j < probes.length && !found; j++) {
        if (f._herbNames && f._herbNames.has(probes[j])) found = probes[j];
      }
      if (found) {
        var raw = (f._herbRaw && f._herbRaw[found]) ||
          (f.herbs.filter(function (h) {
            return h.name === found || rawHerbName(h.raw) === found;
          })[0] || {}).raw;
        best = Math.max(best, W.herbExact);
        hits.push(['药味', raw || found]);
      }
    }

    if (want('disease') && !strict) {
      (f.tags || []).forEach(function (t) {
        if (t === term) { best = Math.max(best, W.tagExact); hits.push(['病名', t]); }
        else if (t.indexOf(term) >= 0) { best = Math.max(best, W.tagContains); hits.push(['病名', t]); }
      });
      var g = f.disease_group || '';
      var dTerms = diseaseTerms(g);
      if (g === term || dTerms.indexOf(term) >= 0) {
        best = Math.max(best, W.groupExact); hits.push(['章节', dTerms.indexOf(term) >= 0 ? term : g]);
      } else if (g.indexOf(term) >= 0 || dTerms.some(function (t) { return t.indexOf(term) >= 0; })) {
        best = Math.max(best, W.groupContains); hits.push(['章节', g]);
      }
      if ((f.indications || '').indexOf(term) >= 0) { best = Math.max(best, W.indications); hits.push(['主治', term]); }
    }

    if (type === 'all' && best === 0 && !strict) {
      var body = [f.functions, f.indications, f.usage, (f.interpretation && f.interpretation.text) || ''].join(' ');
      if (body.indexOf(term) >= 0) { best = W.body; hits.push(['正文', term]); }
    }

    return { score: best, hits: hits };
  }

  /** 判断一个词是不是本书里的药名（含别名与炮制前缀归并后的写法） */
  function isHerbWord(idx, term) {
    var probes = [term];
    if (idx.alias[term]) probes.push(idx.alias[term]);
    for (var i = 0; i < PREFIX.length; i++) {
      if (term.length > PREFIX[i].length + 1 && term.indexOf(PREFIX[i]) === 0) probes.push(term.slice(PREFIX[i].length));
    }
    return probes.some(function (p) { return idx.herbs.has(p); });
  }

  function search(db, idx, query, opts) {
    opts = opts || {};
    var type = opts.type || 'all';
    var raw = (query || '').trim();
    if (!raw) return [];
    var terms = raw.split(/[\s\u3000+,，、;；]+/).filter(Boolean);
    if (!terms.length) return [];
    var strictFlags = terms.map(function (t) { return isHerbWord(idx, t); });

    var out = [];
    for (var i = 0; i < db.formulas.length; i++) {
      var f = db.formulas[i];
      var total = 0;
      var hits = [];
      var ok = true;
      for (var t = 0; t < terms.length; t++) {
        var r = scoreOne(f, terms[t], type, idx, strictFlags[t] && type !== 'name' && type !== 'doctor');
        if (r.score === 0) { ok = false; break; }
        total += r.score;
        hits = hits.concat(r.hits);
      }
      if (!ok) continue;
      // 去重命中说明
      var seen = {};
      hits = hits.filter(function (h) {
        var k = h[0] + '|' + h[1];
        if (seen[k]) return false;
        seen[k] = 1;
        return true;
      });
      out.push({ formula: f, score: total, hits: hits.slice(0, 4), terms: terms });
    }

    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.formula.source_no.localeCompare(b.formula.source_no, 'zh', { numeric: true });
    });
    return out;
  }

  /** 索引页用：把 Map 转成按方数排序的列表 */
  function facets(idx, kind, limit) {
    var map = idx[kind];
    var arr = [];
    map.forEach(function (ids, name) { arr.push({ name: name, count: ids.size }); });
    arr.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'zh');
    });
    return limit ? arr.slice(0, limit) : arr;
  }

  var api = { buildIndex: buildIndex, search: search, facets: facets, stripDose: stripDose,
    rawHerbName: rawHerbName, isCleanHerbName: isCleanHerbName,
    diseaseTerms: diseaseTerms, WEIGHT: W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.YANFANG_SEARCH = api;
})(typeof window !== 'undefined' ? window : globalThis);
