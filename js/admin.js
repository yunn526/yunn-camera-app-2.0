/* 管理員後台。資料與權限都來自後端；非管理員呼叫 adminStats 會被後端拒絕。 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function cell(tr, text) { var td = document.createElement('td'); td.textContent = text == null ? '' : String(text); tr.appendChild(td); }
  function fmt(s) { if (!s) return ''; var d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleString('zh-TW'); }

  function renderStats(t) {
    var wrap = $('stats'); wrap.textContent = '';
    [['使用者', t.users], ['PRO 使用者', t.pro], ['登入次數', t.logins], ['拍照次數', t.photos], ['下載次數', t.downloads], ['雲端同步次數', t.syncs]].forEach(function (p) {
      var d = document.createElement('div'); d.className = 'stat';
      var b = document.createElement('b'); b.textContent = p[1];
      var s = document.createElement('span'); s.textContent = p[0];
      d.append(b, s); wrap.appendChild(d);
    });
  }

  async function load() {
    $('denied').style.display = 'none';
    var d = await YunnAuth.api('adminStats');
    if (!d.ok) {
      $('content').style.display = 'none';
      if (d.error === 'forbidden') $('denied').style.display = '';
      else if (d.error !== 'auth') { $('denied').textContent = '讀取失敗：' + d.error; $('denied').style.display = ''; }
      return;
    }
    $('content').style.display = '';
    renderStats(d.totals);
    var ub = $('users'); ub.textContent = '';
    d.users.forEach(function (u) {
      var tr = document.createElement('tr');
      [u.email, u.name, u.plan, u.proUntil ? fmt(u.proUntil) : '', u.logins, u.photos, u.downloads, u.syncs, fmt(u.lastSeen)].forEach(function (v) { cell(tr, v); });
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { $('pfEmail').value = u.email; });
      ub.appendChild(tr);
    });
    var eb = $('events'); eb.textContent = '';
    d.recent.forEach(function (e) {
      var tr = document.createElement('tr');
      [fmt(e.time), e.email, e.event, e.details].forEach(function (v) { cell(tr, v); });
      eb.appendChild(tr);
    });
  }

  function onAuthChange(user) {
    $('setupWarn').style.display = YunnAuth.configured() ? 'none' : '';
    $('login').style.display = user ? 'none' : '';
    $('panel').style.display = user ? '' : 'none';
    if (user) { $('who').textContent = '登入帳號：' + user.email; load(); }
    else { $('content').style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('reload').addEventListener('click', load);
    $('logout').addEventListener('click', function () { YunnAuth.signOut(); });
    $('planForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var msg = $('planMsg'); msg.textContent = '儲存中…';
      var d = await YunnAuth.api('adminSetPlan', {
        targetEmail: $('pfEmail').value.trim(), plan: $('pfPlan').value, proUntil: $('pfUntil').value
      });
      msg.textContent = d.ok ? '已儲存。' : (d.error === 'forbidden' ? '沒有管理員權限。' : '儲存失敗：' + d.error);
      if (d.ok) load();
    });
    YunnAuth.onChange(onAuthChange);
    onAuthChange(null);
    YunnAuth.start($('gbtn'));
  });
})();
