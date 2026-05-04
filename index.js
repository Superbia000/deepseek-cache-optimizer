/**
 * Deepseek Cache Optimizer v7.0.0
 * 採用絕對路徑 Import，無視資料夾層級，徹底解決載入崩潰 [object Event] 問題。
 */

import { getContext } from '/scripts/extensions.js';

let isEnabled = true;
let isFreezeEnabled = true;
let chunkSize = 10;
let frozenSystemContent = null;
let lastChatId = null;

// 供玩家檢視的最終封包
window.DS_LastSentPayload = null;

function logDebug(message) {
    console.log(`[DS_Optimizer] ${message}`);
    const logArea = document.getElementById('ds_opt_logs');
    if (logArea) {
        const time = new Date().toLocaleTimeString();
        logArea.value += `[${time}] ${message}\n`;
        logArea.scrollTop = logArea.scrollHeight;
    }
}

function optimizePayload(messages) {
    if (!messages || messages.length === 0) return messages;

    const context = getContext();
    
    if (context) {
        const currentChatId = context.chatId;
        if (lastChatId !== currentChatId) {
            logDebug(`[狀態] 偵測到聊天切換，重置凍結快取。`);
            lastChatId = currentChatId;
            frozenSystemContent = null;
        }
    }

    let sysMessages = [];
    let historyMessages = [];
    let tailMessages = [];

    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        if (i === 0 && msg.role === 'system') {
            sysMessages.push(msg); 
        } else if (msg.role === 'system') {
            tailMessages.push(msg); 
        } else {
            historyMessages.push(msg); 
        }
    }

    if (isFreezeEnabled && sysMessages.length > 0) {
        let mainSys = sysMessages[0];
        let contentStr = typeof mainSys.content === 'string' ? mainSys.content : JSON.stringify(mainSys.content);
        
        if (!frozenSystemContent) {
            frozenSystemContent = contentStr;
            logDebug("[緩存建構] 建立初代凍結系統提示。");
        } else {
            let diff = Math.abs(contentStr.length - frozenSystemContent.length);
            if (diff > 0 && diff <= 50) {
                mainSys.content = typeof mainSys.content === 'string' ? frozenSystemContent : JSON.parse(frozenSystemContent);
                logDebug(`[緩存守護] 防禦時間巨集，強制還原防護 (差異 ${diff} 字元)！`);
            } else if (diff > 50) {
                frozenSystemContent = contentStr;
                logDebug(`[緩存重建] 主提示詞顯著修改，更新快取。`);
            }
        }
    }

    let lastMsg = null;
    if (historyMessages.length > 0 && historyMessages[historyMessages.length - 1].role === 'user') {
        lastMsg = historyMessages.pop(); 
    }

    let M = historyMessages.length; 
    if (context && context.chat && M > 0 && chunkSize > 1) {
        let UI_Total = context.chat.length;
        let startIdx = UI_Total - M;
        if (startIdx < 0) startIdx = 0;

        let anchorIdx = Math.ceil(startIdx / chunkSize) * chunkSize;
        let dropCount = anchorIdx - startIdx;
        
        if (dropCount > 0 && dropCount < M) {
            logDebug(`[錨點對齊] 自動剔除最舊 ${dropCount} 條對話，起點已對齊。`);
            historyMessages = historyMessages.slice(dropCount);
        } else if (dropCount === 0 || anchorIdx === startIdx) {
            logDebug(`[錨點對齊] 前綴 100% 命中準備就緒。`);
        }
    }

    if (tailMessages.length > 0) {
        logDebug(`[動態隔離] 成功抽離 ${tailMessages.length} 條世界書/動態設定，強制移至尾部！`);
    }

    let optimized = [...sysMessages, ...historyMessages, ...tailMessages];
    if (lastMsg) {
        optimized.push(lastMsg);
    }
    
    return optimized;
}

const originalFetch = window.fetch;
window.fetch = async function (...args) {
    try {
        const [resource, config] = args;
        
        if (isEnabled && config && typeof config === 'object' && config.body && typeof config.body === 'string') {
            let url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
            let isLLM = url.includes('/chat/completions') || url.includes('/api/') || url.includes('api.deepseek.com') || url.includes('openrouter.ai') || url.includes('/v1/generate');
            
            if (isLLM) {
                let bodyObj = JSON.parse(config.body);
                if (bodyObj.messages && Array.isArray(bodyObj.messages)) {
                    logDebug(`\n>>> [攔截啟動] 捕獲到網路發送封包，進行重組排序...`);
                    
                    let optimizedMessages = optimizePayload(bodyObj.messages);
                    bodyObj.messages = optimizedMessages;
                    config.body = JSON.stringify(bodyObj);
                    
                    window.DS_LastSentPayload = optimizedMessages;
                    logDebug(`<<< [網路放行] 封包重組成功！最終發送: ${optimizedMessages.length} 條`);
                }
            }
        }
    } catch (e) {
        console.error("[DS_Optimizer] 安全忽略內部錯誤:", e);
    }
    
    // 【最高安全層級】強制綁定 window 以防止卡死
    return originalFetch.apply(window, args);
};

