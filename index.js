/**
 * Deepseek Cache Optimizer v3.0.0
 * 同步修改「ST 記憶體緩存變數」與「網路底層封包」，讓介面顯示與 API 發送完全一致。
 * 完美處理：滑動視窗、世界書觸發、時間巨集、用戶手動刪除/重骰。
 */

let isEnabled = true;
let isFreezeEnabled = true;
let chunkSize = 10;
let frozenSystemContent = null;
let lastChatId = null;

// --- 介面日誌排錯函數 ---
function logDebug(message) {
    console.log(`[DS_Optimizer] ${message}`);
    const logArea = document.getElementById('ds_opt_logs');
    if (logArea) {
        const time = new Date().toLocaleTimeString();
        logArea.value += `[${time}] ${message}\n`;
        logArea.scrollTop = logArea.scrollHeight;
    }
}

// --- 核心優化演算法 (具備冪等性，安全適應所有情境) ---
function optimizePayload(messages) {
    if (!messages || messages.length === 0) return messages;

    const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    
    // 1. 聊天室切換偵測
    if (context) {
        const currentChatId = context.chatId;
        if (lastChatId !== currentChatId) {
            logDebug(`[狀態] 偵測到聊天室切換或初次加載，重置系統提示凍結快取。`);
            lastChatId = currentChatId;
            frozenSystemContent = null;
        }
    }

    let sysMessages = [];
    let historyMessages = [];
    let tailMessages = [];

    // 2. 訊息分離 (隔離世界書等動態破壞源)
    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        if (i === 0 && msg.role === 'system') {
            sysMessages.push(msg); // 頂部主提示詞
        } else if (msg.role === 'system') {
            tailMessages.push(msg); // 中途插入的世界書(World Info)、作者筆記(Author Note)
        } else {
            historyMessages.push(msg); // 歷史對話 (User/Assistant)
        }
    }

    // 3. 系統提示凍結 (防禦 {{time}} 等每分鐘跳動的巨集)
    if (isFreezeEnabled && sysMessages.length > 0) {
        let mainSys = sysMessages[0];
        let contentStr = typeof mainSys.content === 'string' ? mainSys.content : JSON.stringify(mainSys.content);
        
        if (!frozenSystemContent) {
            frozenSystemContent = contentStr;
            logDebug("[緩存建構] 建立初代凍結系統提示，成為 Prefix Cache 的穩固基石。");
        } else {
            let diff = Math.abs(contentStr.length - frozenSystemContent.length);
            if (diff > 0 && diff <= 50) {
                // 差異極小，判定為時間或隨機數跳動，強制覆蓋還原！
                mainSys.content = typeof mainSys.content === 'string' ? frozenSystemContent : JSON.parse(frozenSystemContent);
                logDebug(`[緩存守護] 攔截到主提示詞微小跳動 (差異 ${diff} 字元)。已強制還原為凍結版本！`);
            } else if (diff > 50) {
                // 差異巨大，判定為玩家修改了角色卡設定
                frozenSystemContent = contentStr;
                logDebug(`[緩存重建] 偵測到主提示詞顯著修改 (差異 ${diff} 字元)，已更新凍結快取。`);
            }
        }
    }

    if (tailMessages.length > 0) {
        logDebug(`[動態隔離] 成功抽離 ${tailMessages.length} 條觸發的動態系統設定(世界書)。已強制下移至尾部！`);
    }

    // 4. 抽取最新發話 (保證放在最尾端)
    let lastMsg = null;
    if (historyMessages.length > 0) {
        lastMsg = historyMessages.pop(); 
    }

    // 5. 絕對錨點截斷演算法 (解決用戶手動刪除、重骰、ST預設滑動視窗造成的開頭跳動)
    let M = historyMessages.length; 
    if (context && context.chat && M > 0 && chunkSize > 1) {
        let startIdx = 0;
        
        // 取得準備發送的最舊一條訊息內容，用以在 ST UI 介面中定位絕對索引
        let firstContent = historyMessages[0].content;
        if (Array.isArray(firstContent)) {
            let textBlock = firstContent.find(c => c.type === 'text');
            firstContent = textBlock ? textBlock.text : '';
        }
        
        // 比對 ST 介面真實存在的對話，找出它的絕對位置
        for (let i = 0; i < context.chat.length; i++) {
            if (typeof context.chat[i].mes === 'string' && context.chat[i].mes.trim() === firstContent.trim()) {
                startIdx = i;
                break;
            }
        }
        
        // 如果找不到 (極端防呆)，則使用數學回推
        if (startIdx === 0 && context.chat.length > M) {
            startIdx = context.chat.length - M - 1;
            if (startIdx < 0) startIdx = 0;
        }

        // 對齊 chunkSize (如 10 的倍數)
        let anchorIdx = Math.ceil(startIdx / chunkSize) * chunkSize;
        let dropCount = anchorIdx - startIdx;
        
        if (dropCount > 0 && dropCount < M) {
            logDebug(`[錨點對齊] 當前歷史起點為 ${startIdx}。為對齊區塊 ${chunkSize}，自動剔除最舊的 ${dropCount} 條對話。`);
            historyMessages = historyMessages.slice(dropCount);
        } else if (dropCount === 0 || anchorIdx === startIdx) {
            logDebug(`[錨點對齊] 當前截斷點 ${startIdx} 已完美對齊區塊，歷史前綴 100% 命中準備就緒。`);
        }
    }

    // 6. 重組完美順序：主系統卡 -> 穩定歷史對話 -> 世界書(尾部) -> 用戶最新發言
    let optimized = [...sysMessages, ...historyMessages, ...tailMessages];
    if (lastMsg) {
        optimized.push(lastMsg);
    }
    
    return optimized;
}

