(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Email capture on the home page hands off to /newsletter?email=
  $$('form[data-email-redirect]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      location.href = '/newsletter?email=' + encodeURIComponent(f.email.value);
    });
  });

  // Hero slides
  var slides = [
    ['The Rent-repreneur Guide', 'Rent anything.', 'Trailers, paddleboards, tools, cars. If people need it for a weekend, you can own it and rent it. I show you exactly how.'],
    ['Own it. Rent it.', 'Replace it.', 'Replace your income one rental at a time — and still keep your 9–5. Bookings, payments and pickups run on autopilot.'],
    ['Free every Sunday', 'Rent-repreneur.', 'One item worth renting, one listing that works, one real number from my fleet. Straight to your inbox.'],
    ['On YouTube', 'Open book.', 'Every purchase, every booking, every dollar from my rental fleet — documented so you can copy what works.']
  ];
  var rail = $('[data-rail]');
  if (rail) {
    var i = 1, timer;
    var nums = [0, 1, 2, 3].map(function (n) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = '0' + (n + 1);
      b.addEventListener('click', function () { go(n); });
      rail.appendChild(b); return b;
    });
    var render = function () {
      var s = slides[i];
      ['eyebrow', 'word', 'desc'].forEach(function (k, j) { $('[data-slide=' + k + ']').textContent = s[j]; });
      nums.forEach(function (b, n) { b.className = n === i ? 'on' : ''; });
    };
    var start = function () {
      clearInterval(timer);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(function () { i = (i + 1) % 4; render(); }, 6000);
    };
    var go = function (n) { i = (n + 4) % 4; render(); start(); };
    $('[data-prev]').addEventListener('click', function () { go(i - 1); });
    $('[data-next]').addEventListener('click', function () { go(i + 1); });
    render(); start();
  }

  // Video filter tabs
  var vt = $('[data-vtabs]');
  if (vt) {
    var btns = $$('button', vt);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.className = x === b ? 'on' : ''; });
        var t = b.textContent;
        $$('.vcard').forEach(function (c) {
          var cat = c.getAttribute('data-cat');
          c.hidden = !(t === 'Popular' || t === 'See all' || cat === t || cat === 'Popular');
        });
      });
    });
    btns[0].click();
  }

  // FAQ accordion (one open at a time)
  var faq = $('[data-faq]');
  if (faq) {
    $$('button', faq).forEach(function (b) {
      b.addEventListener('click', function () {
        var open = b.getAttribute('aria-expanded') === 'true';
        $$('button', faq).forEach(function (x) {
          x.setAttribute('aria-expanded', 'false'); x.querySelector('i').textContent = '+'; x.nextElementSibling.hidden = true;
        });
        if (!open) { b.setAttribute('aria-expanded', 'true'); b.querySelector('i').textContent = '−'; b.nextElementSibling.hidden = false; }
      });
    });
  }

  // Forms (newsletter + consultation)
  var form = $('form[data-form]');
  if (form) {
    var kind = form.getAttribute('data-form');
    var err = $('[data-err]', form), done = $('[data-done]');
    var q = new URLSearchParams(location.search).get('email');
    if (q && form.email) form.email.value = q;

    $$('[data-chips] .chip', form).forEach(function (c) {
      c.addEventListener('click', function () {
        c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      });
    });
    $$('[data-seg] button', form).forEach(function (c) {
      c.addEventListener('click', function () {
        $$('button', c.parentNode).forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
      });
    });

    var picks = function (name) {
      return $$('[data-chips=' + name + '] .chip[aria-pressed=true]', form).map(function (c) { return c.textContent; });
    };
    var segv = function (name) {
      var b = $('[data-seg=' + name + '] button[aria-pressed=true]', form);
      return b ? b.textContent : '';
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var bad = $$('input', form).filter(function (el) { return !el.checkValidity(); })[0];
      if (bad) {
        err.textContent = bad.type === 'email' ? 'Enter a valid email address.' : bad.type === 'url' ? 'Enter a full URL, like https://example.com.' : 'Please fill in ' + (bad.name || 'this field') + '.';
        bad.focus(); return;
      }
      var data = { name: form.name.value.trim(), email: form.email.value.trim() };
      if (kind === 'newsletter') { data.interests = picks('interests'); data.stage = segv('stage'); }
      else {
        data.phone = form.phone.value.trim(); data.website = form.website.value.trim();
        data.started = segv('started'); data.renting = picks('renting'); data.learn = picks('learn'); data.notes = form.notes.value.trim();
      }
      var btn = $('button[type=submit]', form); btn.disabled = true;
      fetch('/forms/' + kind, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.'); }); })
        .then(function () {
          form.hidden = true; done.hidden = false;
          var n = $('[data-name]', done), m = $('[data-email]', done);
          if (n) n.textContent = data.name; if (m) m.textContent = data.email;
          window.scrollTo(0, 0);
        })
        .catch(function (x) { err.textContent = x.message; })
        .then(function () { btn.disabled = false; });
    });
    var reset = $('[data-reset]');
    if (reset) reset.addEventListener('click', function () { form.hidden = false; done.hidden = true; form.email.value = ''; });
  }
})();
