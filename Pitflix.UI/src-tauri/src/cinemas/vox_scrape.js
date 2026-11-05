// Injected into the hidden VOX Cinemas Egypt webview (see `cinemas/vox.rs`).
//
// The window opens on today's `/showtimes`. From there this script reports
// today straight away, then fetches every other page it needs (coming soon,
// now showing, each date in the date bar) from inside the page — same origin,
// so the requests carry the cookies the bot-protection script just set — a few
// at a time, reporting each as soon as it's parsed. That's a few seconds
// instead of navigating to ~12 pages one after another.
//
// If Rust has to fall back to navigating to a page directly (a fetch failed),
// that page just reports itself.
//
// Reports go to the `pitflix-cinemas` custom scheme (see `cinemas/mod.rs`).
(function () {
  if (window.__pitflixVoxScrape) return;
  window.__pitflixVoxScrape = true;
  if (location.hostname !== 'egy.voxcinemas.com') return;

  var MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  var PARALLEL = 4;

  function text(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function abs(href) {
    try { return href ? new URL(href, location.origin).href : null; } catch (_) { return null; }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // "08 October 2026" -> "2026-10-08"
  function parseReleaseDate(s) {
    var m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s || '');
    if (!m) return null;
    var month = MONTHS[m[2].toLowerCase()];
    return month ? m[3] + '-' + pad(month) + '-' + pad(parseInt(m[1], 10)) : null;
  }

  // "?d=20261009" -> "2026-10-09"
  function parseDateParam(href) {
    var m = /[?&]d=(\d{4})(\d{2})(\d{2})/.exec(href || '');
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  function cairoToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  }

  // "<strong>Release Date:</strong> 08 October 2026<br><strong>Starring:</strong> ..."
  // Walks the nodes rather than splitting innerText: fetched documents aren't
  // rendered, so their innerText has no line breaks.
  function labelledFields(p) {
    var out = {};
    Array.prototype.forEach.call(p.querySelectorAll('strong'), function (strong) {
      var value = '';
      for (var n = strong.nextSibling; n && n.nodeName !== 'STRONG' && n.nodeName !== 'BR'; n = n.nextSibling) {
        value += n.textContent;
      }
      out[text(strong).replace(/:$/, '').toLowerCase()] = value.replace(/\s+/g, ' ').trim();
    });
    return out;
  }

  // "Lisa ," / "Phil ,, Rina ," → "Lisa" / "Phil, Rina"
  function cleanList(s) {
    if (!s) return null;
    var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  function summaries(doc) {
    return Array.prototype.map.call(doc.querySelectorAll('article.movie-summary'), function (a) {
      var h3 = a.querySelector('h3');
      var classification = text(h3 && h3.querySelector('.classification'));
      var title = a.getAttribute('data-title') || text(h3).replace(classification, '').trim();
      var fields = {};
      var synopsis = '';
      Array.prototype.forEach.call(a.querySelectorAll('p'), function (p) {
        if (p.querySelector('strong')) Object.assign(fields, labelledFields(p));
        else if (!p.querySelector('.classification') && text(p).length > 40) synopsis = text(p);
      });
      var poster = a.querySelector('img.poster');
      return {
        slug: a.getAttribute('data-slug'),
        title: title,
        posterUrl: poster ? abs(poster.getAttribute('src')) : null,
        classification: classification || text(a.querySelector('.classification')) || null,
        language: fields.language || null,
        starring: cleanList(fields.starring),
        releaseDate: parseReleaseDate(fields['release date']),
        synopsis: synopsis || null,
        url: abs('/movies/' + a.getAttribute('data-slug')),
      };
    });
  }

  // The featured ("hero") listing shows a trailer instead of a poster; the
  // movie's own page has it.
  function fillMissingPosters(movies) {
    return Promise.all(movies.filter(function (m) { return !m.posterUrl && m.url; }).map(function (m) {
      return fetch(m.url, { credentials: 'include' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (html) {
          var img = new DOMParser().parseFromString(html, 'text/html').querySelector('img.poster');
          if (img) m.posterUrl = abs(img.getAttribute('src'));
        })
        .catch(function () {});
    })).then(function () { return movies; });
  }

  function showtimes(doc, url) {
    var dates = [];
    var seen = {};
    Array.prototype.forEach.call(doc.querySelectorAll('a[href*="/showtimes?d="]'), function (a) {
      var d = parseDateParam(a.getAttribute('href'));
      if (d && !seen[d]) { seen[d] = true; dates.push({ date: d, label: text(a) }); }
    });

    var movies = Array.prototype.map.call(doc.querySelectorAll('article.movie-compare'), function (art) {
      var hero = art.querySelector('aside.movie-hero');
      var tags = Array.prototype.map.call(hero ? hero.querySelectorAll('.tag') : [], text);
      var durationTag = tags.filter(function (t) { return /\bmin\b/.test(t); })[0];
      var cinemas = [];
      var current = null;
      var datesBlock = art.querySelector('.dates');
      Array.prototype.forEach.call(datesBlock ? datesBlock.children : [], function (child) {
        if (child.tagName === 'H3') {
          current = { name: text(child), formats: [] };
          cinemas.push(current);
        } else if (child.matches('ol.showtimes') && current) {
          Array.prototype.forEach.call(child.children, function (li) {
            var times = Array.prototype.map.call(li.querySelectorAll('a.showtime'), function (t) {
              return { time: text(t), bookingUrl: abs(t.getAttribute('href')), id: t.getAttribute('data-id') };
            });
            if (times.length) current.formats.push({ name: text(li.querySelector('strong')) || 'Standard', times: times });
          });
        }
      });
      var heroImg = hero && hero.querySelector('img');
      return {
        slug: art.getAttribute('data-slug'),
        title: text(hero && hero.querySelector('h2')),
        classification: text(hero && hero.querySelector('.classification')) || null,
        language: tags.filter(function (t) { return t !== durationTag; })[0] || null,
        durationMins: durationTag ? parseInt(durationTag, 10) || null : null,
        heroUrl: heroImg ? abs(heroImg.getAttribute('src')) : null,
        url: abs('/movies/' + art.getAttribute('data-slug')),
        cinemas: cinemas.filter(function (c) { return c.formats.length; }),
      };
    });

    // A bare `/showtimes` is today's schedule; its own date isn't a link in the date bar.
    return { date: parseDateParam(url) || cairoToday(), dates: dates, movies: movies };
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

  function errorMessage(e) { return String((e && e.message) || e); }

  // Prefix the app looks for to tell "VOX redesigned their site" from a network hiccup.
  var LAYOUT = 'Site layout changed: ';

  async function fetchDoc(path, selector) {
    var r = await fetch(path, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
    var doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    // A bot-check interstitial or a redesign comes back 200 too; make sure it's the page we know.
    if (!doc.querySelector(selector)) throw new Error(LAYOUT + path + ' has no ' + selector);
    return doc;
  }

  // Runs `tasks` (functions returning promises) at most `limit` at a time.
  async function runPool(tasks, limit) {
    var next = 0;
    async function worker() {
      while (next < tasks.length) await tasks[next++]();
    }
    var workers = [];
    for (var i = 0; i < Math.min(limit, tasks.length); i++) workers.push(worker());
    await Promise.all(workers);
  }

  async function crawl() {
    var today = showtimes(document, location.href);
    if (!today.movies.length && !today.dates.length) {
      throw new Error(LAYOUT + "VOX's showtimes page has no movies and no date bar");
    }
    report({ kind: 'showtimes', data: today });

    var failed = [];
    var tasks = [
      function () {
        return fetchDoc('/movies/comingsoon', 'article.movie-summary')
          .then(function (doc) { return fillMissingPosters(summaries(doc)); })
          .then(function (data) { report({ kind: 'comingSoon', data: data }); })
          .catch(function (e) { failed.push({ kind: 'comingSoon', error: errorMessage(e) }); });
      },
      function () {
        return fetchDoc('/movies/whatson', 'article.movie-summary')
          .then(function (doc) { return fillMissingPosters(summaries(doc)); })
          .then(function (data) { report({ kind: 'nowShowing', data: data }); })
          .catch(function (e) { failed.push({ kind: 'nowShowing', error: errorMessage(e) }); });
      },
    ];
    today.dates.forEach(function (d) {
      if (d.date === today.date) return;
      var path = '/showtimes?d=' + d.date.replace(/-/g, '');
      tasks.push(function () {
        return fetchDoc(path, 'article.movie-compare')
          .then(function (doc) { report({ kind: 'showtimes', data: showtimes(doc, path) }); })
          .catch(function (e) { failed.push({ kind: 'showtimes', date: d.date, error: errorMessage(e) }); });
      });
    });

    await runPool(tasks, PARALLEL);
    report({ kind: 'done', data: { failed: failed } });
  }

  async function onLoad() {
    var path = location.pathname.replace(/\/+$/, '');
    try {
      if (path === '/showtimes' && !parseDateParam(location.search)) await crawl();
      else if (path === '/showtimes') report({ kind: 'showtimes', data: showtimes(document, location.href) });
      else if (path === '/movies/comingsoon' || path === '/movies/whatson') {
        var movies = summaries(document);
        if (!movies.length) throw new Error(LAYOUT + path + ' has no movie listings');
        report({ kind: path === '/movies/comingsoon' ? 'comingSoon' : 'nowShowing', data: await fillMissingPosters(movies) });
      }
      else report({ kind: 'unknown', data: null });
    } catch (e) {
      report({ kind: 'error', data: errorMessage(e) });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onLoad);
  else onLoad();
})();
