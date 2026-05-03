console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/4] V9.0 終極防護破壁版啟動中...");
console.log("==================================================");

// 🚫 嚴禁使用靜態 import，免疫 SyntaxError

const EXTENSION_NAME = "deepseek-cache-optimizer";
const OPTIMIZED_FLAG = "_ds_optimized_v9";

const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_ext_settings_ref = null;
let ST_eventSource_ref = null;

let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,
    anchorKey: null
};

// ==========================================
// 1. 動態安全模組探測 (破解打包環境限制)
// ==========================================
async function loadSTModules() {
    console.log("[DS-Cache-Opt] ⏳ [2/4] 啟動多維動態模組探測...");
    
    const scriptPaths = ['../../../../script.js', '../../../script.js', './script.js'];
    const extPaths = ['../../../extensions.js', '../../extensions.js', './extensions.js'];

    // 探測 script.js
    for (let p of scriptPaths) {
        try {
            let mod = await import(p);
            if (mod.eventSource) ST_eventSource_ref = mod.eventSource;
            if (mod.extension_settings) ST_ext_settings_ref = mod.extension_settings;
        } catch(e) { /* 靜默忽略，繼續探測 */ }
    }
    // 探測 extensions.js
    for (let p of extPaths) {
        try {
            let mod = await import(p);
            if (mod.eventSource && !ST_eventSource_ref) ST_eventSource_ref = mod.eventSource;
            if (mod.extension_settings && !ST_ext_settings_ref) ST_ext_settings_ref = mod.extension_settings;
        } catch(e) {}
    }

    // 探測全域與 ST Context
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        let ctx = SillyTavern.getContext();
        if (ctx.eventSource && !ST_eventSource_ref) ST_eventSource_ref = ctx.eventSource;
        if (ctx.extension_settings && !ST_ext_settings_ref) ST_ext_settings_ref = ctx.extension_settings;
    }
    if (!ST_eventSource_ref && window.eventSource) ST_eventSource_ref = window.eventSource;
    if (!ST_ext_settings_ref && window.extension_settings) ST_ext_settings_ref = window.extension_settings;

    if (!ST_ext_settings_ref) ST_ext_settings_ref = {}; // 終極保底記憶體
}

async function init() {
    await loadSTModules();

    if (!ST_ext_settings_ref[EXTENSION_NAME]) {
        ST_ext_settings_ref[EXTENSION_NAME] = { ...defaultSettings };
    }
    settings = Object.assign({}, defaultSettings, ST_ext_settings_ref[EXTENSION_NAME]);
    if (settings.enabled !== false) settings.enabled = true;

    console.log("[DS-Cache-Opt] ⚙️ [3/4] 當前設定檔:", settings);

    injectUI();
    
    if (ST_eventSource_ref && typeof ST_eventSource_ref.on === 'function') {
        registerNativeHook();
    } else {
        console.warn("[DS-Cache-Opt] ⚠️ 未能找到內部 eventSource (打包版限制)。將完全依賴無損 Fetch 攔截器。");
    }
    
    setupFetchHijack();
}

function safeSaveSettings() {
    if (ST_ext_settings_ref) ST_ext_settings_ref[EXTENSION_NAME] = settings;
    const getCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext : (window.getContext || null);
    if (getCtx && typeof getCtx().saveSettingsDebounced === 'function') {
        getCtx().saveSettingsDebounced();
    } else if (typeof window.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
    }
}

// 防崩潰特徵抓取
function safeGetText(msg) {
    if (!msg || !msg.content) return "";
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        let txtPart = msg.content.find(c => c.type === 'text');
        return txtPart && txtPart.text ? txtPart.text : "[Media]";
    }
    return String(msg.content);
}

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
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 快取破壁架構 V9</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用全維度同步攔截引擎</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                </div>
                <div style="margin-top: 10px;">
                    <button id="ds_reset_btn" class="menu_button">強制重置快取狀態</button>
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
                alert("DeepSeek 快取狀態已重置！下一句對話將建立新基準。");
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
    if (messages[OPTIMIZED_FLAG]) return messages; // 防重複處理

    console.log(`\n--- [DS-Cache-Opt] 🧠 開始陣列重組 (原長度: ${messages.length}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestMsg = messages[messages.length - 1]; 

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
                console.log(`[DS-Cache-Opt] 🚧 錨點丟失，超前剔除 ${chunk} 條建立新護城河。`);
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
        console.log(`[DS-Cache-Opt] 📦 發現並合併 ${sysBottom.length} 條動態設定，已安全強制置底。`);
    }
    optimized.push(latestMsg);

    Object.defineProperty(optimized, OPTIMIZED_FLAG, { value: true, enumerable: false });

    console.log(`[DS-Cache-Opt] ✅ 陣列重組完成！(輸出長度: ${optimized.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
    
    return optimized;
}

// ==========================================
// 4. 雙重攔截引擎
// ==========================================
function registerNativeHook() {
    ST_eventSource_ref.on('before_api_request', (requestData) => {
        if (settings.enabled && requestData && Array.isArray(requestData.messages)) {
            requestData.messages = optimizeMessages(requestData.messages);
            console.log("[DS-Cache-Opt] 💡 記憶體層攔截成功，UI 已同步。");
        }
    });
}

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

function setupFetchHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [4/4] 注入 Fetch 同步無損網路攔截器...");
    const originalFetch = window.fetch;
    window.fetch = function(...args) { // 移除 async，保證 100% 同步執行不干擾 Abort
        try {
            let request = args[0];
            let options = args[1] || {};
            let url = typeof request === 'string' ? request : (request.url || '');

            if (options.method === 'POST' && typeof options.body === 'string') {
                if (url.includes('/generate') || url.includes('/chat/completions') || url.includes('api.')) {
                    let parsed = JSON.parse(options.body);
                    if (deepReplacePayload(parsed)) {
                        options.body = JSON.stringify(parsed);
                        args[1] = options;
                        console.log("[DS-Cache-Opt] 📤 網路層同步 Payload 覆寫成功！(無懼 AbortError)");
                    }
                }
            }
        } catch (err) {
            console.error("[DS-Cache-Opt] ❌ Fetch 攔截處理失敗:", err);
        }
        return originalFetch.apply(this, args);
    };
    console.log("[DS-Cache-Opt] 🎉 全系統防禦部署完畢！");
}

setTimeout(init, 500);
