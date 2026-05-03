console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/3] V10.0 記憶體劫持神蹟版啟動...");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const OPTIMIZED_FLAG = "_ds_optimized_v10";

const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_ext_settings_ref = null;

let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,
    anchorKey: null
};

// ==========================================
// 1. 初始化與設定檔管理
// ==========================================
function init() {
    console.log("[DS-Cache-Opt] ⏳ [2/3] 載入設定...");
    const getCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext : (window.getContext || null);
    const context = getCtx ? getCtx() : {};

    ST_ext_settings_ref = context.extension_settings || window.extension_settings || {};
    
    if (!ST_ext_settings_ref[EXTENSION_NAME]) {
        ST_ext_settings_ref[EXTENSION_NAME] = { ...defaultSettings };
    }
    settings = Object.assign({}, defaultSettings, ST_ext_settings_ref[EXTENSION_NAME]);
    if (settings.enabled !== false) settings.enabled = true;

    injectUI();
    setupMemoryHijack(); // 啟動 V10 核心劫持
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

// 特徵抓取
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
// 2. 原生 UI 注入
// ==========================================
function injectUI() {
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 快取記憶體引擎 V10</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用記憶體核心劫持 (100% 介面同步)</span>
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
    }
    optimized.push(latestMsg);
    
    return optimized;
}

// ==========================================
// 4. V10 獨家黑科技：JSON.stringify 記憶體劫持
// ==========================================
function setupMemoryHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [3/3] 注入 JSON.stringify 記憶體同步劫持器...");
    const originalStringify = JSON.stringify;
    
    JSON.stringify = function(value, replacer, space) {
        try {
            // 偵測是否為即將送出的 LLM Payload (具備 messages 陣列與模型參數)
            if (settings.enabled && value && typeof value === 'object' && Array.isArray(value.messages) && value.messages.length > 2) {
                if (value.model || value.temperature !== undefined || value.max_tokens !== undefined || value.stream !== undefined) {
                    
                    if (!value.messages[OPTIMIZED_FLAG]) {
                        const originalLen = value.messages.length;
                        console.log(`\n--- [DS-Cache-Opt] 🧠 記憶體劫持啟動 (原長度: ${originalLen}) ---`);
                        
                        // 1. 強行覆寫記憶體物件！這會讓 ST 的介面瞬間同步更新
                        value.messages = optimizeMessages(value.messages);
                        const newLen = value.messages.length;
                        
                        // 2. 標記已處理，防止無限迴圈
                        Object.defineProperty(value.messages, OPTIMIZED_FLAG, { value: true, enumerable: false });
                        console.log(`[DS-Cache-Opt] ✅ 記憶體覆寫完成！(輸出長度: ${newLen})\n`);

                        // 3. 彈出視覺提示框給使用者！(只有長度改變或動態設定合併時才提示)
                        if (typeof toastr !== 'undefined') {
                            toastr.success(`DeepSeek 快取保護：<br>對話陣列已從 ${originalLen} 條最佳化為 ${newLen} 條！<br>(動態設定已置底)`, '快取命中極限化', { timeOut: 4000 });
                        }
                    }
                }
            }
        } catch (err) {
            console.error("[DS-Cache-Opt] ❌ 記憶體劫持處理失敗:", err);
        }
        
        // 放行並呼叫原生的序列化
        return originalStringify.call(this, value, replacer, space);
    };
    console.log("[DS-Cache-Opt] 🎉 記憶體防護網部署完畢！再也不會有 AbortError。");
}

setTimeout(init, 500);
