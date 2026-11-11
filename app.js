/* ============================================================
   Ayesha Mansuri — Wedding Album
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
    lbPlay: $('lbPlay'), lbViewport: $('lbViewport'),
    favDrawer: $('favDrawer'), favGrid: $('favGrid'), favEmpty: $('favEmpty'),
    favToggle: $('favToggle')
  };

  /* ---------- Favourites (localStorage) ---------- */
  var LS_KEY = 'amesuri-wedding-favs';

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
    return fetch(BASE + 'manifest.json', { cache: 'no-cache' })
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

    // Observe every new card so it fades in when scrolled into view.
    created.forEach(function (c) {
      if (fadeObserver) fadeObserver.observe(c);
      else c.classList.add('is-in');
    });

    // Deterministic fallback: reveal anything already within (or above) the
    // viewport right now, so the grid is never blank while the observer
    // callback is still pending.
    requestAnimationFrame(function () {
      var vh = window.innerHeight;
      created.forEach(function (c) {
        var r = c.getBoundingClientRect();
        if (r.top < vh + 250 && r.bottom > -250) c.classList.add('is-in');
      });
    });
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
  var fadeObserver = null;

  // Must run before the first render so the initial cards are observed.
  function setupFadeObserver() {
    if (!('IntersectionObserver' in window)) return;
    fadeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          fadeObserver.unobserve(e.target);
        }
      });
    }, { rootMargin: '250px' });
  }

  function initObserver() {
    if (!('IntersectionObserver' in window)) {
      // No IO support: render everything and show it immediately.
      var pump = function () {
        while (renderChunk()) {}
        el.gallery.querySelectorAll('.card').forEach(function (c) { c.classList.add('is-in'); });
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
  var slidesRendered = [];
  var fitOverride = null;   // null = follow the ideal fit for the device

  // Decide how a photo should fill the screen for the current device.
  //  - Portrait screen + landscape photo: fill the screen (cover), otherwise
  //    a 3:2 photo would sit tiny in the middle of a tall phone.
  //  - Everything else: show the whole photo (contain).
  function idealFit(p) {
    var portraitScreen = window.innerHeight > window.innerWidth;
    var landscapePhoto = p.w >= p.h;
    return (portraitScreen && landscapePhoto) ? 'cover' : 'contain';
  }

  function applyFit(img, p) {
    if (!img || !p) return;
    img.style.objectFit = fitOverride || idealFit(p);
  }

  function toggleFit() {
    var s = slideEls[current];
    if (!s) return;
    var p = view[current];
    var img = s.querySelector('img');
    var cur = img.style.objectFit || idealFit(p);
    fitOverride = (cur === 'cover') ? 'contain' : 'cover';
    img.style.objectFit = fitOverride;
    flashHint(fitOverride === 'cover' ? 'Fill screen' : 'Fit whole photo');
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

  function slideFor(i) {
    if (slideEls[i]) return slideEls[i];
    var p = view[i];
    var s = document.createElement('div');
    s.className = 'lb-slide';
    s.dataset.idx = String(i);

    var img = document.createElement('img');
    img.alt = 'Wedding photograph ' + (i + 1) + ' of ' + view.length;
    img.decoding = 'async';
    img.src = showingFull ? PHOTO_DIR + encodeURIComponent(p.src) : PREV_DIR + p.preview;
    applyFit(img, p);
    img.addEventListener('load', function () {
      if (Number(s.dataset.idx) === current) el.lb.classList.remove('is-loading');
    });
    img.addEventListener('error', function () {
      if (Number(s.dataset.idx) === current) el.lb.classList.remove('is-loading');
    });

    s.appendChild(img);
    slideEls[i] = s;
    return s;
  }

  // Keep a small window of slides around the current one so swiping is
  // instant and memory stays bounded.
  function ensureSlides(center) {
    var lo = Math.max(0, center - 2);
    var hi = Math.min(view.length - 1, center + 2);
    for (var i in slideEls) {
      var k = Number(i);
      if (k < lo || k > hi) {
        if (slideEls[k] && slideEls[k].parentNode) slideEls[k].parentNode.removeChild(slideEls[k]);
        delete slideEls[i];
      }
    }
    for (var j = lo; j <= hi; j++) {
      if (!slideEls[j]) {
        var s = slideFor(j);
        el.lbTrack.appendChild(s);
      }
    }
    // Keep DOM order aligned with index order.
    var ordered = [];
    for (var m = lo; m <= hi; m++) if (slideEls[m]) ordered.push(slideEls[m]);
    ordered.forEach(function (n) { el.lbTrack.appendChild(n); });
    slidesRendered = ordered;
    return lo;
  }

  function trackOffsetFor(index, lo) {
    return -(index - lo) * window.innerWidth;
  }

  function applyTrack(offset, animate) {
    el.lbTrack.classList.toggle('animating', !!animate);
    el.lbTrack.style.transform = 'translate3d(' + offset + 'px,0,0)';
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
    syncLbFav();
  }

  function showChrome(show) {
    el.lbChrome.classList.toggle('is-hidden', !show);
    if (show) {
      clearTimeout(chromeTimer);
      chromeTimer = setTimeout(function () {
        if (!drag) el.lbChrome.classList.add('is-hidden');
      }, 3200);
    }
  }

  function openLightbox(i) {
    if (i < 0 || i >= view.length) return;
    current = i;
    showingFull = false;

    el.lb.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    var lo = ensureSlides(i);
    markActive(i);
    applyTrack(trackOffsetFor(i, lo), false);
    updateMeta(i);

    el.lbFull.classList.remove('is-on');
    el.lbFullLabel.textContent = 'Full resolution';

    var img = slideEls[i].querySelector('img');
    if (img && !img.complete) el.lb.classList.add('is-loading');

    showChrome(true);
    flashHint('Swipe to browse  ·  double-tap to fit');
  }

  function closeLightbox() {
    el.lb.classList.remove('is-open');
    el.lb.classList.remove('is-loading');
    stopSlideshow();
    slideEls = {};
    el.lbTrack.innerHTML = '';
    document.body.style.overflow = '';
    current = -1;
  }

  function goTo(n) {
    if (n < 0 || n >= view.length) return;
    current = n;
    var lo = ensureSlides(n);
    markActive(n);
    applyTrack(trackOffsetFor(n, lo), true);
    updateMeta(n);

    var img = slideEls[n] && slideEls[n].querySelector('img');
    if (img && !img.complete) el.lb.classList.add('is-loading');
    showChrome(true);
  }

  function step(d) { goTo(current + d); }

  /* ---------- Slideshow (3 second default) ---------- */
  var SLIDE_MS = 3000;

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
      if (current >= view.length - 1) {
        // Loop back to the first photo when the album ends.
        goTo(0);
      } else {
        step(1);
      }
    }, SLIDE_MS);
    showChrome(true);
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
    img.src = showingFull ? PHOTO_DIR + encodeURIComponent(p.src) : PREV_DIR + p.preview;

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



    el.lb.addEventListener('click', function (e) {
      if (e.target === el.lb || e.target === el.lbViewport) {
        showChrome(el.lbChrome.classList.contains('is-hidden'));
      }
    });

    $('favClose').addEventListener('click', closeFavDrawer);

    // Keyboard
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (el.lb.classList.contains('is-open')) closeLightbox();
        else if (el.favDrawer.classList.contains('is-open')) closeFavDrawer();
      }
      if (!el.lb.classList.contains('is-open')) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
      if (e.key.toLowerCase() === 'f' && current >= 0) toggleFav(view[current]);
    });

    // ---- Drag-to-swipe: the current photo is carried toward the next ----
    var startX = 0, startY = 0, startOffset = 0, lastX = 0, lastT = 0, velocity = 0;
    var axisLocked = null;

    function onDown(e) {
      if (current < 0) return;
      if (e.target.closest && e.target.closest('.lb-btn, .lb-arrow, .lb-close')) return;
      drag = true;
      axisLocked = null;
      startX = e.clientX; startY = e.clientY;
      lastX = e.clientX; lastT = Date.now();
      velocity = 0;
      stopSlideshow();
      var lo = ensureSlides(current);
      startOffset = trackOffsetFor(current, lo);
      el.lbTrack.classList.remove('animating');
      showChrome(false);
      el.lb.setPointerCapture && el.lb.setPointerCapture(e.pointerId);
    }

    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      if (!axisLocked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axisLocked === 'y') { drag = false; showChrome(true); return; }
      }

      // Rubber-band at the ends of the album.
      var w = window.innerWidth;
      var next = current + 1, prev = current - 1;
      var offset = startOffset + dx;
      if (dx > 0 && prev < 0) offset = startOffset + dx * 0.32;
      if (dx < 0 && next > view.length - 1) offset = startOffset + dx * 0.32;

      var now = Date.now();
      var dt = now - lastT;
      if (dt > 0) velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX; lastT = now;

      applyTrack(offset, false);
      e.preventDefault();
    }

    function onUp() {
      if (!drag) return;
      drag = false;

      // How far the track actually moved (positive = dragged towards the next).
      var now = parseFloat(el.lbTrack.style.transform.replace(/[^-\d.]/g, '')) || 0;
      var delta = startOffset - now;

      var threshold = window.innerWidth * 0.18;
      var target = current;

      if (velocity < -0.45) target = current + 1;
      else if (velocity > 0.45) target = current - 1;
      else if (delta > threshold) target = current + 1;
      else if (delta < -threshold) target = current - 1;

      if (target < 0) target = 0;
      if (target > view.length - 1) target = view.length - 1;

      if (target === current) {
        var lo = ensureSlides(current);
        applyTrack(trackOffsetFor(current, lo), true);
        showChrome(true);
      } else {
        goTo(target);
      }
    }

    el.lb.addEventListener('pointerdown', onDown, { passive: true });
    el.lb.addEventListener('pointermove', onMove, { passive: false });
    el.lb.addEventListener('pointerup', onUp, { passive: true });
    el.lb.addEventListener('pointercancel', onUp, { passive: true });

    // Double-tap toggles between filling the screen and showing the whole photo.
    var lastTap = 0, tapTimer = null;
    el.lb.addEventListener('pointerup', function (e) {
      if (e.target.closest && e.target.closest('.lb-btn, .lb-arrow, .lb-close')) return;
      var now = Date.now();
      if (now - lastTap < 320) {
        clearTimeout(tapTimer);
        lastTap = 0;
        toggleFit();
      } else {
        lastTap = now;
        tapTimer = setTimeout(function () { lastTap = 0; }, 320);
      }
    });

    window.addEventListener('resize', function () {
      if (current < 0) return;
      var lo = ensureSlides(current);
      applyTrack(trackOffsetFor(current, lo), false);
      for (var k in slideEls) {
        var s = slideEls[k];
        var im = s.querySelector('img');
        if (im) applyFit(im, view[Number(k)]);
      }
    });

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
      setupFadeObserver();
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
