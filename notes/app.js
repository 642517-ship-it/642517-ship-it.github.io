/* app.js — לוח הפתקים */
(function () {
  'use strict';

  var board    = document.getElementById('board');
  var tpl      = document.getElementById('note-tpl');
  var emptyMsg = document.getElementById('empty');
  var search   = document.getElementById('search');
  var toastEl  = document.getElementById('toast');
  var menu     = document.getElementById('menu');
  var menuBtn  = document.getElementById('menu-btn');
  var fileIn   = document.getElementById('file');
  var helpDlg  = document.getElementById('help');
  var installBtn = document.getElementById('install');

  var NOTE_W = 220, NOTE_H = 230, MIN_W = 150, MIN_H = 150;
  var els = Object.create(null);   // id -> element
  var lastDeleted = [];
  var saveTimers = Object.create(null);
  var defaultColor = Store.prefs().color || 'yellow';

  /* ---------- עזרים ---------- */

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

  function applyColor(el, colorId) {
    var c = Store.colorOf(colorId);
    el.style.setProperty('--bg', c.bg);
    el.style.setProperty('--edge', c.edge);
    el.dataset.color = c.id;
  }

  /* טיימר נפרד לכל שדה: אחרת הקלדה בגוף הפתק מבטלת שמירה ממתינה של הכותרת. */
  function saveSoon(id, patch) {
    var key = id + ':' + Object.keys(patch).join(',');
    clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(function () { Store.update(id, patch); }, 250);
  }

  /* ---------- רינדור ---------- */

  function place(el, n) {
    el.style.left   = n.x + 'px';
    el.style.top    = n.y + 'px';
    el.style.width  = n.w + 'px';
    el.style.height = n.h + 'px';
    el.style.zIndex = n.z || 1;
    el.style.setProperty('--rot', (n.rot || 0) + 'deg');
  }

  function buildNote(n) {
    var el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = n.id;
    applyColor(el, n.color);
    place(el, n);

    var ti = el.querySelector('.note-title');
    var ta = el.querySelector('.note-text');
    ti.value = n.title || '';
    ta.value = n.text || '';

    ti.addEventListener('input', function () {
      saveSoon(n.id, { title: ti.value });
      applyFilter();
    });
    ti.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ta.focus(); }   /* Enter בכותרת יורד לגוף הפתק */
    });
    ta.addEventListener('input', function () {
      saveSoon(n.id, { text: ta.value });
      applyFilter();
    });
    [ti, ta].forEach(function (f) {
      f.addEventListener('focus', function () { bringToFront(n.id, el); });
    });

    /* לוח הצבעים של הפתק */
    var pal = el.querySelector('.note-palette');
    Store.COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.style.background = c.bg;
      b.title = c.id;
      b.addEventListener('click', function () {
        applyColor(el, c.id);
        Store.update(n.id, { color: c.id });
        pal.hidden = true;
      });
      pal.appendChild(b);
    });

    /* עצירת ההתפשטות: המאזין הגלובלי על document סוגר לוחות צבעים פתוחים */
    pal.addEventListener('click', function (e) { e.stopPropagation(); });
    el.querySelector('.tool-color').addEventListener('click', function (e) {
      e.stopPropagation();
      var open = pal.hidden;
      document.querySelectorAll('.note-palette:not([hidden])').forEach(function (p) { p.hidden = true; });
      pal.hidden = !open;
    });
    el.querySelector('.tool-float').addEventListener('click', function () { floatNote(n.id); });
    el.querySelector('.tool-del').addEventListener('click', function () { removeNote(n.id); });

    el.addEventListener('pointerdown', function () { bringToFront(n.id, el); }, true);
    initDrag(el, n.id);
    initResize(el, n.id);

    els[n.id] = el;
    board.appendChild(el);
    return el;
  }

  function render() {
    Object.keys(els).forEach(function (id) { els[id].remove(); });
    els = Object.create(null);
    Store.all().forEach(buildNote);
    updateEmpty();
    applyFilter();
  }

  /* ריענון עדין אחרי שינוי בחלון אחר — בלי לדרוס פתק שנערך כרגע. */
  function refresh() {
    var notes = Store.all();
    var seen = Object.create(null);
    notes.forEach(function (n) {
      seen[n.id] = true;
      var el = els[n.id];
      if (!el) { buildNote(n); return; }
      var ti = el.querySelector('.note-title');
      var ta = el.querySelector('.note-text');
      if (document.activeElement !== ti && ti.value !== (n.title || '')) ti.value = n.title || '';
      if (document.activeElement !== ta && ta.value !== (n.text || '')) ta.value = n.text || '';
      if (el.dataset.color !== n.color) applyColor(el, n.color);
      if (!el.classList.contains('dragging')) place(el, n);
    });
    Object.keys(els).forEach(function (id) {
      if (!seen[id]) { els[id].remove(); delete els[id]; }
    });
    updateEmpty();
    applyFilter();
  }

  function updateEmpty() {
    emptyMsg.hidden = Object.keys(els).length > 0;
  }

  function bringToFront(id, el) {
    var top = Store.maxZ();
    if (Number(el.style.zIndex) === top && top > 0) return;
    var z = top + 1;
    el.style.zIndex = z;
    Store.update(id, { z: z });
  }

  /* ---------- יצירה ומחיקה ---------- */

  function nextSpot() {
    var pad = 24;
    var baseX = board.scrollLeft + pad;
    var baseY = board.scrollTop + pad;
    var count = Object.keys(els).length;
    var perRow = Math.max(1, Math.floor((board.clientWidth - pad) / (NOTE_W + pad)));
    var col = count % perRow;
    var row = Math.floor(count / perRow) % 4;
    return {
      x: Math.round(baseX + col * (NOTE_W + pad) + (row % 2 ? 14 : 0)),
      y: Math.round(baseY + row * (NOTE_H + pad))
    };
  }

  function addNote(text) {
    var spot = nextSpot();
    var n = {
      id: Store.uid(),
      title: '',
      text: text || '',
      color: defaultColor,
      x: spot.x, y: spot.y, w: NOTE_W, h: NOTE_H,
      z: Store.maxZ() + 1,
      rot: Math.round((Math.random() * 3 - 1.5) * 10) / 10,
      created: Date.now(), updated: Date.now()
    };
    Store.add(n);
    var el = buildNote(n);
    updateEmpty();
    /* פתק ריק נפתח על הכותרת; פתק שנוצר מטקסט קיים נפתח על הגוף */
    el.querySelector(text ? '.note-text' : '.note-title').focus();
    el.animate(
      [{ transform: 'rotate(var(--rot)) scale(.86)', opacity: 0 }, { transform: 'rotate(var(--rot)) scale(1)', opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(.2,.9,.3,1.2)' }
    );
    return n;
  }

  function removeNote(id) {
    var n = Store.remove(id);
    if (!n) return;
    if (els[id]) { els[id].remove(); delete els[id]; }
    lastDeleted.push(n);
    updateEmpty();
    toast('הפתק נמחק — Ctrl+Z לשחזור');
  }

  function undoDelete() {
    var n = lastDeleted.pop();
    if (!n) { toast('אין מה לשחזר'); return; }
    Store.add(n);
    buildNote(n);
    updateEmpty();
    toast('הפתק שוחזר');
  }

  /* ---------- גרירה ושינוי גודל ---------- */

  function initDrag(el, id) {
    var head = el.querySelector('.note-head');
    var startX, startY, origX, origY, active = false;

    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.tool')) return;
      active = true;
      head.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      origX = parseFloat(el.style.left) || 0;
      origY = parseFloat(el.style.top) || 0;
      el.classList.add('dragging');
      e.preventDefault();
    });

    head.addEventListener('pointermove', function (e) {
      if (!active) return;
      var x = Math.max(0, origX + (e.clientX - startX));
      var y = Math.max(0, origY + (e.clientY - startY));
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    });

    function end() {
      if (!active) return;
      active = false;
      el.classList.remove('dragging');
      Store.update(id, { x: Math.round(parseFloat(el.style.left)), y: Math.round(parseFloat(el.style.top)) });
      growBoard();
    }
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  function initResize(el, id) {
    var grip = el.querySelector('.note-resize');
    var startX, startY, origW, origH, active = false;

    grip.addEventListener('pointerdown', function (e) {
      active = true;
      grip.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      origW = el.offsetWidth; origH = el.offsetHeight;
      el.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    });

    grip.addEventListener('pointermove', function (e) {
      if (!active) return;
      el.style.width  = Math.max(MIN_W, origW + (e.clientX - startX)) + 'px';
      el.style.height = Math.max(MIN_H, origH + (e.clientY - startY)) + 'px';
    });

    function end() {
      if (!active) return;
      active = false;
      el.classList.remove('dragging');
      Store.update(id, { w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) });
      growBoard();
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /* הלוח גדל לפי הפתק הרחוק ביותר, כדי שאפשר יהיה לגלול אליו. */
  function growBoard() {
    var maxX = 0, maxY = 0;
    Store.all().forEach(function (n) {
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });
    board.style.minWidth  = (maxX + 80) + 'px';
    board.style.minHeight = (maxY + 80) + 'px';
  }

  /* ---------- פתק צף ---------- */

  function floatNote(id) {
    var url = new URL('note.html', location.href);
    url.searchParams.set('id', id);

    if ('documentPictureInPicture' in window) {
      var n = Store.get(id) || {};
      window.documentPictureInPicture
        .requestWindow({ width: Math.max(260, n.w || 280), height: Math.max(260, n.h || 300) })
        .then(function (win) {
          var doc = win.document;
          doc.title = (n.title && n.title.trim()) || 'פתק';
          doc.documentElement.lang = 'he';
          doc.documentElement.dir = 'rtl';
          doc.documentElement.style.height = '100%';
          doc.body.style.cssText = 'margin:0;height:100%;overflow:hidden';
          var frame = doc.createElement('iframe');
          frame.src = url.href;
          frame.style.cssText = 'border:0;display:block;width:100%;height:100%';
          doc.body.appendChild(frame);
        })
        .catch(function () { openPopup(url.href, id); });
      return;
    }
    openPopup(url.href, id);
  }

  function openPopup(href, id) {
    var w = window.open(href, 'note-' + id, 'popup=yes,width=300,height=340');
    if (!w) toast('הדפדפן חסם את החלון — אפשרו חלונות קופצים לאתר הזה');
    else toast('בכרום או אדג׳ החלון הזה יישאר מעל שאר החלונות');
  }

  /* ---------- חיפוש ---------- */

  function applyFilter() {
    var q = search.value.trim().toLowerCase();
    Object.keys(els).forEach(function (id) {
      var el = els[id];
      if (!q) { el.classList.remove('dim', 'hit'); return; }
      var hay = (el.querySelector('.note-title').value + '\n' + el.querySelector('.note-text').value).toLowerCase();
      var hit = hay.indexOf(q) !== -1;
      el.classList.toggle('hit', hit);
      el.classList.toggle('dim', !hit);
    });
  }

  /* ---------- תפריט ופעולות ---------- */

  function tidy() {
    var pad = 24;
    var perRow = Math.max(1, Math.floor((board.clientWidth - pad) / (NOTE_W + pad)));
    var notes = Store.all().slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    notes.forEach(function (n, i) {
      var x = pad + (i % perRow) * (NOTE_W + pad);
      var y = pad + Math.floor(i / perRow) * (NOTE_H + pad);
      Store.update(n.id, { x: x, y: y, w: NOTE_W, h: NOTE_H });
      if (els[n.id]) {
        els[n.id].style.transition = 'left .25s ease, top .25s ease, width .25s ease, height .25s ease';
        place(els[n.id], { x: x, y: y, w: NOTE_W, h: NOTE_H, z: n.z, rot: n.rot });
        setTimeout(function () { els[n.id] && (els[n.id].style.transition = ''); }, 300);
      }
    });
    growBoard();
    toast('הלוח סודר');
  }

  function exportNotes() {
    var payload = { app: 'stickynotes', version: 1, exported: new Date().toISOString(), notes: Store.all() };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'petakim-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importNotes(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { toast('הקובץ אינו קובץ גיבוי תקין'); return; }
      var incoming = Array.isArray(data) ? data : (data && data.notes);
      if (!Array.isArray(incoming)) { toast('הקובץ אינו קובץ גיבוי תקין'); return; }

      var existing = Store.all();
      var byId = Object.create(null);
      existing.forEach(function (n) { byId[n.id] = n; });
      var added = 0;
      incoming.forEach(function (n) {
        if (!n || typeof n !== 'object') return;
        var note = {
          id: n.id && !byId[n.id] ? n.id : Store.uid(),
          title: String(n.title || '').slice(0, 80),
          text: String(n.text || ''),
          color: Store.colorOf(n.color).id,
          x: clamp(Number(n.x) || 24, 0, 20000),
          y: clamp(Number(n.y) || 24, 0, 20000),
          w: clamp(Number(n.w) || NOTE_W, MIN_W, 900),
          h: clamp(Number(n.h) || NOTE_H, MIN_H, 900),
          z: Number(n.z) || 1,
          rot: Number(n.rot) || 0,
          created: Number(n.created) || Date.now(),
          updated: Number(n.updated) || Date.now()
        };
        byId[note.id] = note;
        existing.push(note);
        added++;
      });
      Store.replaceAll(existing);
      render();
      growBoard();
      toast('יובאו ' + added + ' פתקים');
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!Store.all().length) { toast('אין פתקים למחיקה'); return; }
    if (!confirm('למחוק את כל הפתקים? אפשר לגבות קודם דרך "גיבוי לקובץ".')) return;
    lastDeleted = lastDeleted.concat(Store.all());
    Store.replaceAll([]);
    render();
    toast('כל הפתקים נמחקו — Ctrl+Z לשחזור');
  }

  /* ---------- חיווט ---------- */

  document.getElementById('add').addEventListener('click', function () { addNote(); });
  document.getElementById('empty-add').addEventListener('click', function () { addNote(); });
  search.addEventListener('input', applyFilter);

  Store.COLORS.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'chip' + (c.id === defaultColor ? ' on' : '');
    b.style.background = c.bg;
    b.title = 'צבע ברירת מחדל';
    b.setAttribute('aria-label', 'צבע ברירת מחדל: ' + c.id);
    b.addEventListener('click', function () {
      defaultColor = c.id;
      Store.prefs({ color: c.id });
      document.querySelectorAll('#swatches .chip').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    });
    document.getElementById('swatches').appendChild(b);
  });

  menuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', function () {
    if (!menu.hidden) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
    document.querySelectorAll('.note-palette:not([hidden])').forEach(function (p) { p.hidden = true; });
  });
  menu.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    menu.hidden = true;
    switch (b.dataset.act) {
      case 'export': exportNotes(); break;
      case 'import': fileIn.click(); break;
      case 'tidy':   tidy(); break;
      case 'help':   helpDlg.showModal(); break;
      case 'clear':  clearAll(); break;
    }
  });

  fileIn.addEventListener('change', function () {
    if (fileIn.files && fileIn.files[0]) importNotes(fileIn.files[0]);
    fileIn.value = '';
  });

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undoDelete(); }
    if (!typing && (e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addNote(); }
    if (e.key === 'Escape' && !menu.hidden) menu.hidden = true;
  });

  /* לחיצה כפולה על שטח ריק בלוח = פתק חדש במקום הלחיצה */
  board.addEventListener('dblclick', function (e) {
    if (e.target !== board && e.target !== emptyMsg) return;
    var r = board.getBoundingClientRect();
    var n = addNote();
    var x = Math.max(0, Math.round(e.clientX - r.left + board.scrollLeft - NOTE_W / 2));
    var y = Math.max(0, Math.round(e.clientY - r.top + board.scrollTop - 24));
    Store.update(n.id, { x: x, y: y });
    place(els[n.id], Object.assign({}, n, { x: x, y: y }));
  });

  /* הדבקת טקסט על הלוח יוצרת פתק */
  document.addEventListener('paste', function (e) {
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && text.trim()) { addNote(text.trim()); toast('נוצר פתק מהטקסט שהודבק'); }
  });

  Store.onExternalChange(refresh);

  /* התקנה על שולחן העבודה */
  var deferredPrompt = null;
  var installed = window.matchMedia('(display-mode: standalone)').matches ||
                  window.matchMedia('(display-mode: window-controls-overlay)').matches ||
                  window.navigator.standalone === true;
  installBtn.hidden = installed;      /* כבר רץ כאפליקציה — אין מה להתקין */

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', function () {
    if (!deferredPrompt) { helpDlg.showModal(); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      installBtn.hidden = true;
    });
  });
  window.addEventListener('appinstalled', function () {
    installBtn.hidden = true;
    toast('הפתקים הותקנו — חפשו את הקיצור בשולחן העבודה');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  render();
  growBoard();

  /* קיצור "פתק חדש" מהמערכת (manifest shortcuts) */
  if (new URLSearchParams(location.search).has('new')) {
    addNote();
    history.replaceState(null, '', location.pathname);
  }
  if (!Store.all().length && !Store.prefs().seeded) {
    Store.prefs({ seeded: true });
    var first = addNote('• גררו את הפס העליון כדי להזיז\n• ⇱ פותח פתק צף מעל כל החלונות\n• "התקן במחשב" מדביק את הלוח לשולחן העבודה');
    Store.update(first.id, { title: 'ברוכים הבאים 👋' });
    els[first.id].querySelector('.note-title').value = 'ברוכים הבאים 👋';
    document.activeElement.blur();
  }
})();
