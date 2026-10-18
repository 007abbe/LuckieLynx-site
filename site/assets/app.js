window.LL_CONFIG = {"url": "https://qeslzsokehipmemjfcva.supabase.co", "key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlc2x6c29rZWhpcG1lbWpmY3ZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyMjUyNjcsImV4cCI6MjEwNzgwMTI2N30.8GxM7Zqa1YKWIkuVHIu_FE5E35lSL1TK1LRNS3Dsjjw", "preview": false};
(function () {
  /* ---------- accounts ---------- */
  var CFG = window.LL_CONFIG || {};
  var PREVIEW = !!CFG.preview || !window.supabase;
  var fromEmailLink = /access_token|error_description/.test(location.hash);
  var sb = PREVIEW ? null : window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var NAME_HINT = '3 to 16 characters. Letters, numbers and underscores.';
  var TOPIC_LABELS = { alpha: 'alpha and beta launch', competitions: 'big competitions and cash prize events', updates: 'major game updates' };

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.hidden = !on; }
  function setNote(el, msg, kind) {
    el.textContent = msg || '';
    el.classList.toggle('err', kind === 'err');
    el.classList.toggle('ok', kind === 'ok');
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; }
    else { if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.disabled = false; }
  }
  function friendly(err) {
    var m = (err && (err.message || err.error_description)) || String(err || '');
    if (/already registered|already exists/i.test(m)) return 'An account with this email already exists. Sign in instead.';
    if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/Email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link we sent.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts right now. Wait a few minutes and try again.';
    if (/Database error saving new user/i.test(m)) return 'That username was just taken. Pick another one.';
    if (/password/i.test(m) && /(should|weak|least|short)/i.test(m)) return 'Choose a stronger password with at least 8 characters.';
    if (/fetch|network|Failed to|Load failed/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
    return m || 'Something went wrong. Try again.';
  }
  function listTopics(t) { return t.map(function (k) { return TOPIC_LABELS[k] || k; }).join(', '); }

  /* the two backends: real Supabase, or a demo for the design preview */
  var mock = { user: null, prefs: { email_pref: 'picked', email_topics: ['alpha', 'competitions'] }, access: [] };
  var api = PREVIEW ? {
    available: async function (n) { return NAME_RE.test(n) && n.toLowerCase() !== 'luckielynx'; },
    signUp: async function () { return { confirmed: false }; },
    signIn: async function (email) { mock.user = { email: email }; return {}; },
    sendReset: async function () { return {}; },
    setPassword: async function () { return {}; },
    signOut: async function () { mock.user = null; },
    user: async function () { return mock.user; },
    profile: async function () {
      return mock.user ? { username: 'PreviewPlayer', email_pref: mock.prefs.email_pref, email_topics: mock.prefs.email_topics.slice() } : null;
    },
    savePrefs: async function (p, t) { mock.prefs = { email_pref: p, email_topics: t }; return {}; },
    status: async function () { return mock.user ? { is_admin: true, access: mock.access } : null; },
    redeem: async function (code) {
      if (!mock.user) return { ok: false, error: 'Sign in first, then enter your code.' };
      if (code.replace(/[^A-Za-z0-9]/g, '').toUpperCase() !== 'DEMOBETA') return { ok: false, error: "That code isn't valid or has run out. Check it and try again. (Preview: try DEMO-BETA.)" };
      var already = mock.access.length > 0;
      mock.access = [{ phase: 'beta', name: 'Beta' }];
      return { ok: true, phase: 'beta', name: 'Beta', already: already };
    }
  } : {
    available: async function (n) {
      var r = await sb.rpc('username_available', { name: n });
      if (r.error) throw r.error;
      return !!r.data;
    },
    signUp: async function (d) {
      var r = await sb.auth.signUp({
        email: d.email,
        password: d.password,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          data: { username: d.username, email_pref: d.email_pref, email_topics: d.email_topics, age_confirmed: true }
        }
      });
      if (r.error) throw r.error;
      var u = r.data.user;
      if (u && Array.isArray(u.identities) && u.identities.length === 0) throw new Error('User already registered');
      return { confirmed: !!r.data.session };
    },
    signIn: async function (email, pass) {
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw r.error;
      return {};
    },
    sendReset: async function (email) {
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (r.error) throw r.error;
      return {};
    },
    setPassword: async function (p) {
      var r = await sb.auth.updateUser({ password: p });
      if (r.error) throw r.error;
      return {};
    },
    signOut: async function () { await sb.auth.signOut(); },
    user: async function () {
      var r = await sb.auth.getSession();
      return r.data.session ? r.data.session.user : null;
    },
    profile: async function () {
      var u = await api.user();
      if (!u) return null;
      var r = await sb.from('profiles').select('username,email_pref,email_topics').eq('id', u.id).single();
      if (r.error) throw r.error;
      return r.data;
    },
    savePrefs: async function (p, t) {
      var u = await api.user();
      if (!u) throw new Error('Your session ended. Sign in again.');
      var r = await sb.from('profiles').update({ email_pref: p, email_topics: t }).eq('id', u.id);
      if (r.error) throw r.error;
      return {};
    },
    status: async function () {
      var r = await sb.rpc('my_status');
      if (r.error) throw r.error;
      return r.data;
    },
    redeem: async function (code) {
      var r = await sb.rpc('redeem_code', { code: code });
      if (r.error) throw r.error;
      return r.data;
    }
  };

  /* email choice controls, used by sign-up and the account panel */
  function prefsUI(pickedId, topicsId) {
    var picked = $(pickedId), box = $(topicsId);
    var radios = document.querySelectorAll('input[name="' + picked.name + '"]');
    function sync() {
      var on = picked.checked;
      box.querySelectorAll('input').forEach(function (cb) { cb.disabled = !on; });
      box.style.opacity = on ? '1' : '.45';
    }
    radios.forEach(function (r) { r.addEventListener('change', sync); });
    sync();
    return {
      read: function () {
        return {
          email_pref: picked.checked ? 'picked' : 'all',
          email_topics: [].slice.call(box.querySelectorAll('input:checked')).map(function (c) { return c.value; })
        };
      },
      write: function (d) {
        radios.forEach(function (r) { r.checked = (r === picked) ? d.email_pref !== 'all' : d.email_pref === 'all'; });
        box.querySelectorAll('input').forEach(function (c) { c.checked = (d.email_topics || []).indexOf(c.value) !== -1; });
        sync();
      },
      firstTopic: function () { return box.querySelector('input'); }
    };
  }
  var signupPrefs = prefsUI('pref-picked', 'topics');
  var acctPrefs = prefsUI('ap-picked', 'acct-topics');

  /* show / hide password */
  document.querySelectorAll('[data-toggle-pass]').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = $(b.getAttribute('data-toggle-pass'));
      var hide = input.type === 'text';
      input.type = hide ? 'password' : 'text';
      b.textContent = hide ? 'Show' : 'Hide';
    });
  });

  /* signed-in state */
  var form = $('signup-form'), done = $('signup-done'), panel = $('account-panel');
  async function refresh() {
    var user = null, prof = null;
    try { user = await api.user(); } catch (e) { user = null; }
    if (user) { try { prof = await api.profile(); } catch (e) { prof = null; } }
    var signedIn = !!user;
    show($('nav-signin'), !signedIn);
    show($('nav-signup'), !signedIn);
    show($('nav-account'), signedIn);
    show($('nav-signout'), signedIn);
    show($('acct-tag'), PREVIEW && signedIn);
    if (signedIn) {
      var name = prof ? prof.username : (user.email || 'player');
      $('nav-account').textContent = name;
      $('acct-name').textContent = 'Welcome, ' + name + '.';
      if (prof) acctPrefs.write(prof);
      setNote($('prefs-note'), prof ? '' : "Couldn't load your email choices. Refresh the page to try again.", prof ? '' : 'err');
      show(form, false); show(done, false); show(panel, true);
    } else {
      show(panel, false);
      if (done.hidden) show(form, true);
    }
    var st = null;
    if (signedIn) { try { st = await api.status(); } catch (e) { st = null; } }
    var hasAccess = !!(st && st.access && st.access.length);
    show($('nav-download'), hasAccess || !!(st && st.is_admin));
    show($('acct-download'), hasAccess);
    show($('nav-admin'), !!(st && st.is_admin));
    return signedIn;
  }
  function goToAccount() {
    var s = $('signup');
    if (s) s.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  async function doSignOut() {
    await api.signOut();
    await refresh();
  }
  $('nav-signout').addEventListener('click', doSignOut);
  $('acct-signout').addEventListener('click', doSignOut);

  /* live username check */
  var nameIn = $('su-name'), nameHint = $('su-name-hint'), nameTimer = null;
  nameIn.addEventListener('input', function () {
    clearTimeout(nameTimer);
    var n = nameIn.value.trim();
    nameHint.className = 'hint';
    if (!NAME_RE.test(n)) { nameHint.textContent = NAME_HINT; return; }
    nameHint.textContent = 'Checking ' + n + '...';
    nameTimer = setTimeout(async function () {
      try {
        var ok = await api.available(n);
        if (nameIn.value.trim() !== n) return;
        nameHint.textContent = ok ? n + ' is available.' : n + ' is taken. Try another.';
        nameHint.className = 'hint ' + (ok ? 'ok' : 'bad');
      } catch (e) {
        nameHint.textContent = NAME_HINT;
      }
    }, 400);
  });

  /* sign-up */
  var emailIn = $('su-email'), passIn = $('su-pass'), ageIn = $('su-age'), note = $('su-note'), suBtn = $('su-submit');
  function fail(msg, el) { setNote(note, msg, 'err'); if (el) el.focus(); }
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    setNote(note, '');
    var name = nameIn.value.trim(), email = emailIn.value.trim(), pass = passIn.value;
    var pr = signupPrefs.read();
    if (!NAME_RE.test(name)) return fail('Pick a username of 3 to 16 letters, numbers or underscores.', nameIn);
    if (!EMAIL_RE.test(email)) return fail('Enter a full email address, like name@example.com.', emailIn);
    if (pass.length < 8) return fail('Use a password with at least 8 characters.', passIn);
    if (pr.email_pref === 'picked' && !pr.email_topics.length) return fail('Tick at least one thing to hear about, or choose Everything.', signupPrefs.firstTopic());
    if (!ageIn.checked) return fail('You need to be 18 or older to sign up.', ageIn);

    busy(suBtn, true, 'Creating account...');
    try {
      if (!(await api.available(name))) { fail('That username is taken. Pick another one.', nameIn); return; }
      var res = await api.signUp({ username: name, email: email, password: pass, email_pref: pr.email_pref, email_topics: pr.email_topics });
      passIn.value = '';
      if (res.confirmed) { await refresh(); goToAccount(); return; }
      $('done-title').textContent = 'Almost there, ' + name + '.';
      $('done-email').textContent = 'We sent a confirmation link to ' + email + '. Click it to activate your account. Your username is reserved.';
      $('done-prefs').textContent = pr.email_pref === 'all'
        ? "You'll get all our emails. You can change that anytime."
        : "We'll only email you about: " + listTopics(pr.email_topics) + '.';
      show($('done-tag'), PREVIEW);
      show(form, false); show(done, true);
    } catch (err) {
      fail(friendly(err));
    } finally {
      busy(suBtn, false);
    }
  });
  $('done-retry').addEventListener('click', function () {
    show(done, false); show(form, true); emailIn.focus();
  });

  /* account panel: save email choices */
  $('prefs-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var pr = acctPrefs.read(), pn = $('prefs-note'), btn = $('prefs-save');
    if (pr.email_pref === 'picked' && !pr.email_topics.length) { setNote(pn, 'Tick at least one thing to hear about, or choose Everything.', 'err'); return; }
    busy(btn, true, 'Saving...');
    try {
      await api.savePrefs(pr.email_pref, pr.email_topics);
      setNote(pn, PREVIEW ? 'Saved (preview only).' : 'Saved.', 'ok');
    } catch (err) {
      setNote(pn, friendly(err), 'err');
    } finally {
      busy(btn, false);
    }
  });

  /* sign-in dialog: sign in, reset, new password */
  var dlg = $('signin');
  var modes = { signin: $('signin-form'), reset: $('reset-form'), newpass: $('newpass-form') };
  function setMode(m) {
    Object.keys(modes).forEach(function (k) { show(modes[k], k === m); });
    var first = modes[m].querySelector('input');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function openDlg(m) {
    setMode(m || 'signin');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  }
  function closeDlg() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  document.querySelectorAll('[data-open-signin]').forEach(function (b) { b.addEventListener('click', function () { openDlg('signin'); }); });
  document.querySelector('[data-close-signin]').addEventListener('click', closeDlg);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDlg(); });
  document.querySelector('[data-to-reset]').addEventListener('click', function () {
    $('rs-email').value = $('si-email').value; setMode('reset');
  });
  document.querySelector('[data-to-signin]').addEventListener('click', function () { setMode('signin'); });
  document.querySelector('[data-to-signup]').addEventListener('click', function () {
    closeDlg(); goToAccount();
    setTimeout(function () { nameIn.focus({ preventScroll: true }); }, 400);
  });

  $('signin-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var em = $('si-email').value.trim(), pw = $('si-pass').value, sn = $('si-note'), btn = $('si-submit');
    setNote(sn, '');
    if (!EMAIL_RE.test(em)) { setNote(sn, 'Enter the email you signed up with.', 'err'); $('si-email').focus(); return; }
    if (!pw) { setNote(sn, 'Enter your password.', 'err'); $('si-pass').focus(); return; }
    busy(btn, true, 'Signing in...');
    try {
      await api.signIn(em, pw);
      $('si-pass').value = '';
      closeDlg();
      await refresh();
      goToAccount();
    } catch (err) {
      setNote(sn, friendly(err), 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('reset-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var em = $('rs-email').value.trim(), rn = $('rs-note'), btn = $('rs-submit');
    if (!EMAIL_RE.test(em)) { setNote(rn, 'Enter the email you signed up with.', 'err'); return; }
    busy(btn, true, 'Sending...');
    try {
      await api.sendReset(em);
      setNote(rn, 'If an account exists for ' + em + ', a reset link is on its way. Check your inbox.', 'ok');
    } catch (err) {
      setNote(rn, friendly(err), 'err');
    } finally {
      busy(btn, false);
    }
  });

  $('newpass-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var pw = $('np-pass').value, nn = $('np-note'), btn = $('np-submit');
    if (pw.length < 8) { setNote(nn, 'Use a password with at least 8 characters.', 'err'); return; }
    busy(btn, true, 'Saving...');
    try {
      await api.setPassword(pw);
      $('np-pass').value = '';
      setNote(nn, "Password saved. You're signed in.", 'ok');
      setTimeout(function () { closeDlg(); refresh(); goToAccount(); }, 1200);
    } catch (err) {
      setNote(nn, friendly(err), 'err');
    } finally {
      busy(btn, false);
    }
  });

  /* tester code box */
  var codeForm = $('code-form'), codeIn = $('code-input'), codeNote = $('code-note'), codeBtn = $('code-submit');
  codeForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    setNote(codeNote, '');
    var code = codeIn.value.trim();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 4) { setNote(codeNote, 'Enter the code you were given.', 'err'); codeIn.focus(); return; }
    var u = null;
    try { u = await api.user(); } catch (e2) { u = null; }
    if (!u) {
      setNote(codeNote, 'Sign in first, then enter your code. No account yet? Create one above.', 'err');
      openDlg('signin');
      return;
    }
    busy(codeBtn, true, 'Checking...');
    try {
      var res = await api.redeem(code);
      if (!res || !res.ok) { setNote(codeNote, (res && res.error) || 'That code didn\'t work.', 'err'); return; }
      codeIn.value = '';
      setNote(codeNote, (res.already ? 'You already have ' : 'Unlocked: ') + res.name + ' access. ', 'ok');
      var link = document.createElement('a');
      link.href = '/download';
      link.textContent = 'Go to downloads';
      codeNote.appendChild(link);
      refresh();
    } catch (err) {
      setNote(codeNote, friendly(err), 'err');
    } finally {
      busy(codeBtn, false);
    }
  });

  /* /#signin opens the sign-in window (used by the download and admin pages) */
  if (location.hash === '#signin') {
    setTimeout(function () { openDlg('signin'); }, 50);
  }

  /* react to logins from email links, other tabs and token refresh */
  if (sb) {
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') { setTimeout(function () { openDlg('newpass'); }, 0); }
      setTimeout(function () {
        refresh().then(function (signedIn) {
          if (signedIn && fromEmailLink) { fromEmailLink = false; goToAccount(); }
        });
      }, 0);
    });
  }
  refresh();

  /* example 100-seat grid */
  var seats = document.getElementById('seats');
  for (var s = 0; s < 100; s++) {
    var d = document.createElement('i');
    d.className = 'seat ' + (s < 40 ? 'board' : s < 80 ? 'lost' : 'none');
    seats.appendChild(d);
  }

  /* example match map: low-res canvas, scaled up pixelated */
  var c = document.getElementById('map');
  var ctx = c.getContext('2d');
  var W = 64, H = 40, N = 24;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seed = 11;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  var terrain = [];
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var n = rnd();
    terrain.push(n < .08 ? '#16352a' : n < .55 ? '#12291f' : '#10241b');
  }
  var trees = [];
  for (var i = 0; i < 80; i++) {
    var tx = Math.floor(rnd() * W), ty = Math.floor(rnd() * H);
    if (Math.abs(tx - 31.5) > 2) trees.push([tx, ty]);
  }
  var ruins = [[14,30,4,3],[44,31,5,3],[18,10,4,3],[42,11,4,4],[22,22,3,3],[38,24,3,3]];
  var TRACK = 31, STATION_Y = 6;
  var banks = { WEST: { x: 2, y: 18, cx: 5, cy: 20 }, EAST: { x: 57, y: 18, cx: 60, cy: 20 } };

  var CYCLE = 250, DEPART = 210, RIDE = 36;
  var t, trainY, players, active, round = 0, onBoard;

  function reset() {
    t = 0; trainY = H + 2; onBoard = 0;
    active = round % 2 === 0 ? 'EAST' : 'WEST';
    round++;
    players = [];
    for (var p = 0; p < N; p++) players.push({
      state: 'train', x: TRACK, y: H, dropY: 9 + rnd() * 27,
      speed: .42 + rnd() * .38, carry: 0, alive: true
    });
    document.getElementById('hud-bank').textContent = active;
  }

  function moveTo(pl, tx, ty) {
    var dx = tx - pl.x, dy = ty - pl.y, len = Math.hypot(dx, dy) || 1;
    pl.x += dx / len * pl.speed + (rnd() - .5) * .5;
    pl.y += dy / len * pl.speed + (rnd() - .5) * .5;
    return len;
  }

  function step() {
    t += 1.5;
    if (t < RIDE) trainY = H + 2 - (H + 2 - STATION_Y) * (t / RIDE);
    else if (t < DEPART) trainY = STATION_Y;
    else trainY = STATION_Y - (t - DEPART) * .4;

    var bank = banks[active];
    players.forEach(function (pl) {
      if (!pl.alive || pl.state === 'board' || pl.state === 'missed') return;
      if (pl.state === 'train') {
        pl.x = TRACK + .5; pl.y = trainY + 2;
        if (trainY <= pl.dropY) { pl.state = 'bank'; pl.y = pl.dropY; pl.x = TRACK + (bank.cx > TRACK ? 2 : -1); }
        return;
      }
      if (t >= DEPART) { pl.state = 'missed'; return; }
      if (pl.state === 'bank') {
        if (moveTo(pl, bank.cx, bank.cy) < 1.5) { pl.state = 'out'; pl.carry = 1; }
        if (rnd() < .0025) pl.alive = false;
      } else if (pl.state === 'out') {
        if (moveTo(pl, TRACK + .5, STATION_Y + 2) < 1.5) { pl.state = 'board'; onBoard++; return; }
        if (rnd() < .006) {
          var killer = null, best = 9;
          players.forEach(function (o) {
            if (o !== pl && o.alive && (o.state === 'out' || o.state === 'bank')) {
              var dd = Math.hypot(o.x - pl.x, o.y - pl.y);
              if (dd < best) { best = dd; killer = o; }
            }
          });
          if (killer) { killer.carry += pl.carry; if (killer.state === 'bank') killer.state = 'out'; pl.alive = false; pl.carry = 0; }
        }
      }
      pl.x = Math.max(1, Math.min(W - 2, pl.x)); pl.y = Math.max(1, Math.min(H - 2, pl.y));
    });
    if (t > CYCLE) reset();
  }

  function draw(time) {
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { ctx.fillStyle = terrain[y * W + x]; ctx.fillRect(x, y, 1, 1); }
    ctx.fillStyle = '#0b1712'; trees.forEach(function (tr) { ctx.fillRect(tr[0], tr[1], 1, 1); });
    ruins.forEach(function (r) { ctx.fillStyle = '#26332d'; ctx.fillRect(r[0], r[1], r[2], r[3]); ctx.fillStyle = '#35443c'; ctx.fillRect(r[0], r[1], r[2], 1); });
    // track with sleepers
    for (var ty2 = STATION_Y; ty2 < H; ty2++) {
      if (ty2 % 2 === 0) { ctx.fillStyle = '#3a372e'; ctx.fillRect(TRACK - 1, ty2, 4, 1); }
      ctx.fillStyle = '#6b6658'; ctx.fillRect(TRACK, ty2, 1, 1); ctx.fillRect(TRACK + 1, ty2, 1, 1);
    }
    // outpost station
    ctx.fillStyle = '#2b3a33'; ctx.fillRect(TRACK - 6, 1, 14, 5);
    ctx.fillStyle = '#e6c25a'; ctx.fillRect(TRACK - 6, 1, 14, 1);
    // banks
    var blink = reduce || Math.floor(time / 450) % 2 === 0;
    ['WEST', 'EAST'].forEach(function (k) {
      var b = banks[k], on = k === active;
      ctx.fillStyle = on ? '#3a3420' : '#262b28'; ctx.fillRect(b.x, b.y, 5, 5);
      ctx.fillStyle = on ? (blink ? '#f4dc84' : '#b98a22') : '#4a4f4b';
      ctx.fillRect(b.x, b.y, 5, 1); ctx.fillRect(b.x + 2, b.y + 2, 1, 1);
    });
    // train
    if (trainY > -6) {
      ctx.fillStyle = '#d9d6cc'; ctx.fillRect(TRACK, Math.round(trainY), 2, 5);
      ctx.fillStyle = '#e6c25a'; ctx.fillRect(TRACK, Math.round(trainY), 2, 1);
    }
    // players
    var alive = 0, coll = 0;
    players.forEach(function (pl) {
      if (pl.carry > 0 || pl.state === 'out' || pl.state === 'board') coll++;
      if (!pl.alive) return;
      if (pl.state !== 'missed') alive++;
      if (pl.state === 'train' || pl.state === 'board') return;
      ctx.fillStyle = pl.state === 'missed' ? '#7a3446' : pl.carry ? '#f2cf62' : '#f2efe6';
      ctx.fillRect(Math.round(pl.x), Math.round(pl.y), 1, 1);
    });

    var left = Math.max(0, DEPART - Math.floor(t));
    var mm = Math.floor(left / 60), ss = left % 60;
    document.getElementById('hud-train').textContent = t >= DEPART ? 'GONE' : '0' + mm + ':' + (ss < 10 ? '0' : '') + ss;
    document.getElementById('hud-alive').textContent = alive + '/' + N;
    document.getElementById('hud-coll').textContent = coll + '/' + N;
    document.getElementById('hud-board').textContent = onBoard;
    var ph = document.getElementById('phase');
    var bankName = active === 'EAST' ? 'East' : 'West';
    ph.innerHTML = t < RIDE ? '<b>Riding in.</b> Players jump off along the track.'
      : t < DEPART - 60 ? '<b>Bank run.</b> Nexor is in the ' + bankName + ' bank this match. Gold dots are carrying it.'
      : t < DEPART ? '<b>Last call.</b> The train leaves from the outpost when the timer hits zero.'
      : '<b>Train gone.</b> ' + onBoard + ' made it out. They split everything left behind by points.';
  }

  reset();
  if (reduce) { for (var k = 0; k < 110; k++) step(); draw(0); }
  else {
    draw(0);
    var last = 0;
    (function loop(now) {
      if (now - last > 120) { step(); draw(now); last = now; }
      requestAnimationFrame(loop);
    })(0);
  }
})();
