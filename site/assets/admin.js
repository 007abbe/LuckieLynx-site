/* /admin: phases, tester codes, builds and testers. Every action is checked again in the database. */
(function () {
  var L = window.LL, $ = L.$, h = L.h;
  var states = ['loading', 'signedout', 'denied', 'admin'];
  function state(name) { states.forEach(function (s) { L.show($('state-' + s), s === name); }); }
  var data = null;

  function genCode(prefix) {
    var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = [];
    var buf = new Uint32Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 8; i++) out.push(abc[buf[i] % abc.length]);
    return prefix.toUpperCase() + '-' + out.slice(0, 4).join('') + '-' + out.slice(4).join('');
  }

  function codeStatus(p) {
    if (!p.has_code) return 'No code set. Testers can only get in if you add them below.';
    var parts = ['Code set ' + L.fmtDate(p.code_set_at)];
    parts.push(p.code_max_uses ? 'used ' + p.code_uses + ' of ' + p.code_max_uses : 'used ' + p.code_uses + (p.code_uses === 1 ? ' time' : ' times'));
    parts.push(p.code_expires_at ? 'works until ' + L.fmtDate(p.code_expires_at) : 'no end date');
    if (!p.active) parts.push('phase is closed, so the code does nothing yet');
    return parts.join(' · ') + '.';
  }

  function field(id, label, input, hint) {
    return h('div', { class: 'f' }, [h('label', { for: id, text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null]);
  }

  function phaseCard(p) {
    var pid = 'p-' + p.id;
    /* settings */
    var nameIn = h('input', { type: 'text', id: pid + '-name', value: p.name, maxlength: '30' });
    var activeIn = h('input', { type: 'checkbox', id: pid + '-active' });
    activeIn.checked = !!p.active;
    var labelIn = h('input', { type: 'text', id: pid + '-label', value: p.build_label || '', placeholder: 'e.g. ' + p.name + ' 0.1 · Windows 64-bit' });
    var keyIn = h('input', { type: 'text', id: pid + '-key', value: p.build_key || '', placeholder: 'e.g. ' + p.id + '/LuckieLynx-' + p.name + '-0.1.zip', spellcheck: 'false' });
    var notesIn = h('textarea', { id: pid + '-notes', rows: '3', placeholder: 'What testers should know about this build' });
    notesIn.value = p.build_notes || '';
    var saveBtn = h('button', { class: 'btn btn-gold notched btn-small', type: 'submit', text: 'Save phase' });
    var setNote = h('p', { class: 'form-note', id: pid + '-set-note', role: 'status' });
    var settings = h('form', { class: 'admin-form', novalidate: true }, [
      field(pid + '-name', 'PHASE NAME', nameIn),
      h('label', { class: 'check', for: pid + '-active' }, [activeIn, 'Open: testers with access can download']),
      field(pid + '-label', 'BUILD NAME SHOWN TO TESTERS', labelIn),
      field(pid + '-key', 'BUILD FILE IN R2', keyIn, "The file's path in your R2 bucket. Leave empty until the build is uploaded."),
      field(pid + '-notes', 'NOTES FOR TESTERS', notesIn),
      h('div', { class: 'btn-row' }, [saveBtn]),
      setNote
    ]);
    settings.addEventListener('submit', async function (e) {
      e.preventDefault();
      L.busy(saveBtn, true, 'Saving...');
      try {
        await L.rpc('admin_update_phase', { phase: p.id, name: nameIn.value, active: activeIn.checked,
          build_label: labelIn.value, build_key: keyIn.value, build_notes: notesIn.value });
        await reload(function () { L.setNote($(pid + '-set-note'), 'Saved.', 'ok'); });
      } catch (err) {
        L.setNote(setNote, L.friendly(err), 'err');
        L.busy(saveBtn, false);
      }
    });

    /* code */
    var codeIn = h('input', { type: 'text', id: pid + '-code', placeholder: p.id.toUpperCase() + '-XXXX-XXXX', autocomplete: 'off', spellcheck: 'false', maxlength: '48' });
    var genBtn = h('button', { class: 'btn btn-quiet notched btn-small', type: 'button', text: 'Generate' });
    genBtn.addEventListener('click', function () { codeIn.value = genCode(p.id); codeIn.focus(); });
    var maxIn = h('input', { type: 'number', id: pid + '-max', min: '1', step: '1', placeholder: 'No limit' });
    var endIn = h('input', { type: 'date', id: pid + '-end' });
    var codeBtn = h('button', { class: 'btn btn-gold notched btn-small', type: 'submit', text: 'Save code' });
    var clearBtn = h('button', { class: 'btn btn-quiet notched btn-small', type: 'button', text: 'Remove code' });
    L.show(clearBtn, p.has_code);
    var codeNote = h('p', { class: 'form-note', id: pid + '-code-note', role: 'status' });
    var codeForm = h('form', { class: 'admin-form', novalidate: true }, [
      h('div', { class: 'f' }, [h('label', { for: pid + '-code', text: p.has_code ? 'REPLACE CODE' : 'NEW CODE' }), h('div', { class: 'code-field' }, [codeIn, genBtn])]),
      h('div', { class: 'two' }, [field(pid + '-max', 'MAX USES (OPTIONAL)', maxIn), field(pid + '-end', 'WORKS UNTIL (OPTIONAL)', endIn)]),
      h('div', { class: 'btn-row' }, [codeBtn, clearBtn]),
      codeNote
    ]);
    codeForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var code = codeIn.value.trim();
      if (code.replace(/[^A-Za-z0-9]/g, '').length < 6) { L.setNote(codeNote, 'Type or generate a code with at least 6 letters or numbers.', 'err'); codeIn.focus(); return; }
      var max = maxIn.value ? parseInt(maxIn.value, 10) : null;
      if (maxIn.value && (!max || max < 1)) { L.setNote(codeNote, 'Max uses must be 1 or more, or left empty.', 'err'); maxIn.focus(); return; }
      var ends = endIn.value ? new Date(endIn.value + 'T23:59:59').toISOString() : null;
      L.busy(codeBtn, true, 'Saving...');
      try {
        await L.rpc('admin_set_code', { phase: p.id, code: code, max_uses: max, expires_at: ends });
        await reload(function () {
          var n = $(pid + '-code-note');
          L.setNote(n, 'Code saved. Share it with your testers: ' + code.toUpperCase() + '. Copy it now, it is stored scrambled and can\'t be shown again. ', 'ok');
          var copy = h('button', { class: 'textlink small', type: 'button', text: 'Copy code' });
          copy.addEventListener('click', function () {
            try { navigator.clipboard.writeText(code.toUpperCase()).then(function () { copy.textContent = 'Copied'; }, function () {}); } catch (e2) {}
          });
          n.appendChild(copy);
        });
      } catch (err) {
        L.setNote(codeNote, L.friendly(err), 'err');
        L.busy(codeBtn, false);
      }
    });
    clearBtn.addEventListener('click', async function () {
      L.busy(clearBtn, true, 'Removing...');
      try {
        await L.rpc('admin_clear_code', { phase: p.id });
        await reload(function () { L.setNote($(pid + '-code-note'), 'Code removed. Testers who already unlocked keep their access.', 'ok'); });
      } catch (err) {
        L.setNote(codeNote, L.friendly(err), 'err');
        L.busy(clearBtn, false);
      }
    });

    return h('article', { class: 'phase-card notched' }, [
      h('div', { class: 'phase-head' }, [
        h('h3', { text: p.name }),
        h('span', { class: 'pill ' + (p.active ? 'open' : 'closed'), text: (p.active ? 'OPEN' : 'CLOSED') + ' · ' + p.testers + (p.testers === 1 ? ' TESTER' : ' TESTERS') })
      ]),
      settings,
      h('div', { class: 'sub-block' }, [h('h4', { text: 'TESTER CODE' }), h('p', { class: 'code-status', text: codeStatus(p) }), codeForm])
    ]);
  }

  function render(d) {
    data = d;
    var uniq = {};
    d.testers.forEach(function (t) { uniq[t.username.toLowerCase()] = 1; });
    var stats = $('stats');
    stats.textContent = '';
    [[d.accounts, 'ACCOUNTS'], [Object.keys(uniq).length, 'TESTERS'], [d.phases.filter(function (p) { return p.active; }).length, 'OPEN PHASES']].forEach(function (s) {
      stats.appendChild(h('div', {}, [h('b', { text: String(s[0]) }), h('span', { text: s[1] })]));
    });

    var box = $('phases');
    box.textContent = '';
    d.phases.forEach(function (p) { box.appendChild(phaseCard(p)); });

    var sel = $('grant-phase'), keep = sel.value;
    sel.textContent = '';
    d.phases.slice().reverse().forEach(function (p) { sel.appendChild(h('option', { value: p.id, text: p.name })); });
    if (keep) sel.value = keep;

    var rows = $('tester-rows');
    rows.textContent = '';
    d.testers.forEach(function (t) {
      var rm = h('button', { class: 'btn btn-quiet notched btn-small', type: 'button', text: 'Remove' });
      rm.addEventListener('click', async function () {
        L.busy(rm, true, '...');
        try {
          await L.rpc('admin_revoke', { phase: t.phase, username: t.username });
          await reload(function () { L.setNote($('grant-note'), 'Removed ' + t.username + ' from ' + t.phase_name + '.', 'ok'); });
        } catch (err) {
          L.setNote($('grant-note'), L.friendly(err), 'err');
          L.busy(rm, false);
        }
      });
      rows.appendChild(h('tr', {}, [
        h('td', { text: t.username }),
        h('td', { text: t.phase_name }),
        h('td', { class: 'muted', text: t.via === 'code' ? 'Code' : 'Added by admin' }),
        h('td', { class: 'muted', text: L.fmtDate(t.granted_at) }),
        h('td', {}, [rm])
      ]));
    });
    L.show($('tester-empty'), !d.testers.length);
  }

  async function reload(after) {
    var d = await L.rpc('admin_overview');
    render(d);
    if (after) after();
  }

  $('grant-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('grant-user').value.trim(), phase = $('grant-phase').value, btn = $('grant-submit'), note = $('grant-note');
    if (!name) { L.setNote(note, 'Type the username of the player to add.', 'err'); $('grant-user').focus(); return; }
    L.busy(btn, true, 'Adding...');
    try {
      await L.rpc('admin_grant', { phase: phase, username: name });
      $('grant-user').value = '';
      var pname = (data.phases.filter(function (p) { return p.id === phase; })[0] || {}).name || phase;
      await reload(function () { L.setNote($('grant-note'), name + ' now has ' + pname + ' access.', 'ok'); });
    } catch (err) {
      L.setNote(note, L.friendly(err), 'err');
    } finally {
      L.busy(btn, false);
    }
  });

  (async function start() {
    var info = await L.header();
    if (!info.user) { state('signedout'); return; }
    if (!info.status || !info.status.is_admin) { state('denied'); return; }
    try {
      await reload();
      state('admin');
    } catch (err) {
      state('denied');
      $('state-denied').querySelector('p').textContent = L.friendly(err);
    }
  })();
})();
