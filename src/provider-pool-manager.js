import * as fs from 'fs'; // Import fs module
import { getServiceAdapter, serviceInstances, clearServiceInstance } from './adapter.js';
import { MODEL_PROVIDER } from './common.js';
import axios from 'axios';

/**
 * Manages a pool of API service providers, handling their health and selection.
 */
export class ProviderPoolManager {
    // 默认健康检查模型配置
    // 键名必须与 MODEL_PROVIDER 常量值一致
    static DEFAULT_HEALTH_CHECK_MODELS = {
        'gemini-cli-oauth': 'gemini-2.5-flash',
        'gemini-antigravity': 'gemini-2.5-flash',
        'openai-custom': 'gpt-3.5-turbo',
        'claude-custom': 'claude-3-7-sonnet-20250219',
        'claude-kiro-oauth': 'claude-haiku-4-5',
        'openai-qwen-oauth': 'qwen3-coder-flash',
        'openaiResponses-custom': 'gpt-4o-mini'
    };

    constructor(providerPools, options = {}) {
        this.providerPools = providerPools;
        this.globalConfig = options.globalConfig || {}; // 存储全局配置
        this.providerStatus = {}; // Tracks health and usage for each provider instance
        this.roundRobinIndex = {}; // Tracks the current index for round-robin selection for each provider type
        // 使用 ?? 运算符确保 0 也能被正确设置，而不是被 || 替换为默认值
        this.maxErrorCount = options.maxErrorCount ?? 3; // Default to 3 errors before marking unhealthy
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000; // Default to 10 minutes
        
        // 日志级别控制
        this.logLevel = options.logLevel || 'info'; // 'debug', 'info', 'warn', 'error'
        
        // 添加防抖机制，避免频繁的文件 I/O 操作
        this.saveDebounceTime = options.saveDebounceTime || 1000; // 默认1秒防抖
        this.saveTimer = null;
        this.pendingSaves = new Set(); // 记录待保存的 providerType
        
        this.initializeProviderStatus();
    }

