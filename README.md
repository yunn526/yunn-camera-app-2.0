# Yunn Camera

登入後才能使用的手機相機網頁（PWA）。FREE／PRO 兩種方案，附管理員後台，使用紀錄存在你自己的 Google 試算表。

> 這是**全新專案**，與舊版相機網站互不影響。請建立**新的** OAuth 用戶端與**新的** Apps Script 部署，不要沿用舊的網址與 ID。

## 專案結構

```
index.html          相機主畫面（登入、相機、相簿、帳號）
admin.html          管理員後台
css/style.css       樣式
js/config.js        你要填的設定（Client ID、API 網址）
js/auth.js          Google 登入與後端 API 呼叫
js/camera.js        相機、濾鏡、亮度、拍照、下載
js/admin.js         後台統計畫面
backend/Code.gs     Google Apps Script 後端（貼到 Apps Script，不會被網站載入）
manifest.json       PWA 設定
sw.js               Service Worker（離線載入靜態檔）
icons/              PWA 圖示
```

## 運作方式與隱私

- 照片只在使用者手機的瀏覽器記憶體中處理，**不會上傳**。關閉或重新整理頁面後就消失，使用者需自行下載。
- 後端只記錄：Google 帳號、名稱、登入次數、拍照次數、下載次數、方案，以及事件時間與濾鏡名稱。**沒有任何照片內容**。
- 每次請求都帶 Google ID token，由 Apps Script 向 Google 驗證（簽章、`aud`、`iss`、有效期限、email 已驗證）。
- 管理員名單只存在 Apps Script 的「指令碼屬性」`ADMIN_EMAILS`，不寫在前端。非管理員呼叫後台 API 會被後端拒絕，即使他知道 `admin.html` 的網址。
- 方案（FREE／PRO）只讀試算表 `Users` 工作表。前端自稱 PRO 無效。

### FREE 與 PRO

| | FREE | PRO |
|---|---|---|
| 濾鏡 | 原色、黑白、暖色 | 另有鮮明、冷色、復古、褪色 |
| 亮度調整 | ✓ | ✓ |
| 照片解析度 | 最長邊 1280px，含「Yunn Camera」浮水印 | 相機原始解析度，無浮水印 |
| 前後鏡頭、拍照、下載 | ✓ | ✓ |

### 關於 PRO 權限的誠實說明

拍照與濾鏡運算在使用者手機上進行，因此**純靜態網站沒辦法百分之百防止**有技術的人修改自己瀏覽器裡的程式來繞過限制。目前的做法是：每次拍照、下載前都先向後端 `authorize`，由後端依試算表方案決定是否允許並計次；後端說不行，前端就不拍。這能擋住一般使用，也讓後台的數字可信，但不是 DRM。

若將來要做到真正難以繞過，PRO 功能必須放在伺服器端處理（例如上傳照片到伺服器做處理），那會改變「照片只在裝置上處理」的隱私承諾，需要另外討論。

### 付款

**目前沒有金流。** PRO 由管理員在後台手動核發（可設到期日）。要自動收款，需另外串接金流（Stripe、綠界、藍新等）的 webhook，由後端在收到付款成功通知後才把 `Users` 的方案改成 PRO。**付款成功前，前端沒有任何方式可以讓自己變成 PRO。** 金流串接尚未實作。

---

## 設定步驟

### 1. 建立試算表

1. 到 Google 試算表建立一份新的空白試算表，命名如「Yunn Camera 使用紀錄」。
2. 從網址 `https://docs.google.com/spreadsheets/d/<這一段>/edit` 複製**試算表 ID**。
3. `Users` 與 `Events` 兩個工作表會在第一次有人登入時由後端自動建立。

### 2. 建立 Google OAuth 用戶端

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)，建立新專案（例如 `yunn-camera`）。
2. 「API 和服務 → OAuth 同意畫面」：選「外部」，填應用程式名稱與你的 Email。測試階段把想測試的帳號加到「測試使用者」。
3. 「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」，類型選**網頁應用程式**。
4. 「已授權的 JavaScript 來源」加入：
   - `https://yunn526.github.io`
   - 本機測試時再加 `http://localhost:8000`
5. 建立後複製**用戶端 ID**（以 `.apps.googleusercontent.com` 結尾）。

