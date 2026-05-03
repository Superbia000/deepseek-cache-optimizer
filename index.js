console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/4] V7.0 安全原生快取架構啟動...");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const OPTIMIZED_FLAG = "_ds_optimized_v7";

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
function init() {
    console.log("[DS-Cache-Opt] ⏳ [2/4] 載入設定檔...");
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
    setupNativeHook(); // 放棄 Fetch 劫持，全心投入最安全的原生 Hook
}

function safeSaveSettings() {
    if (ST_extension_settings) ST_extension_settings[EXTENSION_NAME] = settings;
    if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
}

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
    console.log("[DS-Cache-Opt] ⏳ [3/4] 注入原生 UI...");
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 原生快取架構 V7</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用原生事件陣列重組</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                    <br><small style="color:var(--SmartThemeBodyColor);">超前丟棄舊訊息數，保證前綴鎖死。</small>
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
    if (messages[OPTIMIZED_FLAG]) return messages;

    console.log(`\n--- [DS-Cache-Opt] 🧠 開始 V7 重組 (原長度: ${messages.length}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestMsg = messages[messages.length - 1]; // 保留最後一條不動 (通常是使用者輸入)

    // 1. 分離陣列：最頂端的 System -> 歷史 -> 中間的世界書 System
    let foundFirstUser = false;
    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (msg.role !== 'system') foundFirstUser = true;

        if (!foundFirstUser && msg.role === 'system') {
            sysTop.push(msg); // Main Prompt
        } else if (msg.role === 'system') {
            sysBottom.push(msg); // Lorebooks / Authors Note
        } else {
            historyAll.push(msg); // History + Examples
        }
    }

    // 2. 對話狀態錨點偵測
    let currentChatId = sysTop.length > 0 ? getAnchorKey(sysTop, 0) : 'default';
    if (!cacheState.isInitialized || cacheState.chatId !== currentChatId) {
        cacheState.chatId = currentChatId;
        cacheState.isInitialized = true;
        let firstRealUserIndex = historyAll.findIndex(m => m.role === 'user');
        cacheState.exampleCount = firstRealUserIndex > 0 ? firstRealUserIndex : 0;
        cacheState.anchorKey = getAnchorKey(historyAll, cacheState.exampleCount);
    }

    // 3. 切塊演算法 (Chunking)
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

    // 4. 重組為完美結構
    let optimized = [...sysTop, ...historyAll];
    if (sysBottom.length > 0) {
        let combined = sysBottom.map(m => safeGetText(m)).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 合併 ${sysBottom.length} 條動態設定並強制置底。`);
    }
    optimized.push(latestMsg);

    // 打上不可見的標記，防止 ST 內部重複處理
    Object.defineProperty(optimized, OPTIMIZED_FLAG, { value: true, enumerable: false });

    console.log(`[DS-Cache-Opt] ✅ 陣列重組完成！(輸出長度: ${optimized.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
    return optimized;
}

// ==========================================
// 4. 絕對安全的 ST 原生事件攔截
// ==========================================
function setupNativeHook() {
    console.log("[DS-Cache-Opt] 🛡️ [4/4] 綁定 ST 原生 Prompt 事件...");
    
    let eventSource = null;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        eventSource = SillyTavern.getContext().eventSource;
    }
    if (!eventSource && typeof window.eventSource !== 'undefined') {
        eventSource = window.eventSource;
    }

    if (eventSource && typeof eventSource.on === 'function') {
        eventSource.on('before_api_request', (eventArgs) => {
            if (!settings.enabled) return;
            try {
                if (eventArgs && eventArgs.request && Array.isArray(eventArgs.request.messages)) {
                    console.log("[DS-Cache-Opt] 💡 捕捉到 ST 原生事件，執行陣列替換...");
                    
                    // 執行重組，並直接覆寫記憶體中的陣列
                    let newMessages = optimizeMessages(eventArgs.request.messages);
                    
                    // 清空原本的陣列，再將新陣列塞回去，確保記憶體指標更新
                    eventArgs.request.messages.length = 0;
                    eventArgs.request.messages.push(...newMessages);
                    
                    // 再次打上標記
                    Object.defineProperty(eventArgs.request.messages, OPTIMIZED_FLAG, { value: true, enumerable: false });
                }
            } catch (e) {
                console.error("[DS-Cache-Opt] ❌ 陣列替換失敗:", e);
            }
        });
        console.log("[DS-Cache-Opt] 🎉 系統就緒！快取引擎已與 SillyTavern 核心完美融合。");
    } else {
        console.error("[DS-Cache-Opt] ❌ 無法找到 eventSource，請更新 SillyTavern。");
    }
}

// 使用 jQuery 保證 DOM 完全載入後再啟動
jQuery(() => {
    setTimeout(init, 500);
});
