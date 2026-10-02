// Home + Book a Call behaviour: menu, email popup, idea filter, FAQ, newsletter signups, booking flow.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var post = function (kind, data) {
    return fetch('/forms/' + kind, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
        });
      });
  };
  var lastFocus = null;
  var open = function (el, focusSel) {
    lastFocus = document.activeElement;
    el.hidden = false; document.body.classList.add('lock');
    var f = $(focusSel, el); if (f) f.focus();
  };
  var close = function (el) {
    el.hidden = true; document.body.classList.remove('lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };

  // Menu
  var menu = $('#menu'), burger = $('[data-menu-open]');
  if (menu) {
    burger.addEventListener('click', function () { burger.setAttribute('aria-expanded', 'true'); open(menu, '[data-menu-close]'); });
    $$('[data-menu-close]', menu).forEach(function (a) {
      a.addEventListener('click', function () { burger.setAttribute('aria-expanded', 'false'); close(menu); });
    });
  }

  // Email popup (menu button, "Don't see yours?" card, sticky bar)
  var ov = $('[data-popup-overlay]');
  if (ov) {
    $$('[data-popup]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (menu && !menu.hidden) { menu.hidden = true; burger.setAttribute('aria-expanded', 'false'); }
        open(ov, subscribed ? '[data-popup-close]' : 'input[type=email]');
      });
    });
    $('[data-popup-close]', ov).addEventListener('click', function () { close(ov); });
    ov.addEventListener('click', function (e) { if (e.target === ov) close(ov); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (ov && !ov.hidden) close(ov);
    else if (menu && !menu.hidden) { burger.setAttribute('aria-expanded', 'false'); close(menu); }
  });

  // Newsletter signups: one shared "subscribed" state across hero, section and popup
  var subscribed = false;
  var showSubscribed = function () {
    subscribed = true;
    $$('form[data-signup]').forEach(function (f) {
      var box = f.parentNode;
      if (box.hasAttribute('data-pop-form')) { box.hidden = true; box = box.parentNode; } else f.hidden = true;
      var ok = $('[data-ok]', box); if (ok) ok.hidden = false;
    });
  };
  $$('form[data-signup]').forEach(function (f) {
    var err = $('.err', f), btn = $('button', f);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      if (!f.email.checkValidity()) { err.textContent = 'Enter a valid email address.'; err.hidden = false; f.email.focus(); return; }
      btn.disabled = true;
      post('newsletter', { email: f.email.value.trim(), source: f.getAttribute('data-signup') })
        .then(showSubscribed)
        .catch(function (x) { err.textContent = x.message; err.hidden = false; })
        .then(function () { btn.disabled = false; });
    });
  });

  // Idea filter
  var filter = $('[data-ideas-filter]');
  if (filter) {
    $$('button', filter).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('button', filter).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var g = b.textContent;
        $$('.card[data-group]').forEach(function (c) { c.hidden = !(g === 'All' || c.getAttribute('data-group') === g); });
      });
    });
  }

  // FAQ (one open at a time)
  var faq = $('[data-faq]');
  if (faq) {
    var btns = $$('button', faq);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var wasOpen = b.getAttribute('aria-expanded') === 'true';
        btns.forEach(function (x) { x.setAttribute('aria-expanded', 'false'); $('i', x).textContent = '+'; x.nextElementSibling.hidden = true; });
        if (!wasOpen) { b.setAttribute('aria-expanded', 'true'); $('i', b).textContent = '−'; b.nextElementSibling.hidden = false; }
      });
    });
  }

  // Book a Call: open slots come from /book/slots (owner's calendar), shown in the visitor's zone
  var bk = $('[data-book]');
  if (bk) {
    var steps = $$('[data-step]', bk), state = { day: 0, time: null }, groups = [];
    var dayWrap = $('[data-days]', bk), timeWrap = $('[data-times]', bk), next = $('[data-next]', bk), msg = $('[data-slots-msg]', bk);
    var go = function (n) {
      steps.forEach(function (s) { s.hidden = s.getAttribute('data-step') !== String(n); });
      if (n > 0) bk.scrollIntoView({ block: 'start' });
    };
    var fmtDay = { weekday: 'short', month: 'short', day: 'numeric' };
    var fmtTime = { hour: 'numeric', minute: '2-digit' };
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

    var renderTimes = function () {
      timeWrap.innerHTML = '';
      (groups[state.day] ? groups[state.day].slots : []).forEach(function (iso) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = new Date(iso).toLocaleTimeString(undefined, fmtTime);
        b.setAttribute('aria-pressed', iso === state.time ? 'true' : 'false');
        b.addEventListener('click', function () { state.time = iso; sync(); });
        timeWrap.appendChild(b);
      });
    };
    var sync = function () {
      $$('button', dayWrap).forEach(function (b, k) { b.setAttribute('aria-pressed', k === state.day ? 'true' : 'false'); });
      renderTimes();
      next.disabled = !state.time;
      next.textContent = state.time ? 'Continue →' : 'Select a time';
    };
    var load = function (note) {
      state.time = null; next.disabled = true;
      msg.hidden = false; msg.textContent = note || 'Loading open times…';
      return fetch('/book/slots', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (j) {
          groups = [];
          (j.slots || []).forEach(function (iso) {
            var d = new Date(iso), key = d.toDateString(), g = groups[groups.length - 1];
            if (!g || g.key !== key) groups.push(g = { key: key, date: d, slots: [] });
            g.slots.push(iso);
          });
          groups = groups.slice(0, 10);
          dayWrap.innerHTML = '';
          groups.forEach(function (g, k) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('aria-label', g.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
            b.innerHTML = '<span></span><b></b><small></small>';
            b.children[0].textContent = g.date.toLocaleDateString(undefined, { weekday: 'short' });
            b.children[1].textContent = g.date.getDate();
            b.children[2].textContent = g.date.toLocaleDateString(undefined, { month: 'short' });
            b.addEventListener('click', function () { state.day = k; state.time = null; sync(); });
            dayWrap.appendChild(b);
          });
          if (state.day >= groups.length) state.day = 0;
          if (groups.length) msg.hidden = !note;
          else msg.textContent = 'No open times in the next two weeks. Email me and we will find one.';
          sync();
        })
        .catch(function () { msg.textContent = "Couldn't load open times. Refresh to try again."; });
    };
    load();

    var labels = function () {
      var d = new Date(state.time);
      var short = d.toLocaleDateString(undefined, fmtDay) + ' · ' + d.toLocaleTimeString(undefined, fmtTime);
      return { short: short, full: short + (tz ? ' (' + tz + ')' : '') };
    };
    next.addEventListener('click', function () {
      if (!state.time) return;
      $$('[data-slot-label]', bk).forEach(function (s) { s.textContent = labels().short; });
      go(1);
    });
    $('[data-back]', bk).addEventListener('click', function () { go(0); });

    var form = $('form[data-step]', bk), err = $('[data-err]', form);
    $$('[data-chips] .chip', form).forEach(function (c) {
      c.addEventListener('click', function () { c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
    });
    var picks = function (name) {
      return $$('[data-chips=' + name + '] .chip[aria-pressed=true]', form).map(function (c) { return c.textContent; });
    };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var bad = $$('input', form).filter(function (el) { return !el.checkValidity(); })[0];
      if (bad) { err.textContent = bad.type === 'email' ? 'Enter a valid email address.' : 'Please enter your name.'; bad.focus(); return; }
      var btn = $('button[type=submit]', form);
      btn.disabled = true;
      fetch('/forms/consultation', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.value.trim(), email: form.email.value.trim(), slot: state.time, slot_label: labels().full,
          renting: picks('renting'), drains: picks('drains'), notes: form.notes.value.trim(),
        }),
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.status === 409) { go(0); load(j.error); return; }
            if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
            go(2);
          });
        })
        .catch(function (x) { err.textContent = x.message; })
        .then(function () { btn.disabled = false; });
    });
  }
})();
