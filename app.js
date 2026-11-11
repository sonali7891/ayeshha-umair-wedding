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

  var IMGBASE    = ORIGIN ? ORIGIN + '/' : BASE;
  var THUMBBASE  = THUMBORIGIN   ? THUMBORIGIN   + '/' : (ORIGIN ? IMGBASE : BASE);
  var PREVIEWBASE = PREVIEWORIGIN ? PREVIEWORIGIN + '/' : (ORIGIN ? IMGBASE : BASE);

  var PHOTO_DIR  = IMGBASE + 'photos/';
  var THUMB_DIR  = THUMBBASE + 'thumbs/';
  var PREV_DIR   = PREVIEWBASE + 'previews/';
  var DL_DIR     = IMGBASE + 'download/';

  var photos = [];
  var favourites = {};
  var view = [];          // photos currently displayed (respecting filter)
  var current = -1;
  var layout = 'masonry';
  var showFavsOnly = false;
  var slideTimer = null;
  var playing = false;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    loader: $('loader'), gallery: $('gallery'), sentinel: $('sentinel'),
    counter: $('counter'), heroCount: $('heroCount'), heroBg: $('heroBg'),
    introCount: $('introCount'), toolbar: $('toolbar'),
    lb: $('lightbox'), lbImg: $('lbImg'), lbStage: $('lbStage'),
    lbCounter: $('lbCounter'), lbDims: $('lbDims'), lbDownload: $('lbDownload'),
    lbFav: $('lbFav'), lbFavLabel: $('lbFavLabel'), lbPlay: $('lbPlay'),
    lbFull: $('lbFull'), lbFullLabel: $('lbFullLabel'),
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
    slice.forEach(function (p, k) {
      frag.appendChild(cardFor(p, rendered + k));
    });
    rendered += slice.length;
    el.gallery.appendChild(frag);

    // Fade in cards that are now visible.
    requestAnimationFrame(function () {
      el.gallery.querySelectorAll('.card:not(.is-in)').forEach(function (c) {
        var r = c.getBoundingClientRect();
        if (r.top < window.innerHeight + 400) c.classList.add('is-in');
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
  function initObserver() {
    if (!('IntersectionObserver' in window)) {
      var pump = function () { while (renderChunk()) {} };
      pump();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        renderChunk();
      }
    }, { rootMargin: '900px 0px' });
    io.observe(el.sentinel);

    // Fade-in observer for cards.
    var fade = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); fade.unobserve(e.target); }
      });
    }, { rootMargin: '200px' });
    window.__fadeObserver = fade;
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

  /* ---------- Lightbox ---------- */
  var showingFull = false;

  function openLightbox(i) {
    if (i < 0 || i >= view.length) return;
    current = i;
    var p = view[i];

    el.lb.classList.add('is-open');
    el.lb.classList.add('is-loading');
    el.lbImg.style.opacity = '0';

    el.lbImg.src = PREV_DIR + p.preview;
    el.lbImg.alt = 'Wedding photograph ' + (i + 1) + ' of ' + view.length;

    el.lbCounter.textContent = (i + 1) + ' / ' + view.length;
    el.lbDims.textContent = p.w + ' × ' + p.h + '  ·  ' + humanBytes(p.bytes) +
      (p.date ? '  ·  ' + formatDate(p.date) : '');
    el.lbDownload.href = DL_DIR + encodeURIComponent(p.src);
    el.lbDownload.setAttribute('download', p.src);

    syncLbFav();
    syncFullToggle();
    document.body.style.overflow = 'hidden';
  }

  // Toggle between the fast preview and the untouched 24MP original.
  function syncFullToggle() {
    showingFull = false;
    el.lbFull.classList.remove('is-on');
    el.lbFullLabel.textContent = 'Full resolution';
  }

  function toggleFullRes() {
    if (current < 0) return;
    var p = view[current];
    el.lb.classList.add('is-loading');
    el.lbImg.style.opacity = '0';

    if (showingFull) {
      el.lbImg.src = PREV_DIR + p.preview;
      el.lbFull.classList.remove('is-on');
      el.lbFullLabel.textContent = 'Full resolution';
      showingFull = false;
    } else {
      el.lbImg.src = PHOTO_DIR + encodeURIComponent(p.src);
      el.lbFull.classList.add('is-on');
      el.lbFullLabel.textContent = 'Showing original';
      showingFull = true;
    }
  }

  function closeLightbox() {
    el.lb.classList.remove('is-open');
    el.lb.classList.remove('is-loading');
    el.lbImg.src = '';
    stopSlideshow();
    document.body.style.overflow = '';
    current = -1;
  }

  function step(d) {
    if (current < 0) return;
    var n = (current + d + view.length) % view.length;
    openLightbox(n);
  }
  function startSlideshow() {
    if (playing) return;
    playing = true;
    el.lbPlay.classList.add('is-playing');
    el.lbPlay.innerHTML = '&#10074;&#10074;';
    slideTimer = setInterval(function () { step(1); }, 4200);
  }
  function stopSlideshow() {
    playing = false;
    el.lbPlay.classList.remove('is-playing');
    el.lbPlay.innerHTML = '&#9654;';
    if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
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
    $('lbPrev').addEventListener('click', function () { step(-1); });
    $('lbNext').addEventListener('click', function () { step(1); });
    el.lbPlay.addEventListener('click', function () { playing ? stopSlideshow() : startSlideshow(); });
    el.lbFav.addEventListener('click', function () { if (current >= 0) toggleFav(view[current]); });
    el.lbFull.addEventListener('click', toggleFullRes);

    // Reveal the image once it has actually decoded.
    el.lbImg.addEventListener('load', function () {
      el.lb.classList.remove('is-loading');
      el.lbImg.style.opacity = '1';
    });
    el.lbImg.addEventListener('error', function () {
      el.lb.classList.remove('is-loading');
      el.lbImg.style.opacity = '1';
    });

    el.lb.addEventListener('click', function (e) {
      if (e.target === el.lb || e.target === el.lbStage) closeLightbox();
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
      if (e.key === ' ') { e.preventDefault(); playing ? stopSlideshow() : startSlideshow(); }
      if (e.key.toLowerCase() === 'f' && current >= 0) toggleFav(view[current]);
    });

    // Swipe on touch devices
    var tx = 0, ty = 0;
    el.lb.addEventListener('touchstart', function (e) {
      tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY;
    }, { passive: true });
    el.lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - tx;
      var dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    // Fade-in observer hookup for newly appended cards
    var mo = new MutationObserver(function () {
      if (!window.__fadeObserver) return;
      el.gallery.querySelectorAll('.card:not(.is-in)').forEach(function (c) {
        window.__fadeObserver.observe(c);
      });
    });
    mo.observe(el.gallery, { childList: true });

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
