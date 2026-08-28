/* app.js — يلا رياضة */
(function () {
  'use strict';

  var LOC   = 'ar-u-nu-latn';           /* عربي بأرقام لاتينية — أوضح للقراءة السريعة */
  var TIMES = ['06:00', '07:00', '08:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
  var ACTS  = ['جري', 'مشي', 'نادي', 'كرة قدم', 'كرة سلة', 'دراجة', 'سباحة', 'تنس', 'إطالة'];
  var DAYS_AHEAD = 14;

  var db = Store.load();
  var draft = null;        /* حالة نموذج التحرير */
  var deferredInstall = null;
  var warnedStorage = false;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ================= التاريخ والوقت ================= */

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function parseSlot(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0) : null;
  }

  function toSlot(d) {
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
           'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  var fmtDay  = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
  var fmtDayS = new Intl.DateTimeFormat(LOC, { weekday: 'short' });
  var fmtTime = new Intl.DateTimeFormat(LOC, { hour: 'numeric', minute: '2-digit' });

  function dayName(d) {
    var diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
    if (diff === 0) return 'اليوم';
    if (diff === 1) return 'غدًا';
    if (diff === 2) return 'بعد غد';
    return fmtDay.format(d);
  }

  function whenText(d) { return d ? dayName(d) + '، ' + fmtTime.format(d) : ''; }

  function rel(d) {
    if (!d || typeof Intl.RelativeTimeFormat !== 'function') return '';
    var rtf  = new Intl.RelativeTimeFormat(LOC, { numeric: 'auto' });
    var days = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
    if (Math.abs(days) >= 1) return rtf.format(days, 'day');
    var mins = Math.round((d - Date.now()) / 60000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    return rtf.format(Math.round(mins / 60), 'hour');
  }

  /* ================= مساعدات الخطة ================= */

  function people(p) {
    var out = [], seen = {};
    [p.own].concat(Object.keys(p.vt)).forEach(function (n) {
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out;
  }

  function yesFor(p, slot) {
    return Object.keys(p.vt).filter(function (n) { return p.vt[n].y.indexOf(slot) >= 0; });
  }

  function agreed(p, slot) {
    var ppl = people(p);
    if (ppl.length < 2) return false;
    var yes = yesFor(p, slot);
    return ppl.every(function (n) { return yes.indexOf(n) >= 0; });
  }

  function agreedSlots(p) {
    return p.slt.filter(function (s) { return agreed(p, s); });
  }

  /* الوقت الذي تُعرَض به الخطة في القوائم */
  function planDate(p) {
    if (p.st.at && (p.st.v === 'set' || p.st.v === 'done')) return parseSlot(p.st.at);
    return p.slt.length ? parseSlot(p.slt[0]) : null;
  }

  function endOf(p) {
    var d = (p.st.v === 'set' && p.st.at) ? parseSlot(p.st.at)
          : (p.slt.length ? parseSlot(p.slt[p.slt.length - 1]) : null);
    return d ? new Date(d.getTime() + p.dur * 60000) : null;
  }

  function isOver(p) {
    if (p.st.v === 'done' || p.st.v === 'off') return true;
    var e = endOf(p);
    return !!e && e < new Date();
  }

  function title(p) { return p.act || 'رياضة'; }

  function durText(m) {
    if (m < 60) return m + ' دقيقة';
    if (m === 60) return 'ساعة';
    if (m === 90) return 'ساعة ونصف';
    if (m === 120) return 'ساعتان';
    return (m / 60) + ' ساعات';
  }

  function pruneVotes(p) {
    Object.keys(p.vt).forEach(function (n) {
      p.vt[n].y = p.vt[n].y.filter(function (s) { return p.slt.indexOf(s) >= 0; });
    });
  }

  function allPlans() {
    return Object.keys(db.plans).map(function (id) { return db.plans[id]; });
  }

  /* ================= التخزين والتنقّل ================= */

  function persist() {
    if (!Store.save(db) && !warnedStorage) {
      warnedStorage = true;
      toast('تعذّر الحفظ على هذا الجهاز — الخطط ستضيع عند إغلاق الصفحة');
    }
  }

  function go(hash, replace) {
    var url = location.pathname + location.search + '#' + (hash || '');
    try {
      if (replace) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
      route();
    } catch (e) {
      location.hash = hash || '';
    }
  }

  function hashParams() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
      else out[kv] = '1';
    });
    return out;
  }

  function route() {
    var q = hashParams();
    if (q.p) return receive(q.p);
    if (q.v && db.plans[q.v]) return showPlan(q.v);
    if (q.e && db.plans[q.e]) return showEdit(q.e);
    if (q['new']) return showEdit(null);
    showHome();
  }

  /* استقبال خطة قادمة من رابط: تُدمج مع النسخة المحلية إن وُجدت */
  function receive(code) {
    var incoming = Store.decode(code);
    if (!incoming) {
      toast('الرابط غير صالح أو ناقص');
      return go('', true);
    }
    var mine   = db.plans[incoming.id] || null;
    var merged = Store.merge(mine, incoming);
    pruneVotes(merged);
    db.plans[merged.id] = merged;
    persist();
    go('v=' + merged.id, true);
    toast(mine ? 'تم تحديث الخطة' : 'وصلك اقتراح من ' + merged.own);
  }

  /* ================= واجهة عامة ================= */

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function showView(id) {
    ['view-home', 'view-edit', 'view-plan'].forEach(function (v) {
      $('#' + v).hidden = (v !== id);
    });
    window.scrollTo(0, 0);
  }

  function confirmDlg(head, text, yesLabel, cb) {
    var dlg = $('#dlg-confirm');
    if (!dlg.showModal) {
      if (window.confirm(head + '\n' + text)) cb();
      return;
    }
    $('#cf-title').textContent = head;
    $('#cf-text').textContent  = text;
    $('#cf-yes').textContent   = yesLabel;
    dlg.returnValue = '';
    dlg.addEventListener('close', function h() {
      dlg.removeEventListener('close', h);
      if (dlg.returnValue === 'yes') cb();
    });
    dlg.showModal();
  }

  function setMe(name) {
    var old = db.me;
    db.me = name;
    if (old && old !== name) {
      allPlans().forEach(function (p) {
        if (p.vt[old]) { p.vt[name] = p.vt[old]; delete p.vt[old]; }
        if (p.own === old) p.own = name;
        if (p.st && p.st.by === old) p.st.by = name;
      });
    }
    persist();
  }

  function askName(cb) {
    var dlg = $('#dlg-name'), inp = $('#name-input');
    if (!dlg.showModal) {
      var v = Store.str(window.prompt('ما اسمك؟', db.me || '') || '', 40);
      if (v) setMe(v);
      if (cb) cb(!!db.me);
      return;
    }
    inp.value = db.me;
    dlg.addEventListener('close', function h() {
      dlg.removeEventListener('close', h);
      var name = Store.str(inp.value, 40);
      if (name) setMe(name);
      /* أُعيد بناء العرض ليظهر الاسم الجديد — إلا أثناء تحرير نموذج */
      if (name && $('#view-edit').hidden) route();
      if (cb) cb(!!db.me);
    });
    dlg.showModal();
  }

  /* يطلب الاسم أولًا إن لم يكن معروفًا، ثم ينفّذ */
  function withName(fn) {
    if (db.me) return fn();
    askName(function (ok) { if (ok) fn(); else toast('اكتب اسمك أولًا'); });
  }

  /* ================= الرئيسية ================= */

  function showHome() {
    showView('view-home');
    renderNext();
    renderStats();
    renderPlanList();
  }

  function renderNext() {
    var wrap = $('#next-wrap');
    wrap.textContent = '';

    var now  = new Date();
    var next = allPlans()
      .filter(function (p) { return p.st.v === 'set' && p.st.at && !isOver(p); })
      .sort(function (a, b) { return parseSlot(a.st.at) - parseSlot(b.st.at); })[0];
    if (!next) return;

    var d    = parseSlot(next.st.at);
    var card = el('div', 'card next');
    card.appendChild(el('div', 'next-lbl', 'الموعد القادم'));
    card.appendChild(el('div', 'next-when', whenText(d)));

    var sub = title(next) + (next.plc ? ' · ' + next.plc : '');
    var r   = rel(d);
    if (r) sub += ' · ' + r;
    card.appendChild(el('div', 'next-sub', sub));

    var open = el('button', 'btn', 'فتح الخطة');
    open.addEventListener('click', function () { go('v=' + next.id); });
    card.appendChild(open);

    if (d < now) card.querySelector('.next-lbl').textContent = 'موعد اليوم';
    wrap.appendChild(card);
  }

  function renderStats() {
    var wrap = $('#stats');
    wrap.textContent = '';

    var dones = allPlans()
      .filter(function (p) { return p.st.v === 'done'; })
      .map(function (p) { return planDate(p); })
      .filter(Boolean);

    var now = Date.now(), W = 7 * 864e5;

    /* نافذة الأسبوع الجارية مفتوحة من الأعلى ليُحتسب تمرين سُجّل لموعد اليوم أو غد */
    function inWeek(k) {
      var lo = now - (k + 1) * W, hi = (k === 0) ? Infinity : now - k * W;
      return dones.some(function (d) { return +d > lo && +d <= hi; });
    }

    var week = dones.filter(function (d) { return +d > now - W; }).length;

    var streak = 0;
    for (var k = 0; k < 260; k++) {
      if (inWeek(k)) streak++;
      else if (k > 0) break;
    }

    [['هذا الأسبوع', week], ['أسابيع متتالية', streak], ['المجموع', dones.length]]
      .forEach(function (pair) {
        var s = el('div', 'stat');
        s.appendChild(el('b', null, String(pair[1])));
        s.appendChild(el('span', null, pair[0]));
        wrap.appendChild(s);
      });
  }

  function statusBadge(p) {
    if (p.st.v === 'done') return ['done', 'تم'];
    if (p.st.v === 'off')  return ['off',  'أُلغي'];
    if (p.st.v === 'set')  return ['set',  'مؤكد'];
    if (agreedSlots(p).length) return ['set', 'جاهز للتأكيد'];
    if (!p.vt[db.me])      return ['wait', 'ردّك مطلوب'];
    return ['wait', 'بانتظار الرد'];
  }

  function renderPlanList() {
    var wrap = $('#plan-groups');
    wrap.textContent = '';

    var plans = allPlans();
    $('#home-empty').hidden = plans.length > 0;
    if (!plans.length) return;

    var live = [], past = [];
    plans.forEach(function (p) { (isOver(p) ? past : live).push(p); });

    var byDate = function (a, b) {
      var da = planDate(a), dbb = planDate(b);
      return (da ? +da : Infinity) - (dbb ? +dbb : Infinity);
    };
    live.sort(byDate);
    past.sort(function (a, b) { return byDate(b, a); });

    if (live.length) wrap.appendChild(groupOf('الخطط الحالية', live, false));
    if (past.length) wrap.appendChild(groupOf('السابقة', past.slice(0, 20), true));
  }

  function groupOf(name, list, isPast) {
    var frag = document.createDocumentFragment();
    frag.appendChild(el('h2', 'group-title', name));
    list.forEach(function (p) {
      var card = el('button', 'card plan-card' + (isPast ? ' past' : ''));
      card.type = 'button';

      var main = el('div', 'pc-main');
      main.appendChild(el('div', 'pc-act', title(p) + (p.plc ? ' · ' + p.plc : '')));

      var d   = planDate(p);
      var sub = el('div', 'pc-sub');
      sub.appendChild(el('span', null,
        d ? ((p.st.v === 'set' || p.st.v === 'done') ? whenText(d) : p.slt.length + ' أوقات مقترحة')
          : 'بلا أوقات'));
      main.appendChild(sub);
      card.appendChild(main);

      var b = statusBadge(p);
      card.appendChild(el('span', 'badge ' + b[0], b[1]));

      card.addEventListener('click', function () { go('v=' + p.id); });
      frag.appendChild(card);
    });
    return frag;
  }

  /* ================= التحرير ================= */

  function showEdit(id) {
    var p = id ? db.plans[id] : null;
    draft = {
      id:    id || null,
      slots: p ? p.slt.slice() : [],
      day:   null
    };
    $('#edit-title').textContent = p ? 'تعديل الاقتراح' : 'اقتراح موعد جديد';
    $('#f-act').value = p ? p.act : '';
    $('#f-plc').value = p ? p.plc : '';
    $('#f-nte').value = p ? p.nte : '';
    $('#f-dur').value = p ? String(p.dur) : '60';
    $('#f-custom').value = '';
    $('#f-custom').min = toSlot(new Date());

    renderPlaces();
    renderDayChips();
    renderSlotList();
    showView('view-edit');
  }

  function renderPlaces() {
    var list = $('#places');
    list.textContent = '';
    var seen = {};
    allPlans().forEach(function (p) {
      if (p.plc && !seen[p.plc]) {
        seen[p.plc] = 1;
        var o = document.createElement('option');
        o.value = p.plc;
        list.appendChild(o);
      }
    });
  }

  function renderActChips() {
    var wrap = $('#act-chips');
    wrap.textContent = '';
    ACTS.forEach(function (a) {
      var c = el('button', 'chip', a);
      c.type = 'button';
      c.addEventListener('click', function () { $('#f-act').value = a; $('#f-act').focus(); });
      wrap.appendChild(c);
    });
  }

  function renderDayChips() {
    var wrap = $('#day-chips');
    wrap.textContent = '';
    var today = startOfDay(new Date());

    for (var i = 0; i < DAYS_AHEAD; i++) {
      (function (d) {
        var c = el('button', 'chip');
        c.type = 'button';
        c.setAttribute('aria-pressed', 'false');
        c.appendChild(el('span', null, i === 0 ? 'اليوم' : i === 1 ? 'غدًا' : fmtDayS.format(d)));
        c.appendChild(el('small', null, d.getDate() + '/' + (d.getMonth() + 1)));
        c.addEventListener('click', function () {
          draft.day = d;
          Array.prototype.forEach.call(wrap.children, function (n) {
            n.setAttribute('aria-pressed', String(n === c));
          });
          renderTimeChips();
        });
        wrap.appendChild(c);
      })(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
    }
    renderTimeChips();
  }

  function renderTimeChips() {
    var wrap = $('#time-chips');
    wrap.textContent = '';
    if (!draft.day) {
      $('#slot-hint').textContent = 'اختر يومًا ثم ساعة لإضافة وقت.';
      return;
    }
    $('#slot-hint').textContent = 'اضغط على الساعات المناسبة يوم ' + dayName(draft.day) + '.';

    TIMES.forEach(function (t) {
      var parts = t.split(':');
      var when  = new Date(draft.day.getFullYear(), draft.day.getMonth(), draft.day.getDate(), +parts[0], +parts[1]);
      var slot  = toSlot(when);
      var c = el('button', 'chip', fmtTime.format(when));
      c.type = 'button';
      c.setAttribute('aria-pressed', String(draft.slots.indexOf(slot) >= 0));
      c.disabled = when < new Date();
      c.addEventListener('click', function () { toggleSlot(slot); });
      wrap.appendChild(c);
    });
  }

  function toggleSlot(slot) {
    var i = draft.slots.indexOf(slot);
    if (i >= 0) {
      draft.slots.splice(i, 1);
    } else {
      if (draft.slots.length >= Store.MAX_SLOTS) return toast('أقصى عدد أوقات: ' + Store.MAX_SLOTS);
      var d = parseSlot(slot);
      if (!d || d < new Date()) return toast('هذا الوقت مضى');
      draft.slots.push(slot);
      draft.slots.sort();
    }
    renderSlotList();
    renderTimeChips();
  }

  function renderSlotList() {
    var list = $('#slot-list');
    list.textContent = '';
    draft.slots.forEach(function (slot) {
      var li = el('li');
      li.appendChild(el('span', null, whenText(parseSlot(slot))));
      var rm = el('button', null, '×');
      rm.type = 'button';
      rm.title = 'إزالة';
      rm.setAttribute('aria-label', 'إزالة ' + whenText(parseSlot(slot)));
      rm.addEventListener('click', function () { toggleSlot(slot); });
      li.appendChild(rm);
      list.appendChild(li);
    });
    $('#save-btn').disabled = draft.slots.length === 0;
  }

  function saveEdit(ev) {
    ev.preventDefault();
    var act = Store.str($('#f-act').value, 60);
    if (!act) { $('#f-act').focus(); return toast('اكتب النشاط'); }
    if (!draft.slots.length) return toast('أضف وقتًا واحدًا على الأقل');

    withName(function () {
      var now = Date.now();
      var p   = draft.id ? Store.clone(db.plans[draft.id]) : Store.newPlan(db.me);

      p.act = act;
      p.plc = Store.str($('#f-plc').value, 80);
      p.nte = Store.str($('#f-nte').value, 120);
      p.dur = parseInt($('#f-dur').value, 10) || 60;
      p.slt = draft.slots.slice().sort();
      p.mts = now;
      if (!p.own) p.own = db.me;

      pruneVotes(p);
      /* صاحب الاقتراح متاح في كل الأوقات التي اقترحها */
      p.vt[db.me] = { y: p.slt.slice(), ts: now };

      if (p.st.v === 'set' && p.slt.indexOf(p.st.at) < 0) {
        p.st = { v: 'open', at: '', ts: now, by: db.me };
      }

      db.plans[p.id] = p;
      persist();
      go('v=' + p.id, true);
      toast(draft.id ? 'حُفظ التعديل — أعد إرسال الرابط' : 'جاهز — أرسله لصديقك');
    });
  }

  /* ================= عرض الخطة ================= */

  function showPlan(id) {
    var p = db.plans[id];
    if (!p) return go('', true);
    showView('view-plan');
    renderPlan(p);
  }

  function renderPlan(p) {
    var view = $('#view-plan');
    view.textContent = '';

    /* --- الترويسة --- */
    var head = el('div', 'plan-head');
    head.appendChild(el('h1', null, title(p)));
    var meta = [];
    if (p.plc) meta.push(p.plc);
    meta.push(durText(p.dur));
    meta.push('اقترحها ' + (p.own === db.me ? 'أنت' : p.own));
    head.appendChild(el('div', 'meta', meta.join(' · ')));
    if (p.nte) head.appendChild(el('div', 'meta', '“' + p.nte + '”'));
    view.appendChild(head);

    view.appendChild(banner(p));
    view.appendChild(voteList(p));
    view.appendChild(planActions(p));
  }

  function banner(p) {
    var b = el('div', 'banner');

    if (p.st.v === 'done') {
      b.className = 'banner ok';
      b.appendChild(el('b', null, 'تم التمرين ✔'));
      b.appendChild(el('span', 'fine', whenText(parseSlot(p.st.at))));
      return b;
    }
    if (p.st.v === 'off') {
      b.appendChild(el('b', null, 'أُلغي الموعد'));
      b.appendChild(el('span', 'fine', 'ألغاه ' + (p.st.by === db.me ? 'أنت' : p.st.by)));
      return b;
    }
    if (p.st.v === 'set') {
      var d = parseSlot(p.st.at);
      b.className = 'banner ok';
      b.appendChild(el('b', null, 'الموعد مؤكد: ' + whenText(d)));
      var r = rel(d);
      b.appendChild(el('span', 'fine', (r ? r + ' · ' : '') + 'أكّده ' + (p.st.by === db.me ? 'أنت' : p.st.by)));
      return b;
    }

    var ready  = agreedSlots(p);
    var others = people(p).filter(function (n) { return n !== db.me; });

    if (ready.length) {
      b.className = 'banner ok';
      b.appendChild(el('b', null, 'وقت يناسب الجميع: ' + whenText(parseSlot(ready[0]))));
      b.appendChild(el('span', 'fine', 'أكّده من القائمة بالأسفل ثم أرسل الرابط.'));
    } else if (!p.vt[db.me] || !p.vt[db.me].y.length) {
      b.className = 'banner wait';
      b.appendChild(el('b', null, 'حدّد الأوقات التي تناسبك'));
      b.appendChild(el('span', 'fine', 'اضغط على كل وقت يناسبك، ثم أعد إرسال الرابط.'));
    } else if (!others.length || !others.some(function (n) { return p.vt[n] && p.vt[n].y.length; })) {
      b.className = 'banner wait';
      b.appendChild(el('b', null, 'بانتظار رد صديقك'));
      b.appendChild(el('span', 'fine', 'أرسل له الرابط ليحدّد أوقاته.'));
    } else {
      b.className = 'banner wait';
      b.appendChild(el('b', null, 'لا يوجد وقت يناسب الجميع'));
      b.appendChild(el('span', 'fine', 'عدّل الاقتراح وأضف أوقاتًا أخرى.'));
    }
    return b;
  }

  function voteList(p) {
    var wrap = el('div');
    wrap.appendChild(el('h2', 'group-title', 'الأوقات المقترحة'));

    var list = el('ul', 'vote-list');
    var editable = (p.st.v === 'open' || p.st.v === 'set');

    p.slt.forEach(function (slot) {
      var d      = parseSlot(slot);
      var past   = d < new Date();
      var mine   = !!(p.vt[db.me] && p.vt[db.me].y.indexOf(slot) >= 0);
      var yes    = yesFor(p, slot);
      var isAll  = agreed(p, slot);
      var chosen = (p.st.at === slot && p.st.v !== 'open');

      var li = el('li', 'vote-row');

      var btn = el('button', 'vote' + (isAll ? ' all' : '') + (chosen ? ' chosen' : '') + (past ? ' past' : ''));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(mine));
      btn.disabled = !editable || past;

      btn.appendChild(el('span', 'tick', mine ? '✓' : ''));

      var when = el('span', 'v-when');
      when.appendChild(el('b', null, whenText(d)));
      when.appendChild(el('span', 'v-who',
        yes.length ? 'يناسب: ' + yes.map(function (n) { return n === db.me ? 'أنت' : n; }).join('، ')
                   : 'لم يوافق عليه أحد بعد'));
      btn.appendChild(when);

      if (isAll) btn.appendChild(el('span', 'v-flag', 'الجميع'));
      btn.addEventListener('click', function () { vote(p, slot); });
      li.appendChild(btn);

      if (isAll && p.st.v === 'open' && !past) {
        var cf = el('button', 'btn btn-primary', 'أكّد');
        cf.type = 'button';
        cf.addEventListener('click', function () { confirmSlot(p, slot); });
        li.appendChild(cf);
      }

      list.appendChild(li);
    });

    wrap.appendChild(list);
    if (editable) wrap.appendChild(el('p', 'fine', 'اضغط على الوقت لتبديل توفّرك فيه.'));
    return wrap;
  }

  function planActions(p) {
    var wrap = el('div', 'plan-actions');

    var wa = el('button', 'btn btn-wa btn-big', shareLabel(p));
    wa.addEventListener('click', function () { sendWhatsApp(p); });
    wrap.appendChild(wa);

    var pair = el('div', 'pair');
    var copy = el('button', 'btn', 'نسخ الرابط');
    copy.addEventListener('click', function () { copyLink(p); });
    pair.appendChild(copy);

    if (navigator.share) {
      var sh = el('button', 'btn', 'مشاركة…');
      sh.addEventListener('click', function () {
        navigator.share({ title: title(p), text: shareText(p), url: planURL(p) }).catch(function () {});
      });
      pair.appendChild(sh);
    }
    wrap.appendChild(pair);

    if (p.st.v === 'set' && p.st.at) {
      var cal = el('div', 'pair');
      var ics = el('button', 'btn', 'أضف إلى التقويم');
      ics.addEventListener('click', function () { downloadIcs(p); });
      cal.appendChild(ics);

      var g = el('a', 'btn', 'تقويم Google');
      g.href = googleUrl(p);
      g.target = '_blank';
      g.rel = 'noopener';
      cal.appendChild(g);
      wrap.appendChild(cal);

      var done = el('button', 'btn', 'تم التمرين ✔');
      done.addEventListener('click', function () { setStatus(p, 'done', p.st.at); });
      wrap.appendChild(done);
    }

    var row = el('div', 'pair');
    if (p.st.v !== 'done') {
      var edit = el('button', 'btn', 'تعديل');
      edit.addEventListener('click', function () { go('e=' + p.id); });
      row.appendChild(edit);
    }
    if (p.st.v === 'open' || p.st.v === 'set') {
      var off = el('button', 'btn btn-danger', 'إلغاء الموعد');
      off.addEventListener('click', function () {
        confirmDlg('إلغاء الموعد؟', 'سيُعلَّم الموعد كملغى. أخبر صديقك بإرسال الرابط بعدها.', 'إلغاء الموعد',
          function () { setStatus(p, 'off', p.st.at || (p.slt[0] || '')); });
      });
      row.appendChild(off);
    }
    if (row.children.length) wrap.appendChild(row);

    var del = el('button', 'btn btn-danger', 'حذف من جهازي');
    del.addEventListener('click', function () {
      confirmDlg('حذف الخطة؟', 'تُحذف من هذا الجهاز فقط. تبقى عند صديقك.', 'حذف', function () {
        delete db.plans[p.id];
        persist();
        go('', true);
        toast('حُذفت الخطة');
      });
    });
    wrap.appendChild(del);

    var box = el('div', 'link-box');
    box.appendChild(el('code', null, planURL(p)));
    wrap.appendChild(box);

    return wrap;
  }

  /* ================= إجراءات ================= */

  function vote(p, slot) {
    withName(function () {
      var mine = p.vt[db.me] ? p.vt[db.me].y.slice() : [];
      var i = mine.indexOf(slot);
      if (i >= 0) mine.splice(i, 1); else mine.push(slot);
      p.vt[db.me] = { y: mine, ts: Date.now() };
      persist();
      renderPlan(p);
    });
  }

  function confirmSlot(p, slot) {
    withName(function () {
      p.st = { v: 'set', at: slot, ts: Date.now(), by: db.me };
      persist();
      renderPlan(p);
      toast('تم التأكيد — أرسل الرابط ليصل صديقك');
    });
  }

  function setStatus(p, v, at) {
    withName(function () {
      p.st = { v: v, at: at || p.st.at, ts: Date.now(), by: db.me };
      persist();
      renderPlan(p);
      toast(v === 'done' ? 'أُضيف إلى سجلك 💪' : 'أُلغي الموعد');
    });
  }

  /* ================= المشاركة ================= */

  function planURL(p) {
    return location.origin + location.pathname + '#p=' + Store.encode(p);
  }

  function shareLabel(p) {
    if (p.st.v === 'set')  return 'أرسل التأكيد في واتساب';
    if (p.vt[db.me] && p.own !== db.me) return 'أرسل ردّك في واتساب';
    return 'أرسل الاقتراح في واتساب';
  }

  function shareText(p) {
    var lines = [];
    var headline = title(p) + (p.plc ? ' · ' + p.plc : '');

    if (p.st.v === 'set') {
      lines.push('✅ ' + headline);
      lines.push(whenText(parseSlot(p.st.at)));
    } else if (p.st.v === 'off') {
      lines.push('❌ أُلغي: ' + headline);
    } else if (p.st.v === 'done') {
      lines.push('💪 تم: ' + headline);
    } else {
      lines.push('🏃 ' + headline);
      var mine = (p.vt[db.me] && p.vt[db.me].y) || [];
      var replying = p.own !== db.me && mine.length > 0;
      var show = replying ? mine : p.slt;
      lines.push(replying ? 'الأوقات التي تناسبني:' : 'الأوقات المقترحة:');
      show.slice().sort().forEach(function (s) { lines.push('• ' + whenText(parseSlot(s))); });
      lines.push('افتح الرابط وحدد ما يناسبك 👇');
    }
    if (p.nte) lines.push(p.nte);
    return lines.join('\n');
  }

  function sendWhatsApp(p) {
    var digits = (db.phone || '').replace(/\D/g, '');
    var url = 'https://wa.me/' + digits + '?text=' +
              encodeURIComponent(shareText(p) + '\n' + planURL(p));
    window.open(url, '_blank', 'noopener');
  }

  function copyLink(p) {
    var text = planURL(p);
    var done = function () { toast('نُسخ الرابط'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('انسخ الرابط من الصندوق بالأسفل'); }
      document.body.removeChild(ta);
    }
  }

  /* ================= التقويم ================= */

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
                          .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function fold(line) {
    /* معيار iCalendar يقيس بالبايتات لا بالأحرف — والعربية حرفان لكل رمز */
    var enc = new TextEncoder();
    var out = [], cur = '', bytes = 0, limit = 72;
    Array.from(line).forEach(function (ch) {
      var n = enc.encode(ch).length;
      if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 72; }
      cur += ch;
      bytes += n;
    });
    out.push(cur);
    return out.join('\r\n');
  }

  function stampLocal(d) {
    return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
           'T' + p2(d.getHours()) + p2(d.getMinutes()) + '00';
  }

  function stampUtc(d) {
    return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
           'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + '00Z';
  }

  function icsText(p) {
    var start = parseSlot(p.st.at);
    var end   = new Date(start.getTime() + p.dur * 60000);
    var name  = title(p) + ' مع ' + people(p).filter(function (n) { return n !== db.me; }).join('، ');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//yalla-sport//AR',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + p.id + '@yalla-sport',
      'DTSTAMP:' + stampUtc(new Date()),
      'DTSTART:' + stampLocal(start),
      'DTEND:' + stampLocal(end),
      fold('SUMMARY:' + icsEscape(name.trim())),
      fold('LOCATION:' + icsEscape(p.plc)),
      fold('DESCRIPTION:' + icsEscape(p.nte)),
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      fold('DESCRIPTION:' + icsEscape(name.trim())),
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
  }

  function downloadIcs(p) {
    var blob = new Blob([icsText(p)], { type: 'text/calendar;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url;
    a.download = (p.act || 'sport').replace(/\s+/g, '-') + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function googleUrl(p) {
    var start = parseSlot(p.st.at);
    var end   = new Date(start.getTime() + p.dur * 60000);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text='     + encodeURIComponent(title(p)) +
      '&dates='    + stampUtc(start) + '/' + stampUtc(end) +
      '&location=' + encodeURIComponent(p.plc || '') +
      '&details='  + encodeURIComponent(p.nte || '');
  }

  /* ================= الإعدادات والتثبيت ================= */

  function openSettings() {
    var dlg = $('#dlg-settings');
    $('#set-name').value  = db.me;
    $('#set-phone').value = db.phone;
    if (!dlg.showModal) return askName();
    dlg.returnValue = '';
    dlg.addEventListener('close', function h() {
      dlg.removeEventListener('close', h);
      if (dlg.returnValue !== 'save') return;
      var name = Store.str($('#set-name').value, 40);
      if (name) setMe(name);
      db.phone = Store.str($('#set-phone').value, 20);
      persist();
      if ($('#view-edit').hidden) route();
      toast('حُفظت الإعدادات');
    });
    dlg.showModal();
  }

  function initInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      $('#install').hidden = false;
    });
    $('#install').addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.finally(function () {
        deferredInstall = null;
        $('#install').hidden = true;
      });
    });
    window.addEventListener('appinstalled', function () { $('#install').hidden = true; });
  }

  /* ================= الإقلاع ================= */

  function init() {
    renderActChips();

    $('#brand').addEventListener('click', function () { go(''); });
    $('#new-btn').addEventListener('click', function () { go('new'); });
    $('#cancel-edit').addEventListener('click', function () {
      if (draft && draft.id) go('v=' + draft.id, true); else go('', true);
    });
    $('#edit-form').addEventListener('submit', saveEdit);
    $('#add-custom').addEventListener('click', function () {
      var v = $('#f-custom').value;
      if (!v) return toast('اختر وقتًا');
      var slot = v.slice(0, 16);
      if (draft.slots.indexOf(slot) >= 0) return toast('هذا الوقت مضاف بالفعل');
      toggleSlot(slot);
      $('#f-custom').value = '';
    });
    $('#settings-btn').addEventListener('click', openSettings);
    $('#help-btn').addEventListener('click', function () {
      var d = $('#dlg-help');
      if (d.showModal) d.showModal();
    });

    window.addEventListener('popstate', route);
    initInstall();

    route();
    if (!db.me && !hashParams().p) askName();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  init();
})();
