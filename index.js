console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/7] V6.0 絕對零度快取防禦啟動...");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const OPTIMIZED_FLAG = "_ds_optimized_v6";

const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_extension_settings = null;

let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,
    anchorKey: null
};

// ==========================================
// 1. 安全初始化與全域設定
// ==========================================
async function init() {
    console.log("[DS-Cache-Opt] ⏳ [2/7] 載入設定檔...");
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        let context = SillyTavern.getContext();
        if (context && context.extension_settings) ST_extension_settings = context.extension_settings;
    }
    if (!ST_extension_settings && typeof window.extension_settings !== 'undefined') {
        ST_extension_settings = window.extension_settings;
    }
    if (!ST_extension_settings) ST_extension_settings = {}; 
    if (!ST_extension_settings[EXTENSION_NAME]) ST_extension_settings[EXTENSION_NAME] = {};
    
    settings = Object.assign({}, defaultSettings, ST_extension_settings[EXTENSION_NAME]);
    if (settings.enabled !== false) settings.enabled = true;
    settings.chunkSize = parseInt(settings.chunkSize) || 10;
    
    injectUI();
    await hookSillyTavernNative(); // 第一重：記憶體攔截
    setupXHRHijack();              // 第二重：XHR 攔截
    setupFetchHijack();            // 第三重：Fetch 攔截
}

function safeSaveSettings() {
    if (ST_extension_settings) ST_extension_settings[EXTENSION_NAME] = settings;
    if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
}

// 防崩潰：安全提取訊息內容 (解決多模態或陣列導致的崩潰)
function safeGetText(msg) {
    if (!msg || !msg.content) return "";
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        let txtPart = msg.content.find(c => c.type === 'text');
        return txtPart && txtPart.text ? txtPart.text : "[Media]";
    }
    return String(msg.content);
}

// 產生防呆特徵金鑰
function getAnchorKey(chatArray, index) {
    if (index >= chatArray.length) return null;
    let key = `${chatArray[index].role}::${safeGetText(chatArray[index]).substring(0, 50)}`;
    if (index + 1 < chatArray.length) {
        key += `||${chatArray[index+1].role}::${safeGetText(chatArray[index+1]).substring(0, 50)}`;
    }
    return key;
}

