import { getContext, extension_settings, saveSettingsAs, eventSource } from "../../../../script.js";

const EXTENSION_NAME = "deepseek-cache-optimizer";

const defaultSettings = {
    enabled: true,
    chunkSize: 10
};

let settings = {};

// 核心狀態：用來追蹤歷史記錄的「靜態起點」
let cacheState = {
    anchorContent: null,
    chatId: null // 用於偵測是否切換了對話
};

async function loadSettings() {
    extension_settings[EXTENSION_NAME] = extension_settings[EXTENSION_NAME] || {};
    settings = Object.assign({}, defaultSettings, extension_settings[EXTENSION_NAME]);
    
    $('#ds_cache_enable').prop('checked', settings.enabled).on('change', function() {
        settings.enabled = !!$(this).prop('checked');
        saveSettings();
    });
    $('#ds_chunk_size').val(settings.chunkSize).on('input', function() {
        settings.chunkSize = parseInt($(this).val()) || 10;
        saveSettings();
    });
}

function saveSettings() {
    extension_settings[EXTENSION_NAME] = settings;
    saveSettingsAs();
}

/**
 * 終極攔截器：在所有擴充功能、世界書、預設組裝完畢，發送給 API 之前執行
 */
function optimizeContextCache(payload) {
    if (!settings.enabled || !payload || !Array.isArray(payload.messages)) return;
    if (payload.messages.length === 0) return;

    let messages = payload.messages;
    
    // 陣列分類容器
    let staticTopMessages = [];    // 絕對靜態的最頂部系統提示 (索引 0)
    let historyMessages = [];      // 用戶與 AI 的對話歷史
    let volatileSystemMessages = []; // 所有世界書、擴充插入的 System
    let latestUserMessage = null;  // 當前用戶輸入

    // 1. 強制分離與分類 (解決深度、預設、世界書問題)
    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        
        // 抓取最後一條 User 訊息
        if (i === messages.length - 1 && msg.role === 'user') {
            latestUserMessage = msg;
            continue;
        }

        // 第一條永遠是 ST 的主 Persona/Scenario 設定，絕對靜態
        if (i === 0 && msg.role === 'system') {
            staticTopMessages.push(msg);
            continue;
        }

        // 其餘所有的 'system' 角色訊息，無論深度在哪，皆視為世界書或動態注入
        if (msg.role === 'system') {
            volatileSystemMessages.push(msg);
        } else {
            // 'user' 和 'assistant' 視為連續的對話歷史
            historyMessages.push(msg);
        }
    }

    // 2. 狀態錨點切割 (Stateful Anchor Slicing) - 解決滾動視窗 100% 破壞快取問題
    const currentChatId = getContext().chatId;
    if (cacheState.chatId !== currentChatId) {
        // 切換聊天室，重置錨點
        cacheState.chatId = currentChatId;
        cacheState.anchorContent = null;
        console.log(`[DeepSeek Optimizer] 偵測到對話切換，已重置快取錨點。`);
    }

    if (historyMessages.length > 0) {
        let anchorIndex = -1;
        
        // 嘗試在當前的歷史記錄中尋找我們上次記錄的「靜態起點」
        if (cacheState.anchorContent) {
            anchorIndex = historyMessages.findIndex(m => m.content === cacheState.anchorContent);
        }

        if (anchorIndex !== -1) {
            // 【快取命中路徑】錨點還在！
            // 只要從錨點開始切割，前綴就與上一回合 100% 相同，無論 ST 塞了多少新訊息在尾巴
            historyMessages = historyMessages.slice(anchorIndex);
            // console.log(`[DeepSeek Optimizer] 錨點尋獲於 index ${anchorIndex}。前綴完美靜止。`);
        } else {
            // 【快取重建路徑】錨點丟失！
            // 原因：對話剛開始，或是上下文爆滿導致 ST 把我們的錨點刪掉了。
            // 解決方案：一次性超前丟棄 N 條訊息 (chunkSize)，建立新的護城河。
            if (historyMessages.length > settings.chunkSize + 2) {
                historyMessages = historyMessages.slice(settings.chunkSize);
                cacheState.anchorContent = historyMessages[0].content;
                console.log(`[DeepSeek Optimizer] 錨點丟失 (上下文推進)。已超前丟棄 ${settings.chunkSize} 條訊息以建立新靜態區塊。`);
            } else {
                // 歷史太短，不需要丟棄，直接把最頂部當作新錨點
                cacheState.anchorContent = historyMessages[0].content;
                console.log(`[DeepSeek Optimizer] 歷史過短。將首條歷史設為新錨點。`);
            }
        }
    }

    // 3. 完美重組陣列
    let optimizedMessages = [];
    
    // [區塊 A：絕對不變的前綴] -> 觸發 99% 快取
    optimizedMessages.push(...staticTopMessages);
    optimizedMessages.push(...historyMessages);
    
    // [區塊 B：動態後綴] -> 不計入快取，全額計費，但佔比極小
    if (volatileSystemMessages.length > 0) {
        // 將零散的世界書、作者備註合併成一條 System 訊息，節省 Token 並減少干擾
        let combinedVolatileContent = volatileSystemMessages.map(m => m.content).join("\n\n---\n\n");
        optimizedMessages.push({ role: 'system', content: combinedVolatileContent });
    }
    
    if (latestUserMessage) {
        optimizedMessages.push(latestUserMessage);
    }

    // 覆寫回請求
    payload.messages = optimizedMessages;
}

jQuery(async () => {
    const html = await $.get(`${getContext().extensionFolderPath}/${EXTENSION_NAME}/index.html`);
    $('#extensions_settings').append(html);
    await loadSettings();

    eventSource.on('before_api_request', (args) => {
        if (args && args.request && args.request.messages) {
            optimizeContextCache(args.request);
        }
    });
});