    /**
     * 日志输出方法，支持日志级别控制
     * @private
     */
    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            const logMethod = level === 'debug' ? 'log' : level;
            console[logMethod](`[ProviderPoolManager] ${message}`);
        }
    }

    /**
     * 查找指定的 provider
     * @private
     */
    _findProvider(providerType, uuid) {
        if (!providerType || !uuid) {
            this._log('error', `Invalid parameters: providerType=${providerType}, uuid=${uuid}`);
            return null;
        }
        const pool = this.providerStatus[providerType];
        return pool?.find(p => p.uuid === uuid) || null;
    }

    /**
     * Initializes the status for each provider in the pools.
     * Initially, all providers are considered healthy and have zero usage.
     */
    initializeProviderStatus() {
        for (const providerType in this.providerPools) {
            this.providerStatus[providerType] = [];
            this.roundRobinIndex[providerType] = 0; // Initialize round-robin index for each type
            this.providerPools[providerType].forEach((providerConfig) => {
                // Ensure initial health and usage stats are present in the config
                providerConfig.isHealthy = providerConfig.isHealthy !== undefined ? providerConfig.isHealthy : true;
                providerConfig.isDisabled = providerConfig.isDisabled !== undefined ? providerConfig.isDisabled : false;
                providerConfig.lastUsed = providerConfig.lastUsed !== undefined ? providerConfig.lastUsed : null;
                providerConfig.usageCount = providerConfig.usageCount !== undefined ? providerConfig.usageCount : 0;
                providerConfig.errorCount = providerConfig.errorCount !== undefined ? providerConfig.errorCount : 0;
                
                // 优化2: 简化 lastErrorTime 处理逻辑
                providerConfig.lastErrorTime = providerConfig.lastErrorTime instanceof Date
                    ? providerConfig.lastErrorTime.toISOString()
                    : (providerConfig.lastErrorTime || null);
                
                // 健康检测相关字段
                providerConfig.lastHealthCheckTime = providerConfig.lastHealthCheckTime || null;
                providerConfig.lastHealthCheckModel = providerConfig.lastHealthCheckModel || null;
                providerConfig.lastErrorMessage = providerConfig.lastErrorMessage || null;
                
                // 用量信息字段（基于用量查询的健康检测）
                providerConfig.usageInfo = providerConfig.usageInfo || null;

                this.providerStatus[providerType].push({
                    config: providerConfig,
                    uuid: providerConfig.uuid, // Still keep uuid at the top level for easy access
                });
            });
        }
        this._log('info', `Initialized provider statuses: ok (maxErrorCount: ${this.maxErrorCount})`);
    }

    /**
     * Selects a provider from the pool for a given provider type.
     * Currently uses a simple round-robin for healthy providers.
     * If requestedModel is provided, providers that don't support the model will be excluded.
     * If no healthy providers are available, will fallback to unhealthy (but not disabled) providers.
     * Unhealthy providers that have passed the recovery interval will be automatically re-checked.
     * @param {string} providerType - The type of provider to select (e.g., 'gemini-cli', 'openai-custom').
     * @param {string} [requestedModel] - Optional. The model name to filter providers by.
     * @returns {object|null} The selected provider's configuration, or null if no provider is found.
     */
    selectProvider(providerType, requestedModel = null, options = {}) {
        // 参数校验
        if (!providerType || typeof providerType !== 'string') {
            this._log('error', `Invalid providerType: ${providerType}`);
            return null;
        }

        const availableProviders = this.providerStatus[providerType] || [];
        
        // 过滤出未禁用的 provider（不管健康状态）
        let enabledProviders = availableProviders.filter(p => !p.config.isDisabled);
        
        // 如果指定了模型，排除不支持该模型的提供商
        if (requestedModel) {
            enabledProviders = enabledProviders.filter(p => {
                if (!p.config.notSupportedModels || !Array.isArray(p.config.notSupportedModels)) {
                    return true;
                }
                return !p.config.notSupportedModels.includes(requestedModel);
            });

            if (enabledProviders.length === 0) {
                this._log('warn', `No available providers for type: ${providerType} that support model: ${requestedModel}`);
                return null;
            }
            this._log('debug', `Filtered ${enabledProviders.length} providers supporting model: ${requestedModel}`);
        }

        if (enabledProviders.length === 0) {
            this._log('warn', `No available providers for type: ${providerType}`);
            return null;
        }

        // 检查不健康的 provider 是否可以尝试恢复（距离上次错误已超过恢复间隔）
        // 异步触发健康检查，不阻塞当前请求
        const now = new Date();
        for (const provider of enabledProviders) {
            if (!provider.config.isHealthy && provider.config.lastErrorTime) {
                const timeSinceError = now.getTime() - new Date(provider.config.lastErrorTime).getTime();
                if (timeSinceError >= this.healthCheckInterval) {
                    // 超过恢复间隔，异步触发健康检查
                    this._log('info', `Triggering auto-recovery health check for ${provider.config.uuid} (${providerType}) after ${Math.round(timeSinceError / 60000)} minutes`);
                    // 更新 lastErrorTime 防止重复触发
                    provider.config.lastErrorTime = now.toISOString();
                    // 异步执行健康检查，不阻塞当前请求
                    this._tryRecoverProvider(providerType, provider.config);
                }
            }
        }

        // 优先选择健康的 provider
        let candidateProviders = enabledProviders.filter(p => p.config.isHealthy);
        let isFallback = false;
        
        // 如果没有健康的，fallback 到不健康的
        if (candidateProviders.length === 0) {
            candidateProviders = enabledProviders;
            isFallback = true;
            this._log('warn', `No healthy providers for type: ${providerType}, falling back to unhealthy providers`);
        }

        // 为每个提供商类型和模型组合维护独立的轮询索引
        const indexKey = requestedModel ? `${providerType}:${requestedModel}` : providerType;
        const currentIndex = this.roundRobinIndex[indexKey] || 0;
        
        // 使用取模确保索引始终在有效范围内
        const providerIndex = currentIndex % candidateProviders.length;
        const selected = candidateProviders[providerIndex];
        
        // 更新下次轮询的索引
        this.roundRobinIndex[indexKey] = (currentIndex + 1) % candidateProviders.length;
        
        // 更新使用信息（除非明确跳过）
        if (!options.skipUsageCount) {
            selected.config.lastUsed = new Date().toISOString();
            selected.config.usageCount++;
            this._debouncedSave(providerType);
        }

        this._log('debug', `Selected provider for ${providerType} (round-robin${isFallback ? ', fallback' : ''}): ${selected.config.uuid}${requestedModel ? ` for model: ${requestedModel}` : ''}${options.skipUsageCount ? ' (skip usage count)' : ''}`);
        
        return selected.config;
    }

    /**
     * Marks a provider as unhealthy (e.g., after an API error).
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {string} [errorMessage] - Optional error message to store.
     */
    markProviderUnhealthy(providerType, providerConfig, errorMessage = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderUnhealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.errorCount++;
            provider.config.lastErrorTime = new Date().toISOString();
            
            // 保存错误信息
            if (errorMessage) {
                provider.config.lastErrorMessage = errorMessage;
            }

            if (provider.config.errorCount >= this.maxErrorCount) {
                provider.config.isHealthy = false;
                this._log('warn', `Marked provider as unhealthy: ${providerConfig.uuid} for type ${providerType}. Total errors: ${provider.config.errorCount}`);
            } else {
                this._log('warn', `Provider ${providerConfig.uuid} for type ${providerType} error count: ${provider.config.errorCount}/${this.maxErrorCount}. Still healthy.`);
            }
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * Marks a provider as healthy.
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     * @param {boolean} resetUsageCount - Whether to reset usage count (optional, default: false).
     * @param {string} [healthCheckModel] - Optional model name used for health check.
     */
    markProviderHealthy(providerType, providerConfig, resetUsageCount = false, healthCheckModel = null) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in markProviderHealthy');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isHealthy = true;
            provider.config.errorCount = 0;
            provider.config.lastErrorTime = null;
            provider.config.lastErrorMessage = null;
            
            // 更新健康检测信息
            provider.config.lastHealthCheckTime = new Date().toISOString();
            if (healthCheckModel) {
                provider.config.lastHealthCheckModel = healthCheckModel;
            }
            
            // 只有在明确要求重置使用计数时才重置
            if (resetUsageCount) {
                provider.config.usageCount = 0;
            }else{
                provider.config.usageCount++;
                provider.config.lastUsed = new Date().toISOString();
            }
            this._log('info', `Marked provider as healthy: ${provider.config.uuid} for type ${providerType}${resetUsageCount ? ' (usage count reset)' : ''}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * 重置提供商的计数器（错误计数和使用计数）
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to mark.
     */
    resetProviderCounters(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in resetProviderCounters');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.errorCount = 0;
            provider.config.usageCount = 0;
            this._log('info', `Reset provider counters: ${provider.config.uuid} for type ${providerType}`);
            
            this._debouncedSave(providerType);
        }
    }

    /**
     * 禁用指定提供商
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置
     */
    disableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in disableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = true;
            this._log('info', `Disabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * 启用指定提供商
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置
     */
    enableProvider(providerType, providerConfig) {
        if (!providerConfig?.uuid) {
            this._log('error', 'Invalid providerConfig in enableProvider');
            return;
        }

        const provider = this._findProvider(providerType, providerConfig.uuid);
        if (provider) {
            provider.config.isDisabled = false;
            this._log('info', `Enabled provider: ${providerConfig.uuid} for type ${providerType}`);
            this._debouncedSave(providerType);
        }
    }

    /**
     * Performs health checks on all providers in the pool.
     * This method would typically be called periodically (e.g., via cron job).
     */
    async performHealthChecks(isInit = false) {
        this._log('info', 'Performing health checks on all providers...');
        const now = new Date();
        
        for (const providerType in this.providerStatus) {
            for (const providerStatus of this.providerStatus[providerType]) {
                const providerConfig = providerStatus.config;

                // Only attempt to health check unhealthy providers after a certain interval
                if (!providerStatus.config.isHealthy && providerStatus.config.lastErrorTime &&
                    (now.getTime() - new Date(providerStatus.config.lastErrorTime).getTime() < this.healthCheckInterval)) {
                    this._log('debug', `Skipping health check for ${providerConfig.uuid} (${providerType}). Last error too recent.`);
                    continue;
                }

                try {
                    // Perform actual health check based on provider type
                    const healthResult = await this._checkProviderHealth(providerType, providerConfig);
                    
                    if (healthResult === null) {
                        this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}) skipped: Check not implemented.`);
                        this.resetProviderCounters(providerType, providerConfig);
                        continue;
                    }
                    
                    if (healthResult.success) {
                        if (!providerStatus.config.isHealthy) {
                            // Provider was unhealthy but is now healthy
                            // 恢复健康时不重置使用计数，保持原有值
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('info', `Health check for ${providerConfig.uuid} (${providerType}): Marked Healthy (actual check)`);
                        } else {
                            // Provider was already healthy and still is
                            // 只在初始化时重置使用计数
                            this.markProviderHealthy(providerType, providerConfig, true, healthResult.modelName);
                            this._log('debug', `Health check for ${providerConfig.uuid} (${providerType}): Still Healthy`);
                        }
                    } else {
                        // Provider is not healthy
                        this._log('warn', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${healthResult.errorMessage || 'Provider is not responding correctly.'}`);
                        this.markProviderUnhealthy(providerType, providerConfig, healthResult.errorMessage);
                        
                        // 更新健康检测时间和模型（即使失败也记录）
                        providerStatus.config.lastHealthCheckTime = new Date().toISOString();
                        if (healthResult.modelName) {
                            providerStatus.config.lastHealthCheckModel = healthResult.modelName;
                        }
                    }

                } catch (error) {
                    this._log('error', `Health check for ${providerConfig.uuid} (${providerType}) failed: ${error.message}`);
                    // If a health check fails, mark it unhealthy, which will update error count and lastErrorTime
                    this.markProviderUnhealthy(providerType, providerConfig, error.message);
                }
            }
        }
    }

    /**
     * 构建健康检查请求（返回多种格式用于重试）
     * @private
     * @returns {Array} 请求格式数组，按优先级排序
     */
    _buildHealthCheckRequests(providerType, modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        const requests = [];
        
        // Gemini 使用 contents 格式
        if (providerType.startsWith('gemini')) {
            requests.push({
                contents: [{
                    role: 'user',
                    parts: [{ text: baseMessage.content }]
                }]
            });
            return requests;
        }
        
        // Kiro OAuth 同时支持 messages 和 contents 格式
        if (providerType.startsWith('claude-kiro')) {
            // 优先使用 messages 格式
            requests.push({
                messages: [baseMessage],
                model: modelName,
                max_tokens: 1
            });
            // 备用 contents 格式
            requests.push({
                contents: [{
                    role: 'user',
                    parts: [{ text: baseMessage.content }]
                }],
                max_tokens: 1
            });
            return requests;
        }
        
        // OpenAI Custom Responses 使用特殊格式
        if (providerType === MODEL_PROVIDER.OPENAI_CUSTOM_RESPONSES) {
            requests.push({
                input: [baseMessage],
                model: modelName
            });
            return requests;
        }
        
        // 其他提供商（OpenAI、Claude、Qwen）使用标准 messages 格式
        requests.push({
            messages: [baseMessage],
            model: modelName
        });
        
        return requests;
    }

    /**
     * 支持基于用量查询的健康检测的提供商类型
     */
    static USAGE_BASED_HEALTH_CHECK_PROVIDERS = [
        MODEL_PROVIDER.KIRO_API
    ];

    /**
     * Performs an actual health check for a specific provider.
     * 优先使用基于用量查询的健康检测（不消耗配额），如果不支持则回退到传统方式。
     * @param {string} providerType - The type of the provider.
     * @param {object} providerConfig - The configuration of the provider to check.
     * @param {boolean} forceCheck - If true, ignore checkHealth config and force the check.
     * @returns {Promise<{success: boolean, modelName: string, errorMessage: string, usageInfo: object}|null>} - Health check result object or null if check not implemented.
     */
    async _checkProviderHealth(providerType, providerConfig, forceCheck = false) {
        // 确定健康检查使用的模型名称
        const modelName = providerConfig.checkModelName ||
                        ProviderPoolManager.DEFAULT_HEALTH_CHECK_MODELS[providerType];
        
        // 如果未启用健康检查且不是强制检查，返回 null
        if (!providerConfig.checkHealth && !forceCheck) {
            return null;
        }

        // 使用内部服务适配器方式进行健康检查
        const proxyKeys = ['GEMINI', 'OPENAI', 'CLAUDE', 'QWEN', 'KIRO'];
        const tempConfig = {
            ...providerConfig,
            MODEL_PROVIDER: providerType
        };
        
        proxyKeys.forEach(key => {
            const proxyKey = `USE_SYSTEM_PROXY_${key}`;
            if (this.globalConfig[proxyKey] !== undefined) {
                tempConfig[proxyKey] = this.globalConfig[proxyKey];
            }
        });

        // 健康检查时清除缓存，确保使用最新的凭据
        clearServiceInstance(providerType, providerConfig.uuid);
        const serviceAdapter = getServiceAdapter(tempConfig);

        // 优先使用基于用量查询的健康检测（不消耗配额）
        if (ProviderPoolManager.USAGE_BASED_HEALTH_CHECK_PROVIDERS.includes(providerType)) {
            const usageResult = await this._checkProviderHealthByUsage(providerType, serviceAdapter, providerConfig);
            if (usageResult !== null) {
                return usageResult;
            }
            // 如果用量查询失败，回退到传统方式
            this._log('debug', `Usage-based health check not available for ${providerConfig.uuid}, falling back to traditional method`);
        }

        // 传统健康检测方式（发送请求）
        if (!modelName) {
            this._log('warn', `Unknown provider type for health check: ${providerType}`);
            return { success: false, modelName: null, errorMessage: 'Unknown provider type for health check' };
        }
        
        // 获取所有可能的请求格式
        const healthCheckRequests = this._buildHealthCheckRequests(providerType, modelName);
        
        // 重试机制：尝试不同的请求格式
        const maxRetries = healthCheckRequests.length;
        let lastError = null;
        
        for (let i = 0; i < maxRetries; i++) {
            const healthCheckRequest = healthCheckRequests[i];
            try {
                this._log('debug', `Health check attempt ${i + 1}/${maxRetries} for ${modelName}: ${JSON.stringify(healthCheckRequest)}`);
                await serviceAdapter.generateContent(modelName, healthCheckRequest);
                return { success: true, modelName, errorMessage: null };
            } catch (error) {
                lastError = error;
                this._log('debug', `Health check attempt ${i + 1} failed for ${providerType}: ${error.message}`);
                // 继续尝试下一个格式
            }
        }
        
        // 所有尝试都失败
        this._log('error', `Health check failed for ${providerType} after ${maxRetries} attempts: ${lastError?.message}`);
        return { success: false, modelName, errorMessage: lastError?.message || 'All health check attempts failed' };
    }

    /**
     * 基于用量查询的健康检测
     * 通过查询配额/余额来判断账号是否健康，不消耗实际配额
     * 会先尝试刷新 token，确保使用最新的凭据
     * @private
     * @param {string} providerType - 提供商类型
     * @param {object} serviceAdapter - 服务适配器实例
     * @param {object} providerConfig - 提供商配置
     * @returns {Promise<{success: boolean, modelName: string, errorMessage: string, usageInfo: object}|null>}
     */
    async _checkProviderHealthByUsage(providerType, serviceAdapter, providerConfig) {
        // 检查适配器是否支持 getUsageLimits 方法
        if (typeof serviceAdapter.getUsageLimits !== 'function') {
            return null;
        }

        try {
            this._log('debug', `Performing usage-based health check for ${providerConfig.uuid} (${providerType})`);

            // 先尝试刷新 token，确保使用最新的凭据
            // 优先使用 forceRefreshToken（强制刷新），否则使用 refreshToken
            if (typeof serviceAdapter.forceRefreshToken === 'function') {
                try {
                    this._log('debug', `Force refreshing token before health check for ${providerConfig.uuid}`);
                    await serviceAdapter.forceRefreshToken();
                    this._log('debug', `Token force refresh completed for ${providerConfig.uuid}`);
                } catch (refreshError) {
                    this._log('warn', `Token force refresh failed for ${providerConfig.uuid}: ${refreshError.message}`);
                    // 刷新失败不阻止健康检查，继续尝试获取用量
                }
            } else if (typeof serviceAdapter.refreshToken === 'function') {
                try {
                    this._log('debug', `Refreshing token before health check for ${providerConfig.uuid}`);
                    await serviceAdapter.refreshToken();
                    this._log('debug', `Token refresh completed for ${providerConfig.uuid}`);
                } catch (refreshError) {
                    this._log('warn', `Token refresh failed for ${providerConfig.uuid}: ${refreshError.message}`);
                    // 刷新失败不阻止健康检查，继续尝试获取用量
                }
            }

            const rawUsageData = await serviceAdapter.getUsageLimits();
            
            // 只支持 Kiro
            if (providerType !== MODEL_PROVIDER.KIRO_API) {
                return null;
            }
            
            // 动态导入格式化函数，避免循环依赖
            const { formatKiroUsage } = await import('./usage-service.js');
            const formattedUsage = formatKiroUsage(rawUsageData);

            if (!formattedUsage) {
                return { 
                    success: false, 
                    modelName: null, 
                    errorMessage: 'Failed to parse usage data',
                    usageInfo: null
                };
            }

            // 分析用量数据，判断是否健康
            const healthAnalysis = this._analyzeUsageHealth(providerType, formattedUsage, providerConfig);
            
            // 更新 provider 的用量信息
            const provider = this._findProvider(providerType, providerConfig.uuid);
            if (provider) {
                provider.config.usageInfo = healthAnalysis.usageInfo;
                provider.config.lastHealthCheckTime = new Date().toISOString();
            }

            this._log('info', `Usage-based health check for ${providerConfig.uuid} (${providerType}): ${healthAnalysis.success ? 'Healthy' : 'Unhealthy'} - ${healthAnalysis.summary}`);
            
            return {
                success: healthAnalysis.success,
                modelName: null,
                errorMessage: healthAnalysis.success ? null : healthAnalysis.errorMessage,
                usageInfo: healthAnalysis.usageInfo
            };
        } catch (error) {
            this._log('warn', `Usage-based health check failed for ${providerConfig.uuid} (${providerType}): ${error.message}`);
            // 返回 null 表示用量查询失败，让调用者回退到传统方式
            return null;
        }
    }

    /**
     * 分析用量数据，判断账号健康状态
     * @private
     * @param {string} providerType - 提供商类型
     * @param {object} formattedUsage - 格式化后的用量数据
     * @param {object} providerConfig - 提供商配置
     * @returns {{success: boolean, errorMessage: string, usageInfo: object, summary: string}}
     */
    _analyzeUsageHealth(providerType, formattedUsage, providerConfig) {
        const usageBreakdown = formattedUsage.usageBreakdown || [];
        
        // 计算总用量
        let totalUsed = 0;
        let totalLimit = 0;
        let hasActiveQuota = false;
        
        for (const breakdown of usageBreakdown) {
            const used = breakdown.currentUsage || 0;
            const limit = breakdown.usageLimit || 0;
            
            totalUsed += used;
            totalLimit += limit;
            
            // 检查是否有可用配额
            if (limit > 0 && used < limit) {
                hasActiveQuota = true;
            }
            
            // 检查免费试用配额
            if (breakdown.freeTrial && breakdown.freeTrial.status === 'ACTIVE') {
                const freeUsed = breakdown.freeTrial.currentUsage || 0;
                const freeLimit = breakdown.freeTrial.usageLimit || 0;
                totalUsed += freeUsed;
                totalLimit += freeLimit;
                if (freeLimit > 0 && freeUsed < freeLimit) {
                    hasActiveQuota = true;
                }
            }
            
            // 检查奖励配额
            if (breakdown.bonuses && Array.isArray(breakdown.bonuses)) {
                for (const bonus of breakdown.bonuses) {
                    if (bonus.status === 'ACTIVE') {
                        const bonusUsed = bonus.currentUsage || 0;
                        const bonusLimit = bonus.usageLimit || 0;
                        totalUsed += bonusUsed;
                        totalLimit += bonusLimit;
                        if (bonusLimit > 0 && bonusUsed < bonusLimit) {
                            hasActiveQuota = true;
                        }
                    }
                }
            }
        }

        const remaining = totalLimit - totalUsed;
        const usagePercent = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;
        
        // 构建用量信息
        const usageInfo = {
            used: totalUsed,
            limit: totalLimit,
            remaining: remaining,
            usagePercent: usagePercent,
            nextReset: formattedUsage.nextDateReset,
            daysUntilReset: formattedUsage.daysUntilReset,
            subscription: formattedUsage.subscription?.title || formattedUsage.subscription?.type,
            email: formattedUsage.user?.email
        };

        // 判断健康状态
        // 配额用完或没有可用配额时标记为不健康
        const isHealthy = hasActiveQuota && remaining > 0;
        
        let errorMessage = null;
        let summary = '';
        
        if (!isHealthy) {
            if (remaining <= 0) {
                errorMessage = `配额已用完 (${totalUsed}/${totalLimit})`;
                summary = errorMessage;
            } else if (!hasActiveQuota) {
                errorMessage = '没有可用的活跃配额';
                summary = errorMessage;
            }
        } else {
            summary = `${totalUsed}/${totalLimit} (${usagePercent}% 已用, 剩余 ${remaining})`;
        }

        return {
            success: isHealthy,
            errorMessage,
            usageInfo,
            summary
        };
    }

    /**
     * 异步尝试恢复不健康的 provider
     * 执行健康检查，如果成功则标记为健康
     * @private
     */
    async _tryRecoverProvider(providerType, providerConfig) {
        try {
            const healthResult = await this._checkProviderHealth(providerType, providerConfig, true);
            
            if (healthResult === null) {
                this._log('debug', `Recovery check skipped for ${providerConfig.uuid} (${providerType}): Check not implemented`);
                return;
            }
            
            if (healthResult.success) {
                this.markProviderHealthy(providerType, providerConfig, false, healthResult.modelName);
                this._log('info', `Provider ${providerConfig.uuid} (${providerType}) recovered successfully`);
            } else {
                this._log('warn', `Provider ${providerConfig.uuid} (${providerType}) recovery failed: ${healthResult.errorMessage}`);
                // 更新错误信息但不增加错误计数（因为已经是不健康状态）
                const provider = this._findProvider(providerType, providerConfig.uuid);
                if (provider) {
                    provider.config.lastErrorMessage = healthResult.errorMessage;
                    provider.config.lastHealthCheckTime = new Date().toISOString();
                    if (healthResult.modelName) {
                        provider.config.lastHealthCheckModel = healthResult.modelName;
                    }
                    this._debouncedSave(providerType);
                }
            }
        } catch (error) {
            this._log('error', `Recovery check error for ${providerConfig.uuid} (${providerType}): ${error.message}`);
        }
    }

    /**
     * 优化1: 添加防抖保存方法
     * 延迟保存操作，避免频繁的文件 I/O
     * @private
     */
    _debouncedSave(providerType) {
        // 将待保存的 providerType 添加到集合中
        this.pendingSaves.add(providerType);
        
        // 清除之前的定时器
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // 设置新的定时器
        this.saveTimer = setTimeout(() => {
            this._flushPendingSaves();
        }, this.saveDebounceTime);
    }
    
    /**
     * 批量保存所有待保存的 providerType（优化为单次文件写入）
     * @private
     */
    async _flushPendingSaves() {
        const typesToSave = Array.from(this.pendingSaves);
        if (typesToSave.length === 0) return;
        
        this.pendingSaves.clear();
        this.saveTimer = null;
        
        try {
            const filePath = this.globalConfig.PROVIDER_POOLS_FILE_PATH || 'provider_pools.json';
            let currentPools = {};
            
            // 一次性读取文件
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                currentPools = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code === 'ENOENT') {
                    this._log('info', 'provider_pools.json does not exist, creating new file.');
                } else {
                    throw readError;
                }
            }

            // 更新所有待保存的 providerType
            for (const providerType of typesToSave) {
                if (this.providerStatus[providerType]) {
                    currentPools[providerType] = this.providerStatus[providerType].map(p => {
                        // Convert Date objects to ISOString if they exist
                        const config = { ...p.config };
                        if (config.lastUsed instanceof Date) {
                            config.lastUsed = config.lastUsed.toISOString();
                        }
                        if (config.lastErrorTime instanceof Date) {
                            config.lastErrorTime = config.lastErrorTime.toISOString();
                        }
                        if (config.lastHealthCheckTime instanceof Date) {
                            config.lastHealthCheckTime = config.lastHealthCheckTime.toISOString();
                        }
                        return config;
                    });
                } else {
                    this._log('warn', `Attempted to save unknown providerType: ${providerType}`);
                }
            }
            
            // 一次性写入文件
            await fs.promises.writeFile(filePath, JSON.stringify(currentPools, null, 2), 'utf8');
            this._log('info', `provider_pools.json updated successfully for types: ${typesToSave.join(', ')}`);
        } catch (error) {
            this._log('error', `Failed to write provider_pools.json: ${error.message}`);
        }
    }

}