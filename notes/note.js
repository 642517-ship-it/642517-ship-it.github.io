/* note.js — פתק בודד בחלון צף */
(function () {
  'use strict';

  var id     = new URLSearchParams(location.search).get('id');
  var solo   = document.getElementById('solo');
  var ti     = document.getElementById('title');
  var ta     = document.getElementById('text');
  var status = document.getElementById('status');
  var pal    = document.getElementById('palette');
  var timer;

  function paint(colorId) {
    var c = Store.colorOf(colorId);
    solo.style.setProperty('--bg', c.bg);
    solo.style.setProperty('--edge', c.edge);
    document.body.style.background = c.bg;
    pal.querySelectorAll('.chip').forEach(function (b) {
      b.classList.toggle('on', b.dataset.color === c.id);
    });
  }

  function setWindowTitle(t) {
    document.title = (t && t.trim()) || 'פתק';
  }

  var note = id && Store.get(id);
  if (!note) {
    ti.disabled = ta.disabled = true;
    ti.value = ta.value = '';
    status.textContent = 'הפתק לא נמצא';
    paint('yellow');
  } else {
    ti.value = note.title || '';
    ta.value = note.text || '';
    setWindowTitle(note.title);
    paint(note.color);
  }

  Store.COLORS.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'chip';
    b.dataset.color = c.id;
    b.style.background = c.bg;
    b.title = c.id;
    b.addEventListener('click', function () {
      if (!note) return;
      Store.update(id, { color: c.id });
      paint(c.id);
    });
    pal.appendChild(b);
  });
  if (note) paint(note.color);

  function save(patch) {
    if (!note) return;
    status.textContent = '…';
    clearTimeout(timer);
    timer = setTimeout(function () {
      Store.update(id, patch());
      status.textContent = 'נשמר';
      setTimeout(function () { status.textContent = ''; }, 1200);
    }, 250);
  }

  ti.addEventListener('input', function () {
    setWindowTitle(ti.value);
    save(function () { return { title: ti.value }; });
  });
  ti.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); ta.focus(); }
  });
  ta.addEventListener('input', function () {
    save(function () { return { text: ta.value }; });
  });

  /* עדכון חי כשעורכים את אותו פתק בלוח */
  Store.onExternalChange(function () {
    var fresh = id && Store.get(id);
    if (!fresh) return;
    if (document.activeElement !== ti && ti.value !== (fresh.title || '')) ti.value = fresh.title || '';
    if (document.activeElement !== ta && ta.value !== (fresh.text || '')) ta.value = fresh.text || '';
    setWindowTitle(fresh.title);
    paint(fresh.color);
  });

  document.getElementById('open-board').addEventListener('click', function () {
    window.open('./', 'stickynotes-board');
  });

  (note && !note.title ? ti : ta).focus();
})();
