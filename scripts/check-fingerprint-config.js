#!/usr/bin/env node

/**
 * 指纹配置检查工具
 * 检查 provider 配置中的指纹是否合理，找出潜在的封号风险
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI 颜色代码
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

/**
 * 读取配置文件
 */
function loadConfig() {
    const configPath = path.join(__dirname, '..', 'provider_pools.json');
    const altConfigPath = path.join(__dirname, '..', 'config.json');
    
    let configFile = configPath;
    if (!fs.existsSync(configPath) && fs.existsSync(altConfigPath)) {
        configFile = altConfigPath;
    }
    
    if (!fs.existsSync(configFile)) {
        console.error(colorize('❌ 配置文件不存在！', 'red'));
        console.error(`   查找路径: ${configPath}`);
        console.error(`   备用路径: ${altConfigPath}`);
        process.exit(1);
    }
    
    console.log(colorize(`📁 读取配置: ${path.basename(configFile)}`, 'cyan'));
    const content = fs.readFileSync(configFile, 'utf8');
    return JSON.parse(content);
}

/**
 * 检查指纹配置
 */
function checkFingerprints(providers) {
    const issues = [];
    const warnings = [];
    const info = [];
    
    // 统计数据
    const saltCounts = {};
    const browserCounts = {};
    const platformCounts = {};
    const languageCounts = {};
    
    providers.forEach(provider => {
        const uuid = provider.uuid || '未命名账号';
        
        // 1. 检查 MACHINE_ID_SALT
        if (!provider.MACHINE_ID_SALT) {
            issues.push(`${uuid}: 缺少 MACHINE_ID_SALT 配置（极高风险）`);
        } else {
            saltCounts[provider.MACHINE_ID_SALT] = (saltCounts[provider.MACHINE_ID_SALT] || 0) + 1;
            
            // 检查盐值长度
            if (provider.MACHINE_ID_SALT.length < 10) {
                warnings.push(`${uuid}: MACHINE_ID_SALT 太短（建议至少20字符）`);
            }
        }
        
        // 2. 检查浏览器版本
        if (!provider.BROWSER_VERSION) {
            info.push(`${uuid}: 未配置 BROWSER_VERSION（将使用随机版本）`);
        } else {
            browserCounts[provider.BROWSER_VERSION] = (browserCounts[provider.BROWSER_VERSION] || 0) + 1;
        }
        
        // 3. 检查平台
        if (!provider.PLATFORM_NAME) {
            info.push(`${uuid}: 未配置 PLATFORM_NAME（将使用系统平台）`);
        } else {
            platformCounts[provider.PLATFORM_NAME] = (platformCounts[provider.PLATFORM_NAME] || 0) + 1;
        }
        
        // 4. 检查语言偏好
        if (!provider.ACCEPT_LANGUAGE) {
            info.push(`${uuid}: 未配置 ACCEPT_LANGUAGE（将使用默认语言）`);
        } else {
            languageCounts[provider.ACCEPT_LANGUAGE] = (languageCounts[provider.ACCEPT_LANGUAGE] || 0) + 1;
        }
        
        // 5. 检查随机延迟
        if (provider.ENABLE_RANDOM_DELAY === false) {
            issues.push(`${uuid}: 关闭了随机延迟（高风险）`);
        }
        
        // 6. 检查请求间隔
        if (provider.MIN_REQUEST_INTERVAL && provider.MIN_REQUEST_INTERVAL < 2000) {
            warnings.push(`${uuid}: MIN_REQUEST_INTERVAL 太短（${provider.MIN_REQUEST_INTERVAL}ms，建议>=2000ms）`);
        }
        if (provider.MAX_REQUEST_INTERVAL && provider.MAX_REQUEST_INTERVAL < 5000) {
            warnings.push(`${uuid}: MAX_REQUEST_INTERVAL 太短（${provider.MAX_REQUEST_INTERVAL}ms，建议>=5000ms）`);
        }
    });
    
    // 检查重复的指纹
    Object.entries(saltCounts).forEach(([salt, count]) => {
        if (count > 1) {
            issues.push(`${count} 个账号使用相同的 MACHINE_ID_SALT: "${salt.substring(0, 20)}..." (极高风险)`);
        }
    });
    
    Object.entries(browserCounts).forEach(([browser, count]) => {
        if (count > 1 && count === providers.length) {
            warnings.push(`所有 ${count} 个账号使用相同的浏览器版本: ${browser} (建议差异化)`);
        }
    });
    
    Object.entries(platformCounts).forEach(([platform, count]) => {
        if (count > 1 && count === providers.length) {
            warnings.push(`所有 ${count} 个账号使用相同的平台: ${platform} (建议差异化)`);
        }
    });
    
    return { issues, warnings, info, stats: { saltCounts, browserCounts, platformCounts, languageCounts } };
}

/**
 * 计算风险评分
 */
function calculateRiskScore(issues, warnings, providers) {
    let score = 0;
    
    // 严重问题：每个+20分
    score += issues.length * 20;
    
    // 警告：每个+5分
    score += warnings.length * 5;
    
    // 如果所有账号指纹相同，额外+50分
    const allSameSalt = providers.every((p, i, arr) => 
        i === 0 || p.MACHINE_ID_SALT === arr[0].MACHINE_ID_SALT
    );
    if (allSameSalt) {
        score += 50;
    }
    
    return Math.min(score, 100);
}

