// 用量管理模块

import { showToast } from './utils.js';

// 从 window 全局变量获取 getAuthHeaders
const getAuthHeaders = window.getAuthHeaders;

/**
 * 初始化用量管理功能
 */
export function initUsageManager() {
    const refreshBtn = document.getElementById('refreshUsageBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshUsage);
    }
    
    // 初始化时自动加载缓存数据
    loadUsage();
}

/**
 * 加载用量数据（优先从缓存读取）
 * 只加载 Claude Kiro OAuth 提供商
 */
export async function loadUsage() {
    const loadingEl = document.getElementById('usageLoading');
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
        // 只查询 claude-kiro-oauth，不带 refresh 参数，优先读取缓存
        const response = await fetch('/api/usage/claude-kiro-oauth', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // 隐藏加载状态
        if (loadingEl) loadingEl.style.display = 'none';

        // 过滤有效实例
        const validInstances = (data.instances || []).filter(instance => {
            // 过滤掉服务实例未初始化的
            if (instance.error === '服务实例未初始化') {
                return false;
            }
            // 过滤掉已禁用的提供商
            if (instance.isDisabled) {
                return false;
            }
            return true;
        });

        // 清空容器
        if (contentEl) contentEl.innerHTML = '';

        // 渲染用量数据
        if (validInstances.length > 0) {
            renderProviderTypeUsage('claude-kiro-oauth', validInstances, contentEl);
        } else {
            if (emptyEl) emptyEl.style.display = 'block';
        }

        // 更新最后更新时间
        if (lastUpdateEl) {
            if (data.fromCache && data.timestamp) {
                lastUpdateEl.textContent = `缓存时间: ${new Date(data.timestamp).toLocaleString()}`;
            } else {
                lastUpdateEl.textContent = `上次更新: ${new Date().toLocaleString()}`;
            }
        }
    } catch (error) {
        console.error('获取用量数据失败:', error);

        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || '获取用量数据失败';
            }
        }
    }
}

/**
 * 刷新用量数据（强制从服务器获取最新数据）
 * 只查询 Kiro 提供商，分批查询每批3个账号，实时渲染
 */
