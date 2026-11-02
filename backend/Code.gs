/**
 * Yunn Camera — Google Apps Script 後端
 *
 * 需要在「專案設定 → 指令碼屬性」設定：
 *   CLIENT_ID     Google OAuth 網頁用戶端 ID（與前端 js/config.js 相同）
 *   ADMIN_EMAILS  管理員 Gmail，多個用逗號分隔（例：a@gmail.com,b@gmail.com）
 *   SHEET_ID      使用紀錄用的 Google 試算表 ID
 *
 * 安全原則：
 *  - 所有請求都必須帶 Google ID token，後端以 Google tokeninfo 驗證
 *    （簽章、aud、iss、exp、email_verified）。
 *  - 管理員身分只看 ADMIN_EMAILS（後端屬性），前端傳什麼都不算數。
 *  - 方案（FREE/PRO）只讀試算表 Users 工作表，前端無法自行宣告。
 *  - 不接收、不儲存任何照片內容。
 */

var USER_HEADERS = ['email', 'name', 'plan', 'proUntil', 'firstSeen', 'lastSeen', 'logins', 'photos', 'downloads', 'syncs'];
var EVENT_HEADERS = ['time', 'email', 'event', 'details'];
var PRO_ONLY_FEATURES = ['pro_filter', 'full_res'];
var ALLOWED_EVENTS = ['photo', 'download', 'cloud_sync'];
var EVENT_COUNTER = { photo: 'photos', download: 'downloads', cloud_sync: 'syncs' };

function doGet() {
  return json_({ ok: true, service: 'yunn-camera' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var user = verifyIdToken_(body.idToken);
    var action = String(body.action || '');
    switch (action) {
      case 'login':         return json_(actionLogin_(user));
      case 'me':            return json_(actionMe_(user));
      case 'authorize':     return json_(actionAuthorize_(user, body));
      case 'adminStats':    requireAdmin_(user); return json_(actionAdminStats_());
      case 'adminSetPlan':  requireAdmin_(user); return json_(actionAdminSetPlan_(user, body));
      default:              return json_({ ok: false, error: 'bad_action' });
    }
  } catch (err) {
    var code = String(err && err.message || err);
    if (['auth', 'forbidden', 'bad_request'].indexOf(code) === -1) {
      console.error(code);
      code = 'server_error';
    }
    return json_({ ok: false, error: code });
  }
}

/* ---------- 驗證 ---------- */

function props_() { return PropertiesService.getScriptProperties(); }

function adminList_() {
  return (props_().getProperty('ADMIN_EMAILS') || '')
    .toLowerCase().split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
}

function isAdmin_(email) { return adminList_().indexOf(String(email).toLowerCase()) !== -1; }

function requireAdmin_(user) { if (!isAdmin_(user.email)) throw new Error('forbidden'); }

function verifyIdToken_(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) throw new Error('auth');
  var clientId = props_().getProperty('CLIENT_ID');
  if (!clientId) throw new Error('server_error');

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('auth');
  var p = JSON.parse(res.getContentText());

  var now = Math.floor(Date.now() / 1000);
  var issOk = p.iss === 'accounts.google.com' || p.iss === 'https://accounts.google.com';
  if (p.aud !== clientId || !issOk || Number(p.exp) <= now ||
      String(p.email_verified) !== 'true' || !p.email) throw new Error('auth');

  var user = { email: String(p.email).toLowerCase(), name: String(p.name || '').slice(0, 100) };
  cache.put(key, JSON.stringify(user), Math.max(1, Math.min(1800, Number(p.exp) - now)));
  return user;
}

/* ---------- 試算表 ---------- */

function ss_() {
  var id = props_().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function findUserRow_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var emails = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).toLowerCase() === email) return i + 2;
  }
  return -1;
}

