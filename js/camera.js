/* 相機、濾鏡與亮度。照片只在本機瀏覽器記憶體中處理，不會上傳。 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // 濾鏡以參數表示；同一份參數用於預覽(CSS filter)與拍照(canvas)。
  var FILTERS = {
    original: { label: '原色',  pro: false, p: {} },
    mono:     { label: '黑白',  pro: false, p: { gray: 1 } },
    warm:     { label: '暖色',  pro: false, p: { sepia: 0.2, saturate: 1.1 } },
    vivid:    { label: '鮮明',  pro: true,  p: { saturate: 1.45, contrast: 1.08 } },
    cool:     { label: '冷色',  pro: true,  p: { hue: 10, saturate: 0.92 } },
    vintage:  { label: '復古',  pro: true,  p: { sepia: 0.35, contrast: 0.9, saturate: 0.8 } },
    fade:     { label: '褪色',  pro: true,  p: { contrast: 0.85, brightness: 1.08, saturate: 0.75 } }
  };
  var FREE_MAX_EDGE = 1280;

  var stream = null, facing = 'environment';
  var filterKey = 'original', brightness = 1;
  var photos = [];
  var busy = false;

  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function isPro() { return YunnAuth.user && YunnAuth.user.plan === 'PRO'; }

  function cssFilter() {
    var p = FILTERS[filterKey].p, parts = [];
    parts.push('brightness(' + ((p.brightness || 1) * brightness).toFixed(2) + ')');
    if (p.contrast) parts.push('contrast(' + p.contrast + ')');
    if (p.saturate) parts.push('saturate(' + p.saturate + ')');
    if (p.gray) parts.push('grayscale(' + p.gray + ')');
    if (p.sepia) parts.push('sepia(' + p.sepia + ')');
    if (p.hue) parts.push('hue-rotate(' + p.hue + 'deg)');
    return parts.join(' ');
  }

  // 不支援 ctx.filter 的瀏覽器（部分 iOS Safari）用像素運算補上。
  function pixelFilter(ctx, w, h) {
    var p = FILTERS[filterKey].p, b = (p.brightness || 1) * brightness;
    var c = p.contrast || 1, s = p.saturate || 1, g = p.gray || 0, sp = p.sepia || 0;
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], gr = d[i + 1], bl = d[i + 2];
      var lum = 0.299 * r + 0.587 * gr + 0.114 * bl;
      r = lum + (r - lum) * s; gr = lum + (gr - lum) * s; bl = lum + (bl - lum) * s;
      if (g) { r += (lum - r) * g; gr += (lum - gr) * g; bl += (lum - bl) * g; }
      if (sp) {
        var tr = 0.393 * r + 0.769 * gr + 0.189 * bl, tg = 0.349 * r + 0.686 * gr + 0.168 * bl, tb = 0.272 * r + 0.534 * gr + 0.131 * bl;
        r += (tr - r) * sp; gr += (tg - gr) * sp; bl += (tb - bl) * sp;
      }
      r = ((r - 128) * c + 128) * b; gr = ((gr - 128) * c + 128) * b; bl = ((bl - 128) * c + 128) * b;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = gr < 0 ? 0 : gr > 255 ? 255 : gr; d[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
    }
    ctx.putImageData(img, 0, 0);
  }

  function applyPreview() {
    $('video').style.filter = cssFilter();
    $('video').style.transform = facing === 'user' ? 'scaleX(-1)' : '';
  }

  async function startCamera(mode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('此瀏覽器無法使用相機，請使用 HTTPS 網址。'); return;
    }
    try {
      var s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode } }, audio: false });
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = s; facing = mode;
      $('video').srcObject = s; $('video').classList.add('show');
      $('placeholder').style.display = 'none';
      $('camToggle').textContent = '關閉相機';
      $('camSwitch').disabled = false;
      $('camMode').textContent = mode === 'user' ? '前鏡頭' : '後鏡頭';
      applyPreview();
    } catch (e) {
      toast('無法開啟相機，請確認瀏覽器已允許相機權限。');
    }
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    $('video').srcObject = null; $('video').classList.remove('show');
    $('placeholder').style.display = '';
    $('camToggle').textContent = '開啟相機';
    $('camSwitch').disabled = true;
    $('camMode').textContent = '未開啟';
  }

  function buildFilterButtons() {
    var wrap = $('filters'); wrap.textContent = '';
    Object.keys(FILTERS).forEach(function (k) {
      var f = FILTERS[k];
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (k === filterKey ? ' on' : '');
      b.textContent = f.label + (f.pro ? ' ★' : '');
      if (f.pro && !isPro()) b.classList.add('locked');
      b.addEventListener('click', function () {
        if (f.pro && !isPro()) { toast('「' + f.label + '」為 PRO 濾鏡，請聯絡管理員升級。'); return; }
        filterKey = k; buildFilterButtons(); applyPreview();
      });
      wrap.appendChild(b);
    });
  }

  async function takePhoto() {
    if (busy) return;
    if (!stream) { toast('請先開啟相機'); return; }
    var video = $('video');
    if (!video.videoWidth) { toast('相機尚未就緒，請稍後再試'); return; }
    busy = true;
    try {
      var proFilter = FILTERS[filterKey].pro;
      var fullRes = isPro();
      // 先問後端：此帳號是否有權使用，並由後端計入拍照次數。
      var auth = await YunnAuth.api('authorize', {
        event: 'photo', filter: filterKey,
        features: (proFilter ? ['pro_filter'] : []).concat(fullRes ? ['full_res'] : [])
      });
      if (!auth.ok || !auth.allowed) {
        if (auth.allowed === false) {
          // 後端判定方案已不是 PRO（例如到期），同步本機顯示
          await refreshPlan();
          toast('PRO 權限已失效，請改用 FREE 功能。');
        } else if (auth.error !== 'auth') toast('無法確認權限，請稍後再試。');
        return;
      }
      var w = video.videoWidth, h = video.videoHeight;
      if (!fullRes) {
        var scale = Math.min(1, FREE_MAX_EDGE / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
      }
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      var native = 'filter' in ctx;
      if (native) ctx.filter = cssFilter();
      ctx.save();
      if (facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
      if (!native) pixelFilter(ctx, w, h);
      if (!fullRes) {
        ctx.filter = 'none';
        ctx.font = 'bold ' + Math.round(w * 0.035) + 'px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.textAlign = 'right';
        ctx.fillText('Yunn Camera', w - w * 0.03, h - h * 0.03);
      }
      var blob = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.92); });
      if (!blob) { toast('拍照失敗，請再試一次'); return; }
      photos.unshift({ blob: blob, url: URL.createObjectURL(blob), time: new Date().toLocaleString('zh-TW'), filter: filterKey });
      renderGallery();
      toast('已拍照（只存在這個裝置，離開頁面後會清除，請先下載）');
    } catch (e) {
      toast('拍照時發生錯誤');
    } finally { busy = false; }
  }

  async function downloadPhoto(p, i) {
    var res = await YunnAuth.api('authorize', { event: 'download', filter: p.filter, features: [] });
    if (!res.ok || !res.allowed) { toast('無法確認下載權限，請稍後再試。'); return; }
    var a = document.createElement('a');
    a.href = p.url; a.download = 'yunn-camera-' + Date.now() + '-' + (photos.length - i) + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- Google Drive 雲端同步（使用者手動觸發，傳到使用者自己的 Drive） ---------- */
  var DRIVE_FOLDER = 'Yunn 拍貼';
  var driveFolderId = null;

  function setCloud(msg) { $('cloudStatus').textContent = msg; }

  async function driveFetch(token, url, opts) {
    var o = opts || {};
    var r = await fetch(url, Object.assign({}, o, { headers: Object.assign({ Authorization: 'Bearer ' + token }, o.headers || {}) }));
    if (!r.ok) throw new Error('drive_' + r.status);
    return r.json();
  }

  async function ensureFolder(token) {
    if (driveFolderId) return driveFolderId;
    var q = encodeURIComponent("name='" + DRIVE_FOLDER + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    var found = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)');
    if (found.files && found.files.length) { driveFolderId = found.files[0].id; return driveFolderId; }
    var f = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' })
    });
    driveFolderId = f.id; return driveFolderId;
  }

  async function uploadToDrive(token, folderId, p, n) {
    var boundary = 'yunn_' + Math.random().toString(16).slice(2);
    var meta = { name: 'Yunn-Camera-' + Date.now() + '-' + n + '.jpg', mimeType: 'image/jpeg', parents: [folderId] };
    var body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
      '\r\n--' + boundary + '\r\nContent-Type: image/jpeg\r\n\r\n', p.blob, '\r\n--' + boundary + '--'
    ], { type: 'multipart/related; boundary=' + boundary });
    await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body
    });
  }

  async function syncAll() {
    var todo = photos.filter(function (p) { return !p.synced; });
    if (!todo.length) { toast(photos.length ? '所有照片都已同步' : '目前沒有照片可以同步'); return; }
    if (!confirm('要把 ' + todo.length + ' 張照片上傳到「你自己的」Google Drive「' + DRIVE_FOLDER + '」資料夾嗎？\n照片不會傳給管理員。')) return;
    var btn = $('syncBtn'); btn.disabled = true;
    try {
      setCloud('請在跳出的視窗允許存取…');
      var token = await YunnAuth.driveToken();
      // 確認授權的是目前登入的同一個 Google 帳號，避免照片傳到別人的 Drive。
      try {
        var about = await driveFetch(token, 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
        var who = about.user && about.user.emailAddress;
        if (who && who.toLowerCase() !== YunnAuth.user.email.toLowerCase()) {
          setCloud('授權的帳號（' + who + '）與登入帳號不同，已取消。請用同一個帳號重試。');
          return;
        }
      } catch (e) { /* 無法查詢時，以 login_hint 指定的帳號為準 */ }
      setCloud('正在準備資料夾…');
      var folder = await ensureFolder(token);
      var done = 0;
      for (var i = 0; i < todo.length; i++) {
        setCloud('正在同步 ' + (i + 1) + ' / ' + todo.length + '…');
        await uploadToDrive(token, folder, todo[i], i + 1);
        todo[i].synced = true; done++;
      }
      setCloud('同步完成：' + done + ' 張已存到你的 Google Drive「' + DRIVE_FOLDER + '」。');
      renderGallery();
      YunnAuth.api('authorize', { event: 'cloud_sync', features: [], count: done });
      toast('雲端同步完成');
    } catch (e) {
      var m = String(e && e.message || e);
      setCloud(/denied|access_denied|popup/.test(m) ? '你沒有授權，照片沒有上傳。' : '同步失敗（' + m + '）。請稍後再試。');
    } finally { btn.disabled = false; }
  }

  function renderGallery() {
    var grid = $('galleryGrid'); grid.textContent = '';
    $('photoCount').textContent = photos.length + ' 張';
    $('galleryEmpty').style.display = photos.length ? 'none' : '';
    photos.forEach(function (p, i) {
      var card = document.createElement('article'); card.className = 'photo-card';
      var img = document.createElement('img'); img.src = p.url; img.alt = '照片 ' + (photos.length - i);
      var meta = document.createElement('div'); meta.className = 'photo-meta';
      var t = document.createElement('span'); t.textContent = p.time + (p.synced ? ' · 已同步' : '');
      var row = document.createElement('div'); row.className = 'photo-actions';
      var dl = document.createElement('button'); dl.type = 'button'; dl.className = 'btn small'; dl.textContent = '下載';
      dl.addEventListener('click', function () { downloadPhoto(p, i); });
      var del = document.createElement('button'); del.type = 'button'; del.className = 'btn small danger'; del.textContent = '刪除';
      del.addEventListener('click', function () {
        if (!confirm('確定要刪除這張照片嗎？')) return;
        URL.revokeObjectURL(p.url); photos.splice(i, 1); renderGallery();
      });
      row.append(dl, del); meta.append(t, row); card.append(img, meta); grid.append(card);
    });
  }

  async function refreshPlan() {
    var d = await YunnAuth.api('me');
    if (d.ok) { YunnAuth.user.plan = d.plan; renderUser(); }
  }

  function showPage(name) {
    ['camera', 'gallery', 'account'].forEach(function (n) { $('page-' + n).classList.toggle('active', n === name); });
    document.querySelectorAll('.navbtn').forEach(function (b) { b.classList.toggle('active', b.dataset.page === name); });
  }

  function renderUser() {
    var u = YunnAuth.user;
    $('planBadge').textContent = u ? u.plan : '';
    $('acctEmail').textContent = u ? u.email : '';
    $('acctPlan').textContent = u ? (u.plan === 'PRO' ? 'PRO 進階版：全部濾鏡、原始解析度、無浮水印' : 'FREE 免費版：3 種濾鏡、最長邊 1280px、含浮水印') : '';
    $('adminLink').style.display = u && u.isAdmin ? '' : 'none';
    buildFilterButtons();
  }

  function onAuthChange(user) {
    var cfgOk = YunnAuth.configured();
    $('setupWarn').style.display = cfgOk ? 'none' : '';
    $('login').style.display = user ? 'none' : '';
    $('app').style.display = user ? '' : 'none';
    if (user) { renderUser(); } else { stopCamera(); photos.forEach(function (p) { URL.revokeObjectURL(p.url); }); photos = []; renderGallery(); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('camToggle').addEventListener('click', function () { stream ? stopCamera() : startCamera('environment'); });
    $('camSwitch').addEventListener('click', function () { if (stream) startCamera(facing === 'environment' ? 'user' : 'environment'); });
    $('shutter').addEventListener('click', takePhoto);
    $('syncBtn').addEventListener('click', syncAll);
    $('bright').addEventListener('input', function (e) {
      brightness = 1 + Number(e.target.value) / 100;
      $('brightVal').textContent = (e.target.value > 0 ? '+' : '') + e.target.value;
      applyPreview();
    });
    document.querySelectorAll('.navbtn').forEach(function (b) { b.addEventListener('click', function () { showPage(b.dataset.page); }); });
    $('logout').addEventListener('click', function () { YunnAuth.signOut(); });
    $('refreshPlan').addEventListener('click', function () { refreshPlan().then(function () { toast('方案已更新'); }); });
    YunnAuth.onChange(onAuthChange);
    onAuthChange(null);
    YunnAuth.start($('gbtn'));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  });
})();