export async function refreshUsage() {
    const loadingEl = document.getElementById('usageLoading');
    const errorEl = document.getElementById('usageError');
    const contentEl = document.getElementById('usageContent');
    const emptyEl = document.getElementById('usageEmpty');
    const lastUpdateEl = document.getElementById('usageLastUpdate');
    const refreshBtn = document.getElementById('refreshUsageBtn');

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        // 清空内容容器，准备渲染
        if (contentEl) contentEl.innerHTML = '';

        // 只查询 claude-kiro-oauth 提供商
        const providerType = 'claude-kiro-oauth';
        const BATCH_SIZE = 3; // 每批3个账号

        console.log('[UsageManager] 开始分批查询 Kiro 用量');

        // 第一次查询获取总数
        let batchIndex = 0;
        let totalBatches = 1;
        let totalCount = 0;
        let allInstances = [];

        do {
            if (loadingEl) {
                loadingEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 正在加载用量数据... (批次 ${batchIndex + 1}/${totalBatches || '?'})`;
            }

            try {
                const batchResult = await fetchProviderUsageBatch(providerType, batchIndex, BATCH_SIZE);

                // 更新总批次数
                if (batchIndex === 0) {
                    totalBatches = batchResult.totalBatches;
                    totalCount = batchResult.totalCount;
                    console.log(`[UsageManager] 总共 ${totalCount} 个账号，分 ${totalBatches} 批查询`);
                }

                // 收集实例数据
                allInstances = allInstances.concat(batchResult.instances);

                // 立即渲染当前已获取的所有数据
                if (contentEl) {
                    contentEl.innerHTML = ''; // 清空
                    if (allInstances.length > 0) {
                        renderProviderTypeUsage(providerType, allInstances, contentEl);
                    }
                }

                console.log(`[UsageManager] 批次 ${batchIndex + 1}/${totalBatches} 完成，当前已获取 ${allInstances.length}/${totalCount} 个账号`);

                batchIndex++;
            } catch (batchError) {
                console.error(`[UsageManager] 批次 ${batchIndex + 1} 查询失败:`, batchError);
                showToast(`批次 ${batchIndex + 1} 查询失败: ${batchError.message}`, 'warning');
                break; // 出错则停止查询
            }

        } while (batchIndex < totalBatches);

        // 隐藏加载状态
        if (loadingEl) loadingEl.style.display = 'none';

        // 更新最后更新时间
        if (lastUpdateEl) {
            lastUpdateEl.textContent = `上次更新: ${new Date().toLocaleString()}`;
        }

        if (allInstances.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            showToast('没有可用的 Kiro 配置', 'info');
        } else {
            showToast(`用量数据已刷新，共 ${allInstances.length} 个账号`, 'success');
        }

    } catch (error) {
        console.error('获取用量数据失败:', error);

        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            const errorMsgEl = document.getElementById('usageErrorMessage');
            if (errorMsgEl) {
                errorMsgEl.textContent = error.message || '获取用量数据失败';
            }
        }

        showToast('获取用量数据失败: ' + error.message, 'error');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

/**
 * 查询单个批次的提供商用量
 * @param {string} providerType - 提供商类型
 * @param {number} batchIndex - 批次索引（从0开始）
 * @param {number} batchSize - 每批数量
 * @returns {Promise<Object>} 批次用量数据
 */
async function fetchProviderUsageBatch(providerType, batchIndex, batchSize) {
    const response = await fetch(
        `/api/usage/${encodeURIComponent(providerType)}?refresh=true&force=true&batch=${batchIndex}&batchSize=${batchSize}`,
        {
            method: 'GET',
            headers: getAuthHeaders()
        }
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * 查询单个提供商类型的用量
 * @param {string} providerType - 提供商类型
 * @returns {Promise<Object>} 用量数据
 */
async function fetchProviderUsage(providerType) {
    const response = await fetch(`/api/usage/${encodeURIComponent(providerType)}?refresh=true&force=true`, {
        method: 'GET',
        headers: getAuthHeaders()
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
        providerType,
        instances: data.instances || []
    };
}

/**
 * 渲染单个提供商类型的用量数据
 * @param {string} providerType - 提供商类型
 * @param {Array} instances - 实例数组
 * @param {HTMLElement} container - 容器元素
 */
function renderProviderTypeUsage(providerType, instances, container) {
    if (!container) return;

    // 过滤有效实例
    const validInstances = instances.filter(instance => {
        // 过滤掉服务实例未初始化的
        if (instance.error === '服务实例未初始化') {
            return false;
        }
        // 过滤掉已禁用的提供商
        if (instance.isDisabled) {
            return false;
        }
        return true;
    });

    if (validInstances.length === 0) {
        return; // 没有有效实例，不渲染
    }

    // 创建分组容器并添加到页面
    const groupContainer = createProviderGroup(providerType, validInstances);
    container.appendChild(groupContainer);
}

/**
 * 渲染用量数据
 * @param {Object} data - 用量数据
 * @param {HTMLElement} container - 容器元素
 */
function renderUsageData(data, container) {
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    if (!data || !data.providers || Object.keys(data.providers).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p>暂无用量数据</p>
            </div>
        `;
        return;
    }

    // 按提供商分组收集已初始化且未禁用的实例
    const groupedInstances = {};
    
    for (const [providerType, providerData] of Object.entries(data.providers)) {
        if (providerData.instances && providerData.instances.length > 0) {
            const validInstances = [];
            for (const instance of providerData.instances) {
                // 过滤掉服务实例未初始化的
                if (instance.error === '服务实例未初始化') {
                    continue;
                }
                // 过滤掉已禁用的提供商
                if (instance.isDisabled) {
                    continue;
                }
                validInstances.push(instance);
            }
            if (validInstances.length > 0) {
                groupedInstances[providerType] = validInstances;
            }
        }
    }

    if (Object.keys(groupedInstances).length === 0) {
        container.innerHTML = `
            <div class="usage-empty">
                <i class="fas fa-chart-bar"></i>
                <p>暂无已初始化的服务实例</p>
            </div>
        `;
        return;
    }

    // 按提供商分组渲染
    for (const [providerType, instances] of Object.entries(groupedInstances)) {
        const groupContainer = createProviderGroup(providerType, instances);
        container.appendChild(groupContainer);
    }
}

/**
 * 创建提供商分组容器
 * @param {string} providerType - 提供商类型
 * @param {Array} instances - 实例数组
 * @returns {HTMLElement} 分组容器元素
 */
function createProviderGroup(providerType, instances) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'usage-provider-group'; // 移除 collapsed 类，默认展开

    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);
    const instanceCount = instances.length;
    const successCount = instances.filter(i => i.success).length;

    // 分组头部（可点击折叠）
    const header = document.createElement('div');
    header.className = 'usage-group-header';
    header.innerHTML = `
        <div class="usage-group-title">
            <i class="fas fa-chevron-down toggle-icon"></i>
            <i class="${providerIcon} provider-icon"></i>
            <span class="provider-name">${providerDisplayName}</span>
            <span class="instance-count">${instanceCount} 个实例</span>
            <span class="success-count ${successCount === instanceCount ? 'all-success' : ''}">${successCount}/${instanceCount} 成功</span>
        </div>
    `;
    
    // 点击头部切换折叠状态
    header.addEventListener('click', () => {
        groupContainer.classList.toggle('collapsed');
    });
    
    groupContainer.appendChild(header);
    
    // 分组内容（卡片网格）
    const content = document.createElement('div');
    content.className = 'usage-group-content';
    
    const gridContainer = document.createElement('div');
    gridContainer.className = 'usage-cards-grid';
    
    for (const instance of instances) {
        const instanceCard = createInstanceUsageCard(instance, providerType);
        gridContainer.appendChild(instanceCard);
    }
    
    content.appendChild(gridContainer);
    groupContainer.appendChild(content);
    
    return groupContainer;
}

