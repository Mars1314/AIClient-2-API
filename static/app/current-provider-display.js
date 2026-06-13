/**
 * 当前使用的 Provider 显示模块
 * 在 Provider Pools 界面显示当前正在使用的账号
 */

let currentProvidersData = null;
let refreshIntervalId = null;

/**
 * 初始化当前 provider 显示
 */
export function initCurrentProviderDisplay() {
    console.log('[Current Provider] Initializing current provider display');
    
    // 初始加载
    loadCurrentProviders();
    
    // 每5秒刷新一次
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
    }
    refreshIntervalId = setInterval(loadCurrentProviders, 5000);
}

/**
 * 停止刷新
 */
export function stopCurrentProviderRefresh() {
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }
}

/**
 * 加载当前正在使用的 providers
 */
async function loadCurrentProviders() {
    try {
        const response = await fetch('/api/providers/current');
        const data = await response.json();
        
        if (data.success) {
            currentProvidersData = data.currentProviders;
            updateCurrentProviderDisplay();
        }
    } catch (error) {
        console.error('[Current Provider] Failed to load current providers:', error);
    }
}

/**
 * 更新当前 provider 的显示
 */
function updateCurrentProviderDisplay() {
    if (!currentProvidersData) return;
    
    // 查找所有 provider modal
    const modals = document.querySelectorAll('.provider-modal');
    
    modals.forEach(modal => {
        const providerType = modal.getAttribute('data-provider-type');
        const currentProvider = currentProvidersData[providerType];
        
        if (!currentProvider) return;
        
        // 更新 modal 标题，显示当前使用的账号
        updateModalTitle(modal, providerType, currentProvider);
        
        // 高亮当前使用的 provider
        highlightCurrentProvider(modal, currentProvider.uuid);
        
        // 显示指纹信息
        updateFingerprintInfo(modal, currentProvider);
    });
}

/**
 * 更新 modal 标题，显示当前账号
 */
function updateModalTitle(modal, providerType, currentProvider) {
    const modalTitle = modal.querySelector('.modal-title');
    if (!modalTitle) return;
    
    // 查找或创建当前账号显示区域
    let currentAccountBadge = modal.querySelector('.current-account-badge');
    
    if (!currentAccountBadge) {
        currentAccountBadge = document.createElement('span');
        currentAccountBadge.className = 'current-account-badge';
        modalTitle.appendChild(currentAccountBadge);
    }
    
    // 状态图标
    const statusIcon = currentProvider.isHealthy ? 
        '<i class="fas fa-check-circle" style="color: #28a745;"></i>' :
        '<i class="fas fa-exclamation-triangle" style="color: #ffc107;"></i>';
    
    // 构建显示内容
    currentAccountBadge.innerHTML = `
        <span style="margin-left: 10px; padding: 5px 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
              color: white; border-radius: 20px; font-size: 12px; font-weight: 600; 
              box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);">
            ${statusIcon} 当前: ${currentProvider.uuid}
        </span>
    `;
}

/**
 * 高亮当前使用的 provider
 */
function highlightCurrentProvider(modal, currentUuid) {
    // 移除所有高亮
    const allProviderItems = modal.querySelectorAll('.provider-item-detail');
    allProviderItems.forEach(item => {
        item.classList.remove('current-active');
        item.style.border = '';
        item.style.boxShadow = '';
        
        // 移除旧的"当前使用"标签
        const oldBadge = item.querySelector('.current-using-badge');
        if (oldBadge) {
            oldBadge.remove();
        }
    });
    
    // 高亮当前的
    const currentItem = modal.querySelector(`.provider-item-detail[data-uuid="${currentUuid}"]`);
    if (currentItem) {
        currentItem.classList.add('current-active');
        currentItem.style.border = '2px solid #667eea';
        currentItem.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
        
        // 添加"当前使用"标签到provider-name后面
        const providerName = currentItem.querySelector('.provider-name');
        if (providerName) {
            let currentBadge = currentItem.querySelector('.current-using-badge');
            if (!currentBadge) {
                currentBadge = document.createElement('span');
                currentBadge.className = 'current-using-badge';
                currentBadge.innerHTML = `
                    <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                          color: white; padding: 4px 10px; border-radius: 12px; 
                          font-size: 11px; font-weight: 600; margin-left: 8px;
                          box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);
                          display: inline-flex; align-items: center; gap: 4px;">
                        <i class="fas fa-play-circle"></i> 当前使用
                    </span>
                `;
                providerName.appendChild(currentBadge);
            }
        }
    }
}

/**
 * 更新指纹信息显示
 */
function updateFingerprintInfo(modal, currentProvider) {
    if (!currentProvider.fingerprint) return;
    
    // 查找或创建指纹信息显示区域
    let fingerprintInfo = modal.querySelector('.current-fingerprint-info');
    
    if (!fingerprintInfo) {
        fingerprintInfo = document.createElement('div');
        fingerprintInfo.className = 'current-fingerprint-info';
        fingerprintInfo.style.cssText = `
            margin: 15px 0;
            padding: 12px;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            border-radius: 8px;
            border-left: 4px solid #667eea;
        `;
        
        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) {
            modalBody.insertBefore(fingerprintInfo, modalBody.firstChild);
        }
    }
    
    const { MACHINE_ID_SALT, BROWSER_VERSION, PLATFORM_NAME } = currentProvider.fingerprint;
    
    fingerprintInfo.innerHTML = `
        <div style="font-weight: 600; color: #667eea; margin-bottom: 8px; font-size: 13px;">
            <i class="fas fa-fingerprint"></i> 当前账号指纹信息
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 12px;">
            <div>
                <span style="color: #6c757d;">盐值:</span>
                <code style="background: rgba(102, 126, 234, 0.1); padding: 2px 6px; border-radius: 4px; color: #667eea;">
                    ${MACHINE_ID_SALT}
                </code>
            </div>
            <div>
                <span style="color: #6c757d;">浏览器:</span>
                <code style="background: rgba(102, 126, 234, 0.1); padding: 2px 6px; border-radius: 4px; color: #667eea;">
                    Chrome ${BROWSER_VERSION}
                </code>
            </div>
            <div>
                <span style="color: #6c757d;">平台:</span>
                <code style="background: rgba(102, 126, 234, 0.1); padding: 2px 6px; border-radius: 4px; color: #667eea;">
                    ${PLATFORM_NAME}
                </code>
            </div>
        </div>
        <div style="margin-top: 8px; font-size: 11px; color: #6c757d;">
            <i class="fas fa-info-circle"></i> 
            每个账号使用独立的设备指纹，切换账号时指纹也会自动更新
        </div>
    `;
}

/**
 * 获取当前 provider 数据（供其他模块使用）
 */
export function getCurrentProvidersData() {
    return currentProvidersData;
}

/**
 * 手动刷新
 */
export function refreshCurrentProviders() {
    return loadCurrentProviders();
}

// 导出供全局使用
window.initCurrentProviderDisplay = initCurrentProviderDisplay;
window.stopCurrentProviderRefresh = stopCurrentProviderRefresh;
window.refreshCurrentProviders = refreshCurrentProviders;
