/**
 * 主题切换功能
 * 支持亮色/深色模式
 */

// 获取当前主题
function getCurrentTheme() {
    // 优先从 localStorage 读取；未手动选择时默认亮色，避免系统深色偏好影响浅色界面
    const savedTheme = localStorage.getItem('theme');
    return savedTheme || 'light';
}

// 应用主题
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // 更新图标
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.classList.add('theme-switching');
        setTimeout(() => {
            themeToggle.classList.remove('theme-switching');
        }, 600);
    }

    console.log(`[Theme] Applied theme: ${theme}`);
}

// 切换主题
function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
}

// 初始化主题
function initTheme() {
    const theme = getCurrentTheme();
    applyTheme(theme);

    // 监听主题切换按钮
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    console.log('[Theme] Theme system initialized');
}

// 导出函数
export { initTheme, toggleTheme, getCurrentTheme };

// 挂载到 window
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
window.getCurrentTheme = getCurrentTheme;
