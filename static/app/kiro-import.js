// Kiro Token 批量导入模块

import { showToast } from './utils.js';
import { getAuthHeaders } from './auth.js';

/**
 * 初始化 Kiro Token 批量导入功能
 */
export function initKiroImport() {
    const fileInput = document.getElementById('kiroTokensFile');
    const selectBtn = document.getElementById('selectKiroTokensBtn');
    const importBtn = document.getElementById('importKiroTokensBtn');
    const fileNameSpan = document.getElementById('kiroTokensFileName');
    const resultDiv = document.getElementById('kiroImportResult');

    if (!fileInput || !selectBtn || !importBtn) {
        console.warn('[Kiro Import] 批量导入元素未找到');
        return;
    }

    // 选择文件按钮
    selectBtn.addEventListener('click', () => {
        fileInput.click();
    });

    // 文件选择变化
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            fileNameSpan.textContent = file.name;
            importBtn.disabled = false;
            resultDiv.style.display = 'none';
        } else {
            fileNameSpan.textContent = '未选择文件';
            importBtn.disabled = true;
        }
    });

    // 导入按钮
    importBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            showToast('请先选择文件', 'error');
            return;
        }

        importBtn.disabled = true;
        importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 导入中...';

        try {
            // 读取文件内容
            const content = await readFileContent(file);
            let tokens;

            try {
                tokens = JSON.parse(content);
            } catch (e) {
                throw new Error('JSON 解析失败，请检查文件格式');
            }

            if (!Array.isArray(tokens)) {
                throw new Error('文件内容必须是 JSON 数组格式');
            }

            // 调用后端 API
            const response = await fetch('/api/import-kiro-tokens', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({ tokens })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error?.message || '导入失败');
            }

            // 显示结果
            showImportResult(resultDiv, result);
            showToast(result.message, 'success');

            // 刷新提供商列表
            if (window.loadProviders) {
                window.loadProviders();
            }

            // 清空文件选择
            fileInput.value = '';
            fileNameSpan.textContent = '未选择文件';

        } catch (error) {
            console.error('[Kiro Import] 导入失败:', error);
            showToast('导入失败: ' + error.message, 'error');
            showImportError(resultDiv, error.message);
        } finally {
            importBtn.disabled = false;
            importBtn.innerHTML = '<i class="fas fa-cogs"></i> 生成配置';
        }
    });

    console.log('[Kiro Import] 批量导入功能已初始化');
}

/**
 * 读取文件内容
 */
function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('文件读取失败'));
        reader.readAsText(file);
    });
}

/**
 * 显示导入结果
 */
function showImportResult(container, result) {
    container.style.display = 'block';
    container.innerHTML = `
        <div style="padding: 10px; background: #d4edda; border-radius: 4px; color: #155724;">
            <strong>✅ 导入成功</strong><br>
            <small>
                创建了 ${result.createdFiles?.length || 0} 个凭据文件<br>
                Provider Pool 总数: ${result.totalPoolEntries || 0}
                ${result.skipped?.length ? `<br>⏭️ 跳过 ${result.skipped.length} 个重复 token` : ''}
                ${result.errors?.length ? `<br>⚠️ ${result.errors.length} 个警告` : ''}
            </small>
        </div>
    `;
}

/**
 * 显示导入错误
 */
function showImportError(container, message) {
    container.style.display = 'block';
    container.innerHTML = `
        <div style="padding: 10px; background: #f8d7da; border-radius: 4px; color: #721c24;">
            <strong>❌ 导入失败</strong><br>
            <small>${message}</small>
        </div>
    `;
}
