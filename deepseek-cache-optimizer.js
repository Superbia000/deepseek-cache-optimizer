// DeepSeek Cache Optimizer v4.0 - 详细调试版
(function() {
    // ========== 立即输出日志，确认脚本已加载 ==========
    console.log("[DCO] ========== 脚本开始执行 ==========");
    console.log("[DCO] 当前页面 URL:", window.location.href);
    console.log("[DCO] 用户代理:", navigator.userAgent);
    console.log("[DCO] SillyTavern 全局对象存在?", typeof SillyTavern !== 'undefined');
    console.log("[DCO] jQuery 存在?", typeof $ !== 'undefined');
    console.log("[DCO] 当前时间:", new Date().toISOString());

    let retryCount = 0;
    const MAX_RETRIES = 30;      // 最多重试30次
    const RETRY_INTERVAL = 1000; // 每秒重试一次

    // 全局存储统计数据
    let stats = {
        total: 0,
        hit: 0,
        hitTokens: 0,
        missTokens: 0
    };

    // ========== 核心稳定化函数 ==========
    function stripDynamic(content) {
        if (!content) return content;
        return content
            .replace(/\b(timestamp|_ts|ts_|time_|date|now|当前时间)[\s:=_]*\d+/gi, '{{fixed}}')
            .replace(/\{\{now\}\}/g, '{{fixed}}')
            .replace(/\{\{date\}\}/g, '{{fixed}}')
            .replace(/\{\{random:[^}]+\}\}/g, '{{fixed}}')
            .replace(/\{\{time\s*\}\}/g, '{{fixed}}');
    }

    function stabilizeMessages(messages, config) {
        if (!config.enabled) return messages;
        if (!config.freezeSystem && !config.removeTimestamps) return messages;
        return messages.map(msg => {
            let content = msg.content;
            if (config.removeTimestamps) content = stripDynamic(content);
            if (msg.role === 'system' && config.freezeSystem) content = stripDynamic(content);
            return { ...msg, content };
        });
    }

    function parseCacheUsage(response, config) {
        const usage = response?.usage;
        if (!usage) return;
        const hit = usage.prompt_cache_hit_tokens || 0;
        const miss = usage.prompt_cache_miss_tokens || 0;
        const total = hit + miss;
        const rate = total ? (hit / total) * 100 : 0;
        stats.total++;
        if (rate > 0) stats.hit++;
        stats.hitTokens += hit;
        stats.missTokens += miss;
        console.log(`[DCO] 缓存命中率: ${rate.toFixed(1)}% (${hit}/${total})`);
        if (rate < config.threshold && rate > 0 && stats.total % 5 === 0) {
            const msg = `缓存命中率偏低: ${rate.toFixed(0)}% < ${config.threshold}%`;
            if (window.toastr) toastr.warning(msg, 'DeepSeek缓存');
            else console.warn(`[DCO] ${msg}`);
        }
        updateStatsUI();
    }

    // UI 更新
    function updateStatsUI() {
        const rateElem = document.getElementById('dco-rate-value');
        const totalElem = document.getElementById('dco-total');
        const hitElem = document.getElementById('dco-hit');
        const savedElem = document.getElementById('dco-saved');
        if (!rateElem) return;
        const totalTokens = stats.hitTokens + stats.missTokens;
        const avgRate = totalTokens ? (stats.hitTokens / totalTokens) * 100 : 0;
        const saved = (stats.hitTokens / 1_000_000) * (0.02 - 0.002);
        const rateClass = avgRate >= 70 ? 'hit-high' : (avgRate >= 40 ? 'hit-mid' : 'hit-low');
        rateElem.innerHTML = `<span class="${rateClass}">${avgRate.toFixed(1)}%</span>`;
        if (totalElem) totalElem.innerText = stats.total;
        if (hitElem) hitElem.innerText = stats.hit;
        if (savedElem) savedElem.innerText = saved.toFixed(6);
    }

    // 注入 UI 面板
    function injectUI(config, saveSettingsCallback) {
        console.log("[DCO] 尝试注入 UI...");
        const container = $('#extensions_settings');
        if (!container.length) {
            console.warn("[DCO] 未找到 #extensions_settings 容器，可能页面未完全加载");
            return false;
        }
        if (document.getElementById('dco-root')) {
            console.log("[DCO] UI 已存在，跳过注入");
            return true;
        }
        const html = `
            <div id="dco-root" class="dco-settings-section">
                <h3>DeepSeek 缓存优化器 v4.0 (调试版)</h3>
                <div class="dco-setting-row">
                    <label><input type="checkbox" id="dco-enabled" ${config.enabled ? 'checked' : ''}> 启用优化</label>
                </div>
                <div class="dco-setting-row">
                    <label><input type="checkbox" id="dco-freeze" ${config.freezeSystem ? 'checked' : ''}> 冻结 System Prompt</label>
                </div>
                <div class="dco-setting-row">
                    <label><input type="checkbox" id="dco-remove-ts" ${config.removeTimestamps ? 'checked' : ''}> 移除时间戳</label>
                </div>
                <div class="dco-setting-row">
                    <label><input type="checkbox" id="dco-show-stats" ${config.showStats ? 'checked' : ''}> 显示统计面板</label>
                </div>
                <div class="dco-setting-row">
                    <label>告警阈值: <input type="number" id="dco-threshold" min="0" max="100" step="5" value="${config.threshold}"> %</label>
                </div>
                <button id="dco-reset" class="menu_button">重置设置</button>
                <div id="dco-stats-container" style="margin-top:20px;">
                    <div class="dco-stats-grid">
                        <div class="dco-stat-card">平均命中率<br><span id="dco-rate-value" class="dco-stat-value">0%</span></div>
                        <div class="dco-stat-card">总请求<br><span id="dco-total" class="dco-stat-value">0</span></div>
                        <div class="dco-stat-card">命中次数<br><span id="dco-hit" class="dco-stat-value">0</span></div>
                        <div class="dco-stat-card">节省($)<br><span id="dco-saved" class="dco-stat-value">0.00</span></div>
                    </div>
                    <div class="dco-note">命中率 = 缓存命中tokens / 总tokens × 100%</div>
                </div>
            </div>
        `;
        container.append(html);
        console.log("[DCO] UI HTML 已注入");

        // 绑定事件
        const bindCheck = (id, key) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    config[key] = el.checked;
                    saveSettingsCallback();
                    if (key === 'showStats') updateStatsUI();
                    console.log(`[DCO] 设置变更: ${key} = ${el.checked}`);
                });
            }
        };
        bindCheck('dco-enabled', 'enabled');
        bindCheck('dco-freeze', 'freezeSystem');
        bindCheck('dco-remove-ts', 'removeTimestamps');
        bindCheck('dco-show-stats', 'showStats');

        const thresh = document.getElementById('dco-threshold');
        if (thresh) {
            thresh.addEventListener('change', () => {
                let val = parseInt(thresh.value);
                if (isNaN(val)) val = 70;
                config.threshold = Math.min(100, Math.max(0, val));
                saveSettingsCallback();
                console.log(`[DCO] 阈值变更为: ${config.threshold}`);
            });
        }

        const resetBtn = document.getElementById('dco-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                config.enabled = true;
                config.freezeSystem = true;
                config.removeTimestamps = true;
                config.showStats = true;
                config.threshold = 70;
                stats = { total:0, hit:0, hitTokens:0, missTokens:0 };
                saveSettingsCallback();
                // 重新绑定UI显示
                document.getElementById('dco-enabled').checked = true;
                document.getElementById('dco-freeze').checked = true;
                document.getElementById('dco-remove-ts').checked = true;
                document.getElementById('dco-show-stats').checked = true;
                document.getElementById('dco-threshold').value = 70;
                updateStatsUI();
                console.log("[DCO] 已重置所有设置");
                if (window.toastr) toastr.info('重置完成', 'DeepSeek缓存');
            });
        }
        updateStatsUI();
        return true;
    }

    // 主初始化函数
    function init() {
        console.log("[DCO] init() 被调用, retryCount =", retryCount);
        // 检查 SillyTavern 核心是否就绪
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                console.log(`[DCO] SillyTavern 未就绪，${retryCount}/${MAX_RETRIES} 秒后重试...`);
                setTimeout(init, RETRY_INTERVAL);
            } else {
                console.error("[DCO] 超时：SillyTavern 核心未加载，请检查扩展是否正确安装");
            }
            return;
        }

        console.log("[DCO] SillyTavern 核心已就绪，获取 context");
        const context = SillyTavern.getContext();
        const { eventSource, extension_settings, saveSettingsDebounced } = context;

        if (!eventSource) {
            console.error("[DCO] eventSource 不可用，扩展无法工作");
            return;
        }

        // 读取或初始化配置
        if (!extension_settings.deepseekCache) extension_settings.deepseekCache = {};
        const defaultSettings = {
            enabled: true,
            freezeSystem: true,
            removeTimestamps: true,
            showStats: true,
            threshold: 70,
        };
        for (const [k, v] of Object.entries(defaultSettings)) {
            if (extension_settings.deepseekCache[k] === undefined) {
                extension_settings.deepseekCache[k] = v;
            }
        }
        const config = extension_settings.deepseekCache;
        console.log("[DCO] 当前配置:", config);

        // 保存配置的包装函数
        function saveConfig() {
            saveSettingsDebounced();
            console.log("[DCO] 配置已保存");
        }

        // 注入 UI（重试机制）
        let uiInjected = false;
        function tryInjectUI() {
            if (uiInjected) return;
            const success = injectUI(config, saveConfig);
            if (success) {
                uiInjected = true;
                console.log("[DCO] UI 注入成功");
            } else {
                console.log("[DCO] UI 注入失败，1秒后重试");
                setTimeout(tryInjectUI, 1000);
            }
        }
        tryInjectUI();

        // ========== 注册事件钩子（兼容多种事件名） ==========
        function onGenerateBefore(data) {
            console.log("[DCO] 捕获 GENERATION_STARTED 事件");
            if (!config.enabled) return data;
            if (data && data.messages) {
                const originalLen = data.messages.length;
                data.messages = stabilizeMessages(data.messages, config);
                console.log(`[DCO] 已稳定化 ${originalLen} 条消息`);
            }
            return data;
        }

        function onMessageReceived(data) {
            console.log("[DCO] 捕获 MESSAGE_RECEIVED 事件");
            if (data?.response) parseCacheUsage(data.response, config);
            else if (data?.apiResponse) parseCacheUsage(data.apiResponse, config);
        }

        // 尝试注册三种可能的事件名
        const possibleGenEvents = ['GENERATION_STARTED', 'messageSend', 'chatEvent'];
        let registered = false;
        for (const ev of possibleGenEvents) {
            if (eventSource.on) {
                try {
                    eventSource.on(ev, onGenerateBefore);
                    console.log(`[DCO] 已注册事件: ${ev}`);
                    registered = true;
                } catch(e) { console.log(`[DCO] 注册 ${ev} 失败:`, e); }
            }
        }
        if (!registered) console.warn("[DCO] 未能注册任何生成事件！");

        if (eventSource.on) {
            try {
                eventSource.on('MESSAGE_RECEIVED', onMessageReceived);
                console.log("[DCO] 已注册 MESSAGE_RECEIVED");
            } catch(e) { console.warn("[DCO] 注册 MESSAGE_RECEIVED 失败:", e); }
        }

        // 可选：世界书稳定化
        if (eventSource.on) {
            eventSource.on('WORLD_INFO_INJECT', (args) => {
                if (config.enabled && args && Array.isArray(args.entries)) {
                    args.entries = [...args.entries].sort((a,b) => (a.key||'').localeCompare(b.key||''));
                    console.log("[DCO] 世界书条目已排序");
                }
                return args;
            });
        }

        console.log("[DCO] ========== 扩展初始化完成 ==========");
        console.log("[DCO] 提示：发送一条消息后，查看命中率统计面板");
    }

    // 开始初始化流程，延迟1秒确保 DOM 基本加载
    setTimeout(init, 1000);
})();