// ==========================================
// 2. 原生風格 UI 注入
// ==========================================
function injectUI() {
    console.log("[DS-Cache-Opt] ⏳ [3/7] 注入原生 UI...");
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 終極快取架構 V6</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用全維度三重攔截引擎</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                </div>
                <div style="margin-top: 10px;">
                    <button id="ds_reset_btn" class="menu_button">強制重置快取狀態 (手動刪除歷史後點擊)</button>
                </div>
            </div>
        </div>
    </div>
    `;

    if ($('#extensions_settings').length > 0) {
        if ($('#ds_cache_ui_box').length === 0) {
            $('#extensions_settings').append(uiHTML);
            $('#ds_cache_enable').on('change', function() {
                settings.enabled = !!$(this).prop('checked');
                if (settings.enabled) cacheState.isInitialized = false; 
                safeSaveSettings();
            });
            $('#ds_chunk_size').on('input', function() {
                settings.chunkSize = parseInt($(this).val()) || 10;
                safeSaveSettings();
            });
            $('#ds_reset_btn').on('click', function() {
                cacheState.isInitialized = false;
                alert("狀態已重置。");
            });
        }
    } else {
        setTimeout(injectUI, 1000);
    }
}

// ==========================================
// 3. 核心零缺陷重組邏輯
// ==========================================
function optimizeMessages(messages) {
    if (!settings.enabled || messages.length < 3) return messages;
    
    // 防無限迴圈
    if (messages[OPTIMIZED_FLAG]) return messages;

    console.log(`\n--- [DS-Cache-Opt] 🧠 開始 V6 重組 (原長度: ${messages.length}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestMsg = messages[messages.length - 1]; // 無論是 User 還是 System，保留最後一條不動

    let foundFirstUser = false;
    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (msg.role !== 'system') foundFirstUser = true;

        if (!foundFirstUser && msg.role === 'system') {
            sysTop.push(msg);
        } else if (msg.role === 'system') {
            sysBottom.push(msg);
        } else {
            historyAll.push(msg);
        }
    }

    let currentChatId = sysTop.length > 0 ? getAnchorKey(sysTop, 0) : 'default';
    if (!cacheState.isInitialized || cacheState.chatId !== currentChatId) {
        cacheState.chatId = currentChatId;
        cacheState.isInitialized = true;
        let firstRealUserIndex = historyAll.findIndex(m => m.role === 'user');
        cacheState.exampleCount = firstRealUserIndex > 0 ? firstRealUserIndex : 0;
        cacheState.anchorKey = getAnchorKey(historyAll, cacheState.exampleCount);
    }

    if (historyAll.length > cacheState.exampleCount) {
        let examples = historyAll.slice(0, cacheState.exampleCount);
        let realHistory = historyAll.slice(cacheState.exampleCount);
        
        let anchorIndex = -1;
        if (cacheState.anchorKey) {
            for (let i = 0; i < realHistory.length; i++) {
                if (getAnchorKey(realHistory, i) === cacheState.anchorKey) {
                    anchorIndex = i; break;
                }
            }
        }

        if (anchorIndex !== -1) {
            realHistory = realHistory.slice(anchorIndex);
            console.log(`[DS-Cache-Opt] 🎯 複合錨點命中！(Index: ${anchorIndex})`);
        } else {
            let chunk = settings.chunkSize || 10;
            if (realHistory.length > chunk + 2) {
                realHistory = realHistory.slice(chunk);
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
                console.log(`[DS-Cache-Opt] 🚧 超前剔除 ${chunk} 條建立新護城河。`);
            } else {
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
            }
        }
        historyAll = [...examples, ...realHistory];
    }

    let optimized = [...sysTop, ...historyAll];
    if (sysBottom.length > 0) {
        let combined = sysBottom.map(m => safeGetText(m)).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 合併 ${sysBottom.length} 條動態設定並強制置底。`);
    }
    optimized.push(latestMsg);

    // 打上防呆標記
    Object.defineProperty(optimized, OPTIMIZED_FLAG, { value: true, enumerable: false });

    console.log(`[DS-Cache-Opt] ✅ 陣列重組完成！(輸出長度: ${optimized.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
    return optimized;
}

// ==========================================
// 4. 第一重攔截：ST 記憶體原生攔截 (UI 同步)
// ==========================================
async function hookSillyTavernNative() {
    console.log("[DS-Cache-Opt] 🛡️ [4/7] 嘗試註冊記憶體攔截器...");
    try {
        const stModule = await import('../../../../script.js');
        if (stModule && stModule.eventSource) {
            stModule.eventSource.on('before_api_request', (eventArgs) => {
                if (!settings.enabled) return;
                if (eventArgs && eventArgs.request && eventArgs.request.messages) {
                    console.log("[DS-Cache-Opt] 💡 觸發原生記憶體攔截 (ST 介面將同步顯示正確長度)！");
                    eventArgs.request.messages = optimizeMessages(eventArgs.request.messages);
                }
            });
            console.log("[DS-Cache-Opt] ✅ 記憶體攔截成功！");
        }
    } catch (e) {
        console.warn("[DS-Cache-Opt] ⚠️ 無法匯入 script.js，依賴底層網路攔截。");
    }
}

// 深度遍歷 Payload 強制替換
function deepReplacePayload(obj) {
    let modified = false;
    if (obj && obj.messages && Array.isArray(obj.messages) && !obj.messages[OPTIMIZED_FLAG]) {
        obj.messages = optimizeMessages(obj.messages);
        modified = true;
    }
    if (obj && obj.body && typeof obj.body === 'object') {
        if (deepReplacePayload(obj.body)) modified = true;
    } else if (obj && obj.body && typeof obj.body === 'string') {
        try {
            let inner = JSON.parse(obj.body);
            if (inner.messages && Array.isArray(inner.messages) && !inner.messages[OPTIMIZED_FLAG]) {
                inner.messages = optimizeMessages(inner.messages);
                obj.body = JSON.stringify(inner);
                modified = true;
            }
        } catch(e) {}
    }
    return modified;
}

// ==========================================
// 5. 第二重攔截：XHR 底層劫持
// ==========================================
function setupXHRHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [5/7] 注入 XHR 底層攔截器...");
    const originalXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        try {
            if (typeof body === 'string' && this._url && (this._url.includes('/generate') || this._url.includes('api.'))) {
                let parsed = JSON.parse(body);
                if (deepReplacePayload(parsed)) {
                    body = JSON.stringify(parsed);
                    console.log("[DS-Cache-Opt] 📤 XHR 網路層絕對覆寫成功！");
                }
            }
        } catch(e) {}
        return originalXHRSend.call(this, body);
    };
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = typeof url === 'string' ? url : url.href;
        return originalXHROpen.apply(this, arguments);
    };
}

// ==========================================
// 6. 第三重攔截：Fetch 終極劫持 (解鎖 Request 限制)
// ==========================================
function setupFetchHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [6/7] 注入 Fetch 底層攔截器...");
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        try {
            let request = args[0];
            let options = args[1] || {};
            let url = typeof request === 'string' ? request : (request.url || '');

            // 破解 Request 物件的唯讀限制
            if (request instanceof Request && request.method === 'POST') {
                options.method = 'POST';
                options.headers = {};
                request.headers.forEach((val, key) => options.headers[key] = val);
                options.body = await request.clone().text();
                args[0] = url; // 降級回字串以允許修改 options
            }

            if (options.method === 'POST' && typeof options.body === 'string') {
                if (url.includes('/generate') || url.includes('/chat/completions') || url.includes('api.')) {
                    let parsed = JSON.parse(options.body);
                    if (deepReplacePayload(parsed)) {
                        options.body = JSON.stringify(parsed);
                        args[1] = options; 
                        console.log("[DS-Cache-Opt] 📤 Fetch 網路層絕對覆寫成功！");
                    }
                }
            }
            return originalFetch.apply(this, args);
        } catch (err) {
            console.error("[DS-Cache-Opt] ❌ Fetch 攔截錯誤:", err);
            return originalFetch.apply(this, args);
        }
    };
    console.log("[DS-Cache-Opt] 🎉 [7/7] 全系統防禦部署完畢！");
}

setTimeout(init, 500);
