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
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('terminus.' + k); localStorage.setItem('terminus.' + k, v) } catch (e) { return null } }

  /* ---------- data: inline copy first (works offline / file://), then the live files beside the page ---------- */
  var DATA = { news: { items: [], notes: [], links: {} }, events: { events: [] } };
  try { var inl = $('tdata'); if (inl) { var j = JSON.parse(inl.textContent); if (j.news) DATA.news = j.news; if (j.events) DATA.events = j.events } } catch (e) {}
  function fetchJson(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json() }) }
  if (/^https?:/.test(location.protocol)) {
    Promise.all([fetchJson('data/news.json').catch(function () { return null }), fetchJson('data/events.json').catch(function () { return null })])
      .then(function (r) { if (r[0] && r[0].items) DATA.news = r[0]; if (r[1] && r[1].events) DATA.events = r[1]; applyData() });
  }

  /* ---------- state from the exe ---------- */
  var PLAYP = null;
  function playPct() { var q = PLAYP; if (q) return q.phase === 'hash' ? (q.total ? Math.floor(q.files / q.total * 100) : 0) : (q.totalBytes ? Math.floor(q.bytes / q.totalBytes * 100) : 0); return NET.progress >= 0 ? NET.progress : -1 }
  function playText() { var q = PLAYP; if (!q) return '';
    if (q.phase === 'hash') return tx('Checking files · ', 'A verificar ficheiros · ') + (q.files || 0).toLocaleString('fr-FR') + ' / ' + (q.total || 0).toLocaleString('fr-FR');
    var mb = function (x) { return (x / 1048576).toFixed(1) };
    return tx('Downloading · ', 'A transferir · ') + mb(q.bytes || 0) + ' / ' + mb(q.totalBytes || 0) + ' MB' + (q.eta != null ? tx(' · ' + q.eta + ' s left', ' · faltam ' + q.eta + ' s') : '') }
  var CAPS = null, INFO = { launcher: null, game: null }, NET = { server: null, ms: null, status: '', progress: -1 },
      STAT = null, REP = null, GAME = false, PLAYING = false, MSH = [], LASTERR = '';
  function has(c) { return !!(CAPS && CAPS.indexOf(c) >= 0) }

  /* ---------- time ---------- */
  var MON = { en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], pt: ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] };
  var DL2 = { en: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], pt: ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'] };
  function p2(n) { return (n < 10 ? '0' : '') + n }
  function hm(d) { return p2(d.getHours()) + ':' + p2(d.getMinutes()) }
  function dShort(iso) { var d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')); return isNaN(d) ? '' : p2(d.getDate()) + ' ' + MON[L()][d.getMonth()] }
  function dur(sec) { sec = Math.max(0, Math.floor(sec)); var d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60; return (d ? d + 'D ' : '') + p2(h) + ':' + p2(m) }
  function evs() { return (DATA.events.events || []).map(function (e) { return { e: e, s: +new Date(e.start), t: +new Date(e.end) } }).filter(function (x) { return !isNaN(x.s) && !isNaN(x.t) && x.t > x.s }) }
  function liveEv(now) { return evs().filter(function (x) { return x.s <= now && now < x.t }).sort(function (a, b) { return a.t - b.t })[0] || null }
  function nextEv(now) { return evs().filter(function (x) { return x.s > now }).sort(function (a, b) { return a.s - b.s })[0] || null }
  function evEnded(id, now) { var x = evs().filter(function (y) { return y.e.id === id })[0]; return !x || x.t <= now }

  /* ---------- news, patch notes ---------- */
  var TAG = { client: ['CLIENT', 'CLIENTE'], server: ['SERVER', 'SERVIDOR'], event: ['EVENT', 'EVENTO'] };
  function newsItems() {
    var now = Date.now();
    return (DATA.news.items || []).filter(function (n) { return !(n.event && evEnded(n.event, now)) && n.title })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') });
  }
  var NEWSIDS = [];
  function hideEmptyCats() { [].forEach.call(document.querySelectorAll('#cats button'), function (b) { var n = b.querySelector('b'), off = !!n && n.textContent.trim() === '0'; if (b.classList.contains('prod-off') !== off) b.classList.toggle('prod-off', off) }) }
  if ($('cats')) new MutationObserver(hideEmptyCats).observe($('cats'), { childList: true });
  function applyNews() {
    var it = newsItems();
    if (!it.length) it = [{ id: 'none', date: new Date().toISOString().slice(0, 10), tag: 'client', thumb: 'img/thumbs/n1.png', title: { en: 'No news yet', pt: 'Ainda sem notícias' }, body: { en: 'News from the team appears here.', pt: 'As notícias da equipa aparecem aqui.' } }];
    NEWSIDS = it.map(function (n) { return n.id });
    ['en', 'pt'].forEach(function (lg) {
      var arr = T.NEWS[lg]; arr.length = 0;
      it.forEach(function (n) { var tg = TAG[n.tag] || TAG.client; arr.push({ d: dShortL(n.date, lg), t: lg === 'pt' ? tg[1] : tg[0], h: esc(n.title[lg] || n.title.en), p: esc((n.body || {})[lg] || (n.body || {}).en || '') }) });
    });
    T.TH.length = 0; it.forEach(function (n) { T.TH.push(/^img\/[a-z0-9\/_-]+\.(png|jpg|webp)$/i.test(n.thumb || '') ? n.thumb : 'img/thumbs/n1.png') });
    var un = T.UN(); if (un) { Object.keys(un).forEach(function (k) { delete un[k] }); var seen = (store('seen') || '').split(','); it.forEach(function (n, i) { if (seen.indexOf(n.id) < 0 && i > 0) un[i] = 1 }) }
    try { T.cats(); T.show(T.vis()[0] || 0) } catch (e) {}
    hideEmptyCats();
    try { T.Y.paint() } catch (e) {}
  }
  function dShortL(iso, lg) { var d = new Date((iso || '') + 'T12:00:00'); return isNaN(d) ? '' : p2(d.getDate()) + ' ' + MON[lg][d.getMonth()] }
  function applyNotes() {
    var N = DATA.news.notes || [];
    ['en', 'pt'].forEach(function (lg) {
      var P = T.PN[lg]; P.v.length = 0; P.meta.length = 0; P.g.length = 0;
      N.forEach(function (n) {
        P.v.push(esc(n.version) + ' · ' + dShortL(n.date, lg));
        P.meta.push(esc((n.meta || {})[lg] || (n.meta || {}).en || ''));
        P.g.push((n.groups || []).map(function (g) { return [esc(g.title[lg] || g.title.en), (g.items || []).map(function (i) { return [esc(i.text[lg] || i.text.en), esc(i.tag || '')] })] }));
      });
    });
    T.DIFF.length = 0; N.forEach(function (n) { var m = []; (n.groups || []).forEach(function (g) { (g.items || []).forEach(function (i) { m.push([/^(new|chg|fix|del)$/.test(i.kind) ? i.kind : 'new', '']) }) }); T.DIFF.push(m) });
  }

  /* ---------- the week strip, the event chip and the countdowns ---------- */
  function weekModel() {
    var now = new Date(), nowMs = +now, dow = (now.getDay() + 6) % 7, mon0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    var days = []; for (var i = 0; i < 7; i++) days.push(new Date(mon0.getFullYear(), mon0.getMonth(), mon0.getDate() + i));
    var lv = liveEv(nowMs), nx = nextEv(nowMs), show = lv || nx;
    var nm = STAT && STAT.ok && STAT.nextMaintenance ? new Date(STAT.nextMaintenance) : null;
    function span(d) { if (!show) return null; var a = +d, b = a + 86400000, s = Math.max(a, show.s), t = Math.min(b, show.t); if (t <= s) return null; return [Math.round((s - a) / 864000), Math.max(4, Math.round((t - s) / 864000))] }
    function mt(d) { if (!nm || isNaN(nm)) return null; var a = +d; if (+nm < a || +nm >= a + 86400000) return null; return [Math.round((+nm - a) / 864000), 18] }
    return {
      dt: days.map(function (d) { return d.getDate() }), mon: days.map(function (d) { return MON[L()][d.getMonth()] }), today: dow,
      ev: days.map(span), mt: days.map(mt),
      cap: function (i) {
        var d = days[i], a = +d, b = a + 86400000, parts = [DL2[L()][i] + ' ' + p2(d.getDate()) + ' ' + MON[L()][d.getMonth()]];
        if (i === dow) parts.push(tx('TODAY', 'HOJE'));
        if (show && show.s < b && show.t > a) { parts.push(esc(pick(show.e.short) || pick(show.e.title))); if (show.s >= a) parts.push(tx('FROM ', 'DESDE AS ') + hm(new Date(show.s))); if (show.t <= b) parts.push(tx('ENDS ', 'ACABA ÀS ') + hm(new Date(show.t))) }
        else parts.push(tx('NO EVENTS', 'SEM EVENTOS'));
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
  setInterval(function () { if (T.R < 81) return; var l = liveEv(Date.now()), k = l ? l.e.id : null; if (k !== lastLive) { lastLive = k; applyEvents(); applyNews(); return } var e = document.querySelector('#ywk .we'); if (e) e.innerHTML = weekModel().head() }, 1000);
  var lastLive = (function () { var l = liveEv(Date.now()); return l ? l.e.id : null })();

  /* ---------- texts that used to be fiction ---------- */
  function fmtGame(g) { g = String(g || ''); return /^\d{10}$/.test(g) ? g.slice(0, 4) + '.' + g.slice(4, 6) + '.' + g.slice(6, 8) + '-' + g.slice(8) : g }
  /* login answers (hud.server) but the world itself is down (status.online from the API) */
  function gameDown() { return !!(STAT && STAT.ok && STAT.online === false) }
  function buildLabel() { return INFO.game ? fmtGame(INFO.game) : (INFO.launcher || '—') }
  function srvLine() {
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
    E.ready = ['READY TO PLAY', 'BUILD ' + b, 'Every PLAY checks your files against the server.', 'PLAY', ''];
    P.ready = ['PRONTO A JOGAR', 'VERSÃO ' + b, 'Cada JOGAR verifica os ficheiros com o servidor.', 'JOGAR', ''];
    var lp = playPct(), lt = PLAYP ? esc(playText()) : '';
    E.launching = ['STARTING TERMINUS', lp >= 0 ? lp + '%' : '', lt || esc(st) || 'Checking files, then the game opens.', 'PLAY', 'STARTING'];
    P.launching = ['A INICIAR O TERMINUS', lp >= 0 ? lp + '%' : '', lt || esc(st) || 'A verificar os ficheiros; depois o jogo abre.', 'JOGAR', 'A INICIAR'];
    var inTray = has('tray');
    E.running = ['TERMINUS IS RUNNING', 'SESSION 0:00:00', inTray ? 'The launcher waits by the clock until you leave the game.' : 'The launcher waits minimised until you leave the game.', 'IN GAME', ''];
    P.running = ['O TERMINUS ESTÁ A CORRER', 'SESSÃO 0:00:00', inTray ? 'O launcher espera junto ao relógio até saíres do jogo.' : 'O launcher espera minimizado até saíres do jogo.', 'EM JOGO', ''];
    var down = STAT && STAT.ok && STAT.maintenance;
    E.offline = [down ? 'OMEGAMON IS IN MAINTENANCE' : 'OMEGAMON IS OFFLINE', down ? 'MAINTENANCE' : 'NO ANSWER', down ? 'Press PLAY when the server is back.' : 'No answer from the server. Checking every 5 s; PLAY still works.', 'PLAY', ''];
    P.offline = [down ? 'OMEGAMON ESTÁ EM MANUTENÇÃO' : 'OMEGAMON ESTÁ OFFLINE', down ? 'MANUTENÇÃO' : 'SEM RESPOSTA', down ? 'Carrega em JOGAR quando o servidor voltar.' : 'Sem resposta do servidor. Verifica a cada 5 s; podes JOGAR.', 'JOGAR', ''];
    T.ERR.en.offline = E.offline; T.ERR.pt.offline = P.offline;
    var nm = STAT && STAT.ok && STAT.nextMaintenance ? new Date(STAT.nextMaintenance) : null, t = nm && !isNaN(nm) ? hm(nm) : '';
    E.maint = ['MAINTENANCE AT ' + t, 'BUILD ' + b, 'Play until ' + t + '; save before then, the server stops.', 'PLAY', ''];
    P.maint = ['MANUTENÇÃO ÀS ' + t, 'VERSÃO ' + b, 'Podes jogar até às ' + t + '; grava antes, o servidor para.', 'JOGAR', ''];
    if (REP) {
      var pct = REP.phase === 'hash' ? (REP.total ? Math.floor(REP.files / REP.total * 100) : 0) : (REP.totalBytes ? Math.floor(REP.bytes / REP.totalBytes * 100) : 0);
      var mb = function (x) { return (x / 1048576).toFixed(1) };
      var nf = function (x) { return (x || 0).toLocaleString('fr-FR') };
      E.verify = ['VERIFYING FILES', pct + '%', nf(REP.files) + ' / ' + nf(REP.total) + ' checked', 'PLAY', 'LOCKED'];
      P.verify = ['A VERIFICAR FICHEIROS', pct + '%', nf(REP.files) + ' / ' + nf(REP.total) + ' verificados', 'JOGAR', 'BLOQUEADO'];
      E.dl = ['REPAIRING ' + (REP.bad || 0) + ' FILES', pct + '%', mb(REP.bytes || 0) + ' / ' + mb(REP.totalBytes || 0) + ' MB' + (REP.speed ? ' · ' + mb(REP.speed) + ' MB/s' : '') + (REP.eta != null ? ' · ' + REP.eta + ' s left' : ''), 'PLAY', 'LOCKED'];
      P.dl = ['A REPARAR ' + (REP.bad || 0) + ' FICHEIROS', pct + '%', mb(REP.bytes || 0) + ' / ' + mb(REP.totalBytes || 0) + ' MB' + (REP.speed ? ' · ' + mb(REP.speed) + ' MB/s' : '') + (REP.eta != null ? ' · faltam ' + REP.eta + ' s' : ''), 'JOGAR', 'BLOQUEADO'];
      T.PCT.verify = pct; T.PCT.dl = pct;
    }
    T.PCT.launching = Math.max(0, playPct());
    T.SRV.en[0] = T.SRV.pt[0] = srvLine(); T.SRV.en[1] = T.SRV.pt[1] = srvLine();
    T.MIN.en.running = T.MIN.pt.running = null; T.MIN.en.dl = T.MIN.pt.dl = null; T.MIN.en.verify = T.MIN.pt.verify = null;
    T.setBuild(b);
  }

  /* ---------- which state the bar shows ---------- */
  var DONE = null;
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
    if (s === 'ready' && DONE) { var ps = $('psub'); if (ps) ps.textContent = DONE }
    if (s === 'running') { var pr = $('psub'); if (pr) pr.textContent = T.ST[L()].running[2] }
    if (s === 'launching') world();
    if ((s === 'dl' || s === 'verify') && $('gpc')) $('gpc').textContent = T.PCT[s];
    if (s === 'maint' && !isNaN(nm)) { var at = new Date(Date.now() + nm * 1000), today = at.toDateString() === new Date().toDateString(), h = hm(at);
      try { T.Y.D({ 'mt.1': [(today ? 'TODAY ' : 'TOMORROW ') + h, (today ? 'HOJE ÀS ' : 'AMANHÃ ÀS ') + h], 'mt.24': ['TOMORROW ' + h, 'AMANHÃ ÀS ' + h], 'mt.bar24': ['MAINTENANCE TOMORROW AT ' + h, 'MANUTENÇÃO AMANHÃ ÀS ' + h] }); T.nt() } catch (e) {} }
    $('sr2') && ($('sr2').textContent = srvLine());
    var sd = $('sd'); if (sd) sd.className = 'd' + (NET.server === false || gameDown() ? ' off' : NET.server == null ? ' wait' : '');
  }
  /* the "entering the world" panel shows the exe's real progress, not a shader count */
  function world() {
    var w = document.querySelector('.world .wl'); if (!w) return;
    var pp = playPct(), pct = pp >= 0 ? pp : 0, b1 = '', b2 = '';
    for (var i = 0; i < 24; i++) { b1 += '<i' + (i < pct / 100 * 24 ? ' class="l"' : '') + '></i>'; b2 += '<i></i>' }
    w.innerHTML = '<div class="eb">' + tx('PLAY · BUILD ', 'JOGAR · VERSÃO ') + esc(buildLabel()) + '</div><h2>' + tx('Entering the<br>Digital World', 'A entrar no<br>Mundo Digital') + '</h2>' +
      '<div class="stg' + (pct >= 100 ? ' done' : '') + '"><span>' + tx('FILES', 'FICHEIROS') + '</span><div class="bars">' + b1 + '</div><span class="v">' + (pp >= 0 ? pct + '%' : tx('CHECKING', 'A VERIFICAR')) + '</span></div>' +
      '<div class="stg wait"><span>' + tx('CLIENT', 'CLIENTE') + '</span><div class="bars">' + b2 + '</div><span class="v">' + tx('NEXT', 'A SEGUIR') + '</span></div>' +
      '<div class="nt">' + (esc(playText()) || esc(NET.status) || tx('Every file is checked against the server, then the game opens.', 'Cada ficheiro é verificado com o servidor e depois o jogo abre.')) + '</div>';
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
      if (/fail|error|refused|could not|não/i.test(NET.status)) { LASTERR = NET.status; if (PLAYING && NET.progress < 0) { PLAYING = false; DONE = NET.status } }
      soon();
    } else if (m.t === 'caps') {
      CAPS = Array.isArray(m.caps) ? m.caps : []; INFO.launcher = m.launcher || INFO.launcher; INFO.game = m.game || null;
      if (typeof m.running === 'boolean') GAME = m.running;
      W.classList.add('caps2'); W.classList.toggle('capcompact', has('compact'));
      if (has('overlays')) post('overlays:html');
      if (has('size')) post('size:1280x720');
      if (has('status')) post('status:html');
      if (has('tray')) post('lang:' + L());
      lverNotice(); soon();
    } else if (m.t === 'status') {
      STAT = m; soon(); T.wk(weekModel());
    } else if (m.t === 'repair') {
      REP = m.phase === 'done' || m.phase === 'error' ? null : m;
      if (m.phase === 'done') try { T.Y.chime && T.Y.chime('done') } catch (x) {}
      if (m.phase === 'done') DONE = (m.bad || 0) === 0 ? tx('Repair finished: every file is intact.', 'Reparação concluída: todos os ficheiros estão bem.') :
        (m.failed ? tx(m.fixed + ' repaired, ' + m.failed + ' still fail. Try again.', m.fixed + ' reparados, ' + m.failed + ' ainda falham. Tenta de novo.') :
          tx(m.fixed + ' files repaired. Ready to play.', m.fixed + ' ficheiros reparados. Pronto a jogar.'));
      if (m.phase === 'error') { DONE = tx('Repair could not run. Details in Settings › Support.', 'A reparação não correu. Detalhes em Definições › Suporte.'); LASTERR = 'repair: ' + (m.msg || 'unknown'); var dg0 = $('diag'); if (dg0) dg0.textContent = diagText(); }
      soon();
    } else if (m.t === 'play') {
      /* the exe checks (and if needed downloads) files before the game starts: real progress, a sign of life */
      PLAYP = m; sigAt = Date.now(); if (!PLAYING) PLAYING = true; soon();
    } else if (m.t === 'game') {
      GAME = !!m.running; PLAYING = false; PLAYP = null;
      if (GAME) { T.setSess(0); store('last', String(Date.now())); lastPlayed(); var cl = closeOnStart(); if (cl) setTimeout(function () { post(has('quit') ? 'quit' : 'close') }, 400) }
      soon();
    }
  });

  /* PLAY: the page keeps its cinematic; the exe does the work */
  $('play').addEventListener('click', function (e) {
    var s = T.S;
    if (PLAYING) { if (window.__SK && window.__SK.busy && window.__SK.busy()) return; e.stopImmediatePropagation(); return }
    if (s === 'running' || s === 'verify' || s === 'dl' || s === 'launching') { e.stopImmediatePropagation(); return }
    /* offline and maintenance are advice from probes that can be wrong: PLAY always reaches the exe, the server decides */
    PLAYING = true; PLAYP = null; playAt = sigAt = Date.now(); DONE = null; post('play'); setTimeout(soon, 50);
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
  setInterval(function () { if (PLAYING && Date.now() - sigAt > 12000) { PLAYING = false; PLAYP = null; soon() } }, 1000);

  /* window controls */
  function byLabel(re) { return [].filter.call(document.querySelectorAll('#win button'), function (b) { return re.test(b.getAttribute('aria-label') || '') }) }
  byLabel(/^Close$/).forEach(function (b) { b.addEventListener('click', function (e) { e.stopImmediatePropagation(); post('close') }, true) });
  byLabel(/^Minimi[sz]e$/).forEach(function (b) { b.addEventListener('click', function (e) { e.stopImmediatePropagation(); if (has('minimize')) post('minimize') }, true) });
  document.querySelectorAll('.comm a').forEach(function (b) { b.addEventListener('click', function (e) { e.stopImmediatePropagation(); e.preventDefault(); var u = (DATA.news.links || {}).discord; if (u && has('open-url')) post('open-url ' + u) }, true) });

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
  function startRepair() { if (!has('repair') || GAME || PLAYING || REP) return; REP = { phase: 'hash', files: 0, total: 0, local: 1 }; repAt = Date.now(); DONE = null; T.sheet(false); post('repair'); soon() }
  setInterval(function () { if (REP && REP.local && Date.now() - repAt > 6000 && !/verif/i.test(NET.status)) { REP = null; soon() } }, 1000);
  document.querySelectorAll('.sh-a button').forEach(function (b) {
    var en = b.getAttribute('data-en') || b.textContent;
    if (/VERIFY|REPAIR/.test(en)) b.addEventListener('click', function (e) { e.stopImmediatePropagation(); startRepair() }, true);
    if (/OPEN FOLDER/.test(en)) b.classList.add('prod-off');
  });

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
    if (el) el.textContent = txt;
  }

  /* launcher-updated notice: only when the exe's version changed since this player last saw it */
  function lverNotice() {
    var v = INFO.launcher; if (!v) return; T.setLver(v);
    var seen = store('lver'); if (!seen) { store('lver', v); seen = v }
    if (seen !== v) W.classList.add('ribbonon'); else W.classList.remove('ribbonon');
    var x = $('ynx'); if (x) x.addEventListener('click', function () { store('lver', v) });
    T.nt();
  }
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
        '<div class="k"><span>' + tx('PLAYERS', 'JOGADORES') + '</span><span></span><b>' + (STAT && STAT.ok && STAT.players != null ? STAT.players : '—') + '</b></div>' +
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
  document.querySelectorAll('.lng button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(function () { applyEvents(); applyNews() }, 0) }) });
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
  addEventListener('resize', function () { setTimeout(fitProd, 0) });

  function pager() { var g = $('pgn'), n = T.vis().length; if (g && n) g.textContent = ((T.vis().indexOf(curIdx()) + 1) || 1) + ' / ' + n }
  function curIdx() { var on = document.querySelector('#rail .ri.on'); return on ? +on.dataset.i : 0 }
  /* the hero clamps a long story (prod.css); the notes panel opens with that story in full, above the patch notes */
  function fillNews() {
    var nt = $('notes'), n = (T.NEWS[T.L] || [])[curIdx()]; if (!nt || !n || !$('pnv')) return;
    var b = $('pnnews'); if (!b) { b = document.createElement('div'); b.id = 'pnnews'; nt.insertBefore(b, $('pnv')) }
    var html = '<div class="eb">' + n.d + ' · ' + n.t + '</div><h3>' + n.h + '</h3><p>' + n.p + '</p>';
    if (b.innerHTML !== html) b.innerHTML = html;
  }
  new MutationObserver(function () { if (W.classList.contains('notesopen')) fillNews() }).observe(W, { attributes: true, attributeFilter: ['class'] });
  if ($('pnb')) new MutationObserver(fillNews).observe($('pnb'), { childList: true });
  /* the title keeps the shipped fit (fit-story shrinks it 2px a step, down to 30px, until the story clears the tabs);
     only a title still over 2 lines after that is cut to 2 (.long, plain wrapping before the ellipsis) */
  function clampTitle() { var h = document.querySelector('#story h1'); if (!h) return; h.classList.remove('long'); if (window.__fitStory) window.__fitStory();
    var lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.06; h.classList.toggle('long', h.getBoundingClientRect().height > 2 * lh + 1) }
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

  function applyData() { applyNotes(); applyNews(); applyEvents(); var d = (DATA.news.links || {}).discord; W.classList.toggle('nodiscord', !d); render() }

  /* warm the settings sheet once, invisibly, so its first open slides at once (it stalled ~460 ms) */
  (window.requestIdleCallback || function (f) { setTimeout(f, 1200) })(function () {
    var sh = $('sheet'); if (!sh || W.classList.contains('sheetopen')) return;
    W.classList.add('prewarm'); T.sheet(true); void sh.offsetHeight; sh.querySelectorAll('*').length; T.sheet(false); void sh.offsetHeight; W.classList.remove('prewarm');
  }, { timeout: 3000 });

  /* boot: the legacy handshake first, so every exe version hides its own buttons and HUD */
  document.documentElement.classList.add('prod');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  try { T.round(T.R) } catch (e) {}
  W.classList.remove('ribbonon', 'takeover', 'mini', 'big');
  applyData(); lastPlayed(); world(); fitProd(); setTimeout(fitProd, 300);
  post('controls:html'); post('hud:html');
  /* ready: the exe keeps its window hidden until the first real frame is painted (no legacy flash) */
  (function () {
    var sent = false;
    /* no requestAnimationFrame: the exe keeps the window at opacity 0 here, and rAF may not run */
    function go() { if (sent) return; sent = true; setTimeout(function () { post('ready') }, 30) }
    if (document.readyState === 'complete') go(); else addEventListener('load', go);
    setTimeout(go, 2500);
  })();
  if (!host) { NET.server = true; render() }
  window.__prod = { get caps() { return CAPS }, get net() { return NET }, get stat() { return STAT }, get rep() { return REP }, get game() { return GAME }, data: DATA, render: render, weekModel: weekModel, apply: function () { applyData() } };
})();