// --- 雙重攔截系統 1：記憶體物件同步 (解決 View Last Prompt 顯示不同步問題) ---
const processedObjects = new WeakSet();
const originalStringify = JSON.stringify;

JSON.stringify = function(value, replacer, space) {
    // 檢查是否為 ST 準備發送的 Prompt 陣列
    if (isEnabled && value && typeof value === 'object' && Array.isArray(value.messages)) {
        const isPayload = value.model || (value.messages.length > 0 && value.messages[0].role);
        
        // 利用 WeakSet 防止無限遞迴或重複處理同一物件
        if (isPayload && !processedObjects.has(value)) {
            processedObjects.add(value);
            try {
                const originalLength = value.messages.length;
                // 執行優化
                const optimized = optimizePayload(value.messages);
                
                // 核心關鍵：【就地覆寫】原陣列內容！
                // 這會導致 ST 綁定在 UI 上的緩存變數同步更新，View Last Prompt 完美顯示結果。
                value.messages.length = 0;
                value.messages.push(...optimized);
                
                logDebug(`[記憶體同步] ST 內部緩存變數已同步修改！(原始: ${originalLength} 條 -> 最終: ${value.messages.length} 條)`);
            } catch (e) {
                console.error("DS Optimizer Stringify Error:", e);
                logDebug(`[排錯警告] 處理失敗: ${e.message}`);
            }
        }
    }
    return originalStringify.call(this, value, replacer, space);
};

// --- 雙重攔截系統 2：網路封包最終確認 (保證 AI 絕對收到優化封包) ---
const originalFetch = window.fetch;
window.fetch = async function (...args) {
    const [resource, config] = args;
    if (isEnabled && config && typeof config.body === 'string' && config.body.includes('"messages":')) {
        let url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
        let isLLM = url.includes('/chat/completions') || url.includes('api.deepseek.com') || url.includes('openrouter.ai') || url.includes('/api/textgeneration');
        
        if (isLLM) {
            try {
                let bodyObj = JSON.parse(config.body);
                if (bodyObj.messages && Array.isArray(bodyObj.messages)) {
                    logDebug(`<<< [網路放行] 最終發送至 AI 的封包已確認！共 ${bodyObj.messages.length} 條訊息。\n---`);
                }
            } catch (e) {}
        }
    }
    return originalFetch.apply(this, args);
};

// --- 無特效極簡 UI 介面與一鍵設置 ---
jQuery(() => {
    const uiHtml = `
    <style>
        #ds_opt_panel { padding: 10px; border: 1px solid #444; background: #1a1a1a; margin-bottom: 10px; color: #ddd; font-family: sans-serif; }
        #ds_opt_panel h3 { margin: 0 0 10px 0; font-size: 15px; color: #fff; }
        #ds_opt_logs { width: 100%; height: 160px; background: #000; color: #0f0; font-family: monospace; font-size: 12px; padding: 5px; border: 1px solid #333; resize: vertical; margin-top: 10px; }
        .ds-hr { margin: 10px 0; border-color: #333; border-style: solid; border-width: 1px 0 0 0; }
        .ds-btn { background: #333; color: #fff; border: 1px solid #555; padding: 5px 10px; cursor: pointer; font-size: 12px; margin-top: 5px;}
        .ds-btn:hover { background: #444; }
        .ds-text { font-size: 12px; color: #aaa; margin-top: 5px; line-height: 1.4; }
    </style>
    <div id="ds_opt_panel">
        <h3>🧠 Deepseek Cache Optimizer v3.0</h3>
        <label><input type="checkbox" id="ds_opt_enable" checked> 啟用記憶體與封包雙重攔截</label><br>
        <label><input type="checkbox" id="ds_opt_freeze" checked> 自動凍結系統提示詞 (防禦時間巨集)</label><br>
        <div style="margin-top: 8px;">
            <label>歷史對齊區塊 (Chunk Size): <input type="number" id="ds_opt_chunk_size" value="10" min="1" max="50" style="width: 50px; background:#222; color:#fff; border:1px solid #555;"></label>
        </div>
        <hr class="ds-hr">
        <button id="ds_opt_apply_settings" class="ds-btn">⚙️ 一鍵優化 ST 世界書設定</button>
        <div class="ds-text">
            ✔️ <b>V3 更新：</b>已徹底解決 View Last Prompt 顯示不同步的問題。現在你打開 ST 原生的查看提示詞，會看到與發送給 AI <b>完全一致、已排序、已隔離世界書</b> 的完美狀態！
        </div>
        <hr class="ds-hr">
        <textarea id="ds_opt_logs" readonly></textarea>
    </div>`;

    $('#extensions_settings').append(uiHtml);

    // 事件綁定
    $('#ds_opt_enable').on('change', function() { isEnabled = $(this).is(':checked'); });
    $('#ds_opt_freeze').on('change', function() { 
        isFreezeEnabled = $(this).is(':checked'); 
        if (!isFreezeEnabled) frozenSystemContent = null;
    });
    $('#ds_opt_chunk_size').on('change', function() { chunkSize = parseInt($(this).val(), 10) || 10; });

    // 世界書最佳化按鈕
    $('#ds_opt_apply_settings').on('click', function() {
        // 重要：必須勾選 Send as System，插件才能透過 role === 'system' 將其識別為世界書並移到尾端
        const wiAsSystem = document.getElementById('world_info_system');
        if (wiAsSystem && !wiAsSystem.checked) {
            $(wiAsSystem).prop('checked', true).trigger('change');
            logDebug("[修正] 世界書 (World Info) 已強制勾選「Send as System」。");
        }
        logDebug("ST 設定已最佳化，世界書已被本插件接管排序。");
    });
    
    logDebug("Deepseek Optimizer v3 載入成功，記憶體同步攔截已就緒。");
});