6. 「資料存取（Data access）」→ 新增或移除範圍 → 勾選 `.../auth/drive.file`（「查看、編輯、建立及刪除你在本應用程式中使用或建立的 Google 雲端硬碟檔案」）並儲存。
7. 「已啟用的 API 和服務」→ 搜尋並啟用 **Google Drive API**。

雲端同步只用 `drive.file` 範圍：網站只能存取**它自己建立**的「Yunn 拍貼」資料夾與其中的照片，看不到使用者 Drive 裡的其他檔案。同步由使用者在相簿頁手動按下，照片從手機直接傳到使用者自己的 Drive，不經過我們的後端，管理員看不到；後台只統計同步次數。

### 3. 部署 Apps Script 後端

1. 到 [script.google.com](https://script.google.com/) 建立新專案，名稱如 `yunn-camera-backend`。
2. 把 `backend/Code.gs` 的內容整份貼進去（取代預設的 `Code.gs`）。
3. 左側「專案設定」→「指令碼屬性」→ 新增三個屬性：

   | 屬性 | 值 |
   |---|---|
   | `CLIENT_ID` | 步驟 2 的用戶端 ID |
   | `ADMIN_EMAILS` | 管理員 Gmail，多個以逗號分隔 |
   | `SHEET_ID` | 步驟 1 的試算表 ID |

4. 「部署 → 新增部署作業 → 類型：網頁應用程式」：
   - 執行身分：**我**
   - 誰可以存取：**所有人**（任何人都能呼叫網址，但沒有有效的 Google ID token 一律被拒絕）
5. 第一次部署會要求授權（存取試算表、對外連線），照畫面同意。
6. 複製**網頁應用程式網址**（以 `/exec` 結尾）。

> 之後修改 `Code.gs`，需要「部署 → 管理部署作業 → 編輯 → 新版本」才會生效，網址不變。

### 4. 填入前端設定

編輯 `js/config.js`：

```js
window.YUNN_CONFIG = {
  GOOGLE_CLIENT_ID: '你的用戶端 ID.apps.googleusercontent.com',
  API_URL: 'https://script.google.com/macros/s/.../exec'
};
```

Client ID 與 API 網址本來就會出現在前端，不是祕密。**真正的祕密（如未來的金流金鑰）絕對不要放進前端或這個倉庫。**

### 5. 本機先測試

```bash
cd yunn-camera-app
python3 -m http.server 8000
```

開啟 `http://localhost:8000`（相機權限在 `localhost` 與 HTTPS 才能使用）。

### 6. 上傳到 GitHub 並開啟 GitHub Pages

1. 把整個資料夾內容放進 `yunn526/yunn-camera-app`（不要放到舊專案）。
2. 倉庫「Settings → Pages」→ Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾 `/ (root)`。
3. 等一兩分鐘後網址為 `https://yunn526.github.io/yunn-camera-app/`。

---

## 上線前測試清單

以下需要在真實的 Google 帳號與網址上測試，**程式碼本身尚未在真實 Google 環境驗證**：

- [ ] 未登入時看不到相機，只看到登入按鈕
- [ ] Google 登入成功，試算表出現 `Users`、`Events`
- [ ] 後鏡頭開啟、切換前鏡頭、拍照、下載
- [ ] 一般帳號開啟 `admin.html` 登入後顯示「沒有管理員權限」
- [ ] 管理員帳號可看到統計，數字與實際操作相符
- [ ] 後台核發 PRO 後，使用者按「重新取得方案」可使用 PRO 濾鏡；設過期日後自動降回 FREE
- [ ] iPhone Safari 與 Android Chrome 的拍照濾鏡結果一致
- [ ] 「加入主畫面」後以獨立視窗開啟
- [ ] 登入超過一小時後（token 過期）會要求重新登入

## 已知限制

- Google ID token 約一小時過期，過期後需重新登入（頁面會提示）。
- Apps Script 有每日呼叫與同時執行的配額；使用者很多時要改用正式資料庫。
- 試算表只適合小規模使用；事件表會一直增長，需要時請自行封存。
- 後台目前只顯示最近 100 筆事件。
- 尚未實作：自動金流、伺服器端 PRO 處理。