/**
 * 打印报告
 */
function printReport(providerType, providers, result) {
    console.log('\n' + '='.repeat(70));
    console.log(colorize(`📊 ${providerType} 配置检查报告`, 'bright'));
    console.log('='.repeat(70));
    
    console.log(`\n总账号数: ${colorize(providers.length, 'cyan')}`);
    
    // 打印严重问题
    if (result.issues.length > 0) {
        console.log(colorize('\n🔴 严重问题（必须修复）:', 'red'));
        result.issues.forEach(issue => {
            console.log(colorize(`  ❌ ${issue}`, 'red'));
        });
    }
    
    // 打印警告
    if (result.warnings.length > 0) {
        console.log(colorize('\n🟡 警告（建议修复）:', 'yellow'));
        result.warnings.forEach(warning => {
            console.log(colorize(`  ⚠️  ${warning}`, 'yellow'));
        });
    }
    
    // 打印信息
    if (result.info.length > 0) {
        console.log(colorize('\nℹ️  信息:', 'blue'));
        result.info.forEach(i => {
            console.log(colorize(`  ℹ️  ${i}`, 'blue'));
        });
    }
    
    // 打印统计
    console.log(colorize('\n📈 指纹差异化统计:', 'cyan'));
    
    const uniqueSalts = Object.keys(result.stats.saltCounts).length;
    const uniqueBrowsers = Object.keys(result.stats.browserCounts).length;
    const uniquePlatforms = Object.keys(result.stats.platformCounts).length;
    const uniqueLanguages = Object.keys(result.stats.languageCounts).length;
    
    console.log(`  盐值 (MACHINE_ID_SALT):  ${colorize(uniqueSalts, uniqueSalts === providers.length ? 'green' : 'red')} / ${providers.length} ${uniqueSalts === providers.length ? '✅' : '❌'}`);
    console.log(`  浏览器版本 (BROWSER):    ${colorize(uniqueBrowsers, uniqueBrowsers > 1 ? 'green' : 'yellow')} / ${providers.length} ${uniqueBrowsers > 1 ? '✅' : '⚠️'}`);
    console.log(`  操作系统 (PLATFORM):     ${colorize(uniquePlatforms, uniquePlatforms > 1 ? 'green' : 'yellow')} / ${providers.length} ${uniquePlatforms > 1 ? '✅' : '⚠️'}`);
    console.log(`  语言偏好 (LANGUAGE):     ${colorize(uniqueLanguages, uniqueLanguages > 1 ? 'green' : 'yellow')} / ${providers.length} ${uniqueLanguages > 1 ? '✅' : '⚠️'}`);
    
    // 风险评分
    const riskScore = calculateRiskScore(result.issues, result.warnings, providers);
    console.log(colorize('\n🎯 风险评分:', 'bright'));
    
    let riskLevel, riskColor, riskIcon;
    if (riskScore < 20) {
        riskLevel = '低风险';
        riskColor = 'green';
        riskIcon = '✅';
    } else if (riskScore < 50) {
        riskLevel = '中风险';
        riskColor = 'yellow';
        riskIcon = '⚠️';
    } else {
        riskLevel = '高风险';
        riskColor = 'red';
        riskIcon = '❌';
    }
    
    console.log(`  ${colorize(riskIcon + ' ' + riskScore + '/100', riskColor)} - ${colorize(riskLevel, riskColor)}`);
    
    // 建议
    console.log(colorize('\n💡 建议:', 'cyan'));
    if (riskScore < 20) {
        console.log(colorize('  ✅ 配置良好！继续保持差异化。', 'green'));
    } else if (riskScore < 50) {
        console.log(colorize('  ⚠️  配置需要优化，建议修复上述警告项。', 'yellow'));
        console.log('  运行: node scripts/generate-fingerprints.js');
    } else {
        console.log(colorize('  ❌ 配置存在严重问题，立即修复！', 'red'));
        console.log('  运行: node scripts/generate-fingerprints.js');
        console.log('  或参考: 账号封禁原因分析与改进建议.md');
    }
}

/**
 * 主函数
 */
function main() {
    console.log(colorize('\n🔍 Kiro 指纹配置检查工具', 'bright'));
    console.log(colorize('检查账号指纹配置，评估封号风险\n', 'cyan'));
    
    try {
        const config = loadConfig();
        
        // 查找 kiro oauth providers
        let providers = [];
        let providerType = 'claude-kiro-oauth';
        
        if (config[providerType]) {
            providers = config[providerType];
        } else if (config.providerPools && config.providerPools[providerType]) {
            providers = config.providerPools[providerType];
        } else if (Array.isArray(config)) {
            providers = config;
        }
        
        if (providers.length === 0) {
            console.log(colorize('⚠️  未找到 claude-kiro-oauth 配置', 'yellow'));
            return;
        }
        
        // 检查配置
        const result = checkFingerprints(providers);
        
        // 打印报告
        printReport(providerType, providers, result);
        
        console.log('\n' + '='.repeat(70) + '\n');
        
        // 退出码
        const riskScore = calculateRiskScore(result.issues, result.warnings, providers);
        if (riskScore >= 50) {
            process.exit(1); // 高风险
        }
        
    } catch (error) {
        console.error(colorize(`\n❌ 错误: ${error.message}`, 'red'));
        console.error(error.stack);
        process.exit(1);
    }
}

main();
