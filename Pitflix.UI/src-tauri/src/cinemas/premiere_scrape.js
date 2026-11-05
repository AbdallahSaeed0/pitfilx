// Injected into the hidden Premiere Cinemas webview (see `cinemas/premiere.rs`).
//
// Premiere's showtime API responses are deliberately encrypted, so this never
// touches the API: it reads the listings from the rendered DOM and gets times
// the way a visitor does — clicking cinema → date → format → experience on the
// now-showing page and reading the "Choose Time" buttons. Results go back
// through the `pitflix-cinemas` custom scheme (same channel as `vox_scrape.js`).
(function () {
  if (window.__pitflixPremiere) return;
  if (!/(^|\.)premiere-cinemas\.com$/.test(location.hostname)) return;

  // Count in-flight XHRs (the site uses axios) so clicks can wait for the
  // data they trigger instead of sleeping a fixed time.
  var pending = 0;
  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    pending++;
    this.addEventListener('loadend', function () { pending--; });
    return send.apply(this, arguments);
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function settle() {
    await sleep(60);
    for (var i = 0; i < 150 && pending > 0; i++) await sleep(100);
    await sleep(80);
  }

  async function waitFor(fn, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    for (;;) {
      var v = fn();
      if (v || Date.now() > deadline) return v;
      await sleep(150);
    }
  }

  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function abs(href) {
    try { return href ? new URL(href, location.origin).href : null; } catch (_) { return null; }
  }

  // `/_next/image?url=<original>&w=…` → the original upload URL.
  function imageUrl(img) {
    if (!img) return null;
    var src = img.getAttribute('src') || '';
    try {
      var u = new URL(src, location.origin);
      return u.searchParams.get('url') || u.href;
    } catch (_) {
      return src || null;
    }
  }

  // Sections are a <p> heading ("Choose Date", …) two levels under the block
  // that also holds that step's buttons. The site uses utility classes only,
  // so headings are the stable hook.
  function section(root, re) {
    var p = Array.prototype.find.call(root.querySelectorAll('p'), function (p) { return re.test(text(p)); });
    return p ? p.parentElement.parentElement : null;
  }

  function buttons(sec) { return sec ? Array.prototype.slice.call(sec.querySelectorAll('button')) : []; }

  function clickButton(root, re, label) {
    var b = buttons(section(root, re)).find(function (b) { return text(b) === label; });
    if (b) b.click();
    return !!b;
  }

  var CINEMA = /^choose your cinema$/i;
  var FORMAT = /^choose formats?$/i;
  var EXPERIENCE = /^choose experiences?$/i;
  var TIME = /^choose time$/i;
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function cards() {
    return Array.prototype.map.call(
      document.querySelectorAll('a[href*="/now-showing/"] + div.flex-1'),
      function (d) { return d.parentElement; }
    );
  }

  function idFromHref(href) {
    var m = /\/(?:now-showing|movie-details|coming-soon-movie-details)\/([^/?#]+)/.exec(href || '');
    return m ? m[1] : null;
  }

  function nowShowing() {
    return cards().map(function (card) {
      var href = card.querySelector('a').getAttribute('href');
      var ps = Array.prototype.filter.call(card.querySelectorAll('.flex-1 > p'), function (p) { return text(p); });
      return {
        id: idFromHref(href),
        title: text(card.querySelector('h1')),
        posterUrl: imageUrl(card.querySelector('img')),
        info: text(ps[0]) || null,
        synopsis: text(ps[1]) || null,
        cinemas: buttons(section(card, CINEMA)).map(text),
        url: abs('/en/movie-details/' + idFromHref(href) + '/1'),
      };
    });
  }

  function comingSoon() {
    return Array.prototype.map.call(
      document.querySelectorAll('a[href*="/coming-soon-movie-details/"]'),
      function (a) {
        var spans = Array.prototype.map.call(a.querySelectorAll('span'), text);
        var year = spans.filter(function (s) { return /^\d{4}$/.test(s); })[0] || null;
        return {
          id: idFromHref(a.getAttribute('href')),
          title: text(a.querySelector('p')) || (a.querySelector('img') || {}).alt || '',
          posterUrl: imageUrl(a.querySelector('img')),
          genres: spans.filter(function (s) { return s !== year; })[0] || null,
          year: year,
          url: abs(a.getAttribute('href')),
        };
      }
    );
  }

  // "2026-10-08" → the date tile showing "08" / "Oct".
  function dateTile(card, isoDate) {
    var parts = isoDate.split('-');
    var month = MONTHS[parseInt(parts[1], 10) - 1];
    return Array.prototype.find.call(card.querySelectorAll('.dates-container'), function (d) {
      var ps = Array.prototype.map.call(d.querySelectorAll('p'), function (p) { return text(p).toLowerCase(); });
      return ps[1] === parts[2] && ps[2] === month;
    });
  }

  // Reads every format · experience → times for the date currently selected on `card`.
  async function readFormats(card) {
    var formats = [];
    var formatNames = buttons(section(card, FORMAT)).map(text);
    for (var fi = 0; fi < formatNames.length; fi++) {
      clickButton(card, FORMAT, formatNames[fi]);
      await settle();
      var experienceNames = buttons(section(card, EXPERIENCE)).map(text);
      for (var ei = 0; ei < experienceNames.length; ei++) {
        clickButton(card, EXPERIENCE, experienceNames[ei]);
        await settle();
        var times = buttons(section(card, TIME)).map(function (b) { return { time: text(b) }; });
        if (times.length) formats.push({ name: formatNames[fi] + ' · ' + experienceNames[ei], times: times });
      }
    }
    return formats;
  }

  // One job covers several dates: each branch is picked once, then every
  // requested date tile under it — much cheaper than a job per date.
  // Returns { "yyyy-mm-dd": [{ name, formats }] } with an entry per requested date.
  async function crawl(job) {
    var card = cards().find(function (c) { return idFromHref(c.querySelector('a').getAttribute('href')) === job.movieId; });
    if (!card) throw new Error('Movie is no longer on the now-showing page.');
    var names = buttons(section(card, CINEMA)).map(text);
    if (job.cinema) names = names.filter(function (n) { return n === job.cinema; });

    var days = {};
    job.dates.forEach(function (d) { days[d] = []; });
    for (var ci = 0; ci < names.length; ci++) {
      clickButton(card, CINEMA, names[ci]);
      await settle();
      // The first click can land before React hydrates; one retry covers it.
      if (!card.querySelector('.dates-container')) {
        await sleep(800);
        clickButton(card, CINEMA, names[ci]);
        await settle();
      }
      for (var di = 0; di < job.dates.length; di++) {
        var tile = dateTile(card, job.dates[di]);
        if (!tile) continue; // not playing at this branch that day
        tile.click();
        await settle();
        var formats = await readFormats(card);
        if (formats.length) days[job.dates[di]].push({ name: names[ci], formats: formats });
      }
    }
    return days;
  }

  function report(payload) {
    payload.url = location.href;
    try {
      fetch('https://pitflix-cinemas.localhost/report', {
        method: 'POST',
        body: JSON.stringify(payload),
      }).catch(function () {});
    } catch (_) {}
  }

  window.__pitflixPremiere = {
    // Called by Rust via `eval` once the now-showing page has reported ready.
    crawl: function (job) {
      crawl(job).then(
        function (days) { report({ kind: 'premiereTimes', data: { jobId: job.jobId, days: days } }); },
        function (e) { report({ kind: 'premiereTimes', data: { jobId: job.jobId, error: String(e && e.message || e) } }); }
      );
    },
  };

  async function onLoad() {
    var path = location.pathname.replace(/\/+$/, '');
    try {
      if (/\/now-showing$/.test(path)) {
        await waitFor(function () { return cards().length; }, 15000);
        // Prefix the app looks for to tell "Premiere redesigned their site" from a slow load.
        if (!cards().length) throw new Error("Site layout changed: no movie cards on Premiere's now-showing page");
        // Cards render first; each one's branch buttons fill in over the next ~2s
        // as per-card requests finish. Wait for all of them so the listing has
        // every movie's branches (and React has hydrated before Rust clicks).
        await waitFor(function () {
          return pending === 0 && cards().every(function (c) { return buttons(section(c, CINEMA)).length; });
        }, 20000);
        if (!cards().some(function (c) { return buttons(section(c, CINEMA)).length; })) {
          throw new Error("Site layout changed: Premiere's movie cards have no cinema picker");
        }
        await sleep(300);
        report({ kind: 'premiereNowShowing', data: nowShowing() });
      } else if (/\/coming-soon$/.test(path)) {
        await waitFor(function () { return document.querySelector('a[href*="/coming-soon-movie-details/"]'); }, 15000);
        report({ kind: 'premiereComingSoon', data: comingSoon() });
      }
    } catch (e) {
      report({ kind: 'error', data: String(e && e.message || e) });
    }
  }

  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad);
})();