jQuery(() => {
    const uiHtml = `
    <style>
        #ds_opt_panel { padding: 10px; border: 1px solid #444; background: #1a1a1a; margin-bottom: 10px; color: #ddd; font-family: sans-serif; border-radius: 5px; }
        #ds_opt_panel h3 { margin: 0 0 10px 0; font-size: 15px; color: #fff; }
        #ds_opt_logs { width: 100%; height: 160px; background: #000; color: #0f0; font-family: monospace; font-size: 12px; padding: 5px; border: 1px solid #333; resize: vertical; margin-top: 10px; }
        .ds-hr { margin: 10px 0; border-color: #333; border-style: solid; border-width: 1px 0 0 0; }
        .ds-btn { background: #333; color: #fff; border: 1px solid #555; padding: 6px 10px; cursor: pointer; font-size: 12px; margin-top: 5px; border-radius: 3px; }
        .ds-btn:hover { background: #444; }
        .ds-btn-highlight { background: #1a4a2a; border-color: #2a7a4a; }
        .ds-btn-highlight:hover { background: #2a6a3a; }
        .ds-text { font-size: 12px; color: #aaa; margin-top: 5px; line-height: 1.4; }
    </style>
    <div id="ds_opt_panel">
        <h3>🧠 Deepseek Cache Optimizer v7.0</h3>
        <label><input type="checkbox" id="ds_opt_enable" checked> 啟用底層網路封包攔截</label><br>
        <label><input type="checkbox" id="ds_opt_freeze" checked> 自動凍結系統提示詞 (防禦時間巨集)</label><br>
        <div style="margin-top: 8px;">
            <label>歷史對齊區塊 (Chunk Size): <input type="number" id="ds_opt_chunk_size" value="10" min="1" max="50" style="width: 50px; background:#222; color:#fff; border:1px solid #555;"></label>
        </div>
        <hr class="ds-hr">
        <button id="ds_opt_apply_settings" class="ds-btn">⚙️ 一鍵優化 ST 世界書設定</button>
        <button id="ds_opt_view_payload" class="ds-btn ds-btn-highlight">🔍 檢視實際發送給 AI 的封包</button>
        <div class="ds-text">
            ⚠️ <b>驗證方式：</b>請無視 ST 原生選單裡的 View Last Prompt。與 AI 對話一次後，點擊上方綠色按鈕，即可親眼見證完美的排序結果！
        </div>
        <hr class="ds-hr">
        <textarea id="ds_opt_logs" readonly></textarea>
    </div>`;

    $('#extensions_settings').append(uiHtml);

    $('#ds_opt_enable').on('change', function() { isEnabled = $(this).is(':checked'); });
    $('#ds_opt_freeze').on('change', function() { 
        isFreezeEnabled = $(this).is(':checked'); 
        if (!isFreezeEnabled) frozenSystemContent = null;
    });
    $('#ds_opt_chunk_size').on('change', function() { chunkSize = parseInt($(this).val(), 10) || 10; });

    $('#ds_opt_apply_settings').on('click', function() {
        const wiAsSystem = document.getElementById('world_info_system');
        if (wiAsSystem && !wiAsSystem.checked) {
            $(wiAsSystem).prop('checked', true).trigger('change');
            logDebug("[設定修正] 世界書已強制勾選「Send as System」。");
        } else {
            logDebug("[設定確認] 世界書設定已是最佳狀態。");
        }
    });

    $('#ds_opt_view_payload').on('click', function() {
        if (!window.DS_LastSentPayload) {
            alert("尚未發送任何對話！請先與 AI 對話一次，攔截器才會產生紀錄。");
            return;
        }
        const payloadStr = JSON.stringify(window.DS_LastSentPayload, null, 2);
        const win = window.open("", "DS_Payload_View", "width=600,height=700,scrollbars=yes");
        win.document.body.innerHTML = `
            <h3 style="font-family: sans-serif; color: #333;">📦 攔截器檢視：Deepseek 實際接收到的封包</h3>
            <p style="font-family: sans-serif; font-size: 13px; color: #555;">請往下拉到底部，你會發現 <b>World Info (世界書)</b> 被完美隔離在倒數第二句！</p>
            <pre style="background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word;">${payloadStr}</pre>
        `;
    });
    
    logDebug("Deepseek Optimizer v7 載入成功！");
});