/**
 * 创建实例用量卡片
 * @param {Object} instance - 实例数据
 * @param {string} providerType - 提供商类型
 * @returns {HTMLElement} 卡片元素
 */
function createInstanceUsageCard(instance, providerType) {
    const card = document.createElement('div');
    card.className = `usage-instance-card ${instance.success ? 'success' : 'error'}`;

    const providerDisplayName = getProviderDisplayName(providerType);
    const providerIcon = getProviderIcon(providerType);

    // 实例头部 - 整合用户信息
    const header = document.createElement('div');
    header.className = 'usage-instance-header';
    
    const statusIcon = instance.success
        ? '<i class="fas fa-check-circle status-success"></i>'
        : '<i class="fas fa-times-circle status-error"></i>';
    
    const healthBadge = instance.isDisabled
        ? '<span class="badge badge-disabled">已禁用</span>'
        : (instance.isHealthy
            ? '<span class="badge badge-healthy">健康</span>'
            : '<span class="badge badge-unhealthy">异常</span>');

    // 获取用户邮箱和订阅信息
    const userEmail = instance.usage?.user?.email || '';
    const subscriptionTitle = instance.usage?.subscription?.title || '';
    
    // 用户信息行
    const userInfoHTML = userEmail ? `
        <div class="instance-user-info">
            <span class="user-email" title="${userEmail}"><i class="fas fa-envelope"></i> ${userEmail}</span>
            ${subscriptionTitle ? `<span class="user-subscription">${subscriptionTitle}</span>` : ''}
        </div>
    ` : '';

    header.innerHTML = `
        <div class="instance-header-top">
            <div class="instance-provider-type">
                <i class="${providerIcon}"></i>
                <span>${providerDisplayName}</span>
            </div>
            <div class="instance-status-badges">
                ${statusIcon}
                ${healthBadge}
            </div>
        </div>
        <div class="instance-name">
            <span class="instance-name-text" title="${instance.name || instance.uuid}">${instance.name || instance.uuid}</span>
        </div>
        ${userInfoHTML}
    `;
    card.appendChild(header);

    // 实例内容 - 只显示用量和到期时间
    const content = document.createElement('div');
    content.className = 'usage-instance-content';

    if (instance.error) {
        content.innerHTML = `
            <div class="usage-error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${instance.error}</span>
            </div>
        `;
    } else if (instance.usage) {
        content.appendChild(renderUsageDetails(instance.usage));
    }

    card.appendChild(content);
    return card;
}

/**
 * 渲染用量详情 - 显示总用量、用量明细和到期时间
 * @param {Object} usage - 用量数据
 * @returns {HTMLElement} 详情元素
 */
function renderUsageDetails(usage) {
    const container = document.createElement('div');
    container.className = 'usage-details';

    // 计算总用量
    const totalUsage = calculateTotalUsage(usage.usageBreakdown);
    
    // 总用量进度条
    if (totalUsage.hasData) {
        const totalSection = document.createElement('div');
        totalSection.className = 'usage-section total-usage';
        
        const progressClass = totalUsage.percent >= 90 ? 'danger' : (totalUsage.percent >= 70 ? 'warning' : 'normal');
        
        totalSection.innerHTML = `
            <div class="total-usage-header">
                <span class="total-label"><i class="fas fa-chart-pie"></i> 总用量</span>
                <span class="total-value">${formatNumber(totalUsage.used)} / ${formatNumber(totalUsage.limit)}</span>
            </div>
            <div class="progress-bar ${progressClass}">
                <div class="progress-fill" style="width: ${totalUsage.percent}%"></div>
            </div>
            <div class="total-percent">${totalUsage.percent.toFixed(2)}%</div>
        `;
        container.appendChild(totalSection);
    }

    // 用量明细（包含免费试用和奖励信息）
    if (usage.usageBreakdown && usage.usageBreakdown.length > 0) {
        const breakdownSection = document.createElement('div');
        breakdownSection.className = 'usage-section usage-breakdown-compact';
        
        let breakdownHTML = '';
        
        for (const breakdown of usage.usageBreakdown) {
            breakdownHTML += createUsageBreakdownHTML(breakdown);
        }
        
        breakdownSection.innerHTML = breakdownHTML;
        container.appendChild(breakdownSection);
    }

    return container;
}

