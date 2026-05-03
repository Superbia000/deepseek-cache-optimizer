console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/7] 外掛腳本已成功被 SillyTavern 讀取並開始執行！");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_extension_settings = null;

let cacheState = {
    chatId: null,
    anchorContent: null
};

// ==========================================
// 1. 絕對安全初始化模組 (含自動修復機制)
// ==========================================
async function init() {
    console.log("[DS-Cache-Opt] ⏳ [2/7] 嘗試載入設定...");
    
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        let context = SillyTavern.getContext();
        if (context && context.extension_settings) ST_extension_settings = context.extension_settings;
    }
    if (!ST_extension_settings && typeof window.extension_settings !== 'undefined') {
        ST_extension_settings = window.extension_settings;
    }
    if (!ST_extension_settings) {
        ST_extension_settings = {}; 
    }
    if (!ST_extension_settings[EXTENSION_NAME]) {
        ST_extension_settings[EXTENSION_NAME] = {};
    }
    
    // 讀取設定
    settings = Object.assign({}, defaultSettings, ST_extension_settings[EXTENSION_NAME]);
    
    // 🔧 強制修復損壞的設定 (除非明確被設為 false，否則一律強制作為 true)
    if (settings.enabled !== false) settings.enabled = true;
    settings.chunkSize = parseInt(settings.chunkSize) || 10;
    
    console.log("[DS-Cache-Opt] ⚙️ [4/7] 當前設定檔:", settings);

    injectUI();
    setupFetchHijack();
}

function safeSaveSettings() {
    if (ST_extension_settings) ST_extension_settings[EXTENSION_NAME] = settings;
    
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        let context = SillyTavern.getContext();
        if (typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
            return;
        }
    }
    if (typeof window.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
    }
}

// ==========================================
// 2. UI 注入
// ==========================================
function injectUI() {
    console.log("[DS-Cache-Opt] ⏳ [5/7] 準備注入 UI...");
    const uiHTML = `
    <div id="ds_cache_ui_box" style="padding:15px; background:rgba(20,20,20,0.8); border:2px solid #00ff88; border-radius:8px; margin-bottom:10px;">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="color:#00ff88;">
                <b>🟢 DeepSeek 快取引擎 V4.2</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <!-- 確保 Checkbox 狀態與變數一致 -->
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用 DeepSeek 底層劫持快取引擎</span>
                </label>
                <hr style="border-color:rgba(255,255,255,0.1); margin:10px 0;">
                <div>
                    <label>超前丟棄訊息數 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                </div>
            </div>
        </div>
    </div>
    `;

    if ($('#extensions_settings').length > 0) {
        if ($('#ds_cache_ui_box').length === 0) {
            $('#extensions_settings').append(uiHTML);
            console.log("[DS-Cache-Opt] 🖥️ [6/7] UI 注入成功！");
            
            $('#ds_cache_enable').on('change', function() {
                settings.enabled = !!$(this).prop('checked');
                safeSaveSettings();
                console.log("[DS-Cache-Opt] 🔘 狀態切換: 啟用 =", settings.enabled);
            });
            $('#ds_chunk_size').on('input', function() {
                settings.chunkSize = parseInt($(this).val()) || 10;
                safeSaveSettings();
            });
        }
    } else {
        setTimeout(injectUI, 1000);
    }
}

// ==========================================
// 3. 核心重組邏輯
// ==========================================
function optimizeMessages(messages) {
    console.log(`\n--- [DS-Cache-Opt] 🧠 開始進行陣列重組 ---`);
    console.log(`[DS-Cache-Opt] 原始陣列長度: ${messages.length}, 當前啟用狀態: ${settings.enabled}`);

    // 加入更詳細的跳過原因
    if (!settings.enabled || messages.length < 3) {
        console.log(`[DS-Cache-Opt] ⏭️ 跳過處理。原因: (啟用狀態=${settings.enabled}, 陣列長度=${messages.length})`);
        return messages;
    }

    let staticTop = [];
    let history = [];
    let volatile = [];
    let latestUser = messages[messages.length - 1];

    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (i === 0 && msg.role === 'system') {
            staticTop.push(msg);
        } else if (msg.role === 'system') {
            volatile.push(msg);
            console.log(`[DS-Cache-Opt] 🔍 抽出動態/世界書 System，深度 index: ${i}`);
        } else {
            history.push(msg);
        }
    }

    if (history.length > 0) {
        let anchorIndex = -1;
        if (cacheState.anchorContent) {
            anchorIndex = history.findIndex(m => m.content === cacheState.anchorContent);
        }

        if (anchorIndex !== -1) {
            history = history.slice(anchorIndex);
            console.log(`[DS-Cache-Opt] 🎯 快取錨點命中！(歷史 index: ${anchorIndex})，前綴完美靜止。`);
        } else {
            let chunk = settings.chunkSize || 10;
            if (history.length > chunk + 2) {
                history = history.slice(chunk);
                cacheState.anchorContent = history[0].content;
                console.log(`[DS-Cache-Opt] 🚧 錨點丟失，超前剔除 ${chunk} 條舊訊息建立新護城河。`);
            } else {
                cacheState.anchorContent = history[0].content;
                console.log(`[DS-Cache-Opt] 🆕 建立初始快取錨點。`);
            }
        }
    }

    let optimized = [...staticTop, ...history];
    if (volatile.length > 0) {
        let combined = volatile.map(m => m.content).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 合併 ${volatile.length} 條動態設定，已強行置底。`);
    }
    optimized.push(latestUser);

    console.log(`[DS-Cache-Opt] ✅ 重組完成！送出陣列長度: ${optimized.length}`);
    console.log(`--- [DS-Cache-Opt] 重組結束 ---\n`);
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
                console.log(`\n[DS-Cache-Opt] 🌐 攔截到 LLM 請求發出: ${url}`);
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
                        console.log("[DS-Cache-Opt] 📤 Payload 已覆寫並準備送出。");
                    }
                } catch (e) {
                    console.error("[DS-Cache-Opt] ❌ 底層攔截處理失敗:", e);
                }
            }
        }
        return originalFetch.apply(this, args);
    };
    console.log("[DS-Cache-Opt] 🎉 初始化流程全部完成！");
}

setTimeout(init, 500);
