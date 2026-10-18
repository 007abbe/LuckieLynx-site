/* Shared code for the download and admin pages: login state, header, helpers.
   In the design preview (no Supabase), every call is answered by an in-memory demo. */
window.LL = (function () {
  var CFG = window.LL_CONFIG || {};
  var PREVIEW = !!CFG.preview || !window.supabase;
  var HOME = CFG.home || '/';
  var sb = PREVIEW ? null : window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }
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
    if (/JWT|session|not authenticated/i.test(m)) return 'Your session ended. Sign in again.';
    if (/fetch|network|Failed to|Load failed/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
    return m || 'Something went wrong. Try again.';
  }
  /* small element builder: h('p', {class: 'x', text: 'hi'}, [children]) */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- demo backend for the preview ---------- */
  var demo = {
    user: { id: 'demo', email: 'you@example.com' },
    username: 'DevAbbe',
    accounts: 214,
    access: ['beta'],
    phases: [
      { id: 'alpha', name: 'Alpha', active: false, has_code: false, code_uses: 0, code_max_uses: null, code_expires_at: null, code_set_at: null,
        build_label: null, build_key: null, build_notes: null },
      { id: 'beta', name: 'Beta', active: true, has_code: true, code_uses: 12, code_max_uses: 50, code_expires_at: '2026-11-30T22:59:59Z', code_set_at: '2026-10-18T09:00:00Z',
        build_label: 'Beta 0.1 · Windows 64-bit', build_key: 'beta/LuckieLynx-Beta-0.1.zip', build_notes: 'First playable map, solo lobbies. Practice Nexor only.' }
    ],
    testers: [
      { username: 'Lynx_01', phase: 'beta', phase_name: 'Beta', via: 'code', granted_at: '2026-10-18T10:12:00Z' },
      { username: 'TrainRunner', phase: 'beta', phase_name: 'Beta', via: 'code', granted_at: '2026-10-18T09:40:00Z' },
      { username: 'Ace', phase: 'beta', phase_name: 'Beta', via: 'admin', granted_at: '2026-10-17T18:02:00Z' }
    ]
  };
  function demoPhase(id) { return demo.phases.filter(function (p) { return p.id === id; })[0]; }
  function demoStatus() {
    return {
      is_admin: true,
      access: demo.phases.filter(function (p) { return p.active && demo.access.indexOf(p.id) !== -1; }).map(function (p) {
        return { phase: p.id, name: p.name, build_label: p.build_label, build_notes: p.build_notes, has_build: !!p.build_key };
      })
    };
  }
  var demoRpc = {
    my_status: function () { return demoStatus(); },
    redeem_code: function (a) {
      if (String(a.code).replace(/[^A-Za-z0-9]/g, '').toUpperCase() !== 'DEMOBETA') return { ok: false, error: "That code isn't valid or has run out. Check it and try again. (Preview: try DEMO-BETA.)" };
      var already = demo.access.indexOf('beta') !== -1;
      if (!already) demo.access.push('beta');
      return { ok: true, phase: 'beta', name: 'Beta', already: already };
    },
    create_download_token: function () { return 'preview'; },
    admin_overview: function () {
      demo.phases.forEach(function (p) { p.testers = demo.testers.filter(function (t) { return t.phase === p.id; }).length; });
      return { accounts: demo.accounts, phases: JSON.parse(JSON.stringify(demo.phases)), testers: demo.testers.slice() };
    },
    admin_set_code: function (a) {
      var c = String(a.code || '').replace(/[^A-Za-z0-9]/g, '');
      if (c.length < 6) throw new Error('Codes need at least 6 letters or numbers. Dashes and spaces are ignored.');
      var p = demoPhase(a.phase);
      p.has_code = true; p.code_uses = 0; p.code_max_uses = a.max_uses; p.code_expires_at = a.expires_at; p.code_set_at = new Date().toISOString();
    },
    admin_clear_code: function (a) { var p = demoPhase(a.phase); p.has_code = false; p.code_uses = 0; p.code_max_uses = null; p.code_expires_at = null; p.code_set_at = null; },
    admin_update_phase: function (a) {
      if (!String(a.name || '').trim()) throw new Error('Give the phase a name.');
      var p = demoPhase(a.phase);
      p.name = a.name.trim(); p.active = a.active; p.build_label = a.build_label || null; p.build_key = a.build_key || null; p.build_notes = a.build_notes || null;
    },
    admin_grant: function (a) {
      var name = String(a.username || '').trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('No account with the username ' + name + '.');
      if (!demo.testers.some(function (t) { return t.phase === a.phase && t.username.toLowerCase() === name.toLowerCase(); })) {
        demo.testers.unshift({ username: name, phase: a.phase, phase_name: demoPhase(a.phase).name, via: 'admin', granted_at: new Date().toISOString() });
      }
    },
    admin_revoke: function (a) {
      demo.testers = demo.testers.filter(function (t) { return !(t.phase === a.phase && t.username.toLowerCase() === String(a.username).toLowerCase()); });
    }
  };

  /* ---------- real or demo calls ---------- */
  async function user() {
    if (PREVIEW) return demo.user;
    var r = await sb.auth.getSession();
    return r.data.session ? r.data.session.user : null;
  }
  async function rpc(name, args) {
    if (PREVIEW) {
      await new Promise(function (res) { setTimeout(res, 120); });
      return demoRpc[name](args || {});
    }
    var r = await sb.rpc(name, args || {});
    if (r.error) throw r.error;
    return r.data;
  }
  async function username(u) {
    if (PREVIEW) return demo.username;
    var r = await sb.from('profiles').select('username').eq('id', u.id).single();
    return r.error ? (u.email || 'Account') : r.data.username;
  }

  /* header: signed-in name, sign out, Download/Admin links. Returns {user, name, status}. */
  async function header() {
    var u = null, name = null, st = null;
    try { u = await user(); } catch (e) { u = null; }
    if (u) {
      try { name = await username(u); } catch (e) { name = u.email || 'Account'; }
      try { st = await rpc('my_status'); } catch (e) { st = null; }
    }
    show($('nav-signin'), !u);
    show($('nav-account'), !!u);
    show($('nav-signout'), !!u);
    if (u) $('nav-account').textContent = name;
    show($('nav-download'), !!(st && ((st.access && st.access.length) || st.is_admin)));
    show($('nav-admin'), !!(st && st.is_admin));
    var so = $('nav-signout');
    if (so && !so.dataset.bound) {
      so.dataset.bound = '1';
      so.addEventListener('click', async function () {
        if (!PREVIEW) await sb.auth.signOut();
        location.href = HOME;
      });
    }
    return { user: u, name: name, status: st };
  }

  return { PREVIEW: PREVIEW, HOME: HOME, sb: sb, $: $, show: show, setNote: setNote, busy: busy, friendly: friendly,
           h: h, fmtDate: fmtDate, user: user, rpc: rpc, header: header };
})();
