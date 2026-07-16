(function () {
    var LOGS_KEY = 'ttracker_logs_v1';
    var EVENING_START_HOUR = 14;   // 2 PM -- sessions before this hour are "morning"
    var MAX_LOG_DAYS = 90;         // number of daily entries to retain in the database
    var DISPLAY_HISTORY_DAYS = 14; // number of past entries shown in the history view
    var UI_REFRESH_DELAY_MS = 600; // ms to show the success message before refreshing the UI
    var SLEEP_MIN = 3;             // minimum sleep hours accepted in the check-in form
    var SLEEP_MAX = 14;            // maximum sleep hours accepted in the check-in form
    var METRICS = [
      { id: 'energy', label: 'Energy' },
      { id: 'mood',   label: 'Mood'   },
      { id: 'focus',  label: 'Focus'  },
      { id: 'drive',  label: 'Drive'  },
    ];

    var logsCache = [];
    var logsDb = null;

    function readLegacyLogs() {
      try {
        var stored = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]');
        return Array.isArray(stored) ? stored : [];
      } catch (e) {
        console.warn('T-Tracker: failed to parse legacy logs.', e);
        return [];
      }
    }

    function initDatabase() {
      if (!window.indexedDB) {
        logsCache = readLegacyLogs();
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        var request = indexedDB.open('ttracker', 1);
        request.onupgradeneeded = function () {
          // A single manually keyed "daily" record replaces the whole bounded array atomically.
          request.result.createObjectStore('logs');
        };
        request.onerror = function () {
          console.warn('T-Tracker: database unavailable; using in-memory logs.', request.error);
          logsDb = null;
          logsCache = readLegacyLogs();
          resolve();
        };
        request.onsuccess = function () {
          logsDb = request.result;
          var read = logsDb.transaction('logs', 'readonly').objectStore('logs').get('daily');
          read.onerror = function () {
            logsCache = readLegacyLogs();
            resolve();
          };
          read.onsuccess = function () {
            var persistedLogs = Array.isArray(read.result) ? read.result : null;
            logsCache = persistedLogs || readLegacyLogs();
            // Copy existing localStorage data into IndexedDB once for returning users.
            if (!persistedLogs) {
              saveLogs(logsCache).then(resolve);
            } else {
              resolve();
            }
          };
        };
      });
    }

    function getLogs() {
      return logsCache;
    }

    function saveLogs(logs) {
      logsCache = logs;
      if (logsDb) {
        try {
          // The explicit "daily" key keeps this small bounded log atomic.
          var write = logsDb.transaction('logs', 'readwrite').objectStore('logs').put(logs, 'daily');
          return new Promise(function (resolve) {
            write.onerror = function () {
              console.warn('T-Tracker: could not save logs to the database.', write.error);
              resolve();
            };
            write.onsuccess = resolve;
          });
        } catch (e) {
          console.warn('T-Tracker: database write failed.', e);
        }
      }
      try { localStorage.setItem(LOGS_KEY, JSON.stringify(logs)); } catch (e) {
        console.warn('T-Tracker: could not save logs.', e);
      }
      return Promise.resolve();
    }
    function todayKey() {
      return new Date().toISOString().slice(0, 10);
    }
    function getSession() {
      return new Date().getHours() < EVENING_START_HOUR ? 'morning' : 'evening';
    }
    function getTodayEntry() {
      var logs = getLogs();
      var today = todayKey();
      return logs.find(function (l) { return l.date === today; }) || null;
    }
    function saveSession(session, data) {
      var logs = getLogs();
      var today = todayKey();
      var idx = logs.findIndex(function (l) { return l.date === today; });
      var entry = idx >= 0 ? logs[idx] : { date: today };
      entry[session] = data;
      if (idx >= 0) logs[idx] = entry; else logs.unshift(entry);
      saveLogs(logs.slice(0, MAX_LOG_DAYS));
    }
    function formatDate(dateStr) {
      // Parse year/month/day components directly to avoid ambiguity from string-based Date parsing
      // (e.g., bare date strings are treated as UTC midnight, which shifts the date in negative-offset
      // timezones; appending a time suffix risks DST edge cases). Component-based construction always
      // creates a local-time Date at midnight, which correctly reflects the stored calendar date.
      var parts = dateStr.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return { dow: days[d.getDay()], short: months[d.getMonth()] + ' ' + d.getDate() };
    }
    function ratingColor(v) {
      if (v >= 4) return '#34d399';
      if (v >= 3) return '#ffb15c';
      return '#ff8a8a';
    }

    var ratings = {};

    // --- Check-in ---
    function renderCheckin() {
      var card = document.getElementById('checkinCard');
      if (!card) return;
      var session = getSession();
      var today = getTodayEntry();
      var sessionDone = today && today[session];

      if (sessionDone) {
        // Use static HTML structure and set dynamic text via textContent to prevent XSS
        var sessionLabels = { morning: 'Morning', evening: 'Evening' };
        var sessionIcons  = { morning: '&#9728;&#65039;', evening: '&#127769;' };
        var comeBackMap   = { morning: 'this afternoon or evening', evening: 'tomorrow morning' };
        card.innerHTML = '<div class="checkin-card">' +
          '<span class="badge-ok" id="badgeLabel"></span>' +
          '<h3 id="checkinHeading"></h3>' +
          '<p class="sub">Already logged for this session. Come back <span id="comeBackText"></span> to log again.</p>' +
          '<button class="btn btn-ghost" id="relogBtn" style="padding:9px 18px;font-size:14px;">Re-log this session</button>' +
          '</div>';
        document.getElementById('badgeLabel').textContent = '\u2713 ' + sessionLabels[session] + ' logged';
        document.getElementById('checkinHeading').innerHTML = sessionIcons[session] + ' ' + sessionLabels[session] + ' check-in';
        document.getElementById('comeBackText').textContent = comeBackMap[session];
        document.getElementById('relogBtn').addEventListener('click', function () {
          ratings = {};
          renderCheckinForm(card, session);
        });
        return;
      }
      renderCheckinForm(card, session);
    }

    function renderCheckinForm(card, session) {
      var sessionLabel = session === 'morning' ? '&#9728;&#65039; Morning check-in' : '&#127769; Evening check-in';
      var sessionSub   = session === 'morning' ? 'How are you starting the day? Rate 1 (low) to 5 (high).' : 'How did the day go? Rate 1 (low) to 5 (high).';

      var sleepHtml = session === 'morning'
        ? '<div class="sleep-row">' +
            '<label for="sleepInput">Hours of sleep last night</label>' +
            '<input type="number" id="sleepInput" class="sleep-input" min="' + SLEEP_MIN + '" max="' + SLEEP_MAX + '" step="0.5" placeholder="e.g. 7.5">' +
          '</div>'
        : '';

      var metricsHtml = METRICS.map(function (m) {
        return '<div class="metric-row">' +
          '<div class="metric-label"><span>' + m.label + '</span><span class="val-badge" id="val-' + m.id + '">\u2014</span></div>' +
          '<div class="rating-btns">' +
          [1,2,3,4,5].map(function (n) {
            return '<button type="button" class="rating-btn" data-metric="' + m.id + '" data-val="' + n + '">' + n + '</button>';
          }).join('') +
          '</div></div>';
      }).join('');

      card.innerHTML = '<div class="checkin-card">' +
        '<h3>' + sessionLabel + '</h3>' +
        '<p class="sub">' + sessionSub + '</p>' +
        sleepHtml + metricsHtml +
        '<div class="checkin-footer">' +
          '<button class="btn btn-primary" id="submitCheckin" style="padding:11px 22px;">Save check-in</button>' +
          '<div class="checkin-msg" id="checkinMsg"></div>' +
        '</div></div>';

      // Restore any pre-selected ratings
      Object.keys(ratings).forEach(function (metric) {
        var v = ratings[metric];
        if (!v) return;
        var btn = card.querySelector('[data-metric="' + metric + '"][data-val="' + v + '"]');
        if (btn) btn.classList.add('selected');
        var badge = card.querySelector('#val-' + metric);
        if (badge) badge.textContent = v;
      });

      card.querySelectorAll('.rating-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var metric = btn.dataset.metric;
          var val = parseInt(btn.dataset.val, 10);
          ratings[metric] = val;
          card.querySelectorAll('[data-metric="' + metric + '"]').forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          var badge = card.querySelector('#val-' + metric);
          if (badge) badge.textContent = val;
        });
      });

      document.getElementById('submitCheckin').addEventListener('click', function () {
        var msgEl = document.getElementById('checkinMsg');
        var missing = METRICS.filter(function (m) { return !ratings[m.id]; }).map(function (m) { return m.label; });
        if (missing.length) {
          msgEl.textContent = 'Please rate: ' + missing.join(', ');
          msgEl.className = 'checkin-msg err';
          return;
        }
        var data = {
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          energy: ratings.energy, mood: ratings.mood, focus: ratings.focus, drive: ratings.drive,
        };
        if (session === 'morning') {
          var sleepEl = document.getElementById('sleepInput');
          if (sleepEl && sleepEl.value) {
            var sleepVal = parseFloat(sleepEl.value);
            if (!isNaN(sleepVal) && sleepVal >= SLEEP_MIN && sleepVal <= SLEEP_MAX) {
              data.sleep = sleepVal;
            } else if (!isNaN(sleepVal)) {
              msgEl.textContent = 'Sleep hours must be between ' + SLEEP_MIN + ' and ' + SLEEP_MAX + '.';
              msgEl.className = 'checkin-msg err';
              return;
            }
          }
        }
        saveSession(session, data);
        ratings = {};
        msgEl.textContent = 'Check-in saved!';
        msgEl.className = 'checkin-msg ok';
        setTimeout(function () { renderCheckin(); renderTodaySummary(); renderHistory(); }, UI_REFRESH_DELAY_MS);
      });
    }

    // --- Today's summary ---
    function renderTodaySummary() {
      var el = document.getElementById('todaySummary');
      if (!el) return;
      var today = getTodayEntry();

      var sessionsHtml = ['morning', 'evening'].map(function (sess) {
        var s = today && today[sess];
        var icon = sess === 'morning' ? '&#9728;&#65039;' : '&#127769;';
        var label = icon + ' ' + sess.charAt(0).toUpperCase() + sess.slice(1);
        if (!s) {
          return '<div class="session-block"><h4>' + label + '</h4><p class="empty-state">Not logged yet</p></div>';
        }
        var barsHtml = METRICS.map(function (m) {
          var v = s[m.id] || 0;
          return '<div class="metric-bar-row">' +
            '<span class="metric-bar-label">' + m.label + '</span>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + (v * 20) + '%;background:' + ratingColor(v) + '"></div></div>' +
            '<span class="metric-bar-val">' + v + '</span>' +
          '</div>';
        }).join('');
        var sleepNote = (sess === 'morning' && s.sleep)
          ? '<p style="font-size:12px;color:var(--ink-mute);margin:8px 0 0;">' + s.sleep + 'h sleep</p>' : '';
        return '<div class="session-block">' +
          '<h4>' + label + ' <span style="font-size:11px;font-weight:600;color:var(--ink-mute);">' + s.time + '</span></h4>' +
          '<div class="metric-bars">' + barsHtml + '</div>' + sleepNote + '</div>';
      }).join('');

      el.innerHTML = '<div class="summary-card"><h3>Today\'s log</h3><div class="summary-sessions">' + sessionsHtml + '</div></div>';
    }

    // --- History ---
    function renderHistory() {
      var el = document.getElementById('logHistory');
      if (!el) return;
      var logs = getLogs().slice(0, DISPLAY_HISTORY_DAYS);

      if (!logs.length) {
        el.innerHTML = '<p class="no-logs">No logs yet \u2014 start with your first check-in above.</p>';
        return;
      }

      function sessionBlock(entry, sess) {
        var s = entry[sess];
        var icon = sess === 'morning' ? '&#9728;&#65039;' : '&#127769;';
        var label = icon + ' ' + sess.charAt(0).toUpperCase() + sess.slice(1);
        if (!s) return '<div class="log-session"><h4>' + label + '</h4><p style="font-size:12.5px;color:var(--ink-mute);margin:0;">\u2014</p></div>';
        var dotsHtml = METRICS.map(function (m) {
          var v = s[m.id] || 0;
          return '<div class="mini-bar-row"><span class="mini-bar-label">' + m.label + '</span>' +
            '<div class="mini-dots">' +
            [1,2,3,4,5].map(function (n) {
              return '<span class="mini-dot' + (n <= v ? ' on' : '') + '"' + (n <= v ? ' style="background:' + ratingColor(v) + '"' : '') + '></span>';
            }).join('') +
            '</div></div>';
        }).join('');
        var sleepNote = (sess === 'morning' && s.sleep) ? '<p style="font-size:11.5px;color:var(--ink-mute);margin:6px 0 0;">' + s.sleep + 'h sleep</p>' : '';
        return '<div class="log-session"><h4>' + label + '</h4><div class="mini-bars">' + dotsHtml + '</div>' + sleepNote + '</div>';
      }

      var entriesHtml = logs.map(function (entry) {
        var df = formatDate(entry.date);
        var todayTag = entry.date === todayKey() ? ' <span style="color:var(--brand-2);font-size:12px;">(Today)</span>' : '';
        return '<div class="log-entry">' +
          '<div class="log-date"><span class="dow">' + df.dow + '</span>' + df.short + todayTag + '</div>' +
          sessionBlock(entry, 'morning') +
          sessionBlock(entry, 'evening') +
          '</div>';
      }).join('');

      el.innerHTML = '<div class="log-history-header">' +
        '<h3>Your log history</h3>' +
        '<button class="btn btn-ghost" id="clearLogsBtn" style="padding:8px 16px;font-size:13px;color:var(--ink-mute);">Clear all</button>' +
        '</div><div class="log-entries">' + entriesHtml + '</div>';

      document.getElementById('clearLogsBtn').addEventListener('click', function () {
        if (confirm('Clear all log data? This cannot be undone.')) {
          saveLogs([]);
          ratings = {};
          renderCheckin();
          renderTodaySummary();
          renderHistory();
        }
      });
    }

    initDatabase().then(function () {
      renderCheckin();
      renderTodaySummary();
      renderHistory();
    });
  })();
