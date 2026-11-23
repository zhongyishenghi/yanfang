/* 易圣验方 · 主程序 */
(function () {
  'use strict';

  var SEED = window.YANFANG_SEED;
  var U = window.YANFANG_UPDATE;
  var S = window.YANFANG_SEARCH;

  /* 运行模式（见 js/mode.js）
     online: 是否启用「填网址增量同步」与「恢复内置数据」——离线版一律 false
     2026-11-20 起不再提供「对照原页」图片入口，来源只显示文字出处。 */
  var MODE = window.YANFANG_MODE || { online: false };
  var ONLINE = !!MODE.online && !!U;

  /* 版本号由 tools/build-offline.mjs 依 build.gradle 生成到 js/appver.js */
  var APPVER = window.YANFANG_APPVER || { name: '1.0.0', code: 1, built: '2026-11-14' };

  if (!SEED) {
    document.body.innerHTML = '<div style="padding:40px;font:15px/2 sans-serif">数据文件 js/db.js 未加载。请先运行 <code>node tools/build-data.mjs</code>。</div>';
    return;
  }

  /* 取本机副本还是安装包内置数据：
     离线版不联网，安装包里的种子就是最新一份；只有本机副本版本号更高（曾手动同步过）时才用它，
     否则旧补丁会把新安装包的数据盖回去。 */
  function initialDb() {
    var local = U && U.load ? U.load(SEED) : SEED;
    if (!local || !Array.isArray(local.formulas) || !Number.isInteger(local.version)) return SEED;
    return local.version > SEED.version ? local : SEED;
  }

  var db = initialDb();
  var idx = S.buildIndex(db);

  /* 「X 味中药」的口径：去重后的中药品种数。炮制/别名写法（淮山药、炒山药…）
     经 herb_alias 归并到标准名再计数；无法归并的照原样保留。
     不用 idx.herbs.size —— 那个为了检索命中把别名/剥前缀变体都当独立键（739），数字虚高。 */
  function countHerbs(d) {
    var alias = d.herb_alias || {};
    var seen = {};
    var n = 0;
    d.formulas.forEach(function (f) {
      f.herbs.forEach(function (h) {
        if (!h.name) return;
        var s = h.name, v = alias[s];
        while (typeof v === 'string' && v !== s) { s = v; v = alias[s]; }
        var key = (v === null) ? h.name : s;
        if (!seen[key]) { seen[key] = 1; n++; }
      });
    });
    return n;
  }
  var HERB_COUNT = countHerbs(db);
  var FAV_KEY = 'yanfang.favs';

  /* 早期版本用别的前缀把这些东西存在本机。改名后按后缀把旧键并到新键、再删旧键，
     否则升级上来的人收藏会凭空消失。这里只认后缀、不写死旧前缀，旧名不再出现在代码里。 */
  (function adoptOldKeys() {
    var pairs = { '.favs': FAV_KEY, '.flip.hint': 'yanfang.flip.hint', '.db.v1': 'yanfang.db.v1', '.db.backup': 'yanfang.db.backup' };
    var olds = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        for (var s in pairs) {
          if (Object.prototype.hasOwnProperty.call(pairs, s) && k !== pairs[s] && k.slice(-s.length) === s) {
            olds.push([k, pairs[s]]);
            break;
          }
        }
      }
      olds.forEach(function (p) {
        var v = localStorage.getItem(p[0]);
        if (v !== null) {
          if (localStorage.getItem(p[1]) === null) localStorage.setItem(p[1], v);
          localStorage.removeItem(p[0]);
        }
      });
    } catch (e) { /* 隐私模式等禁用存储时忽略 */ }
  })();

  /* 页边裁掉、转录只留一个方框的味：不是药名，索引与列表都不拿它当药 */
  var PLACEHOLDER_HERB = /^[□?？·\-—\s]+$/;

  /* 解读模块开关。2026-11-14 起下线：详情页不再显示「解读」区块。
     数据与稿件都还在（data/formulas.json 的 interpretation、data/interpretations-draft.json），
     将来有临床中医师审定过的稿子，把这里改成 true 并跑 node tools/build-data.mjs 即可恢复。 */
  var SHOW_INTERP = false;

  var state = {
    view: 'search',
    type: 'all',
    q: '',
    selected: null,
    facet: 'doctors',
    results: [],
    /* 详情页翻方的浏览序列：进详情时那一刻列表里的顺序，翻动只在这串里走。
       搜索「柴胡」进来就只在 6 条结果里翻，不会突然跳到全书第 200 副。 */
    seq: [],
    seqAt: -1,
    /* 系统返回键 / 返回手势要知道「这一屏是从哪下钻来的」，否则一律按页签判断，
       从索引点进某个医家的方列表后按返回会被当成「已在检索页」直接退掉整个应用。
       fromIndex：当前检索结果是从索引页点条目进来的，返回先回索引首页；
       fromDetail：当前检索结果是从某副方的标签/快捷词跳出来的，返回先回那副方。 */
    fromIndex: false,
    fromDetail: null,
    /* 宽屏右栏当前挂的是哪种空态：'welcome' | 'hint' | null（挂的是方剂详情）。
       用途只有一个——避免每次 resize 都重写一遍 innerHTML。 */
    emptyPane: null
  };

  var $ = function (s) { return document.querySelector(s); };
  var el = {
    nav: $('#nav'),
    q: $('#q'),
    clear: $('#clear'),
    chips: $('#chips'),
    meta: $('#meta'),
    list: $('#list'),
    detail: $('#detail'),
    scrim: $('#scrim'),
    seg: $('#seg'),
    facets: $('#facets'),
    facetMeta: $('#facet-meta'),
    favMeta: $('#fav-meta'),
    favList: $('#fav-list'),
    about: $('#about'),
    lightbox: $('#lightbox'),
    lbBody: $('#lb-body'),
    lbClose: $('#lb-close'),
    panes: {
      search: $('#view-search'),
      index: $('#view-index'),
      fav: $('#view-fav'),
      about: $('#view-about')
    }
  };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hl(text, terms) {
    var safe = esc(text);
    if (!terms || !terms.length) return safe;
    terms.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (t) {
      if (!t) return;
      var pat = esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      safe = safe.replace(new RegExp(pat, 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
    });
    return safe;
  }

  function termsOf(q) {
    return (q || '').trim().split(/[\s\u3000+,，、;；]+/).filter(Boolean);
  }

  function favs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; }
  }
  function toggleFav(id) {
    var list = favs();
    var i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
    return i < 0;
  }

  /* 原书分内科、外科、妇科、儿科、皮肤科、五官科、肿瘤、男性科等部分，
     编号在每部分内各自从 1 起，列表分组头要带上部分名，否则「1」会出现很多次。 */
  function chapterLabel(f) {
    /* 碑方不是原书章节制，100 副按原整理本序号排，分组改用病证（见 groupKey） */
    if (f.part === '碑方') return '碑方';
    /* 临证方是原书之外收的，没有章号，也不编章号，同样按病名分组 */
    if (f.part === '临证') return '临证';
    /* 肿瘤部分是「1. 2. 3.」按方直接编号、不分章，方号不是章号，不能当分组头 */
    if (f.part === '肿瘤') return '肿瘤';
    var no = (f.source_no || '').split('.')[0];
    var part = f.part || '';
    return (part && part !== '内科') ? part + '·' + no : no;
  }

  /* 分组键：原书按「部分+章号」，碑方按病证 */
  function groupKey(f) {
    return chapterLabel(f) + '|' + (f.disease_group || '');
  }

  function chapterTitle(f) {
    var c = (db.chapters || []).filter(function (x) { return x.title === f.disease_group; })[0];
    return c ? c.title : (f.disease_group || '');
  }

  /* ---------- 列表 ---------- */
  function cardHTML(f, hits, terms) {
    /* 只有一个方框的味是转录时辨不出的占位，不是药名，列表里不展示 */
    var herbText = f.herbs.filter(function (h) { return !PLACEHOLDER_HERB.test(h.name || ''); })
      .map(function (h) { return h.name; }).join('　');
    /* 一个方名底下分几副方的，列表里没有单方药味可摘，标一句「分几方」 */
    var subN = (f.sub_formulas || []).length;
    if (!herbText && subN) herbText = '分 ' + subN + ' 方拟治，组成见详情';
    var countText = f.herbs.length ? (f.herbs.length + ' 味') : (subN ? (subN + ' 方') : '0 味');
    var hitHTML = (hits || []).map(function (h) {
      return '<span>' + esc(h[0]) + ' ' + hl(h[1], terms) + '</span>';
    }).join('');
    /* 2026-11-14：用户要求界面不留「已核 / 待核 / 存疑」徽标，此处不再渲染。
       review 字段仍保留在数据里（make-patch、审稿脚本依赖它），需要恢复只改这一处。 */
    // 原书重出的同一方：两条都留着，列表上标一下对方编号，免得用户以为录重了
    var rel = (f.related || [])[0];
    var relMark = rel
      ? '<span class="dot">·</span><span class="rel-mark">' + esc(rel.short || '同方异名') + ' ' + esc(rel.source_no) + '</span>'
      : '';
    /* 药典成方没有医家、也没有章节病名，空字段不占位、不留孤立的分隔点；
       用「药典成方」顶掉医家那一格，卡片副行才不会只剩一个光秃秃的「3 味」。 */
    var subSegs = [];
    if (f.doctor) subSegs.push(hl(f.doctor, terms));
    else if (f.category === '成药') subSegs.push(esc('药典成方'));
    if (f.disease_group) subSegs.push(esc(f.disease_group));
    subSegs.push(countText);
    return '' +
      '<article class="card' + (state.selected === f.id ? ' on' : '') + '" data-id="' + f.id + '" tabindex="0">' +
        '<div class="card-top">' +
          '<span class="no">' + esc(f.source_no) + '</span>' +
          '<h3>' + hl(f.name, terms) + '</h3>' +
        '</div>' +
        '<div class="card-sub"><span>' + subSegs.join('</span><span class="dot">·</span><span>') + '</span>' + relMark + '</div>' +
        '<div class="card-herbs">' + esc(herbText) + '</div>' +
        (hitHTML ? '<div class="card-hit">' + hitHTML + '</div>' : '') +
      '</article>';
  }

  /* 首屏只画一页，滚到底再续。2086 张卡一次性进 DOM，平板切页签 / 开详情
     要重排整棵列表，实测 1–2 秒；分批后首屏 DOM 只有几十张。 */
  var PAGE = 60;

  function rowsHTML(items, from, to, terms, prevKey) {
    var out = '';
    var last = prevKey;
    for (var i = from; i < to; i++) {
      var it = items[i];
      var f = it.formula || it;
      var key = groupKey(f);
      if (key !== last) {
        var t = chapterTitle(f);
        out += '<div class="group-head">' + esc(chapterLabel(f)) + (t ? '　' + esc(t) : '') + '</div>';
        last = key;
      }
      out += cardHTML(f, it.hits || [], terms);
    }
    return { html: out, lastKey: last };
  }

  function appendList(container, n) {
    var items = container._items || [];
    if (container._shown >= items.length) return;
    var from = container._shown || 0;
    var to = Math.min(from + n, items.length);
    var r = rowsHTML(items, from, to, container._terms || [], container._prevKey);
    container.insertAdjacentHTML('beforeend', r.html);
    container._prevKey = r.lastKey;
    container._shown = to;
  }

  function renderList(container, items, terms, empty) {
    container._items = items;
    container._terms = terms || [];
    container._prevKey = null;
    container._shown = 0;
    container._seq = items.map(function (it) { return (it.formula || it).id; });
    if (!items.length) { container.innerHTML = empty || ''; return; }
    container.innerHTML = '';
    appendList(container, PAGE);
  }

  function moreOnScroll(e) {
    var pane = e.currentTarget;
    var list = pane === el.panes.fav ? el.favList : el.list;
    if (list._shown >= (list._items || []).length) return;
    /* 离底还有一屏多就开始续，滚动不会看到空白等待 */
    if (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 900) appendList(list, PAGE);
  }

  function renderSearch() {
    var terms = termsOf(state.q);
    var rows = state.results;
    el.clear.hidden = !state.q;

    if (!state.q) {
      el.meta.innerHTML = '共 <b>' + db.formulas.length + '</b> 副方剂 · <b>' + idx.doctors.size + '</b> 位医家 · 数据 v' + db.version;
    } else if (!rows.length) {
      el.meta.innerHTML = '没有找到「<b>' + esc(state.q) + '</b>」';
    } else {
      el.meta.innerHTML = '找到 <b>' + rows.length + '</b> 副方剂' +
        (terms.length > 1 ? ' · 同时包含 ' + terms.length + ' 个条件' : '');
    }

    if (!state.q) {
      renderList(el.list, db.formulas, [], '');
      return;
    }

    if (!rows.length) {
      el.list.innerHTML = emptyHTML(state.q);
      el.list._items = [];
      el.list._seq = [];
      return;
    }

    renderList(el.list, rows, terms, '');
  }

  /** 检索无结果时，给出相近药名/方名建议 —— 精确匹配的代价是可能搜不到，这里补一手 */
  function suggestFor(q) {
    var out = [];
    idx.herbs.forEach(function (ids, name) {
      if (name !== q && name.indexOf(q) >= 0 && out.length < 6) out.push({ kind: 'herb', text: name });
    });
    idx.tags.forEach(function (ids, name) {
      if (name !== q && name.indexOf(q) >= 0 && out.length < 8) out.push({ kind: 'disease', text: name });
    });
    return out;
  }

  function emptyHTML(q) {
    var s = suggestFor(q);
    var sugg = s.length
      ? '<div class="sugg">' + s.map(function (x) {
          return '<button data-sugg="' + esc(x.text) + '" data-kind="' + x.kind + '">' + esc(x.text) + '</button>';
        }).join('') + '</div>'
      : '';
    return '<div class="empty"><div class="mark">无</div>' +
      '<p>没有匹配的方剂。<br>药名是精确匹配：搜「茯苓」不会带出「土茯苓」。<br>可以试试只搜一味药，或换个说法。</p>' +
      sugg + '</div>';
  }

  /* ---------- 详情 ---------- */
  /* 2026-11-14：用户要求前台不显示校记（编校记、原书合写说明、存疑备注）。
     数据字段 editor_note / uncertain / herb.note 全部随包保留，只是这里不渲染；
     想恢复显示：把 cleanHerbNote 换成直出 h.note，并加回「编校记」区块即可。
     药味的炮制短标记（生、炙、炒、炭、煅、后下、（包）等）属剂量信息，照常显示。 */
  function cleanHerbNote(n) {
    if (!n) return '';
    return n.split(/[；;]/).map(function (s) { return s.trim(); })
      .filter(function (s) {
        return s && s.indexOf('原书') < 0 && s.indexOf('存疑') < 0 && s.indexOf('辨读') < 0;
      })
      .join('；');
  }

  /* 组成列表。原书有些方分成几段写：「（1）口服方」「（2）热敷方」「内服方」「外用方」
     「孕Ⅰ方」「1号方」。段名不显示的话，内服和外用的药会连成一锅，
     读者会以为这三十味要一起煎。 */
  function herbListHTML(herbs) {
    var out = '';
    var lastGroup = '';
    var lastNote = '';
    (herbs || []).forEach(function (h) {
      var g = h.seg || '';
      if (g && g !== lastGroup) {
        out += '<li class="herb-group">' + esc(g) + '</li>';
      }
      if (g !== lastGroup) lastNote = '';
      lastGroup = g;
      var n = cleanHerbNote(h.note);
      /* 页边裁掉、只剩一个方框的味：写成一句话，别在组成里摆一个空方块 */
      var missing = PLACEHOLDER_HERB.test(h.name || '');
      var dose = missing ? '' : String(h.dose || '').trim();
      /* 原书的剂量并不总是单个克数，有三类要注意：
         ① 条件剂量「女贞子（肾阴虚各15克，肾阳虚各5克）」——合并时从剂量位移到了注解，
            它是这一味的真实用量，必须每味都显示，不能因为"长注重复"被吃掉；
         ② 原书根本不标量（「仙灵脾、枸杞子、山药、肉苁蓉」「按比例 10：3：5」）——
            剂量位留空，不要印破折号，印出来像是"漏了"；
         ③ 炮制/煎法短注（先煎、后下、包煎）照旧显示。 */
      var note = '';
      var isCondDose = !dose && /各\s*\d|肾阴|肾阳|等分/.test(n);
      if (n && (isCondDose || !(n.length > 8 && n === lastNote))) {
        note = '<em>' + esc(n) + '</em>';
      }
      lastNote = n;
      var label = missing ? '<b class="herb-missing">（原书此处一味被裁）</b>'
        : '<b>' + esc(h.name) + '</b>';
      /* 没有剂量就不画引导点线：点线拉满一行再接一句注解，看着更像"缺了东西" */
      var right = dose
        ? '<span class="dots"></span><i>' + esc(dose) + '</i>' + note
        : note;
      out += '<li' + (missing ? ' class="is-missing"' : '') + '>' + label + right + '</li>';
    });
    return out;
  }

  function detailHTML(f) {
    var isFav = favs().indexOf(f.id) >= 0;

    var herbItems = herbListHTML(f.herbs);

    /* 一个方名底下分几副方的（「中药人工周期治疗月经失调」按月经周期分三期拟方），
       子方各自成条，但主方详情页的「组成」不能空着 —— 直接把子方的组成摊开。 */
    var subHTML = '';
    var subCount = 0;
    var subHerbs = 0;
    (f.sub_formulas || []).forEach(function (s) {
      var sub = idx.byNo.get(((f.source && f.source.book) || '') + '|' + (f.category || '') + '|' + s.no);
      if (!sub) return;
      subCount++;
      subHerbs += sub.herbs.length;
      subHTML += '<div class="sub-f">' +
        '<div class="sub-h"><b>' + esc(s.label || sub.name) + '</b>' +
          '<i>' + esc(sub.source_no) + '　' + esc(sub.name) + '</i></div>' +
        (sub.usage ? '<div class="sub-u">' + esc(sub.usage) + '</div>' : '') +
        '<ul class="herbs">' + herbListHTML(sub.herbs) + '</ul>' +
      '</div>';
    });
    var compCount = subHTML ? (subCount + ' 方 · ' + subHerbs + ' 味') : (f.herbs.length + ' 味');
    /* 原书有一部分方只列药名、不标克数（如「仙灵脾、枸杞子、山药、肉苁蓉」，
       或「马铃薯、白矾、冰片，配伍比例为 10：3：5」）。这种情况如实说明，
       免得读者以为是转录漏了剂量。 */
    var noDoseAll = f.herbs.length > 0 && !subHTML && f.herbs.every(function (h) {
      return !String(h.dose || '').trim();
    });
    if (noDoseAll) compCount += '　·　未标克数';

    var akaLine = (f.aka && f.aka.length)
      ? '<div class="d-aka">又称　' + f.aka.map(esc).join('、') + '</div>'
      : '';

    /* 互指：同一副方在原书里重出，两条各自独立成条，这里互相指路 */
    var relLine = (f.related && f.related.length)
      ? '<div class="d-rel">' + f.related.map(function (r) {
          return '<button data-rel="' + esc(r.id) + '">' +
            '<i>' + esc(r.label || '同一方异名') + '</i>' +
            '<span>' + esc(r.source_no) + '　' + esc(r.name) + '</span>' +
            '<b>→</b></button>';
        }).join('') + '</div>'
      : '';

    /* 同方不同剂型：药典把同一处方做成丸、片、胶囊、颗粒等多种剂型，各自成条。
       这里一次列全，点一下就换到那个剂型，省得在一个个搜索结果里猜区别。 */
    var famLine = '';
    if (f.family) {
      var sibs = ((idx.family && idx.family.get(f.family)) || []).filter(function (x) {
        return x.id !== f.id;
      });
      if (sibs.length) {
        famLine = '<div class="d-fam">' +
          '<span class="fm-h">同一处方 · ' + (sibs.length + 1) + ' 种剂型</span>' +
          sibs.map(function (x) {
            return '<button data-rel="' + esc(x.id) + '">' + esc(x.name) + '</button>';
          }).join('') +
        '</div>';
      }
    }

    var tagBtns = (f.tags || []).map(function (t) {
      return '<button data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');

    var interp = SHOW_INTERP && f.interpretation && f.interpretation.text
      ? '<div class="block"><h4>解读 <span>原创</span></h4>' +
        '<div class="quote"><p>' + esc(f.interpretation.text) + '</p>' +
        '<div class="by">原创解读 · ' + esc(f.interpretation.author || '易圣验方整理') +
        (f.interpretation.reviewed ? ' · 审于 ' + esc(f.interpretation.reviewed) : '') + '</div></div></div>'
      : '';

    var pages = (f.source && f.source.pages) || [];
    /* 2026-11-20：用户要求来源里只保留文字出处，不再提供「对照原页」图片入口。 */

    /* 2026-11-14：用户要求去掉每副方下方的黄底「尚未逐字比对原页」提示，
       统一在「关于」页说明数据来源。review 字段保留，不再渲染。 */

    /* 翻方导航：序列里有前后才给按钮，到头置灰，同时把相邻方名带上，
       这样不滑也能看出「下一副是什么」 */
    var seqLen = state.seq.length;
    var seqAt = state.seqAt;
    var prevF = seqAt > 0 ? idx.byId.get(state.seq[seqAt - 1]) : null;
    var nextF = (seqAt >= 0 && seqAt < seqLen - 1) ? idx.byId.get(state.seq[seqAt + 1]) : null;
    var posTag = (seqLen > 1 && seqAt >= 0)
      ? '<span class="d-pos">' + (seqAt + 1) + ' / ' + seqLen + '</span>'
      : '';
    var navHTML = seqLen <= 1 ? '' :
      '<div class="d-nav">' +
        '<button data-step="-1"' + (prevF ? '' : ' disabled') + '>' +
          '<i>‹</i><span><b>上一副</b>' + (prevF ? esc(prevF.name) : '已是第一副') + '</span>' +
        '</button>' +
        '<button data-step="1"' + (nextF ? '' : ' disabled') + '>' +
          '<span><b>下一副</b>' + (nextF ? esc(nextF.name) : '已是最后一副') + '</span><i>›</i>' +
        '</button>' +
      '</div>' +
      '<div class="d-hint">左右滑动翻方</div>';

    /* 药典成方不署医家（药典正文就没有这一栏），不拿「佚」冒充佚名，
       改标「药典成方」，头像用「典」字；章节病名为空时也不留孤立分隔点。 */
    var isPatent = f.category === '成药';
    var docName = f.doctor || (isPatent ? '药典成方' : '佚名');
    var docChar = (isPatent && !f.doctor) ? '典' : docName.charAt(0);
    var noLine = [f.source_no, f.category, f.disease_group]
      .filter(function (x) { return x; })
      .map(function (x) { return esc(x); })
      .join('　·　');

    return '' +
      '<button class="back" id="back">← 返回列表</button>' +
      '<div class="d-head">' +
        '<div class="d-no"><span>' + noLine + '</span>' + posTag + '</div>' +
        '<h2>' + esc(f.name) + '</h2>' + akaLine +
        '<div class="d-dr"><span class="avatar">' + esc(docChar) + '</span><span>' + esc(docName) + '</span>' +
          '<button class="fav-btn' + (isFav ? ' on' : '') + '" data-fav="' + f.id + '">' + (isFav ? '已收藏' : '收藏') + '</button>' +
        '</div>' +
        relLine +
        famLine +
      '</div>' +

      '<div class="block"><h4>组成 <span>' + compCount + '</span></h4>' +
        (subHTML ? '<div class="sub-list">' + subHTML + '</div>'
          : '<ul class="herbs">' + herbItems + '</ul>') +
      '</div>' +

      (f.functions ? '<div class="block"><h4>功能</h4><p>' + esc(f.functions) + '</p></div>' : '') +
      (f.indications ? '<div class="block"><h4>主治</h4><p>' + esc(f.indications) + '</p></div>' : '') +
      (f.usage ? '<div class="block"><h4>用法</h4><p>' + esc(f.usage) + '</p></div>' : '') +

      (tagBtns ? '<div class="block"><h4>标签</h4><div class="tags">' + tagBtns + '</div></div>' : '') +

      interp +

      '<div class="block"><h4>来源</h4><div class="src"><span>' + esc((f.source && f.source.book) || '—') +
        (f.source && f.source.cite ? '　' + esc(f.source.cite) : '') +
        (pages.length ? '　第 ' + pages.join('、') + ' 页' : '') + '</span></div></div>' +

      navHTML;
  }

  /* 欢迎卡上的病名快捷入口。
     章节标题重名是正常的：内科·便秘 与 碑方·便秘 是两章不同的内容，标题都叫「便秘」。
     以前按章节逐条渲染，欢迎卡上就出现两个「便秘 14」。按标题去重即可——
     计数本来就是按标题在全库匹配的，同名多章合起来算一次才对。
     另外计数改成一次遍历：211 章 × 2086 首逐个筛要白跑 44 万次。 */
  function topChapters(limit) {
    var seen = {};
    var titles = [];
    (db.chapters || []).forEach(function (c) {
      var t = c.title;
      if (!t || seen[t]) return;
      /* 复合病名（「小儿感冒、支气管炎」）拆开后每段太泛，不进快捷入口 */
      if (S.diseaseTerms(t).length !== 1) return;
      seen[t] = 1;
      titles.push(t);
    });
    var count = {};
    db.formulas.forEach(function (f) {
      S.diseaseTerms(f.disease_group).forEach(function (t) {
        if (seen[t]) count[t] = (count[t] || 0) + 1;
      });
    });
    return titles
      .map(function (t) { return { t: t, n: count[t] || 0 }; })
      .filter(function (x) { return x.n > 0; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, limit);
  }

  function emptyDetailHTML() {
    var docs = S.facets(idx, 'doctors', 6);

    var chBtns = topChapters(8).map(function (x) {
      return '<button data-shortcut="' + esc(x.t) + '" data-kind="disease">' + esc(x.t) + '<i>' + x.n + '</i></button>';
    }).join('');

    var drBtns = docs.map(function (d) {
      return '<button data-shortcut="' + esc(d.name) + '" data-kind="doctor">' + esc(d.name) + '<i>' + d.count + '</i></button>';
    }).join('');

    return '<div class="d-empty">' +
      '<div class="big">易圣验方</div>' +
      '<p>共 <b>' + db.formulas.length + '</b> 副方剂、<b>' + HERB_COUNT + '</b> 味中药' +
      ((db.parts || []).length > 1
        ? '，分 <b>' + db.parts.length + '</b> 部分、原著 <b>' + (db.chapters || []).length + '</b> 章'
        : '') + '。<br>' +
      '按方名、医家、病名、药味检索；<br>' +
      '空格分隔可组合多味药反查（如「柴胡 黄芩」）。</p>' +
      '<div class="quick"><span>病名</span><div class="quick-row">' + chBtns + '</div></div>' +
      '<div class="quick"><span>收录较多的医家</span><div class="quick-row">' + drBtns + '</div></div>' +
      '</div>';
  }

  /* 收藏页右栏的空态。以前这里复用检索页的欢迎卡，收藏页上顶着「共 2086 副剂方」很莫名其妙。 */
  function hintDetailHTML() {
    return '<div class="d-empty"><div class="big">收藏</div>' +
      '<p>从左侧点一方查看详情。<br>' +
      '右栏会一直留在这儿，翻下一副不用来回切。</p></div>';
  }

  function emptyPaneHTML() {
    return state.view === 'fav' ? hintDetailHTML() : emptyDetailHTML();
  }

  /* 宽屏右栏在没有选中方剂时该挂什么，统一由这里决定。
     不能在启动时用 innerWidth 判一次就算完：WebView 常常先按竖屏布局
     （此时 innerWidth < 900）再把窗口转成横屏，那一次判断会把右栏判成"该隐藏"，
     之后没人再填内容 —— 这就是横屏时右栏一片空白的原因。
     所以启动、切页签、resize、转屏都要回来收口。 */
  function syncDetailPane() {
    if (window.innerWidth < 900) {
      if (!state.selected) el.detail.hidden = true;
      return;
    }
    if (document.body.classList.contains('view-wide')) { el.detail.hidden = true; return; }
    el.detail.hidden = false;
    if (state.selected) return;
    var want = state.view === 'fav' ? 'hint' : 'welcome';
    if (state.emptyPane === want) return;
    el.detail.innerHTML = emptyPaneHTML();
    state.emptyPane = want;
  }

  /* ---------- 详情：浏览序列 + 翻方 ---------- */
  function seqOf(container) {
    /* 列表渲染时已经算过一遍顺序，别在每次点卡片时再遍历上千个 DOM 节点 */
    if (container && container._seq) return container._seq;
    return Array.prototype.map.call(
      container.querySelectorAll('.card[data-id]'),
      function (c) { return c.getAttribute('data-id'); }
    );
  }

  function seqAll() {
    return db.formulas.map(function (f) { return f.id; });
  }

  /* 只渲染，不动序列 —— 翻方、宽窄屏切换都走这里，序列才不会被打断 */
  function paintDetail(id, scrollTop) {
    var f = idx.byId.get(id);
    if (!f) return;
    var prev = state.selected;
    state.selected = id;
    el.detail.classList.remove('slide-next', 'slide-prev');   // 翻方动画由 stepDetail 决定要不要加
    el.detail.style.transform = '';
    el.detail.innerHTML = detailHTML(f);
    state.emptyPane = null;
    el.detail.hidden = false;
    document.body.classList.add('showing-detail');
    el.detail.scrollTop = scrollTop || 0;
    /* 全库 2086 张卡片，逐张 classList.toggle 会让平板点一下卡住 1–2 秒。
       选中态全场只有一张：只撤旧卡、点新卡。 */
    if (prev && prev !== id) {
      var oldCard = document.querySelector('.card.on[data-id="' + prev + '"]');
      if (oldCard) oldCard.classList.remove('on');
    }
    var newCard = document.querySelector('.card[data-id="' + id + '"]');
    if (newCard) newCard.classList.add('on');
  }

  /* 从「同一处方 · N 种剂型」或同方异名跳过去以后，左栏那张卡的选中态常常正好在可视区外，
     看着像根本没选中。把它拉回视野。列表是分批渲染的，卡片不在 DOM 里就当没事发生。 */
  function revealCard(id) {
    var c = document.querySelector('.card.on[data-id="' + id + '"]');
    if (!c || !c.scrollIntoView) return;
    try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (err) { /* 老 WebView 不认 options 对象，忽略即可，不该因此中断跳转 */ }
  }

  /* origin：点开卡片时所在的容器；没有容器（深链、同方异名）就退回全书原书顺序 */
  function openDetail(id, scrollTop, origin) {
    if (!idx.byId.get(id)) return;
    var ids = origin ? seqOf(origin) : seqAll();
    if (ids.indexOf(id) < 0) ids = seqAll();
    state.seq = ids;
    state.seqAt = ids.indexOf(id);
    paintDetail(id, scrollTop);
    flipHintOnce();
  }

  /* delta：1 下一副，-1 上一副 */
  function stepDetail(delta) {
    if (state.seqAt < 0) return false;
    var to = state.seqAt + delta;
    if (to < 0 || to >= state.seq.length) { edgeTip(delta); return false; }
    state.seqAt = to;
    paintDetail(state.seq[to], 0);
    el.detail.classList.remove('slide-next', 'slide-prev');
    void el.detail.offsetWidth;                       // 强制重排，同方向连翻也能重放动画
    el.detail.classList.add(delta > 0 ? 'slide-next' : 'slide-prev');
    return true;
  }

  /* 到头了给一句话，免得用户以为是没滑到 */
  var edgeTimer = null;
  function tipEl() {
    var tip = document.getElementById('d-edge');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'd-edge';
      document.body.appendChild(tip);
    }
    return tip;
  }
  function say(text, ms) {
    var tip = tipEl();
    tip.textContent = text;
    tip.classList.add('on');
    clearTimeout(edgeTimer);
    edgeTimer = setTimeout(function () { tip.classList.remove('on'); }, ms);
  }
  function edgeTip(delta) {
    say(delta > 0 ? '已经是最后一副' : '已经是第一副', 1100);
  }

  /* 滑动这事不看提示不会想到，第一次进详情提一句就够，别每次都念叨 */
  function flipHintOnce() {
    if (state.seq.length < 2) return;
    try {
      if (localStorage.getItem('yanfang.flip.hint')) return;
      localStorage.setItem('yanfang.flip.hint', '1');
    } catch (e) { return; }
    setTimeout(function () { say('左右滑动可翻上一副 / 下一副', 2200); }, 500);
  }

  function closeDetail() {
    document.body.classList.remove('showing-detail');
    var sel = state.selected;
    state.selected = null;
    state.seqAt = -1;
    var cur = sel && document.querySelector('.card.on[data-id="' + sel + '"]');
    if (cur) cur.classList.remove('on');
    if (window.innerWidth >= 900) {
      // 宽屏保留右栏，回到空态（检索页是欢迎卡，收藏页是一句提示）
      el.detail.innerHTML = '';
      state.emptyPane = null;
      syncDetailPane();
    } else {
      el.detail.hidden = true;
    }
  }

  /* ---------- 检索 ---------- */
  function runSearch() {
    state.results = state.q ? S.search(db, idx, state.q, { type: state.type }) : [];
    renderSearch();
  }

  var timer = null;
  var composing = false;

  function scheduleSearch() {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 110);
  }

  function setQuery(q, type) {
    state.q = q;
    if (type) state.type = type;
    el.q.value = q;
    document.querySelectorAll('#chips button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-type') === state.type);
    });
    runSearch();
  }

  /* ---------- 索引 ---------- */
  function renderIndex() {
    var kind = state.facet;
    document.querySelectorAll('#seg button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-facet') === kind);
    });

    if (kind === 'doctors') {
      var ds = S.facets(idx, 'doctors');
      el.facetMeta.innerHTML = '共 <b>' + ds.length + '</b> 位医家';
      el.facets.innerHTML = ds.map(function (d) {
        return '<button data-facet-val="' + esc(d.name) + '" data-kind="doctor">' + esc(d.name) + '<i>' + d.count + '</i></button>';
      }).join('');
      return;
    }

    if (kind === 'groups') {
      var gs = S.facets(idx, 'groups');
      var ts = S.facets(idx, 'tags');
      el.facetMeta.innerHTML = '<b>' + gs.length + '</b> 个病名 · <b>' + ts.length + '</b> 个证候与症状词';
      el.facets.innerHTML =
        '<div class="group-head" style="flex-basis:100%">病名章节</div>' +
        gs.map(function (d) {
          return '<button data-facet-val="' + esc(d.name) + '" data-kind="disease">' + esc(d.name) + '<i>' + d.count + '</i></button>';
        }).join('') +
        '<div class="group-head" style="flex-basis:100%">证候与症状</div>' +
        ts.map(function (d) {
          return '<button data-facet-val="' + esc(d.name) + '" data-kind="disease">' + esc(d.name) + '<i>' + d.count + '</i></button>';
        }).join('');
      return;
    }

    var hs = S.facets(idx, 'herbs');
    el.facetMeta.innerHTML = '共 <b>' + hs.length + '</b> 味药 · 按出现方数排序';
    el.facets.innerHTML = hs.map(function (d) {
      return '<button data-facet-val="' + esc(d.name) + '" data-kind="herb">' + esc(d.name) + '<i>' + d.count + '</i></button>';
    }).join('');
  }

  /* ---------- 收藏 ---------- */
  function renderFav() {
    var ids = favs();
    var list = ids.map(function (id) { return idx.byId.get(id); }).filter(Boolean);
    el.favMeta.innerHTML = list.length ? '已收藏 <b>' + list.length + '</b> 副方剂' : '';
    renderList(el.favList, list, [],
      '<div class="empty"><div class="mark">空</div><p>在方剂详情里点「收藏」，就会出现在这里。</p></div>');
  }

  /* ---------- 关于 ---------- */
  function renderAbout() {
    /* 2026-11-21：用户要求关于页不写数据来源、不写检索规则；
       内容边界并入「这是什么」，版本并入「数据与隐私」，打赏放最末。 */
    el.about.innerHTML = '' +
      '<h2>易圣验方</h2><div class="sub">方剂资料检索 · 离线可用</div>' +

      '<div class="stats">' +
        '<div><b>' + db.formulas.length + '</b>副方剂</div>' +
        '<div><b>' + HERB_COUNT + '</b>味中药</div>' +
        '<div><b>' + idx.doctors.size + '</b>位医家</div>' +
      '</div>' +

      '<section><h3>这是什么</h3>' +
      '<p>一个方剂资料库：把名老中医方剂与《中国药典》成方整理成可检索的结构化数据，' +
      '每条都有方名、医家、病名、药味与剂量、功能、主治、用法。按方名、医家、病名、药味四类入口都能查，' +
      '也可以在搜索框里用空格分隔几味药，反查同时含这几味药的方子。数据全部内置，不联网也能查。</p>' +
      '<p>只收事实性字段。原书里的〔方解〕〔按语〕〔加减〕〔典型病例〕等论述性段落不进数据库，' +
      'App 不放原书扫描页。药典成方按药典原文收录，不署个人医家，统一标为「药典成方」。' +
      '本应用只作检索对照，不提供诊疗建议。</p></section>' +

      '<section><h3>免责声明</h3><div class="warn">' +
      '<p>本应用是方剂文献资料的检索工具，只收方名、组成、功能、主治、用法等事实性字段。</p>' +
      '<p>不提供诊疗服务，不构成用药建议，不替代执业医师的诊断与处方；' +
      '方剂的使用须由执业中医师辨证后决定，自行照方用药的风险由使用者自负。</p>' +
      '<p>剂量以原书原文为准：转录可能有识读偏差，引用前请核对原书。' +
      '药典成方所载剂量为投料量（如制 1000 丸、1000 片），不是单次服用量，' +
      '实际用法用量以该方「用法」一项为准。</p>' +
      '<p>如身体不适，请及时就医。</p></div></section>' +

      /* 2026-11-20 起彻底不联网：安装包本身不含联网权限，这段同时是隐私说明的依据 */
      '<section><h3>数据与隐私</h3>' +
      '<p>完全离线。' + db.formulas.length + ' 副方剂全部内置在安装包里，检索与阅读全在本机完成；' +
      '无账号、无登录，不检查更新，不统计装机量，不上传、不收集任何信息。' +
      '安装包未申请网络权限，系统不允许联网。</p>' +
      '<p>收藏只存在本机，卸载即清除。当前版本 <span class="nw">v' + esc(APPVER.name) + '（' + esc(APPVER.built) + '）</span>，' +
      '内置数据 <span class="nw">v' + db.version + '</span>；新版直接覆盖安装，收藏不丢。</p></section>' +

      /* 打赏：只放个人收款码，不做任何权益承诺，条款必须显眼且不可跳过 */
      '<section><h3>自愿打赏</h3>' +
      '<p>本应用一直免费维护。若它对你确有帮助，可以自愿打赏，用于资料整理与后续增补。' +
      '<b>不打赏同样能用全部功能</b>，内容、更新与使用体验都没有任何差别。</p>' +
      '<div class="donate-box">' +
        '<button class="don-qr" id="donate-qr" aria-label="放大微信收款二维码">' +
          '<img src="img/donate-qr.png" alt="微信收款二维码" width="188" height="188">' +
        '</button>' +
        '<div class="don-cap">微信扫一扫 · <b>点按放大</b></div>' +
        '<div class="don-cap">收款方：拼命钟二郎（**胜）</div>' +
      '</div>' +
      '<div class="terms">' +
        '<b>打赏之前请先读完这几句：</b>' +
        '<ul>' +
          '<li><b>完全自愿。</b>金额随意，不打赏不影响任何功能、内容与更新，也不会被区别对待。</li>' +
          '<li><b>不换取任何承诺。</b>打赏不构成对答疑、定制、优先处理、后续内容或任何服务的承诺，' +
            '也不同于购买商品或服务，不产生任何合同义务。</li>' +
          '<li><b>一经支付无法退款。</b>打赏属于无偿赠与，支付成功后不支持退款，也不能折抵其他费用。</li>' +
          '<li><b>不开具发票。</b>收款方为个人，非经营主体，无法提供发票或收据。</li>' +
          '<li><b>请想清楚再决定。</b>支付在你的微信里完成，应用不参与支付流程，也接触不到你的支付信息。</li>' +
        '</ul>' +
      '</div></section>';
  }

  /* ---------- 视图切换 ----------
   * keepBack：这一屏是「下钻」出来的（索引条目 → 方列表、详情标签 → 方列表），
     下钻标记要留着给返回键用；其余入口（点页签、直接搜、清空）都算回到顶层，标记作废。 */
  function setView(v, keepBack) {
    // 窄屏下详情是整屏覆盖的，切页签时必须先收起，否则页签高亮变了、内容还是详情
    if (window.innerWidth < 900 && document.body.classList.contains('showing-detail')) closeDetail();
    state.view = v;
    if (!keepBack) { state.fromIndex = false; state.fromDetail = null; }
    Object.keys(el.panes).forEach(function (k) { el.panes[k].hidden = k !== v; });
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === v);
    });
    var bodyEl = document.querySelector('.body');
    if (bodyEl) bodyEl.classList.toggle('view-wide', v === 'index' || v === 'about');
    /* 切页签也要收口右栏：从详情切到收藏，右栏该换成收藏的空态而不是继续挂着检索欢迎卡 */
    syncDetailPane();
    if (v === 'index') renderIndex();
    if (v === 'fav') renderFav();
    if (v === 'about') renderAbout();
  }

  /* ---------- 事件 ---------- */
  el.nav.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) setView(b.getAttribute('data-view'));
  });

  el.q.addEventListener('compositionstart', function () { composing = true; });
  el.q.addEventListener('compositionend', function () { composing = false; scheduleSearch(); });
  el.q.addEventListener('input', function () {
    state.q = el.q.value;
    el.clear.hidden = !state.q;
    if (!composing) scheduleSearch();
  });
  el.q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); runSearch(); el.q.blur(); }
    if (e.key === 'Escape') { setQuery(''); }
  });

  el.clear.addEventListener('click', function () {
    setQuery('');
    el.q.focus();
  });

  el.chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-type]');
    if (!b) return;
    state.type = b.getAttribute('data-type');
    document.querySelectorAll('#chips button').forEach(function (x) {
      x.classList.toggle('on', x === b);
    });
    runSearch();
    el.q.focus();
  });

  el.seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-facet]');
    if (!b) return;
    state.facet = b.getAttribute('data-facet');
    renderIndex();
  });

  el.list.addEventListener('click', function (e) {
    var card = e.target.closest('.card');
    if (card) { openDetail(card.getAttribute('data-id'), 0, el.list); return; }
    var sugg = e.target.closest('button[data-sugg]');
    if (sugg) setQuery(sugg.getAttribute('data-sugg'), sugg.getAttribute('data-kind') === 'herb' ? 'all' : 'disease');
  });

  el.list.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var card = e.target.closest('.card');
    if (card) openDetail(card.getAttribute('data-id'), 0, el.list);
  });

  /* 滚动容器是 .pane，不是 .list；两处都要续页 */
  el.panes.search.addEventListener('scroll', moreOnScroll, { passive: true });
  el.panes.fav.addEventListener('scroll', moreOnScroll, { passive: true });

  el.favList.addEventListener('click', function (e) {
    var card = e.target.closest('.card');
    if (card) openDetail(card.getAttribute('data-id'), 0, el.favList);
  });

  el.facets.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-facet-val]');
    if (!b) return;
    var kind = b.getAttribute('data-kind');
    setView('search', true);
    state.fromIndex = true;
    setQuery(b.getAttribute('data-facet-val'), kind === 'herb' ? 'all' : (kind === 'doctor' ? 'doctor' : 'disease'));
    el.panes.search.scrollTop = 0;
  });

  el.detail.addEventListener('click', function (e) {
    if (e.target.id === 'back' || e.target.closest('#back')) { closeDetail(); return; }

    var fav = e.target.closest('button[data-fav]');
    if (fav) {
      var id = fav.getAttribute('data-fav');
      var added = toggleFav(id);
      fav.classList.toggle('on', added);
      fav.textContent = added ? '已收藏' : '收藏';
      if (state.view === 'fav') renderFav();
      return;
    }

    var tag = e.target.closest('button[data-tag]');
    if (tag) {
      /* 从详情点病名标签跳出来的列表，返回时应该回到那副方，而不是退出应用 */
      var tagFrom = state.selected;
      setView('search', true);
      state.fromDetail = tagFrom;
      setQuery(tag.getAttribute('data-tag'), 'disease');
      return;
    }


    var st = e.target.closest('button[data-step]');
    if (st) {
      if (!st.disabled) stepDetail(Number(st.getAttribute('data-step')));
      return;
    }

    /* 同方异名：对方正好也在当前序列里就原地移过去，翻方顺序不被打断；
       不在序列里（比如从全书顺序的深链进来）才退回全书顺序 */
    var rel = e.target.closest('button[data-rel]');
    if (rel) {
      var rid = rel.getAttribute('data-rel');
      var at = state.seq.indexOf(rid);
      if (at >= 0) { state.seqAt = at; paintDetail(rid, 0); }
      else openDetail(rid, 0);
      revealCard(rid);
      return;
    }

    var sc = e.target.closest('button[data-shortcut]');
    if (sc) {
      var kind = sc.getAttribute('data-kind');
      var scFrom = state.selected;
      setView('search', true);
      state.fromDetail = scFrom;
      setQuery(sc.getAttribute('data-shortcut'), kind === 'doctor' ? 'doctor' : 'disease');
      return;
    }
  });

  el.scrim.addEventListener('click', closeDetail);

  /* ---------- 详情内左右滑动翻方 ----------
   * 只认横向手势：先锁方向再跟手，纵向滚动时手指的横向抖动不会误翻。
   * 位移超过 50px，或者 300ms 内快速轻扫 26px，就翻一页。 */
  var drag = null;

  el.detail.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || !state.selected) { drag = null; return; }
    var t = e.touches[0];
    drag = { x: t.clientX, y: t.clientY, t: Date.now(), axis: null };
  }, { passive: true });

  el.detail.addEventListener('touchmove', function (e) {
    if (!drag || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dx = t.clientX - drag.x;
    var dy = t.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
      if (drag.axis === 'x') el.detail.classList.add('dragging');
    }
    if (drag.axis !== 'x') return;
    var w = el.detail.clientWidth || 360;
    var shift = Math.max(-w * 0.16, Math.min(w * 0.16, dx * 0.3));
    el.detail.style.transform = 'translateX(' + shift.toFixed(1) + 'px)';
  }, { passive: true });

  function endDrag(e) {
    if (!drag) return;
    var wasX = drag.axis === 'x';
    var dx = wasX ? (e.changedTouches[0].clientX - drag.x) : 0;
    var dt = Date.now() - drag.t;
    drag = null;
    el.detail.classList.remove('dragging');
    el.detail.style.transform = '';
    if (!wasX) return;
    if (Math.abs(dx) > 50 || (Math.abs(dx) > 26 && dt < 300)) {
      stepDetail(dx < 0 ? 1 : -1);
    }
  }

  el.detail.addEventListener('touchend', endDrag, { passive: true });
  el.detail.addEventListener('touchcancel', function () {
    drag = null;
    el.detail.classList.remove('dragging');
    el.detail.style.transform = '';
  }, { passive: true });

  /* 键盘翻方：电脑上比找按钮快 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!state.selected || !el.lightbox.hidden) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    stepDetail(e.key === 'ArrowRight' ? 1 : -1);
  });

  el.lbClose.addEventListener('click', function () { el.lightbox.hidden = true; });
  el.lightbox.addEventListener('click', function (e) {
    if (e.target === el.lightbox) el.lightbox.hidden = true;
  });

  /* 关于页收款码：点开看大图，复用灯箱（Esc / 返回键 / 点空白都能关） */
  el.about.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#donate-qr')) return;
    /* qr 这个 class 让图限制最大宽度并按像素放大，避免糊成一片影响扫码 */
    el.lbBody.className = 'lb-body qr';
    el.lbBody.innerHTML = '<img src="img/donate-qr.png" alt="微信收款二维码">';
    el.lightbox.hidden = false;
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!el.lightbox.hidden) { el.lightbox.hidden = true; return; }
      if (document.body.classList.contains('showing-detail')) { closeDetail(); return; }
      if (document.activeElement !== el.q && state.view === 'search') el.q.focus();
    }
    if (e.key === '/' && document.activeElement !== el.q) {
      e.preventDefault();
      setView('search');
      el.q.focus();
    }
  });

  /* 吸顶搜索条：滚离顶部才画分隔线，静止时不画（免得标题下面凭空多一条横线） */
  (function () {
    var head = document.getElementById('searchhead');
    if (!head || !el.panes.search) return;
    var tick = function () {
      head.classList.toggle('stuck', el.panes.search.scrollTop > 2);
    };
    el.panes.search.addEventListener('scroll', tick, { passive: true });
    tick();
  })();

  // 窗口变宽 / 转屏时把右栏收口（含空态）
  var lastWide = window.innerWidth >= 900;
  function onViewport() {
    var wide = window.innerWidth >= 900;
    if (wide !== lastWide) {
      lastWide = wide;
      if (wide) {
        document.body.classList.remove('showing-detail');
        el.scrim.hidden = true;
        /* 用 paintDetail 而不是 openDetail：宽窄屏切换不该重置浏览序列 */
        if (state.selected) paintDetail(state.selected, el.detail.scrollTop);
      } else if (state.selected) {
        el.detail.hidden = false;
      }
    }
    syncDetailPane();
  }
  window.addEventListener('resize', onViewport);
  /* 安卓转屏时 resize 有时早于视口真正定稿，再补一拍 */
  window.addEventListener('orientationchange', function () {
    setTimeout(onViewport, 120);
  });
  /* 有的 WebView 转屏后只在视觉视口上报变化，window.resize 不一定来 */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      setTimeout(syncDetailPane, 60);
    });
  }

  /* ---------- 更新按钮（关于页动态元素；只有联网模式才挂这组监听） ---------- */
  if (ONLINE) document.addEventListener('click', function (e) {
    if (e.target.id === 'check-update') {
      var input = $('#update-url');
      var msg = $('#update-msg');
      var url = (input.value || '').trim();
      if (!url) { msg.textContent = '请先填写更新源地址。'; return; }
      msg.textContent = '正在检查…';
      U.sync({ baseUrl: url, current: db }).then(function (r) {
        if (r.error) { msg.textContent = '更新失败：' + r.error; return; }
        if (!r.changed) { msg.textContent = '已是最新版本 v' + db.version + '。'; return; }
        db = r.db;
        idx = S.buildIndex(db);
        HERB_COUNT = countHerbs(db);
        runSearch();
        renderAbout();
        var m = $('#update-msg');
        if (m) m.textContent = '已更新：v' + r.from + ' → v' + r.to + '，共 ' + db.formulas.length + ' 副方剂。';
      });
      return;
    }
    if (e.target.id === 'reset-data') {
      U.reset();
      location.reload();
    }
  });

  /* ---------- 启动 ---------- */
  /* 空态先无条件渲出来，可见性交给 CSS：宽屏两栏下右栏必须有内容，
     窄屏 detail 本来就不显示（多渲一次欢迎卡不值几个钱）。
     以前用启动瞬间的 innerWidth 决定"要不要填"，WebView 那会儿常还按竖屏布局，
     判成不该填以后就再没人填——平板横屏右侧一片空白就是这么来的。 */
  /* 不设 hidden：窄屏由 CSS 的 .detail{display:none} 与 body.showing-detail 控制，
     宽屏则必须常驻。一旦在这里把 hidden 置上，[hidden] 那条 !important 会把右栏藏死。 */
  el.detail.hidden = false;
  try {
    el.detail.innerHTML = emptyDetailHTML();
    state.emptyPane = 'welcome';
  } catch (e) {
    /* 空态渲染不该把整个启动拖死：塞一张最简的静态卡，并把错误直接摊在右栏 */
    el.detail.innerHTML = '<div class="d-empty"><div class="big">易圣验方</div>' +
      '<p>共 <b>' + db.formulas.length + '</b> 副方剂</p>' +
      '<p style="color:#b03030">ERR: ' + (e && e.message ? e.message : e) + '</p></div>';
    state.emptyPane = 'welcome';
  }
  /* 布局定稿后再收一次口：转屏 / 分屏 / 宽窄切换都可能让右栏该换成别的空态 */
  syncDetailPane();
  requestAnimationFrame(function () {
    requestAnimationFrame(syncDetailPane);
  });
  [150, 400, 900, 1600].forEach(function (t) { setTimeout(syncDetailPane, t); });

  runSearch();
  setView('search');

  /* 深链：?q=柴胡&type=herb 或 ?id=nk-1-01，方便分享某副方 */
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('q')) setQuery(params.get('q'), params.get('type') || 'all');
    if (params.get('view')) setView(params.get('view'));
    if (params.get('id')) openDetail(params.get('id'));
  } catch (e) { /* 忽略 */ }

  /* ---------- 安卓物理返回键 / 返回手势：原生层调用，返回 'handled' 表示已消化掉 ----------
   * 退的次序就是用户进来的次序，一层一层往回剥，剥到最外层才让原生层退出应用：
   *   看大图 → 方剂详情 → 从详情跳出的列表（回那副方）→ 索引下钻的列表（回索引首页）
   *   → 非检索页签（回检索）→ 退出 */
  window.__yanfangBack = function () {
    if (!el.lightbox.hidden) { el.lightbox.hidden = true; return 'handled'; }
    if (document.body.classList.contains('showing-detail')) { closeDetail(); return 'handled'; }
    if (state.fromDetail) {
      var backTo = state.fromDetail;
      state.fromDetail = null;
      state.fromIndex = false;
      openDetail(backTo, 0);
      return 'handled';
    }
    if (state.fromIndex && state.view === 'search') {
      state.fromIndex = false;
      setView('index');
      return 'handled';
    }
    if (state.view !== 'search') { setView('search'); return 'handled'; }
    return 'exit';
  };
})();
