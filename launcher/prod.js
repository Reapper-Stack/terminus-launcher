/* Terminus launcher — production layer (Launcher v2, docs/specs/launcher-v2-real.md).
   Loaded only by the shipped page (window.TD_PROD). It turns the reviewed design into the real
   launcher: data from data/*.json, state from the launcher exe over the WebView2 bridge.
   Every exe feature is gated on {t:"caps"}; an old exe (no caps) still gets PLAY, close, drag,
   the HUD and online/offline. Nothing here invents a number: what has no source is hidden. */
(function () {
  'use strict';
  var T = window.__TERM;
  if (!T) return;
  var W = T.W, $ = function (id) { return document.getElementById(id) };
  var host = window.chrome && window.chrome.webview;
  function post(m) { try { if (host) host.postMessage(m) } catch (e) {} }
  function L() { return T.L }
  function tx(en, pt) { return L() === 'pt' ? pt : en }
  function pick(o) { return o ? (o[L()] || o.en || '') : '' }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  /* the entries of a data list that are objects (a hand-edited file may hold null, numbers or strings): every reader goes through this */
  function objs(a) { return Array.isArray(a) ? a.filter(function (x) { return x && typeof x === 'object' }) : [] }
  function pl(o, lg) { return o && typeof o === 'object' ? (o[lg] || o.en || '') : '' }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('terminus.' + k); localStorage.setItem('terminus.' + k, v) } catch (e) { return null } }

  /* ---------- data: inline copy first (works offline / file://), then the live files beside the page ---------- */
  var DATA = { news: { items: [], notes: [], links: {} }, events: { events: [] } };
  /* R155: where each zone's data came from (inline = the copy built into the page, net = the live file, null = nothing usable) and which zone is still fetching with nothing to show */
  var SRC = { news: null, events: null }, LOADING = { news: false, events: false };
  try { var inl = $('tdata'); if (inl) { var j = JSON.parse(inl.textContent); if (j.news) { DATA.news = j.news; if (Array.isArray(j.news.items)) SRC.news = 'inline' } if (j.events) { DATA.events = j.events; if (Array.isArray(j.events.events)) SRC.events = 'inline' } } } catch (e) {}
  /* A-87: the text is kept so a refresh can tell whether a file really changed; a hung connection ends after 10 s */
  var LASTTXT = { news: null, events: null }, fetchedAt = Date.now(), refreshing = false;
  function fetchText(u) { var ac = window.AbortController ? new AbortController() : null, tm = ac ? setTimeout(function () { ac.abort() }, 10000) : 0;
    return fetch(u, ac ? { cache: 'no-cache', signal: ac.signal } : { cache: 'no-cache' }).then(function (r) { clearTimeout(tm); if (!r.ok) throw 0; return r.text() }, function (x) { clearTimeout(tm); throw x }) }
  function getZone(z) { return fetchText('data/' + z + '.json').then(function (t) { return { t: t, j: JSON.parse(t) } }).catch(function () { return null }) }
  function takeData(z, j) { if (z === 'news' && j && Array.isArray(j.items)) { DATA.news = j; SRC.news = 'net' } if (z === 'events' && j && Array.isArray(j.events)) { DATA.events = j; SRC.events = 'net' } }
  /* a zone's file counts as changed only when its text differs from the last one taken; a failed fetch keeps what is shown */
  function takeZ(z, r) { if (!r) return false; var ch = r.t !== LASTTXT[z]; LASTTXT[z] = r.t; takeData(z, r.j); return ch }
  if (/^https?:/.test(location.protocol)) {
    LOADING.news = !SRC.news; LOADING.events = !SRC.events;
    Promise.all([getZone('news'), getZone('events')])
      .then(function (r) { takeZ('news', r[0]); takeZ('events', r[1]); LOADING.news = LOADING.events = false; fetchedAt = Date.now(); NETFAIL = !r[0] && !r[1]; applyData() });
  }
  /* a tray-resident launcher keeps its page for days: refetch when it comes back into view (or every minute while visible) once the data is 10 min old; nothing is redrawn unless a file changed */
  function refreshData() {
    if (!/^https?:/.test(location.protocol) || refreshing || document.hidden || Date.now() - fetchedAt < 600000) return; refreshing = true;
    Promise.all([getZone('news'), getZone('events')]).then(function (r) { var ch = takeZ('news', r[0]) | takeZ('events', r[1]); refreshing = false; NETFAIL = !r[0] && !r[1]; if (r[0] || r[1]) fetchedAt = Date.now(); if (ch) applyData() }, function () { refreshing = false });
  }
  setInterval(refreshData, 60000);

  /* ---------- state from the exe ---------- */
  var PLAYP = null;
  function playPct() { var q = PLAYP; if (q) return q.phase === 'hash' ? (q.total ? Math.floor(q.files / q.total * 100) : 0) : (q.totalBytes ? Math.floor(q.bytes / q.totalBytes * 100) : 0); return NET.progress >= 0 ? NET.progress : -1 }
  /* A-99: sizes use the language's own decimal mark, and one of something is not plural */
  function mbl(x, lg) { var s = (x / 1048576).toFixed(1); return lg === 'pt' ? s.replace('.', ',') : s }
  function etaL(e, lg) { return lg === 'pt' ? (e === 1 ? ' · falta 1 s' : ' · faltam ' + e + ' s') : ' · ' + e + ' s left' }
  function nFiles(n, lg) { return n + (lg === 'pt' ? (n === 1 ? ' ficheiro' : ' ficheiros') : (n === 1 ? ' file' : ' files')) }
  function playText() { var q = PLAYP; if (!q) return '';
    if (q.phase === 'hash') return tx('Checking files · ', 'A verificar ficheiros · ') + (q.files || 0).toLocaleString('fr-FR') + ' / ' + (q.total || 0).toLocaleString('fr-FR');
    return tx('Downloading · ', 'A transferir · ') + mbl(q.bytes || 0, L()) + ' / ' + mbl(q.totalBytes || 0, L()) + ' MB' + (q.eta != null ? etaL(q.eta, L()) : '') }
  var CAPS = null, INFO = { launcher: null, game: null }, NET = { server: null, ms: null, status: '', progress: -1 },
      STAT = null, REP = null, GAME = false, PLAYING = false, MSH = [], LASTERR = '', NETFAIL = false;
  /* the exe's own words for a failure stay one string; the page's own texts carry both languages. Either one is shown for 2 min, then it goes */
  var DONE = null, DONEAT = 0, repSeen = 0;
  function setDone(en, pt) { DONE = en ? { en: en, pt: pt || en } : null; DONEAT = Date.now() }
  /* one toast per result, in whatever state the bar is in (R71 toasts rise above the bar for 5 s) */
  try { T.Y.D({ 'rep.ok.h': ['REPAIR FINISHED', 'REPARAÇÃO CONCLUÍDA'], 'rep.er.h': ['REPAIR DID NOT FINISH', 'A REPARAÇÃO NÃO TERMINOU'], 'rep.pl.h': ['PLAY COULD NOT START', 'NÃO FOI POSSÍVEL INICIAR'], 'rep.ok.b': ['{0}', '{0}'], 'rep.er.b': ['{0}', '{0}'], 'rep.pl.b': ['{0}', '{0}'] }) } catch (e) {}
  function toastRes(kind, txt) { try { if (T.Y.toast) T.Y.toast('rep.' + kind, [String(txt || '')]) } catch (e) {} }
  /* the installed build is the release marker: ask the exe for it again (it answers hud:html with caps), never infer it */
  var buildAsks = 0, bgAsked = '';
  function askBuild() { if (CAPS) { buildAsks++; post('hud:html') } }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { askBuild(); refreshData(); tickEvt() } });
  function has(c) { return !!(CAPS && CAPS.indexOf(c) >= 0) }
  /* held rounds (mockup PROD HOLD): a round is released only while its real data exists, and held again when it goes */
  function liveSet(n, v) { var l = window.TD_LIVE || (window.TD_LIVE = {}); v = !!v; if (!!l[n] === v) return; l[n] = v; if (window.TD_LIVE_APPLY) window.TD_LIVE_APPLY() }

  /* ---------- time ---------- */
  var MON = { en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], pt: ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] };
  var DL2 = { en: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], pt: ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'] };
  function p2(n) { return (n < 10 ? '0' : '') + n }
  function hm(d) { return p2(d.getHours()) + ':' + p2(d.getMinutes()) }
  function dShort(iso) { var d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')); return isNaN(d) ? '' : p2(d.getDate()) + ' ' + MON[L()][d.getMonth()] }
  function dur(sec) { sec = Math.max(0, Math.floor(sec)); var d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60; return (d ? d + 'D ' : '') + p2(h) + ':' + p2(m) }
  function evs() { return objs(DATA.events.events).map(function (e) { return { e: e, s: +new Date(e.start), t: +new Date(e.end) } }).filter(function (x) { return !isNaN(x.s) && !isNaN(x.t) && x.t > x.s }) }
  function liveEv(now) { return evs().filter(function (x) { return x.s <= now && now < x.t }).sort(function (a, b) { return a.t - b.t })[0] || null }
  function nextEv(now) { return evs().filter(function (x) { return x.s > now }).sort(function (a, b) { return a.s - b.s })[0] || null }
  /* an event the data does not know: its news stays while only the built-in copy is loaded, goes once the live file confirms the event is gone */
  function evEnded(id, now) { var x = evs().filter(function (y) { return y.e.id === id })[0]; return x ? x.t <= now : SRC.events === 'net' }

  /* ---------- news, patch notes ---------- */
  var TAG = { client: ['CLIENT', 'CLIENTE'], server: ['SERVER', 'SERVIDOR'], event: ['EVENT', 'EVENTO'] };
  /* A-123: the hero shows a lede, never a body cut mid-sentence. The item's own "lede" ({en,pt}) wins; without one it is whole sentences up to about two lines (125 characters).
     A first sentence longer than that stays whole and the 2-line clamp ends it with an ellipsis. The notes panel still carries the full body (n.p). */
  function lede(n, lg) { var own = n.lede && typeof n.lede === 'object' ? (n.lede[lg] || n.lede.en) : ''; if (own) return String(own);
    var b = String((n.body || {})[lg] || (n.body || {}).en || ''); if (b.length <= 125) return b;
    var re = /[^.!?]+[.!?]+(\s+|$)/g, m, out = ''; while ((m = re.exec(b))) { if ((out + m[0]).trim().length > 125) break; out += m[0] } return out.trim() || b }
  function newsItems() {
    var now = Date.now();
    return objs(DATA.news.items).filter(function (n) { return !(n.event && evEnded(n.event, now)) && n.title })
      .sort(function (a, b) { var x = String(a.date || ''), y = String(b.date || ''); return x < y ? 1 : x > y ? -1 : 0 });
  }
  var NEWSIDS = [];
  /* A-25: what the player has read is remembered (terminus.seen, comma-joined ids, newest 50); the first run counts what is already there as read */
  var SEEN = null;
  function seenLoad() { if (!SEEN) { var s = store('seen'); SEEN = { ids: s ? s.split(',').filter(Boolean) : [], first: s == null } } return SEEN }
  function markSeen(ids) { var s = seenLoad(), ch = false; ids.forEach(function (id) { id = String(id); if (id && id.indexOf(',') < 0 && s.ids.indexOf(id) < 0) { s.ids.push(id); ch = true } }); if (ch) store('seen', s.ids.slice(-50).join(',')) }
  /* every card that is no longer marked NEW has been read: called after the demo's own click, key and MARK ALL READ handlers have run */
  function syncSeen() { var un = T.UN(); if (!un) return; markSeen(NEWSIDS.filter(function (id, i) { return !un[i] && id !== 'none' })) }
  function laterSeen() { setTimeout(syncSeen, 30) }
  [['rail', 'click'], ['ymar', 'click']].forEach(function (p) { var el = $(p[0]); if (el) el.addEventListener(p[1], laterSeen, true) });
  addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') laterSeen() }, true);
  function hideEmptyCats() { [].forEach.call(document.querySelectorAll('#cats button'), function (b) { var n = b.querySelector('b'), off = !!n && n.textContent.trim() === '0'; if (b.classList.contains('prod-off') !== off) b.classList.toggle('prod-off', off) }) }
  if ($('cats')) new MutationObserver(hideEmptyCats).observe($('cats'), { childList: true });
  function applyNews() {
    var it = newsItems();
    if (!it.length) it = [{ id: 'none', date: new Date().toISOString().slice(0, 10), tag: 'client', thumb: 'img/thumbs/n1.png', title: { en: 'No news yet', pt: 'Ainda sem notícias' }, body: { en: 'News from the team appears here.', pt: 'As notícias da equipa aparecem aqui.' } }];
    var prevId = NEWSIDS[curIdx()];
    NEWSIDS = it.map(function (n) { return n.id });
    ['en', 'pt'].forEach(function (lg) {
      var arr = T.NEWS[lg]; arr.length = 0;
      it.forEach(function (n) { var tg = TAG[n.tag] || TAG.client; arr.push({ d: dShortL(n.date, lg), t: lg === 'pt' ? tg[1] : tg[0], h: esc(n.title[lg] || n.title.en), p: esc((n.body || {})[lg] || (n.body || {}).en || ''), l: esc(lede(n, lg)) }) });
    });
    T.TH.length = 0; it.forEach(function (n) { T.TH.push(/^img\/[a-z0-9\/_-]+\.(png|jpg|webp)$/i.test(n.thumb || '') ? n.thumb : 'img/thumbs/n1.png') });
    var SN = seenLoad(); if (SN.first) { SN.first = false; markSeen(NEWSIDS) }
    var un = T.UN(); if (un) { Object.keys(un).forEach(function (k) { delete un[k] }); it.forEach(function (n, i) { if (SN.ids.indexOf(String(n.id)) < 0 && i > 0) un[i] = 1 }) }
    /* A-97: a rebuild (language, a refreshed file) puts the player back on the story they were reading, if it is still listed */
    try { T.cats(); var ki = prevId ? NEWSIDS.indexOf(prevId) : -1; T.show(ki >= 0 && T.vis().indexOf(ki) >= 0 ? ki : (T.vis()[0] || 0)) } catch (e) {}
    hideEmptyCats();
    try { T.Y.paint() } catch (e) {}
  }
  function dShortL(iso, lg) { var d = new Date((iso || '') + 'T12:00:00'); return isNaN(d) ? '' : p2(d.getDate()) + ' ' + MON[lg][d.getMonth()] }
  function applyNotes() {
    var N = objs(DATA.news.notes);
    ['en', 'pt'].forEach(function (lg) {
      var P = T.PN[lg]; P.v.length = 0; P.meta.length = 0; P.g.length = 0;
      N.forEach(function (n) {
        P.v.push(esc(n.version) + ' · ' + dShortL(n.date, lg));
        P.meta.push(esc((n.meta || {})[lg] || (n.meta || {}).en || ''));
        P.g.push(objs(n.groups).map(function (g) { return [esc(pl(g.title, lg)), objs(g.items).map(function (i) { return [esc(pl(i.text, lg)), esc(i.tag || '')] })] }));
      });
    });
    T.DIFF.length = 0; N.forEach(function (n) { var m = []; objs(n.groups).forEach(function (g) { objs(g.items).forEach(function (i) { m.push([/^(new|chg|fix|del)$/.test(i.kind) ? i.kind : 'new', '']) }) }); T.DIFF.push(m) });
  }

  /* ---------- the week strip, the event chip and the countdowns ---------- */
  function weekModel() {
    var now = new Date(), nowMs = +now, dow = (now.getDay() + 6) % 7, mon0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    var days = []; for (var i = 0; i < 7; i++) days.push(new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + i));
    var lv = liveEv(nowMs), nx = nextEv(nowMs), show = lv || nx;
    var nm = STAT && STAT.ok && STAT.nextMaintenance ? new Date(STAT.nextMaintenance) : null;
    /* calendar midnights, not +24 h: a day with a DST change is 23 or 25 h long, and its 100 columns are that long */
    function span(d, i) { if (!show) return null; var a = +d, b = end(i), w = (b - a) / 100, s = Math.max(a, show.s), t = Math.min(b, show.t); if (t <= s) return null; return [Math.round((s - a) / w), Math.max(4, Math.round((t - s) / w))] }
    function mt(d, i) { if (!nm || isNaN(nm)) return null; var a = +d, b = end(i); if (+nm < a || +nm >= b) return null; return [Math.round((+nm - a) / ((b - a) / 100)), 18] }
    /* R149: every event of each day (local midnight to midnight), sorted by start; past events of the week stay, marked DONE */
    function end(i) { return +new Date(days[i].getFullYear(), days[i].getMonth(), days[i].getDate() + 1) }
    function dayEvs(i) { var a = +days[i], b = end(i); return evs().filter(function (x) { return x.s < b && x.t > a }).sort(function (p, q) { return p.s - q.s }) }
    /* A-131: a week with nothing in it says NO EVENTS once (the header), not again in the caption under the strip */
    var wkAny = days.some(function (d, i) { return dayEvs(i).length > 0 });
    return {
      dt: days.map(function (d) { return d.getDate() }), mon: days.map(function (d) { return MON[L()][d.getMonth()] }), today: dow,
      ev: days.map(span), mt: days.map(mt),
      evs: days.map(function (d, i) { var a = +d, b = end(i), w = (b - a) / 100; return dayEvs(i).map(function (x) { var s = Math.max(a, x.s), t = Math.min(b, x.t);
        return { s: [Math.round((s - a) / w), Math.max(3, Math.round((t - s) / w))], c: x.e.kind === 'maint' ? 'mt' : x.e.kind === 'exp' ? 'x149' : '' } }) }),
      capAll: function (i) {
        if (!(i >= 0 && i < 7)) i = dow;
        var d = days[i], a = +d, b = end(i), n = Date.now(), all = dayEvs(i), parts = [DL2[L()][i] + ' ' + p2(d.getDate()) + ' ' + MON[L()][d.getMonth()]];
        if (i === dow) parts.push(tx('TODAY', 'HOJE'));
        if (!all.length && wkAny) parts.push(tx('NO EVENTS', 'SEM EVENTOS'));
        var x = all.filter(function (y) { return y.s <= n && n < y.t })[0] || all.filter(function (y) { return y.s > n })[0] || all[all.length - 1];
        if (x) { var nmx = esc(pick(x.e.short) || pick(x.e.title)), more = all.length > 1 ? '+' + (all.length - 1) : '', st = x.s >= a, en = x.t <= b, hs = hm(new Date(x.s)), he = hm(new Date(x.t));
          if (nmx || more) parts.push(nmx && more ? nmx + ' ' + more : nmx || more);
          if (st && en) parts.push(tx(hs + ' TO ' + he, 'DAS ' + hs + ' ÀS ' + he)); else if (st) parts.push(tx('FROM ', 'DESDE AS ') + hs); else if (en) parts.push(tx('ENDS ', 'ACABA ÀS ') + he);
          if (x.t <= n) parts.push(tx('DONE', 'FEITA')) }
        if (nm && +nm >= a && +nm < b) parts.push(tx('MAINT. ', 'MANUT. ') + hm(nm));
        return parts.join(' · ');
      },
      cap: function (i) {
        var d = days[i], a = +d, b = end(i), parts = [DL2[L()][i] + ' ' + p2(d.getDate()) + ' ' + MON[L()][d.getMonth()]];
        if (i === dow) parts.push(tx('TODAY', 'HOJE'));
        if (show && show.s < b && show.t > a) { var sn = esc(pick(show.e.short) || pick(show.e.title)); if (sn) parts.push(sn); if (show.s >= a) parts.push(tx('FROM ', 'DESDE AS ') + hm(new Date(show.s))); if (show.t <= b) parts.push(tx('ENDS ', 'ACABA ÀS ') + hm(new Date(show.t))) }
        else if (wkAny) parts.push(tx('NO EVENTS', 'SEM EVENTOS'));
        if (nm && +nm >= a && +nm < b) parts.push(tx('MAINT. ', 'MANUT. ') + hm(nm));
        return parts.join(' · ');
      },
      head: function () {
        var n = Date.now(), l = liveEv(n), x = nextEv(n);
        if (l) return '<b>' + esc(pick(l.e.short) || pick(l.e.title)) + '</b> ' + tx(dur((l.t - n) / 1000) + ' LEFT', 'FALTAM ' + dur((l.t - n) / 1000));
        if (x && x.s - n < 7 * 86400000) return '<b>' + esc(pick(x.e.short) || pick(x.e.title)) + '</b> ' + tx('STARTS IN ', 'COMEÇA EM ') + dur((x.s - n) / 1000);
        return '<b>' + tx('NO EVENTS', 'SEM EVENTOS') + '</b>';
      }
    };
  }
  function applyEvents() {
    var now = Date.now(), lv = liveEv(now);
    if (lv) {
      W.dataset.event = lv.e.kind || 'event'; T.setEvt(lv.e.kind || 'event'); T.setE(Math.floor((lv.t - now) / 1000));
      var lab = lv.e.short || lv.e.title || {}, sp = document.querySelectorAll('.evt span'); if (sp[0]) { sp[0].setAttribute('data-en', esc(lab.en || '')); sp[0].setAttribute('data-pt', esc(lab.pt || lab.en || '')); sp[0].innerHTML = esc(pick(lab)) }
    } else { delete W.dataset.event; W.classList.remove('takeover') }
    T.wk(weekModel());
  }
  /* A-103: the event countdown is read from the clock every second (a sleeping or throttled page would drift a free-running counter) */
  function tickEvt() { var l = liveEv(Date.now()); if (l) T.setE(Math.floor((l.t - Date.now()) / 1000)) }
  setInterval(function () { if (T.R < 81) return; var l = liveEv(Date.now()), k = l ? l.e.id : null;
    /* A-97: an event starting or ending repaints the week and the LIVE tag; the news list is rebuilt only if it really changed (a story the player is reading stays open) */
    if (k !== lastLive) { lastLive = k; applyEvents(); if (newsItems().map(function (n) { return n.id }).join('|') !== NEWSIDS.join('|')) applyNews(); return }
    tickEvt(); var e = document.querySelector('#ywk .we'); if (e) { var hh = weekModel().head(); if (e.__h !== hh) { e.__h = hh; e.innerHTML = hh } } }, 1000);   /* only on change: a rewrite adds elements and wakes the type pass */
  var lastLive = (function () { var l = liveEv(Date.now()); return l ? l.e.id : null })();

  /* ---------- R148: the server's clock. /v1/status sends "at" = the host's own time with its UTC offset (DateTimeOffset.Now); the exe forwards it in
     {t:"status"}. The clock is the PC's instant (the server's only when the two disagree by more than 90 s) shown at the server's offset. A status
     with ok:false or with no usable "at" keeps what was known; none known = the round stays held. Every other time on the launcher stays local. ---------- */
  var SRV = null;
  function parseAt(a) { if (typeof a !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(a)) return null; var t = Date.parse(a), m = /(?:([+-])(\d\d):?(\d\d)|(Z))$/i.exec(a); if (isNaN(t) || !m) return null;
    var off = m[4] ? 0 : (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]); return Math.abs(off) <= 14 * 60 ? { t: t, off: off } : null }
  function takeAt(m) { if (m.ok === false) return; var pa = parseAt(m.at); if (!pa) return; var sk = pa.t - Date.now(); SRV = { off: pa.off, skew: Math.abs(sk) > 90000 ? sk : 0 } }
  window.TD_SRVNOW = function () { return SRV ? Date.now() + SRV.skew + SRV.off * 60000 : NaN };
  window.TD_SRVOFF = function () { return SRV ? SRV.off : null };

  /* ---------- R153 / R154: the page's own session log (localStorage terminus.play, in the launcher's UserData, which updates never prune).
     o = start of the game session open now (0 = none, or not seen: a game adopted after a restart), s = counted sessions [start, end] of the last 15 days,
     t = seconds of every counted session, e = when the last game session ended (game:false after game:true, adopted games included), l = seconds of the
     last counted session (null = none yet). Under 1 min a session is not counted; an open start whose end was never seen is dropped; a session longer
     than 24 h (an open start kept by a killed launcher and adopted days later) is not counted, its end still is. Stored values that no real log can hold
     are discarded on load. ---------- */
  var MAXS = 86400000;
  var PLOG = (function () { var d = { o: 0, s: [], t: 0, e: 0, l: null }, n = Date.now(), T0 = Date.UTC(2020, 0, 1);
    function ok(x, lo, hi) { x = +x; return isFinite(x) && x >= lo && x <= hi ? x : null }
    try { var j = JSON.parse(store('play') || 'null'); if (j && typeof j === 'object') {
      d.o = ok(j.o, n - MAXS, n + MAXS) || 0; d.e = ok(j.e, T0, n + 366 * 86400000) || 0;
      d.t = ok(j.t, 0, (n - T0) / 1000) || 0; d.l = j.l == null ? null : ok(j.l, 60, MAXS / 1000);
      d.s = Array.isArray(j.s) ? j.s.filter(function (x) { return Array.isArray(x) && ok(x[0], T0, n + MAXS) != null && ok(x[1] - x[0], 60000, MAXS) != null }).map(function (x) { return [+x[0], +x[1]] }) : [] } } catch (e) {}
    return d })();
  function psave() { var lim = Date.now() - 15 * 86400000; PLOG.s = PLOG.s.filter(function (x) { return x[1] > lim }); store('play', JSON.stringify(PLOG)) }
  function sessOpen() { PLOG.o = Date.now(); psave() }
  function sessClose() { var n = Date.now(), o = PLOG.o; PLOG.e = n; PLOG.o = 0;
    if (o && n - o >= 60000 && n - o <= MAXS) { var sec = Math.floor((n - o) / 1000); PLOG.s.push([o, n]); PLOG.t += sec; PLOG.l = sec }
    psave(); sessLive() }
  function weekSec() { var n = new Date(), m0 = +new Date(n.getFullYear(), n.getMonth(), n.getDate() - (n.getDay() + 6) % 7);
    return PLOG.s.reduce(function (a, x) { return a + Math.max(0, Math.min(x[1], +n) - Math.max(x[0], m0)) }, 0) / 1000 }
  function hmm(sec) { var m = Math.max(0, Math.floor(sec / 60)); return Math.floor(m / 60) + ':' + p2(m % 60) }
  window.__r154data = function () { if (!has('game') || PLOG.l == null) return null; return { s: hmm(PLOG.l), w: hmm(weekSec()), t: PLOG.t < 3600 ? '&lt;1' : String(Math.floor(PLOG.t / 3600)) } };
  window.__since = function () { if (!has('game') || !PLOG.e) return null;
    return { last: PLOG.e, notes: objs(DATA.news.notes).map(function (x) { return String(x.date || '') }), news: newsItems().map(function (x) { return String(x.date || '') }), ev: evs().map(function (x) { return x.s }) } };
  function sessLive() { var g = has('game'); liveSet(153, g && PLOG.e > 0); liveSet(154, g && PLOG.l != null);
    try { if (window.__r153) window.__r153() } catch (e) {} try { if (window.__r154) window.__r154() } catch (e) {} }

  /* ---------- R155: the news and week zones say loading / empty / could not load; RETRY runs the real fetch. The week is never "empty": its strip says NO EVENTS ---------- */
  function r155mode(z) { if (LOADING[z]) return 'loading'; if (z === 'news') return newsItems().length ? 'ok' : SRC.news ? 'empty' : 'fail'; return SRC.events ? 'ok' : 'fail' }
  var R155Q = false;
  function r155sync() { if (R155Q || typeof window.__r155 !== 'function') return; var c = window.__r155(); if (!c) return;
    ['news', 'events'].forEach(function (z) { var m = r155mode(z); if (c[z] !== m) window.__r155(z, m) }) }
  window.__r155load = function (z, cb) { if (z !== 'news' && z !== 'events') return; LOADING[z] = true;
    getZone(z).then(function (r) { takeZ(z, r) }).then(function () {
      LOADING[z] = false; R155Q = true; try { applyData() } finally { R155Q = false }
      var m = r155mode(z); if (cb) cb(m); r155sync() }) };

  /* ---------- texts that used to be fiction ---------- */
  function fmtGame(g) { g = String(g || ''); return /^\d{10}$/.test(g) ? g.slice(0, 4) + '.' + g.slice(4, 6) + '.' + g.slice(6, 8) + '-' + g.slice(8) : g }
  /* login answers (hud.server) but the world itself is down (status.online from the API) */
  function gameDown() { return !!(STAT && STAT.ok && STAT.online === false) }
  function buildLabel() { return INFO.game ? fmtGame(INFO.game) : (INFO.launcher || '—') }
  /* A-135: the server probe is a TCP connect to the game port; when the PC itself has no connection (the browser says so, or the launcher's own page data could not be fetched either) the player is told to check the connection, not that Omegamon is down */
  function noNet() { return NET.server === false && !gameDown() && (navigator.onLine === false || NETFAIL) }
  addEventListener('online', function () { NETFAIL = false; soon() }); addEventListener('offline', function () { soon() });
  function srvLine() {
    if (noNet()) return tx('NO INTERNET', 'SEM INTERNET');
    if (NET.server === false || gameDown()) return tx('OFFLINE', 'OFFLINE');
    if (STAT && STAT.ok && STAT.maintenance) return tx('MAINTENANCE', 'MANUTENÇÃO');
    if (NET.server == null) return tx('CHECKING…', 'A VERIFICAR…');
    var a = ['ONLINE']; if (NET.ms != null) a.push(NET.ms + ' MS');
    if (STAT && STAT.ok && STAT.players != null) a.push(STAT.players + ' ' + tx('PLAYING', 'A JOGAR'));
    return a.join(' · ');
  }
  function rows() {
    var b = buildLabel(), st = NET.status || '';
    var E = T.ST.en, P = T.ST.pt;
    E.checking = ['CONNECTING TO OMEGAMON', 'BUILD ' + b, 'Checking the server. You can already press PLAY.', 'PLAY', ''];
    P.checking = ['A LIGAR AO OMEGAMON', 'VERSÃO ' + b, 'A verificar o servidor. Já podes carregar em JOGAR.', 'JOGAR', ''];
    /* a result (repair finished, a failure) takes the status line of READY for 2 min; it is part of the row, so the bar is written once */
    if (DONE && Date.now() - DONEAT > 120000) DONE = null;
    E.ready = ['READY TO PLAY', 'BUILD ' + b, DONE ? esc(DONE.en) : 'Every PLAY checks your files against the server.', 'PLAY', ''];
    P.ready = ['PRONTO A JOGAR', 'VERSÃO ' + b, DONE ? esc(DONE.pt) : 'Cada JOGAR verifica os ficheiros com o servidor.', 'JOGAR', ''];
    var lp = playPct(), lt = PLAYP ? esc(playText()) : '';
    E.launching = ['STARTING TERMINUS', lp >= 0 ? lp + '%' : '', lt || esc(st) || 'Checking files, then the game opens.', 'PLAY', 'STARTING'];
    P.launching = ['A INICIAR O TERMINUS', lp >= 0 ? lp + '%' : '', lt || esc(st) || 'A verificar os ficheiros; depois o jogo abre.', 'JOGAR', 'A INICIAR'];
    var inTray = has('tray');
    E.running = ['TERMINUS IS RUNNING', 'SESSION 0:00:00', inTray ? 'The launcher waits by the clock until you leave the game.' : 'The launcher waits minimised until you leave the game.', 'IN GAME', ''];
    P.running = ['O TERMINUS ESTÁ A CORRER', 'SESSÃO 0:00:00', inTray ? 'O launcher espera junto ao relógio até saíres do jogo.' : 'O launcher espera minimizado até saíres do jogo.', 'EM JOGO', ''];
    var down = STAT && STAT.ok && STAT.maintenance;
    E.offline = [down ? 'OMEGAMON IS IN MAINTENANCE' : 'OMEGAMON IS OFFLINE', down ? 'MAINTENANCE' : 'NO ANSWER', down ? 'Press PLAY when the server is back.' : 'No answer. Checking every 5 s; PLAY still works.', 'PLAY', ''];
    P.offline = [down ? 'OMEGAMON ESTÁ EM MANUTENÇÃO' : 'OMEGAMON ESTÁ OFFLINE', down ? 'MANUTENÇÃO' : 'SEM RESPOSTA', down ? 'Carrega em JOGAR quando o servidor voltar.' : 'Sem resposta. A verificar a cada 5 s; podes JOGAR.', 'JOGAR', ''];
    if (noNet()) {
      E.offline = ['NO INTERNET CONNECTION', 'NO NETWORK', 'Check your connection. PLAY still tries; the server decides.', 'PLAY', ''];
      P.offline = ['SEM LIGAÇÃO À INTERNET', 'SEM REDE', 'Verifica a tua ligação. O JOGAR continua a tentar.', 'JOGAR', ''];
    }
    T.ERR.en.offline = E.offline; T.ERR.pt.offline = P.offline;
    var nm = STAT && STAT.ok && STAT.nextMaintenance ? new Date(STAT.nextMaintenance) : null, t = nm && !isNaN(nm) ? hm(nm) : '';
    E.maint = ['MAINTENANCE AT ' + t, 'BUILD ' + b, 'Play until ' + t + '; save before then, the server stops.', 'PLAY', ''];
    P.maint = ['MANUTENÇÃO ÀS ' + t, 'VERSÃO ' + b, 'Podes jogar até às ' + t + '; grava antes, o servidor para.', 'JOGAR', ''];
    if (REP) {
      var pct = REP.phase === 'hash' ? (REP.total ? Math.floor(REP.files / REP.total * 100) : 0) : (REP.totalBytes ? Math.floor(REP.bytes / REP.totalBytes * 100) : 0);
      var nf = function (x) { return (x || 0).toLocaleString('fr-FR') };
      /* A-102: a repair the exe has not reported on for a minute says it is still working (it never unlocks the bar by itself: only the exe's done/error does) */
      var stall = !REP.local && repSeen && Date.now() - repSeen > 60000;
      var dlt = function (lg) { return mbl(REP.bytes || 0, lg) + ' / ' + mbl(REP.totalBytes || 0, lg) + ' MB' + (REP.speed ? ' · ' + mbl(REP.speed, lg) + ' MB/s' : '') + (REP.eta != null ? etaL(REP.eta, lg) : '') + (stall ? (lg === 'pt' ? ' · ainda a trabalhar' : ' · still working') : '') };
      E.verify = ['VERIFYING FILES', pct + '%', nf(REP.files) + ' / ' + nf(REP.total) + ' checked' + (stall ? ' · still working' : ''), 'PLAY', 'LOCKED'];
      P.verify = ['A VERIFICAR FICHEIROS', pct + '%', nf(REP.files) + ' / ' + nf(REP.total) + ' verificados' + (stall ? ' · ainda a trabalhar' : ''), 'JOGAR', 'BLOQUEADO'];
      E.dl = ['REPAIRING ' + nFiles(REP.bad || 0, 'en').toUpperCase(), pct + '%', dlt('en'), 'PLAY', 'LOCKED'];
      P.dl = ['A REPARAR ' + nFiles(REP.bad || 0, 'pt').toUpperCase(), pct + '%', dlt('pt'), 'JOGAR', 'BLOQUEADO'];
      T.PCT.verify = pct; T.PCT.dl = pct;
    }
    T.PCT.launching = Math.max(0, playPct());
    T.SRV.en[0] = T.SRV.pt[0] = srvLine(); T.SRV.en[1] = T.SRV.pt[1] = srvLine();
    /* A-134: CANCEL appears only when the exe advertises the 'cancel' command (it does not yet: needs the host); a cancelled sync keeps its partial files and resumes next time */
    var cx = has('cancel'); window.__cancelCap = cx;
    T.MIN.en.running = T.MIN.pt.running = null; T.MIN.en.dl = T.MIN.en.verify = T.MIN.en.launching = cx ? ['CANCEL'] : null; T.MIN.pt.dl = T.MIN.pt.verify = T.MIN.pt.launching = cx ? ['CANCELAR'] : null;
    if (!cx) { delete T.MIN.en.launching; delete T.MIN.pt.launching }
    T.setBuild(b);
  }

  /* ---------- which state the bar shows ---------- */
  function want() {
    if (GAME) return 'running';
    if (REP && (REP.phase === 'hash')) return 'verify';
    if (REP && REP.phase === 'download') return 'dl';
    if (PLAYING) return 'launching';
    if (NET.server === false || gameDown() || (STAT && STAT.ok && STAT.maintenance)) return 'offline';
    if (NET.server == null && !STAT) return host ? 'checking' : 'ready';
    var nm = STAT && STAT.ok && STAT.nextMaintenance ? +new Date(STAT.nextMaintenance) - Date.now() : NaN;
    if (nm > 0 && nm < 86400000) return 'maint';
    return 'ready';
  }
  function render() {
    rows(); var s = want(), nm = STAT && STAT.ok && STAT.nextMaintenance ? (+new Date(STAT.nextMaintenance) - Date.now()) / 1000 : NaN;
    if (s === 'maint' && !isNaN(nm)) { var at0 = new Date(Date.now() + nm * 1000), td0 = at0.toDateString() === new Date().toDateString(), h0 = hm(at0);
      try { T.Y.D({ 'mt.1': [(td0 ? 'TODAY ' : 'TOMORROW ') + h0, (td0 ? 'HOJE ÀS ' : 'AMANHÃ ÀS ') + h0], 'mt.24': ['TOMORROW ' + h0, 'AMANHÃ ÀS ' + h0], 'mt.bar24': ['MAINTENANCE TOMORROW AT ' + h0, 'MANUTENÇÃO AMANHÃ ÀS ' + h0] }) } catch (e) {}
      T.setM(Math.floor(nm)); T.setMv('m1') }
    if (T.S !== s || ['launching', 'verify', 'dl', 'ready', 'offline', 'maint'].indexOf(s) >= 0) T.state(s);
    if (s === 'running') { var pr = $('psub'), rt = T.ST[L()].running[2]; if (pr && pr.textContent !== rt) pr.textContent = rt }
    /* A-17: a status line that does not fit its one line carries the whole text as a tooltip */
    var pq = $('psub'); if (pq) { if (pq.scrollWidth > pq.clientWidth + 1) { if (pq.title !== pq.textContent) pq.title = pq.textContent } else if (pq.hasAttribute('title')) pq.removeAttribute('title') }
    if (s === 'launching') world();
    if ((s === 'dl' || s === 'verify') && $('gpc')) $('gpc').textContent = T.PCT[s];
    if (s === 'maint' && !isNaN(nm)) { var at = new Date(Date.now() + nm * 1000), today = at.toDateString() === new Date().toDateString(), h = hm(at);
      try { T.Y.D({ 'mt.1': [(today ? 'TODAY ' : 'TOMORROW ') + h, (today ? 'HOJE ÀS ' : 'AMANHÃ ÀS ') + h], 'mt.24': ['TOMORROW ' + h, 'AMANHÃ ÀS ' + h], 'mt.bar24': ['MAINTENANCE TOMORROW AT ' + h, 'MANUTENÇÃO AMANHÃ ÀS ' + h] }); T.nt() } catch (e) {} }
    $('sr2') && ($('sr2').textContent = srvLine());
    var sd = $('sd'); if (sd) sd.className = 'd' + (NET.server === false || gameDown() ? ' off' : NET.server == null ? ' wait' : '');
    try { a11yAnnounce() } catch (e) {}
  }
  /* A-132: while the exe has sent no progress yet the CHECKING value counts the seconds, so a slow start does not look frozen */
  function waitTxt() { var s = playAt ? Math.floor((Date.now() - playAt) / 1000) : 0; return s >= 3 ? ' · ' + Math.floor(s / 60) + ':' + p2(s % 60) : '' }
  setInterval(function () { if (T.S !== 'launching' || !PLAYING || playPct() >= 0) return; var v = document.querySelector('.world .wl .stg:not(.wait) .v'); if (v) { var t = tx('CHECKING', 'A VERIFICAR') + waitTxt(); if (v.textContent !== t) v.textContent = t } }, 1000);
  /* the "entering the world" panel shows the exe's real progress, not a shader count */
  function world() {
    var w = document.querySelector('.world .wl'); if (!w) return;
    var pp = playPct(), pct = pp >= 0 ? pp : 0, b1 = '', b2 = '';
    for (var i = 0; i < 24; i++) { b1 += '<i' + (i < pct / 100 * 24 ? ' class="l"' : '') + '></i>'; b2 += '<i></i>' }
    var wh = '<div class="eb">' + tx('PLAY · BUILD ', 'JOGAR · VERSÃO ') + esc(buildLabel()) + '</div><h2>' + tx('Entering the<br>Digital World', 'A entrar no<br>Mundo Digital') + '</h2>' +
      '<div class="stg' + (pct >= 100 ? ' done' : '') + '"><span>' + tx('FILES', 'FICHEIROS') + '</span><div class="bars">' + b1 + '</div><span class="v">' + (pp >= 0 ? pct + '%' : tx('CHECKING', 'A VERIFICAR') + waitTxt()) + '</span></div>' +
      '<div class="stg wait"><span>' + tx('CLIENT', 'CLIENTE') + '</span><div class="bars">' + b2 + '</div><span class="v">' + tx('NEXT', 'A SEGUIR') + '</span></div>' +
      '<div class="nt">' + (esc(playText()) || esc(NET.status) || tx('Every file is checked against the server, then the game opens.', 'Cada ficheiro é verificado com o servidor e depois o jogo abre.')) + '</div>' +
      (has('cancel') ? '<button class="ib" id="wcx">' + tx('CANCEL', 'CANCELAR') + '</button>' : '');
    /* a11y: an unchanged panel is not rewritten, and a rewrite keeps keyboard focus on CANCEL */
    if (w.__wh === wh && w.firstElementChild) return; w.__wh = wh;
    var hadF = document.activeElement && document.activeElement.id === 'wcx'; w.innerHTML = wh;
    if (hadF && $('wcx')) $('wcx').focus({ focusVisible: true });
  }
  /* the cinematic ends: show the state the exe says we are in (the game may already be running) */
  window.__prodGo = function () { if (GAME) T.state('running'); else if (PLAYING) { T.state('launching'); world() } else render() };
  var _rt = 0; function soon() { if (_rt) return; _rt = setTimeout(function () { _rt = 0; render() }, 60) }

  /* ---------- the bridge ---------- */
  if (host) host.addEventListener('message', function (ev) {
    var m = ev.data; if (!m || typeof m !== 'object') return;
    if (m.t === 'hud') {
      /* every exe re-sends hud every 5 s with an unchanged status: only a CHANGE is a sign of life for a pending PLAY */
      /* the exe's own housekeeping lines are not for players ("Ready", the local-page notice) */
      var nst = /^(ready|visual page override)/i.test(m.status || '') ? '' : (m.status || ''), npr = typeof m.progress === 'number' ? m.progress : -1;
      if (PLAYING && (nst !== NET.status || npr !== NET.progress)) sigAt = Date.now();
      NET.server = m.server; NET.status = nst; NET.progress = npr;
      if (typeof m.ms === 'number') { NET.ms = m.ms; MSH.push(m.ms); if (MSH.length > 24) MSH.shift() } else if (m.server === false) NET.ms = null;
      if (!CAPS && m.build) INFO.launcher = m.build;
      /* an exe that sends hud.err says explicitly whether the status is a failure (its texts are pt/en player messages now);
         only an older exe without the flag is still guessed from its English text */
      var bad = typeof m.err === 'boolean' ? m.err : /fail|error|refused|could not|não/i.test(NET.status);
      if (bad && NET.status) { LASTERR = NET.status; if (PLAYING && NET.progress < 0) { PLAYING = false; setDone(NET.status); toastRes('pl', NET.status); askBuild() } }
      soon();
    } else if (m.t === 'caps') {
      if (buildAsks) { buildAsks--; INFO.game = m.game || null; soon(); return }
      CAPS = Array.isArray(m.caps) ? m.caps : []; INFO.launcher = m.launcher || INFO.launcher; INFO.game = m.game || null; lastPlayed();
      /* a game that ended while this page watched closes the session; one that ended unseen (launcher killed, closed on start) drops its open start */
      if (typeof m.running === 'boolean') { var wasG = GAME; GAME = m.running; if (!GAME && wasG) sessClose(); else if (!GAME && PLOG.o) { PLOG.o = 0; psave() } }
      /* A-32: the SESSION clock counts from the real start (this page saw it, or its stored start); a game adopted with no known start shows no number */
      T.setSessStart(GAME && PLOG.o ? PLOG.o : null);
      if (has('bgupdate')) post('bgupdate:get'); else liveSet(156, false);
      sessLive();
      W.classList.add('caps2'); W.classList.toggle('capcompact', has('compact')); supportBtns();
      if (has('overlays')) post('overlays:html');
      if (has('size')) post('size:1280x720');
      if (has('status')) post('status:html');
      if (has('tray')) post('lang:' + L());
      lverNotice(); soon();
    } else if (m.t === 'status') {
      STAT = m; takeAt(m); liveSet(148, !!SRV); soon(); T.wk(weekModel());
    } else if (m.t === 'repair') {
      REP = m.phase === 'done' || m.phase === 'error' ? null : m; repSeen = Date.now();
      if (m.phase === 'done') try { T.Y.chime && T.Y.chime('done') } catch (x) {}
      if (m.phase === 'done') {
        var nfx = m.fixed || 0, nfl = m.failed || 0;
        if ((m.bad || 0) === 0) setDone('Repair finished: every file is intact.', 'Reparação concluída: todos os ficheiros estão bem.');
        else if (nfl) setDone(nfx + ' repaired, ' + nfl + (nfl === 1 ? ' still fails' : ' still fail') + '. Try again.', nfx + ' reparados, ' + nfl + (nfl === 1 ? ' ainda falha' : ' ainda falham') + '. Tenta de novo.');
        else setDone(nFiles(nfx, 'en') + ' repaired. Ready to play.', nFiles(nfx, 'pt') + (nfx === 1 ? ' reparado' : ' reparados') + '. Pronto a jogar.');
        toastRes(nfl ? 'er' : 'ok', DONE[L()]);
      }
      if (m.phase === 'error') { /* m.msg is player text only from an exe that sends m.code; an older exe's msg is its raw English log line */
        if (m.code && m.msg) setDone(m.msg); else setDone('Repair could not run. Details in Settings › Support.', 'A reparação não correu. Detalhes em Definições › Suporte.');
        toastRes('er', DONE[L()]); LASTERR = 'repair: ' + (m.msg || 'unknown'); var dg0 = $('diag'); if (dg0) dg0.textContent = diagText(); }
      soon();
    } else if (m.t === 'play') {
      /* the exe checks (and if needed downloads) files before the game starts: real progress, a sign of life */
      PLAYP = m; sigAt = Date.now(); if (!PLAYING) PLAYING = true; soon();
    } else if (m.t === 'game') {
      var wasR = GAME; GAME = !!m.running; PLAYING = false; PLAYP = null;
      if (GAME && !wasR) { sessOpen(); askBuild() } else if (!GAME && wasR) sessClose();
      if (GAME) { T.setSessStart(PLOG.o || Date.now()); store('last', String(Date.now())); lastPlayed(); var cl = closeOnStart(); if (cl) setTimeout(function () { post(has('quit') ? 'quit' : 'close') }, 400) }
      soon();
    } else if (m.t === 'bgupdate') {
      /* R156 page part: inert until an exe that sends the bgupdate cap reports its mode and last result (no exe does yet) */
      if (!has('bgupdate')) return;
      var la = m.last && typeof m.last === 'object' ? m.last : null;
      if (la && la.result === 'applied' && String(la.to) !== String(INFO.game || '') && la.to + '|' + la.at !== bgAsked) { bgAsked = la.to + '|' + la.at; askBuild() }
      liveSet(156, true);
      try { if (window.__r156msg) window.__r156msg({ mode: /^(off|on|night)$/.test(m.mode) ? m.mode : 'off', last: la ? { result: String(la.result || ''), to: esc(fmtGame(la.to)), nv: /^\d{10}$/.test(String(la.to)) ? String(la.to).slice(6) : '', seen: !!la.seen } : null }) } catch (e) {}
    }
  });

  /* CANCEL (A-134): a new bridge command, so the page asks only when the exe advertised it; it then shows the idle bar at once and the exe confirms with its own messages */
  function doCancel() { post('cancel'); REP = null; PLAYING = false; PLAYP = null;
    setDone('Cancelled. What was downloaded is kept; it resumes next time.', 'Cancelado. O que foi transferido fica guardado; retoma da próxima vez.'); soon() }
  var mA = $('mA'); if (mA) mA.addEventListener('click', function (e) {
    var s = T.S; if (!has('cancel') || !(s === 'dl' || s === 'verify' || s === 'launching')) return;
    e.stopImmediatePropagation(); doCancel() }, true);
  /* the launch view hides the bar, so its own CANCEL sits under the status text */
  W.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#wcx') && has('cancel')) { e.stopImmediatePropagation(); doCancel() } }, true);
  /* PLAY: the page keeps its cinematic; the exe does the work */
  $('play').addEventListener('click', function (e) {
    var s = T.S;
    if (PLAYING) { if (window.__SK && window.__SK.busy && window.__SK.busy()) return; e.stopImmediatePropagation(); return }
    if (s === 'running' || s === 'verify' || s === 'dl' || s === 'launching') { e.stopImmediatePropagation(); return }
    /* offline and maintenance are advice from probes that can be wrong: PLAY always reaches the exe, the server decides */
    PLAYING = true; PLAYP = null; playAt = sigAt = Date.now(); setDone(null); post('play'); setTimeout(soon, 50);
    /* only ready/maintenance get the cinematic; any other state goes straight to launching */
    if (s !== 'ready' && s !== 'maint') { e.stopImmediatePropagation(); T.state('launching'); world() }
  }, true);
  /* keyboard: PLAY goes through the same click as the mouse (posts play); demo-only keys and the command palette are gone */
  addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey) { if (e.key && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopImmediatePropagation() } return }
    if (e.altKey) return;
    var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
    var k = (e.key || '').toLowerCase();
    if (k === 'i' || k === 'd' || k === 'p') { e.stopImmediatePropagation(); return }
    var open = W.classList.contains('sheetopen') || W.classList.contains('notesopen') || W.classList.contains('keysopen') || W.classList.contains('artopen') || (T.Y.cur && T.Y.cur());
    if ((e.key === 'Enter' && (e.target === document.body || e.target.id === 'play')) || (e.key === ' ' && e.target.id === 'play')) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!open) $('play').click();
    }
  }, true);
  /* a PLAY that hears nothing (old exe, a click the exe ignored, a reloaded page) gives the bar back 12 s after the last sign of life */
  var playAt = 0, sigAt = 0;
  /* A-31: once the exe has reported checking or downloading, a quiet minute (one big file hashing on a slow disk) is still work; 12 s stays for "no sign at all" */
  setInterval(function () { if (PLAYING && Date.now() - sigAt > (PLAYP && (PLAYP.phase === 'hash' || PLAYP.phase === 'download') ? 60000 : 12000)) { PLAYING = false; PLAYP = null; soon() } }, 1000);

  /* window controls */
  function byLabel(re) { return [].filter.call(document.querySelectorAll('#win button'), function (b) { return re.test(b.getAttribute('aria-label') || '') }) }
  byLabel(/^Close$/).forEach(function (b) { b.addEventListener('click', function (e) { e.stopImmediatePropagation(); post('close') }, true) });
  byLabel(/^Minimi[sz]e$/).forEach(function (b) { b.addEventListener('click', function (e) { e.stopImmediatePropagation(); if (has('minimize')) post('minimize') }, true) });
  /* A-108: the exe opens only https://discord.gg|discord.com/<up to 64 letters, digits, / _ ->, 100 characters at most (HtmlPanel.cs open-url): a link it would refuse leaves no dead button */
  function okDiscord(u) { return typeof u === 'string' && u.length <= 100 && /^https:\/\/(discord\.gg|discord\.com)\/[A-Za-z0-9\/_-]{1,64}$/.test(u) }
  document.querySelectorAll('.comm a').forEach(function (b) { b.addEventListener('click', function (e) { e.stopImmediatePropagation(); e.preventDefault(); var u = (DATA.news.links || {}).discord; if (okDiscord(u) && has('open-url')) post('open-url ' + u) }, true) });

  /* settings rows with no backing in the exe are removed, not left as dead switches */
  [].forEach.call(document.querySelectorAll('#sheet .sh-g'), function (g) { var gl = g.querySelector('.gl'); if (gl && /^GAME/.test(gl.getAttribute('data-en') || gl.textContent)) g.classList.add('prod-off') });
  [].forEach.call(document.querySelectorAll('#sheet .sh-o'), function (r) { if (/Download limit|Install folder|Limite de transfer|Pasta de instala/.test(r.textContent)) r.classList.add('prod-off') });
  [].forEach.call(document.querySelectorAll('#sheet *'), function (e) { if (e.children.length === 0 && /^Game settings are saved|^As definições do jogo/.test(e.textContent)) e.classList.add('prod-off') });
  var sidx = document.getElementById('sidx'); if (sidx) new MutationObserver(function () { [].forEach.call(sidx.querySelectorAll('button'), function (b) { if (/^GAME|^JOGO/.test(b.textContent)) b.classList.add('prod-off') }) }).observe(sidx, { childList: true });

  /* drag the window from any quiet part of the page — only once the mouse MOVES, so a click or a
     double-click (compact) on the top strip still reaches the page; the exe's native move loop
     would otherwise swallow it */
  var dragFrom = null;
  W.addEventListener('mousemove', function (e) {
    if (!dragFrom || !(e.buttons & 1)) { dragFrom = null; return }
    if (Math.abs(e.screenX - dragFrom[0]) + Math.abs(e.screenY - dragFrom[1]) > 4) { dragFrom = null; post('drag') }
  });
  addEventListener('mouseup', function () { dragFrom = null });
  W.addEventListener('mousedown', function (e) {
    dragFrom = null;
    if (e.button !== 0) return;
    if (e.target.closest('button,a,u,input,select,textarea,label,[role=button],[tabindex],[onclick],.rd,#rdl,#tkback,.back,.sheet,.notes,.stcard,.ynot,#rail,.cats,#ywk,.minor,.srv,.prog,.actwrap,.ylo,.take,.report,#story h1,#story p')) return;
    for (var el = e.target; el && el !== W; el = el.parentElement) if (getComputedStyle(el).cursor === 'pointer') return;
    dragFrom = [e.screenX, e.screenY];
  });

  /* repair: VERIFY and REPAIR in Settings, and the minor buttons */
  /* the exe stays silent when it ignores a repair (busy, game running): give the bar back after 6 s of silence */
  var repAt = 0;
  function startRepair() { if (!has('repair') || GAME || PLAYING || REP) return; REP = { phase: 'hash', files: 0, total: 0, local: 1 }; repAt = Date.now(); repSeen = 0; setDone(null); T.sheet(false); post('repair'); soon() }
  setInterval(function () { if (REP && REP.local && Date.now() - repAt > 6000 && !/verif/i.test(NET.status)) { REP = null;
    var t1 = 'Repair did not start. Try again in a moment.', t2 = 'A reparação não arrancou. Tenta outra vez daqui a pouco.';
    setDone(t1, t2); toastRes('er', tx(t1, t2)); soon() } }, 1000);
  document.querySelectorAll('.sh-a button').forEach(function (b) {
    var en = b.getAttribute('data-en') || b.textContent;
    if (/VERIFY|REPAIR/.test(en)) b.addEventListener('click', function (e) { e.stopImmediatePropagation(); startRepair() }, true);
    if (/OPEN FOLDER/.test(en)) b.classList.add('prod-off');
  });

  /* A-28 / A-29: Settings > Support gets CREATE ERROR REPORT (the exe's existing "report" message; it saves the report and shows it in Explorer) and QUIT LAUNCHER (the existing "quit"),
     each only when the exe says it has the feature. The exe does not advertise "report" yet, so it follows "repair", the cap of the exes that accept both messages (needs host: a "report" cap). */
  function supportBtns() {
    var row = document.querySelector('#sheet .sh-g.support .sh-a'); if (!row) return;
    function add(id, en, ptt, on, msg) {
      var b = $(id); if (!on) { if (b) b.remove(); return } if (b) return;
      b = document.createElement('button'); b.id = id; b.setAttribute('data-en', en); b.setAttribute('data-pt', ptt); b.textContent = tx(en, ptt);
      b.addEventListener('click', function (e) { e.stopImmediatePropagation(); post(msg) }, true); row.appendChild(b) }
    add('drep', 'ERROR REPORT', 'RELATÓRIO DE ERRO', has('repair'), 'report');
    add('dquit', 'QUIT LAUNCHER', 'SAIR DO LAUNCHER', has('quit'), 'quit') }

  /* close-on-start toggle (page-side; the exe minimises by itself) */
  function closeOnStart() { var lab = document.querySelector('#sheet [data-en="Close when the game starts"]'), o = lab && lab.closest('.sh-o'), t = o && o.querySelector('.tg'); return !!(t && t.classList.contains('on')) }

  /* last played */
  function lastPlayed() {
    var v = +store('last'), el = $('ylp');
    var txt, en; if (!v) { txt = tx('FIRST TIME HERE', 'PRIMEIRA VEZ AQUI'); en = 'FIRST TIME HERE' }
    else { var d = new Date(v), n = new Date(), y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1); txt = tx('LAST PLAYED · ', 'ÚLTIMO JOGO · ') + (d.toDateString() === n.toDateString() ? tx('TODAY ', 'HOJE ') : d.toDateString() === y.toDateString() ? tx('YESTERDAY ', 'ONTEM ') : p2(d.getDate()) + ' ' + MON[L()][d.getMonth()] + ' ') + hm(d) }
    if (!en) en = txt.replace(/^ÚLTIMO JOGO · /, 'LAST PLAYED · ').replace(/HOJE /, 'TODAY ').replace(/ONTEM /, 'YESTERDAY ').replace(/ (\d\d) (FEV|ABR|MAI|AGO|SET|OUT|DEZ) /, function (a, d, mo) { return ' ' + d + ' ' + MON.en[MON.pt.indexOf(mo)] + ' ' });
    var pt = !v ? 'PRIMEIRA VEZ AQUI' : en.replace(/^LAST PLAYED · /, 'ÚLTIMO JOGO · ').replace(/TODAY /, 'HOJE ').replace(/YESTERDAY /, 'ONTEM ');
    try { T.Y.D({ 'lo.last': [en, pt] }) } catch (e) {}
    if (el) { el.textContent = txt; el.classList.toggle('first', !v) }
    firstRun(!v && !!CAPS && !INFO.game);
  }
  /* A-94: the first-run texts (R160-R162) are for a launcher that has never started the game on this PC: no last-played stamp here AND no installed
     build marker from the exe (an upgrade install has one, a fresh unzip has none). The stamp is written when the game starts, which ends it. */
  function firstRun(on) { if (!!window.TD_FIRST === on) return; window.TD_FIRST = on; ['__first160', '__first162'].forEach(function (f) { try { if (typeof window[f] === 'function') window[f]() } catch (e) {} }) }

  /* launcher-updated notice: only when the exe's version changed since this player last saw it */
  function lverNotice() {
    var v = INFO.launcher; if (!v) return; T.setLver(v);
    var seen = store('lver'); if (!seen) { store('lver', v); seen = v }
    if (seen !== v) W.classList.add('ribbonon'); else W.classList.remove('ribbonon');
    T.nt();
  }
  /* A-96: the notice box is drawn after this runs, so its X is caught on the click itself (capture phase): the version closed is the one remembered */
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#ynx,#rbx') && INFO.launcher) store('lver', INFO.launcher) }, true);
  document.addEventListener('click', function (e) { var u = e.target.closest && e.target.closest('u[data-a=relnotes]'); if (u) { e.stopImmediatePropagation(); store('lver', INFO.launcher || ''); W.classList.remove('ribbonon'); T.nt(); T.notes(true) } }, true);

  /* the server card shows only what is measured (the demo redraws it on every state change: re-apply) */
  function stProd() {
    (function () {
      var c = $('stcard'); if (!c) return;
      var sp = '', mx = Math.max.apply(null, MSH.concat([1]));
      MSH.forEach(function (v) { sp += '<i' + (v > mx * 0.8 && MSH.length > 3 ? ' class="h"' : '') + ' style="height:' + Math.max(2, Math.round(v / mx * 16)) + 'px"></i>' });
      var nm = STAT && STAT.ok && STAT.nextMaintenance ? new Date(STAT.nextMaintenance) : null;
      c.innerHTML = '<h4 data-prod="1">Omegamon<span>● ' + esc(srvLine().split(' · ')[0]) + '</span></h4>' +
        '<div class="k"><span>' + tx('LATENCY', 'LATÊNCIA') + '</span><span class="spark">' + sp + '</span><b>' + (NET.ms != null ? NET.ms + ' MS' : '—') + '</b></div>' +
        '<div class="k"><span>' + tx('PLAYERS', 'JOGADORES') + '</span><span></span><b>' + (STAT && STAT.ok && STAT.players != null ? esc(STAT.players) : '—') + '</b></div>' +
        '<div class="k"><span>' + tx('MAINTENANCE', 'MANUTENÇÃO') + '</span><span></span><b>' + (nm && !isNaN(nm) ? p2(nm.getDate()) + ' ' + MON[L()][nm.getMonth()] + ' ' + hm(nm) : tx('NONE PLANNED', 'NENHUMA PREVISTA')) + '</b></div>';
    })();
  }
  var stBusy = false;
  if ($('stcard')) new MutationObserver(function () { if (stBusy || $('stcard').querySelector('[data-prod]')) return; stBusy = true; stProd(); stBusy = false }).observe($('stcard'), { childList: true });

  /* diagnostics: only facts the page knows */
  var GPU = null;
  function diagText() {
    if (GPU === null) { GPU = ''; try { var g = document.createElement('canvas').getContext('webgl'), x = g && g.getExtension('WEBGL_debug_renderer_info'); GPU = x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : ''; var lc = g && g.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext() } catch (e) {} }
    var gpu = GPU;
    return ['terminus ' + buildLabel() + ' · launcher ' + (INFO.launcher || '?'), 'server ' + (NET.server === false ? 'offline' : NET.ms != null ? NET.ms + ' ms' : '?') + ' · ' + L(),
      gpu ? 'gpu ' + gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 80) : '', LASTERR ? 'last error ' + LASTERR.slice(0, 120) : ''].filter(Boolean).join('\n');
  }
  var dg = $('diag'); if (dg) { new MutationObserver(function () { var t = diagText(); if (dg.textContent !== t) dg.textContent = t }).observe(dg, { childList: true, characterData: true, subtree: true }); dg.textContent = diagText() }

  /* language switches redraw what this layer owns */
  var lastLang = null;
  new MutationObserver(function () { var l = document.documentElement.lang; if (l === lastLang) return; lastLang = l;
    applyNews(); applyEvents(); lastPlayed(); render(); if ($('sr2')) $('sr2').textContent = srvLine(); if (has('tray')) post('lang:' + L()) }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  /* fill the 1280x720 design into whatever window the exe gives us */
  /* compact (double-click the top strip, or the compact icon): the window itself folds to the 212 px strip */
  var wasMini = false;
  new MutationObserver(function () {
    var m = W.classList.contains('mini'); if (m && !has('compact')) { W.classList.remove('mini'); return } if (m === wasMini) return; wasMini = m;
    /* fold/unfold without a stray frame: hide the canvas until the exe has resized the window, then refit and show */
    W.style.visibility = 'hidden';
    var want = m ? 212 : 720, done = false, show = function () { if (done) return; done = true; removeEventListener('resize', onR); fitProd(); requestAnimationFrame(function () { W.style.visibility = '' }) };
    var onR = function () { if (Math.abs(innerHeight / (innerWidth / 1280) - want) < 24) show() };
    addEventListener('resize', onR); setTimeout(show, 350);
    if (has('size')) post(m ? 'size:1280x212' : 'size:1280x720');
  }).observe(W, { attributes: true, attributeFilter: ['class'] });
  function fitProd() { var h = W.classList.contains('mini') ? 212 : 720, s = Math.min(innerWidth / 1280, innerHeight / h); W.style.transform = 'scale(' + s + ')'; W.style.transformOrigin = 'top left'; W.style.marginLeft = Math.max(0, (innerWidth - 1280 * s) / 2) + 'px'; W.style.marginTop = Math.max(0, (innerHeight - h * s) / 2) + 'px' }
  addEventListener('resize', function () { fitProd(); setTimeout(fitProd, 0) });

  function pager() { var g = $('pgn'), n = T.vis().length; if (g && n) g.textContent = ((T.vis().indexOf(curIdx()) + 1) || 1) + ' / ' + n }
  function curIdx() { var on = document.querySelector('#rail .ri.on'); return on ? +on.dataset.i : 0 }
  /* the hero clamps a long story (prod.css), so the panel carries it in full. The block follows the pressed version tab;
     opened from a story that has no notes entry (an older one), the panel shows that story alone until a tab is pressed */
  var LONE = null;
  function fillNews() {
    var nt = $('notes'), pv = $('pnv'); if (!nt || !pv) return;
    var tabs = [].slice.call(pv.children), k = tabs.findIndex(function (b) { return b.getAttribute('aria-pressed') === 'true' });
    var lone = LONE ? NEWSIDS.indexOf(LONE) : -1, note = objs(DATA.news.notes)[k], i = lone >= 0 ? lone : note ? NEWSIDS.indexOf(note.id) : -1, n = i >= 0 ? (T.NEWS[T.L] || [])[i] : null;
    var b = $('pnnews'); if (!b) { b = document.createElement('div'); b.id = 'pnnews'; nt.insertBefore(b, pv) }
    var html = n ? '<div class="eb">' + n.d + ' · ' + n.t + '</div><h3>' + n.h + '</h3><p>' + n.p + '</p>' : '';
    b.hidden = !n; if (b.innerHTML !== html) b.innerHTML = html;
    nt.classList.toggle('storyonly', lone >= 0);
    if (lone >= 0) tabs.forEach(function (t) { t.setAttribute('aria-pressed', 'false') });
  }
  function openedFromStory() {
    if (!W.classList.contains('notesopen')) return;
    var id = NEWSIDS[curIdx()], k = objs(DATA.news.notes).map(function (n) { return n.id }).indexOf(id), tab = $('pnv') && $('pnv').children[k];
    LONE = null; if (k >= 0 && tab) tab.click(); else LONE = id || null;
    fillNews();
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#pnv button')) { LONE = null; fillNews() }
  }, true);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#rdl')) openedFromStory() });
  addEventListener('keydown', function (e) {
    var tg = e.target && e.target.tagName;
    if ((e.key || '').toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && tg !== 'INPUT' && tg !== 'TEXTAREA' && !W.classList.contains('notesopen')) setTimeout(openedFromStory, 0);
  }, true);
  new MutationObserver(function () { if (W.classList.contains('notesopen')) fillNews(); else LONE = null }).observe(W, { attributes: true, attributeFilter: ['class'] });
  if ($('pnb')) new MutationObserver(fillNews).observe($('pnb'), { childList: true });
  /* the title keeps the shipped fit (fit-story shrinks it 2px a step, down to 30px, until the story clears the tabs);
     only a title still over 2 lines after that is cut to 2 (.long, plain wrapping before the ellipsis) */
  function clampTitle() { var h = document.querySelector('#story h1'); if (!h) return; h.classList.remove('long'); if (window.__fitStory) window.__fitStory();
    var lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.06; h.classList.toggle('long', h.offsetHeight > 2 * lh + 1) }
  if ($('story')) new MutationObserver(function () { setTimeout(pager, 0); setTimeout(clampTitle, 40) }).observe($('story'), { childList: true });
  new MutationObserver(function () { setTimeout(clampTitle, 40) }).observe(W, { attributes: true, attributeFilter: ['class', 'data-st'] });
  addEventListener('resize', function () { setTimeout(clampTitle, 0) });
  if ($('ph2')) $('ph2').addEventListener('click', function (e) {
    e.stopImmediatePropagation(); if (!this.classList.contains('er')) return;
    var t = this.textContent + ' · BUILD ' + buildLabel() + ' · ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    try { navigator.clipboard.writeText(t).catch(function () {}) } catch (x) {}
    this.textContent = tx('COPIED', 'COPIADO'); setTimeout(function () { soon() }, 1400);
  }, true);
  /* ---------- native pass (audit 2026-11-07): nothing from the demo is reachable ---------- */
  W.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#story h1')) { e.stopImmediatePropagation(); return }
    var r = t.closest('#rail .ri'); if (r && r.classList.contains('on')) { e.stopImmediatePropagation(); return }
  }, true);
  W.addEventListener('pointerdown', function (e) { if (e.target.closest('#dragbar')) e.stopImmediatePropagation() }, true);
  if ($('ph2')) { $('ph2').removeAttribute('role'); $('ph2').setAttribute('tabindex', '-1'); delete $('ph2').dataset.tip }
  addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    if (W.classList.contains('sheetopen') || W.classList.contains('notesopen') || W.classList.contains('keysopen') || (T.Y.cur && T.Y.cur())) return;
    var f = [].filter.call(W.querySelectorAll('button,[tabindex="0"],a[href],.comm a,[role=button]'), function (x) { if (x.tabIndex < 0 || x.closest('[inert],.prod-off') || (x.id === 'ph2' && !x.classList.contains('er'))) return false; var r = x.getBoundingClientRect(); if (!r.width || !r.height) return false; var c = getComputedStyle(x); return c.visibility !== 'hidden' && c.display !== 'none' });
    f.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.top - rb.top) > 12 ? ra.top - rb.top : ra.left - rb.left });
    if (!f.length) return; var i = f.indexOf(document.activeElement);
    var nx = e.shiftKey ? (i <= 0 ? f[f.length - 1] : f[i - 1]) : (i < 0 || i >= f.length - 1 ? f[0] : f[i + 1]);
    e.preventDefault(); e.stopImmediatePropagation(); nx.focus({ focusVisible: true });
  }, true);
  [].forEach.call(document.querySelectorAll('.keys .k'), function (k) { var kb = k.querySelector('kbd'), sp = k.querySelector('span'); if (!kb || !sp) return;
    var key = kb.textContent.trim();
    if (key === 'P' || key === 'I' || key === 'D' || /CTRL/.test(key)) k.remove();
    else if (key === 'ENTER') { sp.setAttribute('data-en', 'Play'); sp.setAttribute('data-pt', 'Jogar'); sp.textContent = tx('Play', 'Jogar') } });
  [].forEach.call(document.querySelectorAll('.sh-a button'), function (b) { var en = b.getAttribute('data-en') || b.textContent;
    if (/^VERIFY/.test(en)) b.classList.add('prod-off');
    if (/^REPAIR$/.test(en)) { b.setAttribute('data-en', 'VERIFY AND REPAIR'); b.setAttribute('data-pt', 'VERIFICAR E REPARAR'); b.textContent = tx('VERIFY AND REPAIR', 'VERIFICAR E REPARAR') } });
  [].forEach.call(document.querySelectorAll('#sheet [data-en]'), function (e) { var en = e.getAttribute('data-en');
    if (en === 'Update finished') { e.setAttribute('data-en', 'Repair finished'); e.setAttribute('data-pt', 'Reparação concluída'); e.innerHTML = tx('Repair finished', 'Reparação concluída') }
    if (/^build, system, GPU/.test(en)) { e.setAttribute('data-en', 'build, server, GPU and last error; never account, chat or names'); e.setAttribute('data-pt', 'versão, servidor, GPU e último erro; nunca conta, chat ou nomes'); e.innerHTML = tx(e.getAttribute('data-en'), e.getAttribute('data-pt')) } });
  [].forEach.call(document.querySelectorAll('.keys .nt'), function (n) { n.setAttribute('data-en', 'TAB moves between controls; focus is a gold outline. ? shows this list.'); n.setAttribute('data-pt', 'TAB passa de controlo em controlo; o foco é um contorno dourado. ? mostra esta lista.'); n.innerHTML = tx(n.getAttribute('data-en'), n.getAttribute('data-pt')) });
  /* settings section numbers count only the sections that are shown (01 LAUNCHER, not 02) */
  function renum() { var i = 0; [].forEach.call(document.querySelectorAll('#sheet .sh-g'), function (g) { var gl = g.querySelector('.gl'); if (!gl || g.classList.contains('prod-off')) return; var n = '0' + (++i); if (gl.getAttribute('data-n') !== n) gl.setAttribute('data-n', n) }) }
  renum(); [].forEach.call(document.querySelectorAll('#sheet .sh-g .gl'), function (gl) { new MutationObserver(renum).observe(gl, { attributes: true, attributeFilter: ['data-n'] }) });
  try { T.Y.D({ 'dg.ok.b': ['Ready to paste into a support message.', 'Pronto a colar numa mensagem de suporte.'] }) } catch (e) {}
  if (sidx) new MutationObserver(function () { var G = document.querySelectorAll('#sheet .sh-g');
    [].forEach.call(sidx.querySelectorAll('button[data-g]'), function (b) { var g = G[+b.dataset.g], n = b.querySelector('b'); if (!g || !n) return;
      var c = [].filter.call(g.querySelectorAll('.sh-o'), function (o) { return !o.classList.contains('prod-off') }).length; if (n.textContent !== String(c)) n.textContent = c }) }).observe(sidx, { childList: true, subtree: true, characterData: true });

  /* A-104: each stage on its own, so one bad entry in a data file never skips the rest (events, discord link, the bar) */
  function applyData() { try { [applyNotes, applyNews, applyEvents, function () { W.classList.toggle('nodiscord', !okDiscord((DATA.news.links || {}).discord)) }, render].forEach(function (f) { try { f() } catch (e) {} }); liveSet(149, true) } finally { r155sync(); sessLive() } }

  /* warm the settings sheet once, invisibly, so its first open slides at once (it stalled ~460 ms) */
  (window.requestIdleCallback || function (f) { setTimeout(f, 1200) })(function () {
    var sh = $('sheet'); if (!sh || W.classList.contains('sheetopen')) return;
    W.classList.add('prewarm'); T.sheet(true); void sh.offsetHeight; sh.querySelectorAll('*').length; T.sheet(false); void sh.offsetHeight; W.classList.remove('prewarm');
  }, { timeout: 3000 });

  /* boot: the legacy handshake first, so every exe version hides its own buttons and HUD */
  document.documentElement.classList.add('prod');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  /* A-69 (page side): the handshake the exe waits for (controls:html, hud:html, ready) is sent even when a boot step throws, so a half-drawn page never leaves the exe's native buttons parked */
  try {
    try { T.round(T.R) } catch (e) {}
    W.classList.remove('ribbonon', 'takeover', 'mini', 'big');
    applyData(); lastPlayed(); world(); fitProd(); setTimeout(fitProd, 300);
  } catch (e) { try { fitProd() } catch (x) {} }
  post('controls:html'); post('hud:html');
  /* ready: the exe keeps its window hidden until the first real frame is painted (no legacy flash) */
  (function () {
    var sent = false;
    /* no requestAnimationFrame: the exe keeps the window at opacity 0 here, and rAF may not run */
    function go() { if (sent) return; sent = true; setTimeout(function () { post('ready') }, 30) }
    if (document.readyState === 'complete') go(); else addEventListener('load', go);
    setTimeout(go, 2500);
  })();
  /* A-20/A-120: park the ambient animation (class still120, see prod.css) while the page is hidden, the window has lost focus (after 5 s of no input there) or nothing was touched for 60 s;
     any input brings it back. Never during a download, verify, install or launch (their "charged" look is meant to move). Costs nothing while parked: no timer runs. */
  (function () {
    var IDLE = 60000, BLUR_IDLE = 5000, BOOT = performance.now(), lastIn = Date.now(), blurred = false, tm = 0, on = false;
    var BUSY = { dl: 1, verify: 1, launching: 1, installing: 1, install: 1 };
    try { blurred = !document.hasFocus() } catch (e) {}
    function wait() {
      if (BUSY[W.dataset.st || '']) return -1e9;
      if (document.hidden) return 0;
      var need = blurred ? BLUR_IDLE : IDLE, left = need - (Date.now() - lastIn);
      if (blurred) left = Math.max(left, 6000 - (performance.now() - BOOT));   /* a window that starts unfocused is not parked while its entry animation runs */
      return left;
    }
    function apply() {
      clearTimeout(tm); tm = 0;
      var w = wait(), now = w <= 0 && w > -1e9;
      if (now !== on) { on = now; W.classList.toggle('still120', on) }
      if (!on && w > 0) tm = setTimeout(apply, Math.max(1000, w));
    }
    function act() { lastIn = Date.now(); if (on || !tm) apply() }
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { addEventListener(t, act, { capture: true, passive: true }) });
    addEventListener('blur', function () { blurred = true; apply() });
    addEventListener('focus', function () { blurred = false; lastIn = Date.now(); apply() });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) lastIn = Date.now(); apply() });
    new MutationObserver(apply).observe(W, { attributes: true, attributeFilter: ['data-st'] });
    apply();
    /* A-122: the notes header GIF (prod.css loads it only while the notes are open) is fetched once, when the launcher is ready and the page is idle */
    var gifDone = false;
    function gif() {
      if (gifDone || document.hidden || W.dataset.st !== 'ready') return; gifDone = true;
    }
    new MutationObserver(gif).observe(W, { attributes: true, attributeFilter: ['data-st'] });
    document.addEventListener('visibilitychange', gif); gif();
  })();
  /* ---------- a11y final pass (audit 2026-11-24) ---------- */
  /* A-112: the bar and the world panel are not live regions any more (every hud rewrote them); ONE hidden status line is written when the state, its headline or a 10 % step of the progress changes */
  var LIVE = null, liveKey = null;
  (function () { [].forEach.call(document.querySelectorAll('.prog, .world'), function (n) { n.removeAttribute('role'); n.removeAttribute('aria-live') });
    LIVE = document.createElement('div'); LIVE.id = 'srlive'; LIVE.className = 'sr-only'; LIVE.setAttribute('role', 'status'); LIVE.setAttribute('aria-live', 'polite'); LIVE.setAttribute('aria-atomic', 'true'); W.appendChild(LIVE) })();
  function a11yAnnounce() {
    if (!LIVE) return;
    var s = T.S, p1 = ($('ph1') || {}).textContent || '', sub = (($('psub') || {}).textContent || '').replace(/\s+/g, ' ').trim(), p2 = (($('ph2') || {}).textContent || '').trim();
    var pr = s === 'launching' ? playPct() : (s === 'dl' || s === 'verify') ? +T.PCT[s] : -1, key, msg;
    if (s === 'update') { key = s + '|' + p1 + '|' + p2; msg = p1 + ', ' + p2 }
    else { key = s + '|' + p1 + '|' + (pr >= 0 ? Math.floor(pr / 10) : sub); msg = p1 + (pr >= 0 ? ', ' + Math.round(pr) + '%' : '') + (sub ? '. ' + sub : '') }
    if (key === liveKey) return; var first = liveKey === null; liveKey = key;
    if (!first) LIVE.textContent = msg }
  /* names: every aria-label that was English-only follows the language; the two window buttons keep their .wmin / .wclose class for the CSS and the bridge */
  var LBL = [['nav.comm', 'Community', 'Comunidade'], ['.lng', 'Language', 'Idioma'], ['#cmp', 'Compact mode', 'Modo compacto'], ['#gear', 'Settings', 'Definições'], ['.wmin', 'Minimise', 'Minimizar'], ['.wclose', 'Close', 'Fechar'],
    ['#ywk', 'This week', 'Esta semana'], ['#ynx', 'Dismiss', 'Dispensar'], ['#cats', 'News categories', 'Categorias de notícias'], ['#art', 'Dispatch', 'Notícia'], ['#drives', 'Choose a drive', 'Escolhe uma unidade'], ['#take', 'Event', 'Evento'],
    ['#stcard', 'Server status', 'Estado do servidor'], ['#inst', 'Install Terminus', 'Instalar o Terminus'], ['#shx', 'Close settings', 'Fechar definições'], ['#diag', 'Diagnostics', 'Diagnóstico'], ['#ntx', 'Close patch notes', 'Fechar notas da atualização'],
    ['#closeask', 'Close', 'Fechar'], ['#yq', 'Download details', 'Detalhes da transferência'], ['#yin', 'Installed', 'Instalado'], ['#yrp', 'Repair', 'Reparar'], ['#yop', 'Launch options', 'Opções de arranque'], ['#ypal', 'Commands', 'Comandos'],
    ['#ycn', 'Connection test', 'Teste de ligação'], ['#ysch', 'Schedule', 'Agenda']];
  function setLbl(e, v) { if (e.getAttribute('aria-label') !== v) e.setAttribute('aria-label', v) }
  function firstText(e) { var w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), n; while ((n = w.nextNode())) { var t = n.nodeValue.trim(); if (t) return t } return '' }
  function a11yNames() {
    var pt = L() === 'pt';
    LBL.forEach(function (r) { var e = document.querySelector(r[0]); if (e) setLbl(e, pt ? r[2] : r[1]) });
    var sn = $('snd'); if (sn) { var st = pt ? 'Sons do launcher' : 'Sound cues'; setLbl(sn, st); if (sn.title !== st) sn.title = st }
    [].forEach.call(document.querySelectorAll('.lng button'), function (b) { var en = b.dataset.l === 'en'; setLbl(b, en ? 'English' : 'Português'); if (b.getAttribute('lang') !== (en ? 'en' : 'pt')) b.setAttribute('lang', en ? 'en' : 'pt') });
    /* a tab with a count reads "ALL, 11", not "ALL11" */
    [].forEach.call(document.querySelectorAll('#cats button, #sidx button'), function (b) { var n = b.querySelector('b'); if (!n) return;
      var t = [].filter.call(b.childNodes, function (c) { return c.nodeType === 3 }).map(function (c) { return c.nodeValue }).join('').trim(); if (t) setLbl(b, t + ', ' + n.textContent.trim()) });
    /* every segmented control is a group named by its row */
    [].forEach.call(document.querySelectorAll('#sheet .sh-o > .seg'), function (sg) { if (sg.hasAttribute('aria-label') && !sg.hasAttribute('data-ag')) return;
      var row = sg.parentElement, t = firstText(row.firstElementChild === sg ? row : row.firstElementChild); if (!t) return;
      sg.setAttribute('role', 'group'); sg.setAttribute('data-ag', ''); setLbl(sg, t) });
  }
  /* the four dialogs hold Tab and Shift+Tab inside themselves (the page behind is inert, so without this the focus would leave the page) */
  addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    var d = [['sheetopen', '#sheet'], ['notesopen', '#notes'], ['keysopen', '.keys'], ['reportopen', '.report']].filter(function (x) { return W.classList.contains(x[0]) })[0]; if (!d) return;
    var p = document.querySelector(d[1]); if (!p) return;
    var f = [].filter.call(p.querySelectorAll('button,[tabindex="0"],a[href],[role=button]'), function (x) { if (x.tabIndex < 0 || x.closest('.prod-off')) return false; var r = x.getBoundingClientRect(); if (!r.width || !r.height) return false; var c = getComputedStyle(x); return c.visibility !== 'hidden' && c.display !== 'none' });
    if (!f.length) return; var i = f.indexOf(document.activeElement), last = f.length - 1;
    if (e.shiftKey ? i <= 0 : i === last) { e.preventDefault(); f[e.shiftKey ? last : 0].focus({ focusVisible: true }) }
  }, true);
  /* the BUILD chip is a button only while it carries an error code to copy */
  function a11yPh2() { var p = $('ph2'); if (!p) return;
    if (p.classList.contains('er')) { if (p.getAttribute('role') !== 'button') p.setAttribute('role', 'button'); if (p.getAttribute('tabindex') !== '0') p.setAttribute('tabindex', '0'); setLbl(p, tx('Copy error code ', 'Copiar código do erro ') + p.textContent.trim()) }
    else { if (p.hasAttribute('role')) p.removeAttribute('role'); if (p.getAttribute('tabindex') !== '-1') p.setAttribute('tabindex', '-1'); if (p.hasAttribute('aria-label')) p.removeAttribute('aria-label') } }
  (function () { var p = $('ph2'); if (p) new MutationObserver(a11yPh2).observe(p, { attributes: true, attributeFilter: ['class', 'role', 'tabindex'], childList: true, characterData: true, subtree: true });
    var o = { childList: true, subtree: true, characterData: true };
    [$('cats'), $('sidx')].forEach(function (n) { if (n) new MutationObserver(a11yNames).observe(n, o) });
    var sh = $('sheet'); if (sh) new MutationObserver(a11yNames).observe(sh, o);
    new MutationObserver(function () { a11yNames(); a11yPh2() }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    a11yNames(); a11yPh2() })();
  /* A-38 (page side): a file or link dropped on the window must not navigate it away from the launcher page (the host's AllowExternalDrop=false is the real lock) */
  ['dragover', 'drop'].forEach(function (t) { addEventListener(t, function (e) { e.preventDefault() }) });
  if (!host) { NET.server = true; render() }
  window.__prod = { get caps() { return CAPS }, get net() { return NET }, get stat() { return STAT }, get rep() { return REP }, get game() { return GAME }, data: DATA, render: render, weekModel: weekModel, apply: function () { applyData() }, get plog() { return PLOG }, get srv() { return SRV }, get src() { return SRC } };
})();
