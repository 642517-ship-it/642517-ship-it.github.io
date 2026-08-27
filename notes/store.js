/* store.js — מקור אמת יחיד לפתקים, משותף ללוח ולחלון הצף. */
(function (global) {
  'use strict';

  var KEY = 'stickynotes.v1';
  var PREFS = 'stickynotes.prefs.v1';

  var COLORS = [
    { id: 'yellow', bg: '#ffe27a', edge: '#f0c94a' },
    { id: 'pink',   bg: '#ffa7bf', edge: '#f07f9e' },
    { id: 'blue',   bg: '#9adcff', edge: '#66c4ef' },
    { id: 'green',  bg: '#b6e88a', edge: '#8fd05c' },
    { id: 'purple', bg: '#cfb3ff', edge: '#b08fff' },
    { id: 'orange', bg: '#ffbe7a', edge: '#f5a04f' }
  ];

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function read() {
    var data = safeParse(localStorage.getItem(KEY), null);
    if (!data || !Array.isArray(data.notes)) return { notes: [] };
    return data;
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function colorOf(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i];
    return COLORS[0];
  }

  var Store = {
    KEY: KEY,
    COLORS: COLORS,
    colorOf: colorOf,
    uid: uid,

    all: function () {
      return read().notes;
    },

    get: function (id) {
      var notes = read().notes;
      for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i];
      return null;
    },

    /* מיזוג-ואז-כתיבה: קורא מחדש לפני כל שינוי כדי לא לדרוס עדכון שהגיע מחלון אחר. */
    update: function (id, patch) {
      var data = read();
      for (var i = 0; i < data.notes.length; i++) {
        if (data.notes[i].id === id) {
          for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) data.notes[i][k] = patch[k];
          data.notes[i].updated = Date.now();
          write(data);
          return data.notes[i];
        }
      }
      return null;
    },

    add: function (note) {
      var data = read();
      data.notes.push(note);
      write(data);
      return note;
    },

    remove: function (id) {
      var data = read();
      var removed = null;
      data.notes = data.notes.filter(function (n) {
        if (n.id === id) { removed = n; return false; }
        return true;
      });
      write(data);
      return removed;
    },

    replaceAll: function (notes) {
      write({ notes: notes });
    },

    maxZ: function () {
      return read().notes.reduce(function (m, n) { return Math.max(m, n.z || 0); }, 0);
    },

    prefs: function (patch) {
      var p = safeParse(localStorage.getItem(PREFS), {}) || {};
      if (patch) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
        try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch (e) {}
      }
      return p;
    },

    /* מאזין לשינויים שנעשו בחלון אחר (לוח ⇄ פתק צף). */
    onExternalChange: function (fn) {
      global.addEventListener('storage', function (e) {
        if (e.key === KEY || e.key === null) fn();
      });
    }
  };

  global.Store = Store;
})(window);
