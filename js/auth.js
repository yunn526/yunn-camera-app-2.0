/* Google 登入與後端 API。權限一律以後端回應為準，前端只負責顯示。 */
(function () {
  var cfg = window.YUNN_CONFIG || {};
  var TOKEN_KEY = 'yc_idtoken';
  var state = { user: null, token: null, listeners: [] };

  function configured() { return !!(cfg.GOOGLE_CLIENT_ID && cfg.API_URL); }

  function decodeExp(token) {
    try {
      var p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return Number(p.exp) || 0;
    } catch (e) { return 0; }
  }

  function notify() { state.listeners.forEach(function (fn) { try { fn(state.user); } catch (e) { console.error(e); } }); }

  async function api(action, payload) {
    if (!state.token) throw new Error('auth');
    var res = await fetch(cfg.API_URL, {
      method: 'POST',
      // text/plain 可避免 CORS 預檢請求（Apps Script 不支援 OPTIONS）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, idToken: state.token }, payload || {}))
    });
    var data = await res.json();
    if (!data.ok && data.error === 'auth') { signOut(true); }
    return data;
  }

  async function establish(token, isFresh) {
    state.token = token;
    var data = await api(isFresh ? 'login' : 'me');
    if (!data.ok) { state.token = null; sessionStorage.removeItem(TOKEN_KEY); return false; }
    sessionStorage.setItem(TOKEN_KEY, token);
    state.user = { email: data.email, name: data.name, plan: data.plan, isAdmin: !!data.isAdmin };
    notify();
    return true;
  }

  // Google Drive 授權（僅限 drive.file：只能存取本應用程式建立的檔案）。
  // 必須由使用者點擊觸發，否則瀏覽器會擋彈出視窗。
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var drive = { token: null, exp: 0 };

  function driveToken() {
    return new Promise(function (resolve, reject) {
      if (drive.token && Date.now() < drive.exp - 60000) { resolve(drive.token); return; }
      if (!(window.google && google.accounts && google.accounts.oauth2)) { reject(new Error('gis')); return; }
      var client = google.accounts.oauth2.initTokenClient({
        client_id: cfg.GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        login_hint: state.user ? state.user.email : undefined,
        callback: function (r) {
          if (r.error || !r.access_token) { reject(new Error(r.error || 'denied')); return; }
          drive.token = r.access_token;
          drive.exp = Date.now() + Number(r.expires_in || 3600) * 1000;
          resolve(drive.token);
        },
        error_callback: function (e) { reject(new Error((e && e.type) || 'popup')); }
      });
      client.requestAccessToken();
    });
  }

  function signOut(expired) {
    if (drive.token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(drive.token, function () {}); } catch (e) {}
    }
    drive.token = null; drive.exp = 0;
    state.token = null; state.user = null;
    sessionStorage.removeItem(TOKEN_KEY);
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    notify();
    if (expired) { var el = document.getElementById('loginMsg'); if (el) el.textContent = '登入已過期，請重新登入。'; }
  }

  function initGoogle(buttonEl) {
    google.accounts.id.initialize({
      client_id: cfg.GOOGLE_CLIENT_ID,
      callback: function (resp) {
        if (!resp.credential) return;
        establish(resp.credential, true).then(function (ok) {
          var el = document.getElementById('loginMsg');
          if (el && !ok) el.textContent = '登入失敗，請稍後再試或聯絡管理員。';
        }).catch(function () {
          var el = document.getElementById('loginMsg');
          if (el) el.textContent = '無法連線到後端，請檢查 API_URL 設定。';
        });
      }
    });
    if (buttonEl) google.accounts.id.renderButton(buttonEl, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with' });
  }

  function start(buttonEl) {
    if (!configured()) { notify(); return; }
    var saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved && decodeExp(saved) * 1000 > Date.now() + 30000) {
      establish(saved, false).catch(function () { signOut(); });
    }
    function ready() { initGoogle(buttonEl); }
    if (window.google && google.accounts && google.accounts.id) ready();
    else window.addEventListener('gis-ready', ready, { once: true });
  }

  window.YunnAuth = {
    configured: configured,
    start: start,
    api: api,
    driveToken: driveToken,
    signOut: function () { signOut(false); },
    onChange: function (fn) { state.listeners.push(fn); },
    get user() { return state.user; }
  };
})();
