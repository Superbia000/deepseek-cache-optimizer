console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/2] V13.0 官方 Interceptor 版啟動...");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_ext_settings_ref = window.extension_settings || {};

// 相容性獲取設定檔
if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
    ST_ext_settings_ref = SillyTavern.getContext().extension_settings || ST_ext_settings_ref;
}
if (!ST_ext_settings_ref[EXTENSION_NAME]) {
    ST_ext_settings_ref[EXTENSION_NAME] = { ...defaultSettings };
}
settings = Object.assign({}, defaultSettings, ST_ext_settings_ref[EXTENSION_NAME]);

let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,
    anchorKey: null
};

function safeSaveSettings() {
    ST_ext_settings_ref[EXTENSION_NAME] = settings;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext && typeof SillyTavern.getContext().saveSettingsDebounced === 'function') {
        SillyTavern.getContext().saveSettingsDebounced();
    }
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
// 介面注入
// ==========================================
function injectUI() {
    if ($('#ds_cache_ui_box').length > 0) return;
    if ($('#extensions_settings').length === 0) {
        setTimeout(injectUI, 1000);
        return;
    }

    console.log("[DS-Cache-Opt] ⏳ [2/2] 注入介面...");
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 官方快取攔截器 V13</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用官方 Prompt Interceptor</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                </div>
                <div style="margin-top: 10px;">
                    <button id="ds_reset_btn" class="menu_button">強制重置快取基準</button>
                </div>
            </div>
        </div>
    </div>
    `;

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
$(document).ready(injectUI);

// ==========================================
// 核心：ST 官方文檔標準 Interceptor
// ==========================================
// 根據官方文檔，SillyTavern 會尋找 manifest.json 中的 generate_interceptor 指定的全域函數
globalThis.dsCacheInterceptor = async function(chat) {
    // 官方保證：chat 是一個即將被送出的 mutable array (可變陣列)
    if (!settings.enabled || !Array.isArray(chat) || chat.length < 3) return;

    const originalLen = chat.length;
    console.log(`\n--- [DS-Cache-Opt] 🧠 觸發官方 Interceptor 重組 (原長度: ${originalLen}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestMsg = chat[chat.length - 1]; 

    let foundFirstUser = false;
    for (let i = 0; i < chat.length - 1; i++) {
        let msg = chat[i];
        if (msg.role !== 'system') foundFirstUser = true;

        if (!foundFirstUser && msg.role === 'system') {
            sysTop.push(msg); // 頂層靜態提示詞
        } else if (msg.role === 'system') {
            sysBottom.push(msg); // 世界書等動態注入
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
        console.log(`[DS-Cache-Opt] 📦 合併 ${sysBottom.length} 條動態設定並強行置底。`);
    }
    optimized.push(latestMsg);
    
    // 官方指定修改陣列的標準做法 (in-place modification)
    chat.splice(0, chat.length, ...optimized);
    
    console.log(`[DS-Cache-Opt] ✅ 官方 Interceptor 執行完畢！(輸出長度: ${chat.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);

    // 視覺提示：如果長度發生了壓縮，在畫面上彈出綠色提示
    if (originalLen !== chat.length && typeof toastr !== 'undefined') {
        toastr.success(`快取引擎已成功將 ${originalLen} 條對話重組為 ${chat.length} 條！`, 'DeepSeek Cache Optimized');
    }
};
