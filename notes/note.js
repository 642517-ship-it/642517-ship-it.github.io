/* note.js — פתק בודד בחלון צף */
(function () {
  'use strict';

  var id     = new URLSearchParams(location.search).get('id');
  var solo   = document.getElementById('solo');
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

  var note = id && Store.get(id);
  if (!note) {
    ta.disabled = true;
    ta.value = '';
    status.textContent = 'הפתק לא נמצא';
    paint('yellow');
  } else {
    ta.value = note.text || '';
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

  ta.addEventListener('input', function () {
    if (!note) return;
    status.textContent = '…';
    clearTimeout(timer);
    timer = setTimeout(function () {
      Store.update(id, { text: ta.value });
      status.textContent = 'נשמר';
      setTimeout(function () { status.textContent = ''; }, 1200);
    }, 250);
  });

  /* עדכון חי כשעורכים את אותו פתק בלוח */
  Store.onExternalChange(function () {
    var fresh = id && Store.get(id);
    if (!fresh) return;
    if (document.activeElement !== ta && ta.value !== (fresh.text || '')) ta.value = fresh.text || '';
    paint(fresh.color);
  });

  document.getElementById('open-board').addEventListener('click', function () {
    window.open('./', 'stickynotes-board');
  });

  ta.focus();
})();
