// 【终极诊断版】DeepSeek Cache Optimizer
// 此版本仅用于检测扩展是否被 ST 核心系统加载
console.log("[DCO] === 脚本开始执行 ===");

(function() {
    // 延迟一秒以等待 ST 核心 API 完全初始化
    setTimeout(function() {
        console.log("[DCO] 开始检测 SillyTavern 核心...");
        
        // 检查 getContext
        let context;
        try {
            if (typeof SillyTavern !== 'undefined') {
                context = SillyTavern.getContext();
                console.log("[DCO] ✓ getContext 获取成功, 可用属性:", Object.keys(context || {}));
            } else {
                console.error("[DCO] ✗ SillyTavern 全局对象未找到！");
                alert("[DCO] 错误：SillyTavern 核心未找到！扩展将无法工作。请确认文件路径正确。");
                return;
            }
        } catch(e) {
            console.error("[DCO] ✗ 获取 context 出错:", e);
            return;
        }

        // 检查事件系统
        let events = [];
        try {
            events = Object.keys(context.eventSource || {});
            console.log("[DCO] ✓ eventSource 可用. 方法:", events);
        } catch(e) {
            console.error("[DCO] ✗ eventSource 不可用:", e);
        }

        // 检查配置注入点
        let settingsPanel = document.querySelector('#extensions_settings');
        if (settingsPanel) {
            console.log("[DCO] ✓ 找到设置面板容器 #extensions_settings");
        } else {
            console.error("[DCO] ✗ 未找到设置面板容器 #extensions_settings！UI将无法注入。");
        }

        // 最终状态确认
        const isReady = context && context.eventSource;
        if (isReady) {
            console.log("[DCO] ✅ 扩展已就绪！可以正常工作。如果仍无UI，请检查'管理扩展'页面中此扩展是否已启用。");
        } else {
            console.log("[DCO] ❌ 扩展未就绪！");
        }

    }, 1000);
})();
