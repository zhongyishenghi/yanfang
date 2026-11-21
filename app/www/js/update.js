/* 易圣验方 · 增量更新客户端（浏览器 / WebView 通用）
 *
 * 协议：静态站点上放 version.json + 若干 patch-N.json，不需要后端。
 * 安全：每个增量包自带 FNV-1a 校验和；版本必须严格 +1；任一记录字段不全则整包拒绝；
 *      合并是「先算好再落盘」，中途失败绝不破坏本地数据。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'shifang.db.v1';
  var BACKUP_KEY = 'shifang.db.backup';

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function patchBody(p) {
    return JSON.stringify({
      from: p.from,
      to: p.to,
      upserts: p.upserts || [],
      deletes: p.deletes || [],
      alias: p.alias || {}
    });
  }

  function signPatch(p) {
    var body = { from: p.from, to: p.to, upserts: p.upserts || [], deletes: p.deletes || [], alias: p.alias || {} };
    return Object.assign({}, p, { checksum: fnv1a(patchBody(body)) });
  }

  function normalizePatch(p) {
    if (!p || typeof p !== 'object') throw new Error('增量包格式错误');
    var from = p.from, to = p.to;
    var upserts = p.upserts || [];
    var deletes = p.deletes || [];
    if (!Number.isInteger(from) || !Number.isInteger(to) || to !== from + 1) {
      throw new Error('增量包版本号不连续');
    }
    if (!Array.isArray(upserts) || !Array.isArray(deletes)) {
      throw new Error('upserts / deletes 必须是数组');
    }
    if (p.checksum && fnv1a(patchBody({ from: from, to: to, upserts: upserts, deletes: deletes, alias: p.alias || {} })) !== p.checksum) {
      throw new Error('增量包校验和不匹配，已拒绝');
    }
    return { from: from, to: to, upserts: upserts, deletes: deletes, alias: p.alias || {} };
  }

  function validateFormula(f) {
    if (!f || !f.id || !f.name || !Array.isArray(f.herbs) || f.herbs.length === 0) return false;
    return f.herbs.every(function (h) { return h && h.name && h.dose; });
  }

  function mergePatch(db, patch) {
    var p = normalizePatch(patch);
    if (p.from !== db.version) {
      throw new Error('增量包起点 ' + p.from + ' 与本地版本 ' + db.version + ' 不一致');
    }
    for (var i = 0; i < p.upserts.length; i++) {
      if (!validateFormula(p.upserts[i])) {
        throw new Error('记录 ' + (p.upserts[i] && p.upserts[i].id) + ' 字段不完整，整包拒绝');
      }
    }
    var map = new Map(db.formulas.map(function (f) { return [f.id, f]; }));
    p.upserts.forEach(function (f) { map.set(f.id, Object.assign({}, f, { v: p.to })); });
    p.deletes.forEach(function (id) { map.delete(id); });

    var alias = Object.assign({}, db.herb_alias || {});
    Object.keys(p.alias).forEach(function (k) { alias[k] = p.alias[k]; });

    var list = Array.from(map.values()).sort(function (a, b) {
      var ka = String(a.source_no || a.id).split('.'), kb = String(b.source_no || b.id).split('.');
      if (+ka[0] !== +kb[0]) return +ka[0] - +kb[0];
      return (+ka[1] || 0) - (+kb[1] || 0);
    });

    return Object.assign({}, db, {
      version: p.to,
      formulas: list,
      herb_alias: alias,
      updated_at: new Date().toISOString().slice(0, 10)
    });
  }

  function checkMeta(meta, currentVersion) {
    if (!Number.isInteger(meta.latest)) throw new Error('latest 字段非法');
    if (meta.latest <= currentVersion) return null;
    var chain = (meta.patches || [])
      .filter(function (p) { return p.from >= currentVersion && p.to <= meta.latest; })
      .sort(function (a, b) { return a.from - b.from; });
    if (!chain.length || chain[0].from !== currentVersion || chain[chain.length - 1].to !== meta.latest) {
      throw new Error('增量包链不连续，需要全量包');
    }
    return chain;
  }

  function checkUpdate(opts) {
    var baseUrl = (opts.baseUrl || '').replace(/\/$/, '');
    var currentVersion = opts.currentVersion;
    var fetchImpl = opts.fetchImpl || global.fetch;
    var timeout = opts.timeout || 8000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout);
    return fetchImpl(baseUrl + '/version.json?t=' + Date.now(), { signal: ctrl.signal, cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('version.json HTTP ' + res.status);
        return res.json();
      })
      .then(function (meta) {
        var chain = checkMeta(meta, currentVersion);
        return chain ? { updated: true, latest: meta.latest, chain: chain } : { updated: false, latest: currentVersion };
      })
      .finally(function () { clearTimeout(timer); });
  }

  function applyChain(db, chain, baseUrl, fetchImpl) {
    var root = (baseUrl || '').replace(/\/$/, '');
    var doFetch = fetchImpl || global.fetch;
    return chain.reduce(function (p, step) {
      return p.then(function (acc) {
        return doFetch(root + '/' + step.file, { cache: 'no-store' }).then(function (res) {
          if (!res.ok) throw new Error(step.file + ' HTTP ' + res.status);
          return res.json();
        }).then(function (patch) {
          return mergePatch(acc, patch);
        });
      });
    }, Promise.resolve(db));
  }

  function save(db) {
    try {
      var old = global.localStorage.getItem(STORAGE_KEY);
      if (old) global.localStorage.setItem(BACKUP_KEY, old);
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load(seed) {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed;
      var db = JSON.parse(raw);
      if (!db || !Array.isArray(db.formulas) || !Number.isInteger(db.version)) return seed;
      return db;
    } catch (e) {
      return seed;
    }
  }

  function reset() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
      global.localStorage.removeItem(BACKUP_KEY);
    } catch (e) { /* 忽略 */ }
  }

  function sync(opts) {
    var current = opts.current;
    return checkUpdate({ baseUrl: opts.baseUrl, currentVersion: current.version, fetchImpl: opts.fetchImpl })
      .then(function (plan) {
        if (!plan.updated) return { changed: false, db: current };
        return applyChain(current, plan.chain, opts.baseUrl, opts.fetchImpl).then(function (next) {
          var ok = save(next);
          return { changed: true, db: ok ? next : next, from: current.version, to: next.version, persisted: ok };
        });
      })
      .catch(function (err) {
        return { changed: false, db: load(current), error: String((err && err.message) || err) };
      });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    fnv1a: fnv1a,
    signPatch: signPatch,
    normalizePatch: normalizePatch,
    validateFormula: validateFormula,
    mergePatch: mergePatch,
    checkMeta: checkMeta,
    checkUpdate: checkUpdate,
    applyChain: applyChain,
    save: save,
    load: load,
    reset: reset,
    sync: sync
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.YANFANG_UPDATE = api;
})(typeof window !== 'undefined' ? window : globalThis);
