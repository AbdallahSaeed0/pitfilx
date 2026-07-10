(function () {
  // Injected after every navigation-complete event. Guard against double
  // injection (re-injected as a safety net even when the page didn't
  // actually navigate, e.g. some SPA history changes fire Finished twice).
  if (window.__pitflixBrowseInjected) return;
  window.__pitflixBrowseInjected = true;

  // ---- a) popup/redirect suppression ----------------------------------
  // Deliberately NOT overriding window.open() here. window.open() is also
  // how plenty of legitimate in-page interactions work (image/video
  // lightboxes, "view full size", etc. — this is exactly what broke
  // clicking through images on Getty Images). A JS-side override would
  // swallow the call before it ever reaches the native popup mechanism,
  // pre-empting the Rust-side `on_new_window` hook (mirrors WebView2's
  // NewWindowRequested) that already does the right thing: deny outright
  // for blocklisted ad/tracker domains, otherwise redirect the SAME
  // webview to the target URL instead of opening a real OS window. That
  // Rust hook is sufficient on its own and doesn't have this false-positive
  // problem, since it only fires for genuine navigation attempts.

  // ---- b) cosmetic ad hiding --------------------------------------------
  var AD_SELECTORS = [
    '[id*="google_ads"]',
    '[id^="div-gpt-ad"]',
    '[id*="dfp-ad"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="adnxs.com"]',
    'iframe[id^="google_ads_iframe"]',
    'ins.adsbygoogle',
    '[class*="ad-banner"]',
    '[class*="ad-container"]',
    '[class*="ad-slot"]',
    '[class^="ad-"]',
    '[class$="-ad"]',
    '[class*=" ad "]',
    '[id^="ad-"]',
    '[id$="-ad"]',
    '.advertisement',
    '.ads-container',
    '.sponsored-content',
  ];
  var AD_SELECTOR = AD_SELECTORS.join(',');

  function hideAds(root) {
    try {
      var nodes = root.querySelectorAll(AD_SELECTOR);
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].style.setProperty('display', 'none', 'important');
      }
    } catch (_) {}
  }

  hideAds(document);

  // ---- c) download overlay ------------------------------------------
  var MIN_SIZE = 150;
  // Two markers, both checked before doing ANY work on an element:
  //   ATTACHED_ATTR — a button already exists for this element. Set
  //   synchronously as the very first thing attachButton() does.
  //   PENDING_ATTR — we've already registered a deferred "wait for this
  //   element to become ready" listener for it. Without this, an element
  //   that isn't qualifying yet (e.g. a <video> whose metadata hasn't
  //   loaded) could get a SECOND deferred listener registered if the
  //   MutationObserver reports it again in a later, separate batch (its
  //   ancestor moved, a sibling changed, etc.) before the first listener
  //   has fired — both listeners would eventually fire and attempt to
  //   attach, which is exactly the "MutationObserver revisits an element
  //   it already started handling" duplicate-button bug.
  var ATTACHED_ATTR = 'data-pitflix-dl-attached';
  var PENDING_ATTR = 'data-pitflix-dl-pending';

  function mediaUrlFor(el) {
    if (el.tagName === 'IMG') return el.currentSrc || el.src || null;
    return null;
  }

  // ---- video source resolution -----------------------------------------
  // video.currentSrc / video.src is very often a `blob:` URL for sites using
  // MediaSource Extensions (any custom player, not just <video src="...">) —
  // blob URLs only exist inside that page's own JS heap and can't be fetched
  // independently from Rust/the backend. Chain of fallbacks, in order:
  //   1. A real http(s) URL directly on the element (or a <source> child).
  //   2. An embedded player-config object many custom players (Pornhub-style
  //      embeds are the common example) expose in an inline <script> tag as
  //      a `mediaDefinitions` array of { format, videoUrl, quality } entries.
  //
  // KNOWN LIMITATION: step 2 only recognizes the `mediaDefinitions` shape.
  // It does not attempt to guess at other sites' differently-shaped embedded
  // player configs (there is no single reliable pattern across the web) — on
  // any such site this simply finds nothing and the button is greyed out,
  // rather than guessing and shipping a download request that's likely to
  // fail.
  function directVideoUrl(el) {
    var direct = el.currentSrc || el.src || '';
    if (/^https?:\/\//i.test(direct)) return direct;
    var sources = el.querySelectorAll('source');
    for (var i = sources.length - 1; i >= 0; i--) {
      var su = sources[i].src || '';
      if (/^https?:\/\//i.test(su)) return su; // last <source> wins — pages usually list highest-res last
    }
    return null;
  }

  // Finds the index of the bracket/brace matching the opener at `openIdx`,
  // skipping over string-literal contents (including escaped quotes) so
  // nested `[`/`]`/`{`/`}` inside quoted strings don't throw off the count.
  function findMatchingBracket(text, openIdx) {
    var open = text[openIdx];
    var close = open === '[' ? ']' : '}';
    var depth = 0;
    var inString = false;
    var quoteChar = '';
    for (var i = openIdx; i < text.length; i++) {
      var c = text[i];
      if (inString) {
        if (c === '\\') { i++; continue; }
        if (c === quoteChar) inString = false;
        continue;
      }
      if (c === '"' || c === "'") { inString = true; quoteChar = c; continue; }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // Extracts and parses the `mediaDefinitions` array out of one script's raw
  // text, WITHOUT eval()-ing anything — locates the key, then the bracket
  // immediately following its colon, then walks forward to the matching
  // close bracket via findMatchingBracket() (a naive non-greedy regex like
  // `\[[\s\S]*?\]` would stop at the first `]`, which is usually the nested
  // per-entry `"quality":[...]` array, truncating the outer array).
  function extractMediaDefinitions(scriptText) {
    var key = '"mediaDefinitions"';
    var keyIdx = scriptText.indexOf(key);
    if (keyIdx === -1) {
      key = 'mediaDefinitions';
      keyIdx = scriptText.indexOf(key);
      if (keyIdx === -1) return null;
    }
    var colonIdx = scriptText.indexOf(':', keyIdx + key.length);
    if (colonIdx === -1) return null;
    var bracketIdx = scriptText.indexOf('[', colonIdx);
    if (bracketIdx === -1 || bracketIdx - colonIdx > 20) return null;
    var endIdx = findMatchingBracket(scriptText, bracketIdx);
    if (endIdx === -1) return null;
    try {
      var parsed = JSON.parse(scriptText.slice(bracketIdx, endIdx + 1));
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function scanMediaDefinitionsFromPage() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.src) continue; // only inline scripts carry embedded player config
      var text = s.textContent || '';
      if (text.indexOf('mediaDefinitions') === -1) continue;
      var defs = extractMediaDefinitions(text);
      if (defs && defs.length) return defs;
    }
    return null;
  }

  // Prefers a direct mp4 entry (no server-side processing needed); falls
  // back to the highest-quality hls entry otherwise.
  function pickFromMediaDefinitions(defs) {
    var mp4 = null;
    var bestHls = null;
    var bestHlsQuality = -1;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (!d || !d.videoUrl) continue;
      if (d.format === 'mp4' && !mp4) {
        mp4 = d.videoUrl;
      } else if (d.format === 'hls') {
        var qRaw = Array.isArray(d.quality) ? d.quality[0] : d.quality;
        var q = parseInt(qRaw, 10);
        if (isNaN(q)) q = 0;
        if (q >= bestHlsQuality) {
          bestHlsQuality = q;
          bestHls = d.videoUrl;
        }
      }
    }
    if (mp4) return { url: mp4, type: 'video' };
    if (bestHls) return { url: bestHls, type: 'hls' };
    return null;
  }

  /** Returns `{ url, type: 'video' | 'hls' }` or null. Safe to call
   * repeatedly (attach-time pre-check, delayed retry, and the authoritative
   * check right before actually sending the download request). */
  function resolveVideoSource(el) {
    var direct = directVideoUrl(el);
    if (direct) return { url: direct, type: 'video' };
    var defs = scanMediaDefinitionsFromPage();
    if (defs) {
      var picked = pickFromMediaDefinitions(defs);
      if (picked) return picked;
    }
    return null;
  }

  function isQualifying(el) {
    if (el.tagName === 'IMG') {
      var w = el.naturalWidth || el.width || 0;
      var h = el.naturalHeight || el.height || 0;
      return w >= MIN_SIZE && h >= MIN_SIZE;
    }
    if (el.tagName === 'VIDEO') {
      var vw = el.videoWidth || el.clientWidth || 0;
      var vh = el.videoHeight || el.clientHeight || 0;
      return vw >= MIN_SIZE || vh >= MIN_SIZE || el.clientWidth >= MIN_SIZE;
    }
    return false;
  }

  function sendDownloadRequest(url, type) {
    // The `pitflix-browse` custom scheme is served by WebView2 as a real
    // https virtual host (`use_https_scheme(true)` on the Rust side), so a
    // plain cross-origin fetch works from any http(s) page without
    // triggering mixed-content blocking. The response isn't read — this is
    // fire-and-forget; Rust re-emits the payload as a Tauri event.
    try {
      fetch('https://pitflix-browse.localhost/download', {
        method: 'POST',
        body: JSON.stringify({ url: url, type: type, pageUrl: window.location.href }),
      }).catch(function () {});
    } catch (_) {}
  }

  // Applies/refreshes the enabled-vs-greyed-out visual state for a video's
  // button based on current resolvability. Re-run once after a short delay
  // for sites whose player-config script finishes initializing slightly
  // after the <video> element itself already exists in the DOM — a single
  // retry, not a poll loop.
  function refreshVideoButtonState(el, btn, allowRetry) {
    var resolved = resolveVideoSource(el);
    if (resolved) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = 'pointer';
      btn.title = 'Download';
      return;
    }
    btn.disabled = true;
    btn.style.opacity = '0.35';
    btn.style.cursor = 'not-allowed';
    btn.title = 'No downloadable source found';
    if (allowRetry) {
      setTimeout(function () {
        if (btn.isConnected) refreshVideoButtonState(el, btn, false);
      }, 1500);
    }
  }

  function attachButton(el, type) {
    if (el.getAttribute(ATTACHED_ATTR)) return;
    el.setAttribute(ATTACHED_ATTR, '1');
    el.removeAttribute(PENDING_ATTR);

    var wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:absolute;top:6px;right:6px;z-index:2147483647;opacity:0;' +
      'transition:opacity .15s ease;pointer-events:none;';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Download';
    btn.textContent = '⬇'; // ⬇
    btn.style.cssText =
      'pointer-events:auto;width:28px;height:28px;border-radius:50%;border:none;' +
      'background:rgba(20,20,20,0.75);color:#fff;font-size:14px;line-height:28px;' +
      'text-align:center;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4);padding:0;';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.disabled) return;
      if (type === 'image') {
        var url = mediaUrlFor(el);
        if (url) sendDownloadRequest(url, 'image');
        return;
      }
      // Re-resolve right before sending — the authoritative, final check —
      // rather than trusting a possibly-stale greyed-out/enabled UI state.
      var resolved = resolveVideoSource(el);
      if (resolved) sendDownloadRequest(resolved.url, resolved.type);
    });

    wrapper.appendChild(btn);

    function position() {
      var host = el.parentElement;
      if (!host) return;
      if (window.getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }
      wrapper.style.position = 'absolute';
    }
    position();

    function show() {
      wrapper.style.opacity = '1';
    }
    function hide() {
      wrapper.style.opacity = '0';
    }
    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    wrapper.addEventListener('mouseenter', show);
    wrapper.addEventListener('mouseleave', hide);

    if (el.parentElement) {
      el.parentElement.appendChild(wrapper);
    }

    if (type === 'video') {
      refreshVideoButtonState(el, btn, true);
    }
  }

  function tryAttach(el) {
    if (el.getAttribute(ATTACHED_ATTR) || el.getAttribute(PENDING_ATTR)) return;
    var type = el.tagName === 'IMG' ? 'image' : el.tagName === 'VIDEO' ? 'video' : null;
    if (!type) return;

    if (isQualifying(el)) {
      attachButton(el, type);
      return;
    }
    // Not ready yet (image not loaded, video metadata not loaded). Mark as
    // pending BEFORE registering the deferred listener so a later
    // MutationObserver batch that revisits this same not-yet-qualifying
    // element (e.g. its ancestor moved) skips it via the check above
    // instead of registering a second listener.
    el.setAttribute(PENDING_ATTR, '1');
    if (el.tagName === 'IMG' && !el.complete) {
      el.addEventListener('load', function () {
        if (isQualifying(el)) attachButton(el, type);
        else el.removeAttribute(PENDING_ATTR);
      }, { once: true });
    } else if (el.tagName === 'VIDEO') {
      el.addEventListener('loadedmetadata', function () {
        if (isQualifying(el)) attachButton(el, type);
        else el.removeAttribute(PENDING_ATTR);
      }, { once: true });
    } else {
      el.removeAttribute(PENDING_ATTR);
    }
  }

  function scan(root) {
    try {
      var media = root.querySelectorAll('img,video');
      for (var i = 0; i < media.length; i++) tryAttach(media[i]);
    } catch (_) {}
  }

  scan(document);

  var observer = new MutationObserver(function (mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var added = mutations[m].addedNodes;
      for (var i = 0; i < added.length; i++) {
        var node = added[i];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG' || node.tagName === 'VIDEO') {
          tryAttach(node);
        } else if (node.querySelectorAll) {
          var found = node.querySelectorAll('img,video');
          for (var j = 0; j < found.length; j++) tryAttach(found[j]);
          hideAds(node);
        }
      }
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