function effectivePlan_(plan, proUntil) {
  if (plan !== 'PRO') return 'FREE';
  if (!proUntil) return 'PRO';
  var t = new Date(proUntil).getTime();
  return (isNaN(t) || t > Date.now()) ? 'PRO' : 'FREE';
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** 取得（必要時建立）使用者，可同時累加計數欄位。回傳列資料物件。 */
function touchUser_(user, counterColumn) {
  return withLock_(function () {
    var sh = sheet_('Users', USER_HEADERS);
    var row = findUserRow_(sh, user.email);
    var nowIso = new Date().toISOString();
    if (row === -1) {
      sh.appendRow([user.email, user.name, 'FREE', '', nowIso, nowIso, 0, 0, 0, 0]);
      row = sh.getLastRow();
    }
    var vals = sh.getRange(row, 1, 1, USER_HEADERS.length).getValues()[0];
    vals[1] = user.name || vals[1];
    vals[5] = nowIso;
    if (counterColumn) {
      var idx = USER_HEADERS.indexOf(counterColumn);
      vals[idx] = Number(vals[idx] || 0) + 1;
    }
    sh.getRange(row, 1, 1, USER_HEADERS.length).setValues([vals]);
    return {
      email: vals[0], name: vals[1], planRaw: vals[2], proUntil: vals[3],
      plan: effectivePlan_(vals[2], vals[3])
    };
  });
}

function logEvent_(email, event, details) {
  var sh = sheet_('Events', EVENT_HEADERS);
  var text = '';
  try { text = JSON.stringify(details || {}).slice(0, 300); } catch (e) { text = ''; }
  sh.appendRow([new Date().toISOString(), email, event, text]);
}

/* ---------- 動作 ---------- */

function actionLogin_(user) {
  var u = touchUser_(user, 'logins');
  logEvent_(user.email, 'login', { plan: u.plan });
  return { ok: true, email: u.email, name: u.name, plan: u.plan, isAdmin: isAdmin_(user.email) };
}

function actionMe_(user) {
  var u = touchUser_(user, null);
  return { ok: true, email: u.email, name: u.name, plan: u.plan, isAdmin: isAdmin_(user.email) };
}

/**
 * 前端在「拍照」「下載」之前呼叫。由後端依方案決定是否允許，並記錄次數。
 * body: { event: 'photo'|'download', features: ['pro_filter','full_res'], filter: 'xxx' }
 */
function actionAuthorize_(user, body) {
  var event = String(body.event || '');
  if (ALLOWED_EVENTS.indexOf(event) === -1) throw new Error('bad_request');
  var features = Array.isArray(body.features) ? body.features.slice(0, 5).map(String) : [];

  var u = touchUser_(user, null);
  var needsPro = features.some(function (f) { return PRO_ONLY_FEATURES.indexOf(f) !== -1; });
  if (needsPro && u.plan !== 'PRO') {
    logEvent_(user.email, 'denied', { event: event, features: features });
    return { ok: true, allowed: false, plan: u.plan, reason: 'pro_required' };
  }
  touchUser_(user, EVENT_COUNTER[event]);
  var count = Math.max(0, Math.min(1000, Math.floor(Number(body.count) || 0)));
  logEvent_(user.email, event, { filter: String(body.filter || '').slice(0, 30), features: features, count: count });
  return { ok: true, allowed: true, plan: u.plan };
}

function actionAdminStats_() {
  var us = sheet_('Users', USER_HEADERS);
  var n = us.getLastRow() - 1;
  var rows = n > 0 ? us.getRange(2, 1, n, USER_HEADERS.length).getValues() : [];
  var totals = { users: rows.length, pro: 0, logins: 0, photos: 0, downloads: 0, syncs: 0 };
  var users = rows.map(function (r) {
    var plan = effectivePlan_(r[2], r[3]);
    if (plan === 'PRO') totals.pro++;
    totals.logins += Number(r[6] || 0);
    totals.photos += Number(r[7] || 0);
    totals.downloads += Number(r[8] || 0);
    totals.syncs += Number(r[9] || 0);
    return { email: r[0], name: r[1], plan: plan, proUntil: r[3] ? String(r[3]) : '',
             firstSeen: String(r[4]), lastSeen: String(r[5]),
             logins: Number(r[6] || 0), photos: Number(r[7] || 0), downloads: Number(r[8] || 0),
             syncs: Number(r[9] || 0) };
  });
  var es = sheet_('Events', EVENT_HEADERS);
  var m = es.getLastRow() - 1;
  var take = Math.min(m, 100);
  var ev = take > 0 ? es.getRange(es.getLastRow() - take + 1, 1, take, 4).getValues() : [];
  var recent = ev.reverse().map(function (r) {
    return { time: String(r[0]), email: r[1], event: r[2], details: r[3] };
  });
  return { ok: true, totals: totals, users: users, recent: recent };
}

function actionAdminSetPlan_(admin, body) {
  var target = String(body.targetEmail || '').toLowerCase().trim();
  var plan = String(body.plan || '');
  var until = String(body.proUntil || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target) || target.length > 200) throw new Error('bad_request');
  if (plan !== 'FREE' && plan !== 'PRO') throw new Error('bad_request');
  if (until && isNaN(new Date(until).getTime())) throw new Error('bad_request');
  if (plan === 'FREE') until = '';

  withLock_(function () {
    var sh = sheet_('Users', USER_HEADERS);
    var row = findUserRow_(sh, target);
    if (row === -1) {
      var nowIso = new Date().toISOString();
      sh.appendRow([target, '', plan, until, nowIso, '', 0, 0, 0, 0]);
    } else {
      sh.getRange(row, 3, 1, 2).setValues([[plan, until]]);
    }
  });
  logEvent_(admin.email, 'admin_set_plan', { target: target, plan: plan, proUntil: until });
  return { ok: true };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
