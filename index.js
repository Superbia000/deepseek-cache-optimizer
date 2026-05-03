console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/7] V5.2 三重攔截快取架構啟動中...");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const OPTIMIZED_FLAG = "_ds_optimized_v5"; // 防重複處理標籤

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
// 1. 安全初始化模組
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
    
    console.log("[DS-Cache-Opt] ⚙️ [3/7] 當前設定:", settings);
    injectUI();
    setupNativeHook();
    setupFetchHijack();
}

function safeSaveSettings() {
    if (ST_extension_settings) ST_extension_settings[EXTENSION_NAME] = settings;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        let context = SillyTavern.getContext();
        if (typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced(); return;
        }
    }
    if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
}

function getAnchorKey(chatArray, index) {
    if (index >= chatArray.length) return null;
    let key = `${chatArray[index].role}::${chatArray[index].content.substring(0, 50)}`;
    if (index + 1 < chatArray.length) {
        key += `||${chatArray[index+1].role}::${chatArray[index+1].content.substring(0, 50)}`;
    }
    return key;
}

// ==========================================
// 2. 原生無特效 UI 注入
// ==========================================
function injectUI() {
    console.log("[DS-Cache-Opt] ⏳ [4/7] 注入原生風格 UI...");
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 快取架構 V5.2</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用三重攔截快取引擎</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                    <br><small style="color:var(--SmartThemeBodyColor);">ST 上下文達到上限時，一次超前丟棄 N 條舊訊息，保證前綴鎖死。</small>
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
                alert("DeepSeek 快取狀態已重置。下一句將建立新的快取基準。");
            });
        }
    } else {
        setTimeout(injectUI, 1000);
    }
}

// ==========================================
// 3. 核心重組邏輯 (具備防重複處理機制)
// ==========================================
function optimizeMessages(messages) {
    if (!settings.enabled || messages.length < 3) return messages;
    
    // 防呆機制：如果已經被最佳化過，直接跳過，避免無限迴圈
    if (messages[OPTIMIZED_FLAG]) {
        console.log(`[DS-Cache-Opt] ⏭️ 偵測到已處理過的陣列，安全放行。`);
        return messages;
    }

    console.log(`\n--- [DS-Cache-Opt] 🧠 開始 V5.2 陣列重組 (原長度: ${messages.length}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestUser = messages[messages.length - 1];

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
        console.log(`[DS-Cache-Opt] 🆕 建立初始快取基準...`);
        cacheState.chatId = currentChatId;
        cacheState.isInitialized = true;
        
        let firstRealUserIndex = historyAll.findIndex(m => m.role === 'user');
        cacheState.exampleCount = firstRealUserIndex > 0 ? firstRealUserIndex : 0;
        
        let anchorIdx = cacheState.exampleCount;
        cacheState.anchorKey = getAnchorKey(historyAll, anchorIdx);
        console.log(`[DS-Cache-Opt] 基準完成！保護了 ${cacheState.exampleCount} 條範例對話。`);
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
                console.log(`[DS-Cache-Opt] 🚧 上下文推進，超前剔除 ${chunk} 條建立新護城河。`);
            } else {
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
            }
        }
        historyAll = [...examples, ...realHistory];
    }

    let optimized = [...sysTop, ...historyAll];
    if (sysBottom.length > 0) {
        let combined = sysBottom.map(m => m.content).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 合併 ${sysBottom.length} 條動態設定並強制置底。`);
    }
    optimized.push(latestUser);

    // 植入不可見的防呆標籤，保證不會被重複處理
    Object.defineProperty(optimized, OPTIMIZED_FLAG, { value: true, enumerable: false });

    console.log(`[DS-Cache-Opt] ✅ 陣列重組完成！(輸出長度: ${optimized.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
    return optimized;
}

// ==========================================
// 4. 第一重攔截：ST 原生事件 (讓介面同步)
// ==========================================
function setupNativeHook() {
    console.log("[DS-Cache-Opt] 🛡️ [5/7] 註冊 ST 原生事件攔截器...");
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const ST = SillyTavern.getContext();
        if (ST.eventSource && typeof ST.eventSource.on === 'function') {
            ST.eventSource.on('before_api_request', (eventArgs) => {
                if (settings.enabled && eventArgs && eventArgs.request && eventArgs.request.messages) {
                    console.log("[DS-Cache-Opt] 💡 觸發 ST 原生攔截，正在更新內部記憶體...");
                    eventArgs.request.messages = optimizeMessages(eventArgs.request.messages);
                }
            });
        }
    }
}

// ==========================================
// 5. 第二重攔截：Fetch 底層劫持 (防漏網之魚)
// ==========================================
function setupFetchHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [6/7] 注入 Fetch 底層攔截器...");
    const originalFetch = window.fetch;
    
    window.fetch = async function(...args) {
        let resource = args[0];
        let init = args[1];

        if (init && init.method === 'POST' && typeof init.body === 'string') {
            let url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            if (url.includes('/generate') || url.includes('/chat/completions') || url.includes('api.')) {
                try {
                    let parsed = JSON.parse(init.body);
                    let messages = parsed.messages || (parsed.body && parsed.body.messages);
                    
                    if (messages && !messages[OPTIMIZED_FLAG]) {
                        console.log(`[DS-Cache-Opt] 🌐 Fetch 層捕捉到未處理的 Payload，強制介入...`);
                        let optimized = optimizeMessages(messages);
                        
                        if (parsed.messages) parsed.messages = optimized;
                        if (parsed.body && parsed.body.messages) parsed.body.messages = optimized;
                        
                        // 強制覆寫參考，解決嚴格模式下的遺失問題
                        init.body = JSON.stringify(parsed);
                        args[1] = init; 
                        console.log("[DS-Cache-Opt] 📤 網路層 Payload 覆寫成功！");
                    }
                } catch (e) {
                    console.error("[DS-Cache-Opt] ❌ Fetch 攔截錯誤:", e);
                }
            }
        }
        return originalFetch.apply(this, args);
    };
    console.log("[DS-Cache-Opt] 🎉 [7/7] 初始化流程全部完成！快取引擎正在運作中。");
}

setTimeout(init, 500);
