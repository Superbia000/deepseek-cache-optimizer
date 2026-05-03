console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/7] V5.0 終極快取架構啟動中...");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_extension_settings = null;

// V5.0 核心狀態機：具備動態範例辨識與複合錨點技術
let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,      // 記錄「範例對話」的長度，避免切塊時誤刪
    anchorKey: null       // 複合防呆金鑰
};

// ==========================================
// 1. 絕對安全初始化模組
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
    
    console.log("[DS-Cache-Opt] ⚙️ [4/7] 當前設定:", settings);
    injectUI();
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

// 產生複合錨點金鑰 (防重複訊息誤判)
function getAnchorKey(chatArray, index) {
    if (index >= chatArray.length) return null;
    let key = `${chatArray[index].role}::${chatArray[index].content.substring(0, 50)}`; // 取前50字做特徵
    if (index + 1 < chatArray.length) {
        key += `||${chatArray[index+1].role}::${chatArray[index+1].content.substring(0, 50)}`;
    }
    return key;
}

// ==========================================
// 2. ST 原生 UI 注入 (移除所有特殊效果)
// ==========================================
function injectUI() {
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 快取架構 V5.0</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用 V5.0 複合狀態錨點引擎</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                    <br><small style="color:var(--SmartThemeBodyColor);">當對話達長度上限 ST 刪除舊訊息時，一次超前丟棄 N 條以保證前綴靜止。</small>
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
                console.log("[DS-Cache-Opt] 🔄 使用者手動重置了狀態錨點！");
                alert("DeepSeek 快取狀態已重置。");
            });
        }
    } else {
        setTimeout(injectUI, 1000);
    }
}

// ==========================================
// 3. V5.0 核心重組邏輯 (Zero-Flaw Algorithm)
// ==========================================
function optimizeMessages(messages) {
    if (!settings.enabled || messages.length < 3) return messages;
    console.log(`\n--- [DS-Cache-Opt] 🧠 開始進行 V5 陣列重組 (原長度: ${messages.length}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestUser = messages[messages.length - 1];

    // 1. 分類訊息，將中間的動態設定 (世界書) 拉出
    let foundFirstUser = false;
    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (msg.role !== 'system') foundFirstUser = true;

        if (!foundFirstUser && msg.role === 'system') {
            sysTop.push(msg); // 絕對靜止的 Main Prompt
        } else if (msg.role === 'system') {
            sysBottom.push(msg); // 世界書、動態注入、Author Note
        } else {
            historyAll.push(msg); // 包含範例對話與真實歷史
        }
    }

    // 2. 對話切換偵測
    let currentChatId = sysTop.length > 0 ? getAnchorKey(sysTop, 0) : 'default';
    if (!cacheState.isInitialized || cacheState.chatId !== currentChatId) {
        console.log(`[DS-Cache-Opt] 🆕 初始化快取基準...`);
        cacheState.chatId = currentChatId;
        // 假設前 N 條訊息如果在多次生成中不變，即為 Example Message。
        // 但這裡我們用簡化但 100% 安全的做法：只要第一次載入，我們將當前歷史長度直接備份
        cacheState.isInitialized = true;
        
        // 尋找真實對話起點：第一條 User 發送的訊息
        let firstRealUserIndex = historyAll.findIndex(m => m.role === 'user');
        cacheState.exampleCount = firstRealUserIndex > 0 ? firstRealUserIndex : 0;
        
        // 建立初始錨點 (跳過範例對話)
        let anchorIdx = cacheState.exampleCount;
        cacheState.anchorKey = getAnchorKey(historyAll, anchorIdx);
        console.log(`[DS-Cache-Opt] 基準建立完成！保護了 ${cacheState.exampleCount} 條範例對話。`);
    }

    // 3. 雙重雜湊錨點尋找邏輯
    if (historyAll.length > cacheState.exampleCount) {
        let examples = historyAll.slice(0, cacheState.exampleCount);
        let realHistory = historyAll.slice(cacheState.exampleCount);
        
        let anchorIndex = -1;
        if (cacheState.anchorKey) {
            // 在真實歷史中尋找複合錨點
            for (let i = 0; i < realHistory.length; i++) {
                if (getAnchorKey(realHistory, i) === cacheState.anchorKey) {
                    anchorIndex = i; break;
                }
            }
        }

        if (anchorIndex !== -1) {
            // 【命中路徑】從錨點開始保留，確保前綴一模一樣
            realHistory = realHistory.slice(anchorIndex);
            console.log(`[DS-Cache-Opt] 🎯 複合錨點尋獲！前綴完美鎖定。`);
        } else {
            // 【丟失路徑】ST 刪了舊對話，或使用者手動刪了對話。
            let chunk = settings.chunkSize || 10;
            if (realHistory.length > chunk + 2) {
                realHistory = realHistory.slice(chunk); // 超前丟棄
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
                console.log(`[DS-Cache-Opt] 🚧 錨點丟失，已超前剔除 ${chunk} 條歷史重建護城河。`);
            } else {
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
                console.log(`[DS-Cache-Opt] ⚠️ 歷史太短或遭手動刪除，重置起點。`);
            }
        }

        // 把範例對話拼回去，保證角色性格不走樣
        historyAll = [...examples, ...realHistory];
    }

    // 4. 重組並置底
    let optimized = [...sysTop, ...historyAll];
    if (sysBottom.length > 0) {
        let combined = sysBottom.map(m => m.content).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 發現 ${sysBottom.length} 條動態設定 (世界書/備註)，已強制安全置底。`);
    }
    optimized.push(latestUser);

    console.log(`[DS-Cache-Opt] ✅ 陣列重組完成！(最終長度: ${optimized.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
    return optimized;
}

// ==========================================
// 4. 底層網路劫持
// ==========================================
function setupFetchHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [7/7] 注入 Fetch 底層攔截器...");
    const originalFetch = window.fetch;
    
    window.fetch = async function (...args) {
        const url = args[0] || "";
        const options = args[1] || {};

        if (options.method === 'POST' && typeof options.body === 'string') {
            if (url.includes('/generate') || url.includes('/chat/completions') || url.includes('api.')) {
                try {
                    let parsedBody = JSON.parse(options.body);
                    let targetMessages = null;
                    let isWrapped = false;
                    
                    if (parsedBody.messages && Array.isArray(parsedBody.messages)) {
                        targetMessages = parsedBody.messages;
                    } else if (parsedBody.body && parsedBody.body.messages && Array.isArray(parsedBody.body.messages)) {
                        targetMessages = parsedBody.body.messages;
                        isWrapped = true;
                    }

                    if (targetMessages) {
                        const optimizedMessages = optimizeMessages(targetMessages);
                        if (isWrapped) {
                            parsedBody.body.messages = optimizedMessages;
                        } else {
                            parsedBody.messages = optimizedMessages;
                        }
                        options.body = JSON.stringify(parsedBody);
                    }
                } catch (e) {
                    console.error("[DS-Cache-Opt] ❌ 底層攔截處理失敗:", e);
                }
            }
        }
        return originalFetch.apply(this, args);
    };
    console.log("[DS-Cache-Opt] 🎉 初始化流程全部完成！快取引擎正在運作中。");
}

setTimeout(init, 500);
