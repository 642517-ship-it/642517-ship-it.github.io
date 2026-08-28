/* store.js — نموذج الخطة، التخزين المحلي، وترميز الخطة داخل الرابط.
   لا يوجد خادم: كل خطة تُرمَّز في الرابط، وتُدمج عند الطرف الآخر. */
var Store = (function () {
  'use strict';

  var KEY        = 'yalla-sport/v1';
  var VER        = 1;
  var MAX_SLOTS  = 8;
  var MAX_TEXT   = 120;
  var MAX_PEOPLE = 12;
  var SLOT_RE    = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  var STATES     = { open: 1, set: 1, done: 1, off: 1 };

  var memory = null; /* بديل عند تعذّر localStorage (تصفح خاص مثلًا) */

  /* ---------- أدوات ---------- */

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function num(x)   { return typeof x === 'number' && isFinite(x) ? x : 0; }

  function str(x, max) {
    if (typeof x !== 'string') return '';
    x = x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    max = max || MAX_TEXT;
    return x.length > max ? x.slice(0, max) : x;
  }

  function newId() {
    var s = '', abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    for (var i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  /* ---------- التخزين ---------- */

  function blank() { return { me: '', phone: '', plans: {} }; }

  function load() {
    if (memory) return memory;
    var db;
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (e) { db = null; }
    if (!db || typeof db !== 'object') db = blank();
    if (typeof db.me    !== 'string') db.me = '';
    if (typeof db.phone !== 'string') db.phone = '';
    if (!db.plans || typeof db.plans !== 'object') db.plans = {};
    return db;
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); memory = null; return true; }
    catch (e) { memory = db; return false; }
  }

  /* ---------- الخطة ---------- */

  function newPlan(me) {
    var now = Date.now();
    return {
      ver: VER, id: newId(), own: str(me, 40) || 'أنا',
      act: '', plc: '', dur: 60, nte: '',
      slt: [], vt: {},
      st: { v: 'open', at: '', ts: now, by: str(me, 40) },
      mts: now
    };
  }

  /* تنقية خطة قادمة من رابط خارجي: كل شيء يُعرض عبر textContent، وهنا نحدّ الأنواع والأحجام. */
  function sanitize(p) {
    if (!p || typeof p !== 'object') return null;

    var out = {
      ver: VER,
      id:  /^[a-z0-9]{4,12}$/.test(p.id) ? p.id : newId(),
      own: str(p.own, 40) || 'صديقك',
      act: str(p.act, 60),
      plc: str(p.plc, 80),
      dur: (function (d) { return (d >= 5 && d <= 600) ? d : 60; })(Math.round(num(p.dur))),
      nte: str(p.nte, MAX_TEXT),
      slt: [], vt: {}, st: null,
      mts: num(p.mts)
    };

    var seen = {};
    (Array.isArray(p.slt) ? p.slt : []).forEach(function (s) {
      if (typeof s === 'string' && SLOT_RE.test(s) && !seen[s] && out.slt.length < MAX_SLOTS) {
        seen[s] = 1;
        out.slt.push(s);
      }
    });
    out.slt.sort();

    var votes = (p.vt && typeof p.vt === 'object') ? p.vt : {};
    Object.keys(votes).slice(0, MAX_PEOPLE).forEach(function (rawName) {
      var name = str(rawName, 40);
      if (!name) return;
      var v = votes[rawName];
      if (!v || typeof v !== 'object') return;
      var yes = [];
      (Array.isArray(v.y) ? v.y : []).forEach(function (s) {
        if (typeof s === 'string' && SLOT_RE.test(s) && yes.indexOf(s) < 0) yes.push(s);
      });
      out.vt[name] = { y: yes, ts: num(v.ts) };
    });

    var st = p.st;
    if (st && typeof st === 'object' && STATES[st.v]) {
      out.st = {
        v:  st.v,
        at: (typeof st.at === 'string' && SLOT_RE.test(st.at)) ? st.at : '',
        ts: num(st.ts),
        by: str(st.by, 40)
      };
    } else {
      out.st = { v: 'open', at: '', ts: 0, by: '' };
    }
    if ((out.st.v === 'set' || out.st.v === 'done') && !out.st.at) out.st.v = 'open';

    return out;
  }

  /* دمج نسختين من نفس الخطة: الأحدث يفوز — للتفاصيل، ولصوت كل شخص على حدة، وللحالة. */
  function merge(a, b) {
    if (!a) return clone(b);
    if (!b) return clone(a);

    var out = clone(num(b.mts) > num(a.mts) ? b : a);

    out.vt = {};
    var names = {};
    Object.keys(a.vt || {}).forEach(function (n) { names[n] = 1; });
    Object.keys(b.vt || {}).forEach(function (n) { names[n] = 1; });
    Object.keys(names).forEach(function (n) {
      var va = (a.vt || {})[n], vb = (b.vt || {})[n];
      if (!va)      out.vt[n] = clone(vb);
      else if (!vb) out.vt[n] = clone(va);
      else          out.vt[n] = clone(num(vb.ts) >= num(va.ts) ? vb : va);
    });

    var sa = a.st, sb = b.st;
    if (!sa)      out.st = clone(sb);
    else if (!sb) out.st = clone(sa);
    else          out.st = clone(num(sb.ts) >= num(sa.ts) ? sb : sa);

    return out;
  }

  /* ---------- الترميز في الرابط ---------- */

  function b64u(text) {
    var bytes = new TextEncoder().encode(text), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unb64u(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* الصيغة السلكية: مصفوفة مضغوطة — الأسماء مرة واحدة، والأوقات أرقامًا.
     الهدف رابط قصير بما يكفي لرسالة واتساب. */
  var EPOCH   = Date.UTC(2020, 0, 1);
  var ST_LIST = ['open', 'set', 'done', 'off'];

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function sec(ms) { return Math.round((num(ms) - EPOCH) / 1000); }
  function ms(s)   { return EPOCH + num(s) * 1000; }

  /* دقائق منذ 2020-01-01 بحساب التقويم لا بالمناطق الزمنية — لا يتأثر بالتوقيت الصيفي */
  function slotToNum(slot) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(slot || '');
    if (!m) return -1;
    var days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 864e5);
    return days * 1440 + (+m[4]) * 60 + (+m[5]);
  }

  function numToSlot(n) {
    n = Math.round(num(n));
    if (n <= 0) return null;
    var days = Math.floor(n / 1440), rest = n % 1440;
    var d = new Date(EPOCH + days * 864e5);
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) +
           'T' + p2(Math.floor(rest / 60)) + ':' + p2(rest % 60);
  }

  function pack(p) {
    var names = [p.own];
    Object.keys(p.vt).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });

    var nameIdx = function (n) { return names.indexOf(n); };
    var slotIdx = function (s) { return p.slt.indexOf(s); };

    var vt = Object.keys(p.vt).map(function (n) {
      return [
        nameIdx(n),
        sec(p.vt[n].ts),
        p.vt[n].y.map(slotIdx).filter(function (i) { return i >= 0; })
      ];
    });

    var st = [
      Math.max(0, ST_LIST.indexOf(p.st.v)),
      slotIdx(p.st.at),
      sec(p.st.ts),
      nameIdx(p.st.by)
    ];

    return [VER, p.id, names, p.act, p.plc, p.nte, p.dur, p.slt.map(slotToNum), vt, st, sec(p.mts)];
  }

  function unpack(w) {
    if (!Array.isArray(w) || w.length < 11) return null;

    var names  = Array.isArray(w[2]) ? w[2] : [];
    var nameAt = function (i) {
      return (typeof i === 'number' && typeof names[i] === 'string') ? names[i] : '';
    };
    /* تُحفظ الفجوات كما هي حتى تبقى الفهارس متطابقة مع ما رُمِّز */
    var slots = (Array.isArray(w[7]) ? w[7] : []).map(numToSlot);
    var slotAt = function (i) {
      return (typeof i === 'number' && slots[i]) ? slots[i] : '';
    };

    var vt = {};
    (Array.isArray(w[8]) ? w[8] : []).forEach(function (v) {
      if (!Array.isArray(v)) return;
      var n = nameAt(v[0]);
      if (!n) return;
      vt[n] = {
        y: (Array.isArray(v[2]) ? v[2] : []).map(slotAt).filter(Boolean),
        ts: ms(v[1])
      };
    });

    var s  = Array.isArray(w[9]) ? w[9] : [];
    var st = { v: ST_LIST[s[0]] || 'open', at: slotAt(s[1]), ts: ms(s[2]), by: nameAt(s[3]) };

    return sanitize({
      ver: VER, id: w[1], own: names[0],
      act: w[3], plc: w[4], nte: w[5], dur: w[6],
      slt: slots.filter(Boolean), vt: vt, st: st, mts: ms(w[10])
    });
  }

  function encode(plan) { return b64u(JSON.stringify(pack(plan))); }

  function decode(code) {
    try { return unpack(JSON.parse(unb64u(code))); }
    catch (e) { return null; }
  }

  return {
    VER: VER, MAX_SLOTS: MAX_SLOTS,
    load: load, save: save, blank: blank,
    newPlan: newPlan, newId: newId, sanitize: sanitize, merge: merge,
    encode: encode, decode: decode, clone: clone, str: str
  };
})();