/**
 * 创建用量明细 HTML（紧凑版）
 * @param {Object} breakdown - 用量明细数据
 * @returns {string} HTML 字符串
 */
function createUsageBreakdownHTML(breakdown) {
    const usagePercent = breakdown.usageLimit > 0
        ? Math.min(100, (breakdown.currentUsage / breakdown.usageLimit) * 100)
        : 0;
    
    const progressClass = usagePercent >= 90 ? 'danger' : (usagePercent >= 70 ? 'warning' : 'normal');

    let html = `
        <div class="breakdown-item-compact">
            <div class="breakdown-header-compact">
                <span class="breakdown-name">${breakdown.displayName || breakdown.resourceType}</span>
                <span class="breakdown-usage">${formatNumber(breakdown.currentUsage)} / ${formatNumber(breakdown.usageLimit)}</span>
            </div>
            <div class="progress-bar-small ${progressClass}">
                <div class="progress-fill" style="width: ${usagePercent}%"></div>
            </div>
    `;

    // 免费试用信息
    if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
        html += `
            <div class="extra-usage-info free-trial">
                <span class="extra-label"><i class="fas fa-gift"></i> 免费试用</span>
                <span class="extra-value">${formatNumber(breakdown.freeTrial.currentUsage)} / ${formatNumber(breakdown.freeTrial.usageLimit)}</span>
                <span class="extra-expires">到期: ${formatDate(breakdown.freeTrial.expiresAt)}</span>
            </div>
        `;
    }

    // 奖励信息
    if (breakdown.bonuses && breakdown.bonuses.length > 0) {
        for (const bonus of breakdown.bonuses) {
            if (bonus.status === 'ACTIVE') {
                html += `
                    <div class="extra-usage-info bonus">
                        <span class="extra-label"><i class="fas fa-star"></i> ${bonus.displayName || bonus.code}</span>
                        <span class="extra-value">${formatNumber(bonus.currentUsage)} / ${formatNumber(bonus.usageLimit)}</span>
                        <span class="extra-expires">到期: ${formatDate(bonus.expiresAt)}</span>
                    </div>
                `;
            }
        }
    }

    html += '</div>';
    return html;
}

/**
 * 计算总用量（包含基础用量、免费试用和奖励）
 * @param {Array} usageBreakdown - 用量明细数组
 * @returns {Object} 总用量信息
 */
function calculateTotalUsage(usageBreakdown) {
    if (!usageBreakdown || usageBreakdown.length === 0) {
        return { hasData: false, used: 0, limit: 0, percent: 0 };
    }

    let totalUsed = 0;
    let totalLimit = 0;

    for (const breakdown of usageBreakdown) {
        // 基础用量
        totalUsed += breakdown.currentUsage || 0;
        totalLimit += breakdown.usageLimit || 0;
        
        // 免费试用用量
        if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
            totalUsed += breakdown.freeTrial.currentUsage || 0;
            totalLimit += breakdown.freeTrial.usageLimit || 0;
        }
        
        // 奖励用量
        if (breakdown.bonuses && breakdown.bonuses.length > 0) {
            for (const bonus of breakdown.bonuses) {
                if (bonus.status === 'ACTIVE') {
                    totalUsed += bonus.currentUsage || 0;
                    totalLimit += bonus.usageLimit || 0;
                }
            }
        }
    }

    const percent = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;

    return {
        hasData: true,
        used: totalUsed,
        limit: totalLimit,
        percent: percent
    };
}

/**
 * 获取提供商显示名称
 * @param {string} providerType - 提供商类型
 * @returns {string} 显示名称
 */
function getProviderDisplayName(providerType) {
    const names = {
        'claude-kiro-oauth': 'Claude Kiro OAuth',
        'gemini-cli-oauth': 'Gemini CLI OAuth',
        'gemini-antigravity': 'Gemini Antigravity',
        'openai-qwen-oauth': 'Qwen OAuth'
    };
    return names[providerType] || providerType;
}

/**
 * 获取提供商图标
 * @param {string} providerType - 提供商类型
 * @returns {string} 图标类名
 */
function getProviderIcon(providerType) {
    const icons = {
        'claude-kiro-oauth': 'fas fa-robot',
        'gemini-cli-oauth': 'fas fa-gem',
        'gemini-antigravity': 'fas fa-rocket',
        'openai-qwen-oauth': 'fas fa-code'
    };
    return icons[providerType] || 'fas fa-server';
}


/**
 * 格式化数字（向上取整保留两位小数）
 * @param {number} num - 数字
 * @returns {string} 格式化后的数字
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0.00';
    // 向上取整到两位小数
    const rounded = Math.ceil(num * 100) / 100;
    return rounded.toFixed(2);
}

/**
 * 格式化日期
 * @param {string} dateStr - ISO 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}