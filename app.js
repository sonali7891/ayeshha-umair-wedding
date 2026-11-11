/* ============================================================
   Ayeshha & Umair - Wedding Album
   Originals live at /photos/, display copies at /thumbs/ + /previews/.
   ============================================================ */
(function () {
  'use strict';

  // ---- Base paths ----------------------------------------------------
  // The album app can be served from GitHub Pages (where only the UI and the
  // small grid thumbnails live) or from the Oracle VM itself (everything
  // same-origin). Resolve both without hardcoding paths.
  //
  //   BASE -> directory this app was loaded from (for manifest.json)
  //
  // config.js may set any of the ALBUM_*_ORIGIN values to an absolute
  // origin; each defaults to empty (same-origin).
  var BASE = (function () {
    var s = document.currentScript;
    var p = s && s.src ? s.src : location.href;
    try { p = new URL(p, location.href).pathname; } catch (e) {}
    return p.replace(/[^/]*$/, '');
  })();

  function origin(v) { return (v || '').replace(/\/+$/, ''); }

  var ORIGIN        = origin(window.ALBUM_ORIGIN);
  var THUMBORIGIN   = origin(window.ALBUM_THUMB_ORIGIN);
  var PREVIEWORIGIN = origin(window.ALBUM_PREVIEW_ORIGIN);

  // Each asset group resolves independently:
  //   - an explicit absolute origin if configured, otherwise
  //   - the app's own directory (same-origin deployment).
  var LOCAL = BASE;

  var PHOTO_DIR  = (ORIGIN ? ORIGIN + '/' : LOCAL) + 'photos/';
  var DL_DIR     = (ORIGIN ? ORIGIN + '/' : LOCAL) + 'download/';
  var PREV_DIR   = (PREVIEWORIGIN ? PREVIEWORIGIN + '/'
                    : (ORIGIN ? ORIGIN + '/' : LOCAL)) + 'previews/';
  var THUMB_DIR  = (THUMBORIGIN ? THUMBORIGIN + '/' : LOCAL) + 'thumbs/';

  var photos = [];
  var favourites = {};
  var view = [];          // photos currently displayed (respecting filter)
  var current = -1;
  var layout = 'masonry';
  var showFavsOnly = false;
  var slideTimer = null;
  var playing = false;

  var BUILD = '2026.11.11-4';
  window.ALBUM_BUILD = BUILD;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    loader: $('loader'), gallery: $('gallery'), sentinel: $('sentinel'),
    counter: $('counter'), heroCount: $('heroCount'), heroBg: $('heroBg'),
    introCount: $('introCount'), toolbar: $('toolbar'),
    lb: $('lightbox'), lbTrack: $('lbTrack'), lbChrome: $('lbChrome'),
    lbCounter: $('lbCounter'), lbDims: $('lbDims'), lbDownload: $('lbDownload'),
    lbFav: $('lbFav'), lbFavLabel: $('lbFavLabel'),
    lbFull: $('lbFull'), lbFullLabel: $('lbFullLabel'),
    lbProgressFill: $('lbProgressFill'), lbHint: null,
    lbBackdrop: $('lbBackdrop'),
    lbPlay: $('lbPlay'), lbViewport: $('lbViewport'),
    favDrawer: $('favDrawer'), favGrid: $('favGrid'), favEmpty: $('favEmpty'),
    favToggle: $('favToggle')
  };

  /* ---------- Favourites (localStorage) ---------- */
  var LS_KEY = 'ayeshha-umair-wedding-favs';

  function loadFavs() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) favourites = JSON.parse(raw) || {};
    } catch (e) { favourites = {}; }
  }
  function saveFavs() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(favourites)); } catch (e) {}
  }
  function favCount() {
    var n = 0;
    for (var k in favourites) if (favourites.hasOwnProperty(k)) n++;
    return n;
  }

  /* ---------- Helpers ---------- */
  function humanBytes(n) {
    if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
  }

  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(iso);
    if (!m) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(m[3], 10) + ' ' + months[parseInt(m[2], 10) - 1] + ' ' + m[1] + ' · ' + m[4] + ':' + m[5];
  }

  /* ---------- Manifest ---------- */
  function loadManifest() {
    // Cache-busted so a stale manifest can never be served after an update.
    return fetch(BASE + 'manifest.json?v=' + BUILD, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('manifest ' + r.status);
        return r.json();
      });
  }

  /* ---------- Rendering ---------- */
  var rendered = 0;

  function cardFor(p, i) {
    var card = document.createElement('figure');
    card.className = 'card';
    card.dataset.idx = String(i);

    var img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = 'Wedding photograph ' + (i + 1);
    img.src = THUMB_DIR + p.thumb;
    img.dataset.full = PREV_DIR + p.preview;

    var fav = document.createElement('button');
    fav.className = 'card-fav' + (favourites[p.src] ? ' is-on' : '');
    fav.innerHTML = '&#9829;';
    fav.title = 'Favourite';
    fav.setAttribute('aria-label', 'Toggle favourite');
    fav.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFav(p, card.querySelector('.card-fav'));
    });

    var num = document.createElement('span');
    num.className = 'card-index';
    num.textContent = String(i + 1).padStart(3, '0');

    card.appendChild(img);
    card.appendChild(fav);
    card.appendChild(num);

    card.addEventListener('click', function () { openLightbox(i); });

    return card;
  }

  function renderChunk() {
    var slice = view.slice(rendered, rendered + 48);
    if (!slice.length) return false;

    var frag = document.createDocumentFragment();
    var created = [];
    slice.forEach(function (p, k) {
      var c = cardFor(p, rendered + k);
      created.push(c);
      frag.appendChild(c);
    });
    rendered += slice.length;
    el.gallery.appendChild(frag);

    return true;
  }

  function rebuild() {
    el.gallery.innerHTML = '';
    rendered = 0;
    view = showFavsOnly
      ? photos.filter(function (p) { return favourites[p.src]; })
      : photos.slice();
    el.gallery.classList.toggle('masonry', layout === 'masonry');
    el.gallery.classList.toggle('grid', layout === 'grid');
    updateCounter();
    renderChunk();
  }

  function updateCounter() {
    var label = view.length + (view.length === 1 ? ' photograph' : ' photographs');
    if (showFavsOnly) label += ' · favourited';
    el.counter.textContent = label;
  }

  /* ---------- Lazy loading ---------- */

  // Must run before the first render so the initial cards are observed.
  function initObserver() {
    if (!('IntersectionObserver' in window)) {
      // No IO support: render everything and show it immediately.
      var pump = function () {
        while (renderChunk()) {}
        
      };
      pump();
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        renderChunk();
      }
    }, { rootMargin: '900px 0px' });
    io.observe(el.sentinel);
  }

  /* ---------- Favourites ---------- */
  function toggleFav(p, btn) {
    if (favourites[p.src]) {
      delete favourites[p.src];
      if (btn) btn.classList.remove('is-on');
    } else {
      favourites[p.src] = 1;
      if (btn) btn.classList.add('is-on');
    }
    saveFavs();
    renderFavGrid();
    if (showFavsOnly) rebuild();
    if (current >= 0 && view[current] && view[current].src === p.src) syncLbFav();
  }

  function syncLbFav() {
    var p = view[current];
    if (!p) return;
    var on = !!favourites[p.src];
    el.lbFav.classList.toggle('is-on', on);
    el.lbFavLabel.textContent = on ? 'Favourited' : 'Favourite';
  }

  function renderFavGrid() {
    var list = photos.filter(function (p) { return favourites[p.src]; });
    el.favGrid.innerHTML = '';
    el.favEmpty.style.display = list.length ? 'none' : 'block';
    list.forEach(function (p) {
      var img = document.createElement('img');
      img.src = THUMB_DIR + p.thumb;
      img.alt = 'Favourite photograph';
      img.loading = 'lazy';
      img.addEventListener('click', function () {
        var idx = view.indexOf(p);
        if (idx < 0) {
          showFavsOnly = false;
          el.favToggle.checked = false;
          rebuild();
          idx = view.indexOf(p);
        }
        closeFavDrawer();
        openLightbox(idx);
      });
      el.favGrid.appendChild(img);
    });
  }

  /* ---------- Immersive swipe viewer ---------- */
  var showingFull = false;
  var slideEls = {};        // index -> slide element
  var drag = null;          // active pointer drag state
  var chromeTimer = null;
  var trackAnimTimer = null;
  var zoom = { on: false, scale: 1, x: 0, y: 0 };

  // Work out the exact pixel box that shows the whole photo, at its true
  // aspect ratio, inside the current viewport. The picture is never cropped
  // and never stretched - it is shown exactly as it was taken.
  function sizeSlideImage(img, p) {
    if (!img || !p) return;
    var sw = window.innerWidth;
    var sh = window.innerHeight;
    var photoAspect = p.w / p.h;
    var screenAspect = sw / sh;
    var w, h;
    if (photoAspect >= screenAspect) {
      w = sw; h = sw / photoAspect;
    } else {
      h = sh; w = sh * photoAspect;
    }
    img.style.width = Math.round(w) + 'px';
    img.style.height = Math.round(h) + 'px';
    img.style.objectFit = 'contain';
  }

  function applyZoom(img) {
    if (!img) return;
    img.style.setProperty('--zx', zoom.x.toFixed(1) + 'px');
    img.style.setProperty('--zy', zoom.y.toFixed(1) + 'px');
    img.style.setProperty('--zs', zoom.scale.toFixed(3));
  }

  function resetZoom() {
    zoom.on = false; zoom.scale = 1; zoom.x = 0; zoom.y = 0;
    var s = slideEls[current];
    if (s) applyZoom(s.querySelector('img'));
  }

  // Double tap: zoom in on the photo (uniform scale, aspect ratio kept) or
  // zoom back out to the whole picture.
  function toggleFit(e) {
    var s = slideEls[current];
    if (!s) return;
    var img = s.querySelector('img');
    if (!img) return;

    if (!zoom.on) {
      var rect = img.getBoundingClientRect();
      var px = (e && e.clientX != null) ? e.clientX : rect.left + rect.width / 2;
      var py = (e && e.clientY != null) ? e.clientY : rect.top + rect.height / 2;
      var cx = px - (rect.left + rect.width / 2);
      var cy = py - (rect.top + rect.height / 2);
      zoom.on = true;
      zoom.scale = 2.4;
      zoom.x = -cx * (zoom.scale - 1);
      zoom.y = -cy * (zoom.scale - 1);
      flashHint('Zoomed  ·  drag to pan');
    } else {
      resetZoom();
      flashHint('Whole photo');
    }
    applyZoom(img);
  }

  function flashHint(text) {
    if (!el.lbHint) {
      el.lbHint = document.createElement('div');
      el.lbHint.className = 'lb-hint';
      el.lb.appendChild(el.lbHint);
    }
    el.lbHint.textContent = text;
    el.lbHint.style.animation = 'none';
    void el.lbHint.offsetHeight;
    el.lbHint.style.animation = 'hintFade 2.6s ease forwards';
  }

  // Place a slide at its own index. Because every slide is absolutely
  // positioned, adding or removing one never disturbs the others.
  function positionSlide(s, i) {
    var W = window.innerWidth;
    var H = window.innerHeight;
    s.style.width = W + 'px';
    s.style.height = H + 'px';
    s.style.transform = 'translate3d(' + (i * W) + 'px,0,0)';
  }

  function slideFor(i) {
    if (slideEls[i]) return slideEls[i];
    var p = view[i];
    var s = document.createElement('div');
    s.className = 'lb-slide';
    s.dataset.idx = String(i);
    positionSlide(s, i);

    // Show the small thumbnail straight away as a placeholder so the slide
    // is never empty, then fade the larger preview in over it.
    s.style.backgroundImage = 'url("' + THUMB_DIR + p.thumb + '")';
    s.style.backgroundSize = 'contain';
    s.style.backgroundPosition = 'center';
    s.style.backgroundRepeat = 'no-repeat';

    var img = document.createElement('img');
    img.alt = 'Wedding photograph ' + (i + 1) + ' of ' + view.length;
    img.decoding = 'async';
    img.style.opacity = '0';
    var fullSrc = showingFull ? PHOTO_DIR + encodeURIComponent(p.src) : PREV_DIR + p.preview;
    img.src = fullSrc;
    sizeSlideImage(img, p);
    applyZoom(img);
    var reveal = function () {
      img.style.opacity = '1';
      // Safety net: if the file's real aspect ratio disagrees with the
      // manifest (a rotated photo, a stale entry), re-fit the box to the
      // pixels the browser actually decoded so the picture is never
      // squashed or cropped.
      var nw = img.naturalWidth;
      var nh = img.naturalHeight;
      if (nw && nh) {
        var box = img.getBoundingClientRect();
        if (box.width > 1 && box.height > 1 &&
            Math.abs((nw / nh) - (box.width / box.height)) > 0.005) {
          sizeSlideImage(img, { w: nw, h: nh });
          applyZoom(img);
        }
      }
      if (Number(s.dataset.idx) === current) el.lb.classList.remove('is-loading');
    };
    img.addEventListener('load', reveal);
    img.addEventListener('error', reveal);
    if (img.complete && img.naturalWidth > 0) reveal();

    s.appendChild(img);
    slideEls[i] = s;
    return s;
  }

  // Warm the previews that sit just OUTSIDE the slide window - those are the
  // ones the next swipe will need. Anything inside the window has already
  // had its <img src> assigned by slideFor(), so prefetching it would just
  // duplicate an in-flight request and waste mobile data.
  var prefetched = {};
  var prefetchRefs = [];
  function prefetch(i) {
    if (i < 0 || i >= view.length || prefetched[i]) return;
    if (slideEls[i]) return;              // already being fetched by its slide
    prefetched[i] = 1;
    var im = new Image();
    // Keep the reference alive until the load settles - dropping it straight
    // away can let a memory-constrained mobile browser cancel the fetch.
    im.onload = im.onerror = function () { im.onload = im.onerror = null; };
    im.src = PREV_DIR + view[i].preview;
    prefetchRefs.push(im);
    if (prefetchRefs.length > 8) prefetchRefs.shift();
  }

  // Free the decoded bitmap of a slide that is leaving the window.
  function releaseSlide(s) {
    if (!s) return;
    var im = s.querySelector('img');
    if (im) {
      im.src = '';                       // releases the decoded image
      im.removeAttribute('src');
      im.style.opacity = '0';
    }
    s.style.backgroundImage = '';
  }

  // Keep a window of slides around the current one so swiping is
  // instant and memory stays bounded.
  function ensureSlides(center) {
    // A phone can afford fewer full-screen decoded previews than a desktop.
    var span = window.innerWidth <= 760 ? 2 : 3;
    var lo = Math.max(0, center - span);
    var hi = Math.min(view.length - 1, center + span);
    for (var i in slideEls) {
      var k = Number(i);
      if (k < lo || k > hi) {
        var leaving = slideEls[i];
        releaseSlide(leaving);
        if (leaving && leaving.parentNode) leaving.parentNode.removeChild(leaving);
        delete slideEls[i];
      }
    }
    for (var j = lo; j <= hi; j++) {
      if (!slideEls[j]) {
        var s = slideFor(j);
        // Absolute positioning means the DOM order is irrelevant, so a
        // plain append is safe and never disturbs the other slides.
        el.lbTrack.appendChild(s);
        slideEls[j] = s;
      }
    }
    // Warm the leading edges just outside the window.
    prefetch(center - (span + 1));
    prefetch(center + (span + 1));
    return lo;
  }

  // The track offset depends only on the current index - never on which
  // slides happen to be mounted - so it can never jump.
  function trackOffsetFor(index) {
    return -index * window.innerWidth;
  }

  // Read the current X offset of the track. NOTE: a naive
  // parseFloat(el.style.transform) returns 3 for "translate3d(...)"
  // because of the digit in "translate3d" - so extract it properly.
  function currentOffset() {
    var m = /translate(?:3d|X)?\(\s*(-?[\d.]+)px/.exec(el.lbTrack.style.transform || '');
    return m ? parseFloat(m[1]) : 0;
  }

  function applyTrack(offset, animate) {
    el.lbTrack.classList.toggle('animating', !!animate);
    el.lbTrack.style.transform = 'translate3d(' + offset + 'px,0,0)';
    clearTimeout(trackAnimTimer);
    if (animate) {
      trackAnimTimer = setTimeout(function () {
        el.lbTrack.classList.remove('animating');
      }, 460);
    }
  }

  function markActive(i) {
    for (var k in slideEls) {
      slideEls[k].classList.toggle('is-active', Number(k) === i);
    }
  }

  function updateMeta(i) {
    var p = view[i];
    if (!p) return;
    el.lbCounter.textContent = (i + 1) + ' / ' + view.length;
    el.lbDims.textContent = p.w + ' × ' + p.h + '  ·  ' + humanBytes(p.bytes) +
      (p.date ? '  ·  ' + formatDate(p.date) : '');
    el.lbDownload.href = DL_DIR + encodeURIComponent(p.src);
    el.lbDownload.setAttribute('download', p.src);
    el.lbProgressFill.style.width = (((i + 1) / view.length) * 100) + '%';
    if (el.lbBackdrop) {
      el.lbBackdrop.style.backgroundImage = 'url("' + PREV_DIR + p.preview + '")';
      el.lbBackdrop.classList.add('is-ready');
    }
    syncLbFav();
  }

  function showChrome(show) {
    el.lbChrome.classList.toggle('is-hidden', !show);
    if (show) {
      clearTimeout(chromeTimer);
      chromeTimer = setTimeout(function () {
        if (!drag) el.lbChrome.classList.add('is-hidden');
      }, 2400);
    } else {
      clearTimeout(chromeTimer);
    }
  }

  function openLightbox(i) {
    if (i < 0 || i >= view.length) return;
    current = i;
    showingFull = false;
    zoom.on = false; zoom.scale = 1; zoom.x = 0; zoom.y = 0;

    el.lb.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    ensureSlides(i);
    markActive(i);
    applyTrack(trackOffsetFor(i), false);
    updateMeta(i);

    el.lbFull.classList.remove('is-on');
    el.lbFullLabel.textContent = 'Full resolution';

    var img = slideEls[i].querySelector('img');
    if (img && !img.complete) el.lb.classList.add('is-loading');

    showChrome(true);
    flashHint('Swipe to browse  ·  double-tap to zoom');
  }

  function closeLightbox() {
    el.lb.classList.remove('is-open');
    el.lb.classList.remove('is-loading');
    stopSlideshow();
    slideEls = {};
    el.lbTrack.innerHTML = '';
    if (el.lbBackdrop) {
      el.lbBackdrop.classList.remove('is-ready');
      el.lbBackdrop.style.backgroundImage = '';
    }
    document.body.style.overflow = '';
    current = -1;
  }

  function goTo(n, opts) {
    if (drag) return;                 // never fight an in-flight gesture
    if (n < 0 || n >= view.length) return;
    opts = opts || {};
    current = n;
    ensureSlides(n);
    markActive(n);
    applyTrack(trackOffsetFor(n), opts.animate !== false);
    updateMeta(n);

    var img = slideEls[n] && slideEls[n].querySelector('img');
    if (img && !img.complete) {
      // Only show the spinner if the image is genuinely slow, so a fast
      // load never causes a distracting flash of the spinner.
      var slow = setTimeout(function () { el.lb.classList.add('is-loading'); }, 250);
      img.addEventListener('load', function () { clearTimeout(slow); el.lb.classList.remove('is-loading'); }, { once: true });
      img.addEventListener('error', function () { clearTimeout(slow); el.lb.classList.remove('is-loading'); }, { once: true });
    }
    // The controls are never revealed by an automatic/programmatic move.
  }

  function step(d) { goTo(current + d); }

  /* ---------- Slideshow (3 second default) ---------- */
  var SLIDE_MS = 2000;

  function startSlideshow() {
    if (playing) return;
    playing = true;
    el.lbPlay.classList.add('is-playing');
    el.lbPlay.setAttribute('aria-label', 'Pause slideshow');
    var icon = el.lbPlay.querySelector('.lb-play-icon');
    var pause = el.lbPlay.querySelector('.lb-pause-icon');
    if (icon) icon.style.display = 'none';
    if (pause) pause.style.display = '';
    slideTimer = setInterval(function () {
      if (document.hidden || drag) return;   // never advance mid-gesture
      if (current >= view.length - 1) {
        // Loop back to the first photo instantly - an animated sweep
        // across the whole album would be disorienting.
        goTo(0, { animate: false });
      } else {
        step(1);
      }
    }, SLIDE_MS);
    // A running slideshow shows the photograph and nothing else.
    showChrome(false);
  }

  function stopSlideshow() {
    playing = false;
    el.lbPlay.classList.remove('is-playing');
    el.lbPlay.setAttribute('aria-label', 'Start slideshow');
    var icon = el.lbPlay.querySelector('.lb-play-icon');
    var pause = el.lbPlay.querySelector('.lb-pause-icon');
    if (icon) icon.style.display = '';
    if (pause) pause.style.display = 'none';
    if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
  }

  // Swap the active slide between the fast preview and the original file.
  function toggleFullRes() {
    if (current < 0) return;
    var p = view[current];
    var s = slideEls[current];
    if (!s) return;
    var img = s.querySelector('img');

    el.lb.classList.add('is-loading');
    showingFull = !showingFull;
    img.style.opacity = '0';
    img.src = showingFull ? PHOTO_DIR + encodeURIComponent(p.src) : PREV_DIR + p.preview;
    sizeSlideImage(img, p);
    applyZoom(img);

    if (showingFull) {
      el.lbFull.classList.add('is-on');
      el.lbFullLabel.textContent = 'Showing original';
    } else {
      el.lbFull.classList.remove('is-on');
      el.lbFullLabel.textContent = 'Full resolution';
    }
  }

  /* ---------- Drawer ---------- */
  function openFavDrawer() { el.favDrawer.classList.add('is-open'); renderFavGrid(); }
  function closeFavDrawer() { el.favDrawer.classList.remove('is-open'); }

  /* ---------- Hero ---------- */
  function setupHero() {
    if (!photos.length) return;
    // A few good frames from across the day.
    var picks = [0, Math.floor(photos.length * 0.25), Math.floor(photos.length * 0.5),
                 Math.floor(photos.length * 0.75), photos.length - 1];
    var i = 0;
    var img = new Image();
    img.onload = function () {
      el.heroBg.style.backgroundImage = 'url("' + PREV_DIR + photos[picks[i]].preview + '")';
      el.heroBg.classList.add('is-ready');
    };
    img.src = PREV_DIR + photos[picks[0]].preview;

    // Cycle the hero background slowly through a few frames.
    setInterval(function () {
      i = (i + 1) % picks.length;
      var n = new Image();
      n.onload = function () {
        el.heroBg.style.backgroundImage = 'url("' + PREV_DIR + photos[picks[i]].preview + '")';
      };
      n.src = PREV_DIR + photos[picks[i]].preview;
    }, 9000);
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    document.querySelectorAll('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        layout = b.dataset.layout;
        rebuild();
      });
    });

    el.favToggle.addEventListener('change', function () {
      showFavsOnly = el.favToggle.checked;
      rebuild();
      el.toolbar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('lbClose').addEventListener('click', closeLightbox);
    $('lbPrev').addEventListener('click', function () { stopSlideshow(); step(-1); });
    $('lbNext').addEventListener('click', function () { stopSlideshow(); step(1); });
    el.lbPlay.addEventListener('click', function () {
      if (playing) { stopSlideshow(); } else { startSlideshow(); }
    });
    el.lbFav.addEventListener('click', function () { if (current >= 0) toggleFav(view[current]); });
    el.lbFull.addEventListener('click', toggleFullRes);





    $('favClose').addEventListener('click', closeFavDrawer);

    // Keyboard
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (el.lb.classList.contains('is-open')) closeLightbox();
        else if (el.favDrawer.classList.contains('is-open')) closeFavDrawer();
      }
      if (!el.lb.classList.contains('is-open')) return;
      if (e.key === 'ArrowLeft') { stopSlideshow(); step(-1); }
      if (e.key === 'ArrowRight') { stopSlideshow(); step(1); }
      if (e.key.toLowerCase() === 'f' && current >= 0) toggleFav(view[current]);
    });

    // ---- Drag-to-swipe: the current photo is carried toward the next ----
    var startX = 0, startY = 0, startOffset = 0, lastX = 0, lastT = 0, velocity = 0;
    var wasDrag = false;
    var panStartX = 0, panStartY = 0;
    var axisLocked = null;

    function onDown(e) {
      if (current < 0) return;
      if (e.target.closest && e.target.closest('.lb-btn, .lb-arrow, .lb-close')) return;
      drag = true;
      wasDrag = false;
      axisLocked = null;
      startX = e.clientX; startY = e.clientY;
      lastX = e.clientX; lastT = Date.now();
      velocity = 0;
      stopSlideshow();
      ensureSlides(current);
      startOffset = trackOffsetFor(current);
      el.lbTrack.classList.remove('animating');
      panStartX = zoom.x; panStartY = zoom.y;
      // Hide every control for the duration of the gesture so only the
      // photograph is visible while the viewer is swiping.
      el.lb.classList.add('is-dragging');
      showChrome(false);
      try { el.lb.setPointerCapture(e.pointerId); } catch (err) {}
    }

    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      if (zoom.on) {
        // Zoomed in: pan the photo instead of swiping.
        if (!axisLocked) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          axisLocked = 'xy';
        }
        wasDrag = true;
        var s = slideEls[current];
        var im = s && s.querySelector('img');
        if (im) {
          zoom.x = panStartX + dx;
          zoom.y = panStartY + dy;
          im.style.transition = 'none';   // pan must follow the finger exactly
          applyZoom(im);
        }
        if (e.cancelable) e.preventDefault();
        return;
      }

      if (!axisLocked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axisLocked === 'y') { drag = false; el.lb.classList.remove('is-dragging'); return; }
      }
      if (Math.abs(dx) > 8) wasDrag = true;

      // Rubber-band at the ends of the album.
      var w = window.innerWidth;
      var next = current + 1, prev = current - 1;
      var offset = startOffset + dx;
      if (dx > 0 && prev < 0) offset = startOffset + dx * 0.32;
      if (dx < 0 && next > view.length - 1) offset = startOffset + dx * 0.32;

      var now = Date.now();
      var dt = now - lastT;
      // Only trust the velocity sample when it is recent (ignore the long
      // gaps a throttled/background tab can produce).
      if (dt > 0 && dt < 120) velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX; lastT = now;

      applyTrack(offset, false);
      if (e.cancelable) e.preventDefault();
    }

    function onUp() {
      if (!drag) return;
      drag = false;
      el.lb.classList.remove('is-dragging');

      if (zoom.on) {
        // Panning a zoomed photo - stay on the same picture.
        var zs = slideEls[current];
        var zi = zs && zs.querySelector('img');
        if (zi) zi.style.transition = '';
        showChrome(false);
        return;
      }

      // How far the track actually moved (positive = dragged towards the next).
      var delta = startOffset - currentOffset();

      var threshold = window.innerWidth * 0.16;
      var target = current;

      // Distance is the primary signal; velocity only adds a flick in the
      // same direction, so a slow deliberate swipe is never misjudged.
      if (delta > threshold || velocity < -0.45) target = current + 1;
      else if (delta < -threshold || velocity > 0.45) target = current - 1;

      if (target < 0) target = 0;
      if (target > view.length - 1) target = view.length - 1;

      if (target === current) {
        // Not far enough to change photo: snap back, keep the chrome hidden.
        var lo = ensureSlides(current);
        applyTrack(trackOffsetFor(current), true);
      } else {
        goTo(target);
      }
      // The controls stay hidden after a swipe - the viewer sees only the photo.
      showChrome(false);
    }

    el.lb.addEventListener('pointerdown', onDown, { passive: true });
    el.lb.addEventListener('pointermove', onMove, { passive: false });
    el.lb.addEventListener('pointerup', onUp, { passive: true });
    el.lb.addEventListener('pointercancel', onUp, { passive: true });

    // A tap (as opposed to a swipe) toggles the controls.
    // A double tap switches between filling the screen and the whole photo.
    var lastTap = 0;
    el.lb.addEventListener('pointerup', function (e) {
      if (e.target.closest && e.target.closest('.lb-btn, .lb-arrow, .lb-close')) return;
      if (wasDrag) { wasDrag = false; return; }
      var now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        toggleFit(e);
      } else {
        lastTap = now;
      }
      showChrome(el.lbChrome.classList.contains('is-hidden'));
    });

    window.addEventListener('resize', function () {
      if (current < 0) return;
      for (var k in slideEls) {
        var s2 = slideEls[k];
        positionSlide(s2, Number(k));
        var im2 = s2.querySelector('img');
        if (im2) { sizeSlideImage(im2, view[Number(k)]); applyZoom(im2); }
      }
      applyTrack(trackOffsetFor(current), false);
    });

    // Do not keep advancing in a hidden tab.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && playing) stopSlideshow();
    });
    el.lbCounter.setAttribute('aria-live', 'polite');
    el.lbCounter.setAttribute('aria-atomic', 'true');

    var cue = $('scrollCue');
    if (cue) cue.addEventListener('click', function () {
      document.querySelector('.intro').scrollIntoView({ behavior: 'smooth' });
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    loadFavs();
    loadManifest().then(function (m) {
      photos = m.photos || [];
      el.heroCount.textContent = photos.length;
      el.introCount.textContent = photos.length;
      rebuild();
      initObserver();

      setupHero();
      bindEvents();
      setTimeout(function () { el.loader.classList.add('is-hidden'); }, 350);
    }).catch(function (err) {
      el.loader.innerHTML = '<p class="loader-text">Could not load the album manifest.<br><small>' +
        err.message + '</small></p>';
      console.error(err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
