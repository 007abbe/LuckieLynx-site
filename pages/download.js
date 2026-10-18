/* /download: shows the builds the signed-in tester can download. */
(function () {
  var L = window.LL, $ = L.$, h = L.h;
  var states = ['loading', 'signedout', 'noaccess', 'access'];
  function state(name) { states.forEach(function (s) { L.show($('state-' + s), s === name); }); }

  async function startDownload(phase, btn) {
    var note = $('dl-note');
    L.setNote(note, '');
    L.busy(btn, true, 'Preparing...');
    try {
      var token = await L.rpc('create_download_token', { phase: phase });
      if (L.PREVIEW) {
        L.setNote(note, 'Preview: on luckielynx.com the download starts here.', 'ok');
      } else {
        location.href = '/api/file?t=' + encodeURIComponent(token);
      }
    } catch (err) {
      L.setNote(note, L.friendly(err), 'err');
    } finally {
      setTimeout(function () { L.busy(btn, false); }, 1500);
    }
  }

  function render(st) {
    var box = $('builds');
    box.textContent = '';
    var list = (st && st.access) || [];
    if (!list.length && st && st.is_admin) {
      $('access-lede').textContent = "You're an admin. To test a build here, open its phase and give yourself access on the admin page.";
    }
    list.forEach(function (a) {
      var btn = a.has_build
        ? h('button', { class: 'btn btn-gold notched', type: 'button', text: 'Download' })
        : h('button', { class: 'btn btn-quiet notched', type: 'button', disabled: true, text: 'Build coming soon' });
      if (a.has_build) btn.addEventListener('click', function () { startDownload(a.phase, btn); });
      box.appendChild(h('article', { class: 'build notched' }, [
        h('span', { class: 'label' }, [h('span', { class: 'spark', 'aria-hidden': 'true' }), a.name + ' access']),
        h('h3', { text: a.build_label || a.name + ' build' }),
        a.build_notes ? h('p', { text: a.build_notes }) : null,
        btn
      ]));
    });
  }

  function bindCode(formId, inputId, btnId, noteId) {
    var form = $(formId), input = $(inputId), btn = $(btnId), note = $(noteId);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      L.setNote(note, '');
      var code = input.value.trim();
      if (code.replace(/[^A-Za-z0-9]/g, '').length < 4) { L.setNote(note, 'Enter the code you were given.', 'err'); input.focus(); return; }
      L.busy(btn, true, 'Checking...');
      try {
        var res = await L.rpc('redeem_code', { code: code });
        if (!res || !res.ok) { L.setNote(note, (res && res.error) || "That code didn't work.", 'err'); return; }
        input.value = '';
        L.setNote(note, (res.already ? 'You already have ' : 'Unlocked: ') + res.name + ' access.', 'ok');
        await load();
      } catch (err) {
        L.setNote(note, L.friendly(err), 'err');
      } finally {
        L.busy(btn, false);
      }
    });
  }
  bindCode('dl-code-form', 'dl-code-input', 'dl-code-submit', 'dl-code-note');
  bindCode('dl-code-form-2', 'dl-code-input-2', 'dl-code-submit-2', 'dl-code-note-2');

  async function load() {
    var info = await L.header();
    if (!info.user) { state('signedout'); return; }
    var st = info.status;
    if (st && ((st.access && st.access.length) || st.is_admin)) { render(st); state('access'); }
    else state('noaccess');
  }
  load();
})();
