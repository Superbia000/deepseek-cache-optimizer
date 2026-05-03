// DeepSeek Cache Optimizer v4.2 (最终稳定版)
(function () {
    // 等待页面完全加载后再尝试获取上下文
    window.addEventListener('load', function () {
        setTimeout(function() {
            if (typeof SillyTavern === 'undefined') {
                console.error('[DCO] 无法加载：SillyTavern 核心未找到。');
                return;
            }

            const context = SillyTavern.getContext();
            if (!context) {
                console.error('[DCO] 无法获取上下文。');
                return;
            }

            const { eventSource, extension_settings, saveSettingsDebounced } = context;

            // 默认配置
            const defaultSettings = {
                enabled: true,
                freezeSystem: true,
                removeTimestamps: true,
                showStats: true,
                threshold: 70,
            };

            if (!extension_settings.deepseekCache) extension_settings.deepseekCache = {};
            for (const [k, v] of Object.entries(defaultSettings)) {
                if (extension_settings.deepseekCache[k] === undefined) {
                    extension_settings.deepseekCache[k] = v;
                }
            }
            const config = extension_settings.deepseekCache;

            let stats = { total: 0, hit: 0, hitTokens: 0, missTokens: 0 };

            // 稳定化函数
            function stripDynamic(content) {
                if (!content) return content;
                return content
                    .replace(/\b(timestamp|_ts|ts_|time_|date|now|当前时间)[\s:=_]*\d+/gi, '{{fixed}}')
                    .replace(/\{\{now\}\}/g, '{{fixed}}')
                    .replace(/\{\{date\}\}/g, '{{fixed}}')
                    .replace(/\{\{random:[^}]+\}\}/g, '{{fixed}}')
                    .replace(/\{\{time\s*\}\}/g, '{{fixed}}');
            }

            function stabilizeMessages(messages) {
                if (!config.enabled) return messages;
                return messages.map(msg => {
                    let content = msg.content;
                    if (config.removeTimestamps) content = stripDynamic(content);
                    if (msg.role === 'system' && config.freezeSystem) content = stripDynamic(content);
                    return { ...msg, content };
                });
            }

            function updateStatsUI() {
                const totalTokens = stats.hitTokens + stats.missTokens;
                const avgRate = totalTokens ? (stats.hitTokens / totalTokens) * 100 : 0;
                const saved = (stats.hitTokens / 1_000_000) * (0.02 - 0.002);
                if (document.getElementById('dco-rate')) {
                    document.getElementById('dco-rate').innerHTML = avgRate.toFixed(1) + '%';
                    document.getElementById('dco-total').innerText = stats.total;
                    document.getElementById('dco-hit').innerText = stats.hit;
                    document.getElementById('dco-saved').innerText = saved.toFixed(6);
                }
            }

            function parseCacheUsage(response) {
                const usage = response?.usage;
                if (!usage) return;
                const hit = usage.prompt_cache_hit_tokens || 0;
                const miss = usage.prompt_cache_miss_tokens || 0;
                stats.total++;
                if (hit > 0) stats.hit++;
                stats.hitTokens += hit;
                stats.missTokens += miss;
                updateStatsUI();
                let rate = (stats.hitTokens / (stats.hitTokens + stats.missTokens)) * 100;
                console.log(`[DCO] 缓存命中率: ${rate.toFixed(1)}%`);
                if (rate < config.threshold && rate > 0 && stats.total % 5 === 0) {
                    if (window.toastr) toastr.warning(`缓存命中率偏低: ${rate.toFixed(0)}% < ${config.threshold}%`, 'DeepSeek缓存');
                }
            }

            // ========== 事件监听 ==========
            if (eventSource) {
                eventSource.on('GENERATION_STARTED', function (data) {
                    if (!config.enabled) return data;
                    if (data && data.messages) {
                        data.messages = stabilizeMessages(data.messages);
                    }
                    return data;
                });

                eventSource.on('MESSAGE_RECEIVED', function (data) {
                    if (data?.response) parseCacheUsage(data.response);
                    else if (data?.apiResponse) parseCacheUsage(data.apiResponse);
                });
                console.log('[DCO] 事件监听器注册成功!');
            } else {
                console.error('[DCO] 无法注册事件: eventSource 不可用');
            }

            // ========== UI 注入 ==========
            const settingsHtml = `
                <div id="dco-root" style="margin: 20px 0; padding: 10px; border-radius: 8px; background: var(--black30p);">
                    <h3>DeepSeek 缓存优化器</h3>
                    <div><label><input type="checkbox" id="dco-enabled"> 启用优化</label></div>
                    <div><label><input type="checkbox" id="dco-freeze"> 冻结 System Prompt</label></div>
                    <div><label><input type="checkbox" id="dco-remove-ts"> 移除时间戳</label></div>
                    <div><label><input type="checkbox" id="dco-stats"> 显示统计</label></div>
                    <div><label>告警阈值: <input type="number" id="dco-threshold" min="0" max="100" step="5"></label></div>
                    <div id="dco-stats-area" style="margin-top: 10px;">
                        <div>平均命中率: <span id="dco-rate">0%</span></div>
                        <div>总请求: <span id="dco-total">0</span> (命中: <span id="dco-hit">0</span>)</div>
                        <div>节省: $<span id="dco-saved">0.00</span></div>
                    </div>
                    <button id="dco-reset">重置</button>
                </div>
            `;
            const container = $('#extensions_settings');
            if (container.length) {
                if (!document.getElementById('dco-root')) container.append(settingsHtml);
                // 绑定UI事件
                const bind = (id, key) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.checked = config[key];
                        el.onchange = () => { config[key] = el.checked; saveSettingsDebounced(); updateStatsUI(); };
                    }
                };
                bind('dco-enabled', 'enabled');
                bind('dco-freeze', 'freezeSystem');
                bind('dco-remove-ts', 'removeTimestamps');
                bind('dco-stats', 'showStats');
                const thresh = document.getElementById('dco-threshold');
                if (thresh) {
                    thresh.value = config.threshold;
                    thresh.onchange = () => { config.threshold = parseInt(thresh.value) || 70; saveSettingsDebounced(); };
                }
                document.getElementById('dco-reset').onclick = () => {
                    for (const [k, v] of Object.entries(defaultSettings)) config[k] = v;
                    stats = { total:0, hit:0, hitTokens:0, missTokens:0 };
                    saveSettingsDebounced();
                    bind('dco-enabled', 'enabled');
                    bind('dco-freeze', 'freezeSystem');
                    bind('dco-remove-ts', 'removeTimestamps');
                    bind('dco-stats', 'showStats');
                    if(thresh) thresh.value = config.threshold;
                    updateStatsUI();
                    if (window.toastr) toastr.info('已重置所有缓存优化设置', 'DeepSeek缓存');
                };
                updateStatsUI();
            } else {
                console.warn('[DCO] 未找到扩展设置容器，UI未注入');
            }
            console.log('[DCO] 扩展初始化完成，等待对话触发事件');
        }, 1000);
    });
})();
