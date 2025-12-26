#!/usr/bin/env node
/**
 * Kiro Token 批量转换工具
 * 
 * 功能：将包含多个 Kiro token 的 JSON 数组文件转换为：
 * 1. 每个 token 生成独立的凭据文件 (configs/kiro/kiro-{email}.json)
 * 2. 生成 provider_pools.json 配置
 * 
 * 使用方法：
 *   node scripts/generate-kiro-pools.js <输入文件路径> [输出目录]
 * 
 * 示例：
 *   node scripts/generate-kiro-pools.js tokens.json
 *   node scripts/generate-kiro-pools.js tokens.json ./my-configs
 */

import * as fs from 'fs';
import * as path from 'path';

// 默认配置
const DEFAULT_OUTPUT_DIR = './configs/kiro';
const DEFAULT_REGION = 'us-east-1';

/**
 * 从输入的 token 对象中提取 Kiro 需要的字段
 */
function extractKiroCredentials(token) {
    return {
        // 核心认证字段
        refreshToken: token.refreshToken,
        accessToken: token.accessToken || null,
        
        // 认证方式
        authMethod: token.authMethod || 'social',
        region: DEFAULT_REGION,
        
        // 可选字段
        profileArn: token.profileArn || null,
        expiresAt: token.expiresAt || null,
        
        // 元数据（用于备注）
        _meta: {
            email: token.email,
            provider: token.provider,
            addedAt: token.addedAt,
            originalId: token.id
        }
    };
}

/**
 * 生成安全的文件名（从 email 提取）
 */
function generateSafeFilename(email, index) {
    if (!email) {
        return `kiro-${index + 1}`;
    }
    // 提取 @ 前面的部分，移除特殊字符
    const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '-');
    return `kiro-${username}`;
}

/**
 * 生成 provider pool 条目
 */
function generatePoolEntry(credFilePath, token, index) {
    const email = token.email || `unknown-${index + 1}`;
    return {
        // 凭据文件路径
        KIRO_OAUTH_CREDS_FILE_PATH: credFilePath,
        
        // 使用原始 id 作为 uuid，保持一致性
        uuid: token.id || `kiro-${Date.now()}-${index}`,
        
        // 备注信息（方便识别和删除）
        _comment: `Email: ${email} | Added: ${token.addedAt || 'unknown'}`,
        
        // 健康检查配置
        checkModelName: 'claude-haiku-4-5',
        checkHealth: true,
        
        // 状态字段
        isHealthy: true,
        isDisabled: false,
        lastUsed: null,
        usageCount: 0,
        errorCount: 0,
        lastErrorTime: null,
        lastHealthCheckTime: null,
        lastHealthCheckModel: null,
        lastErrorMessage: null
    };
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
Kiro Token 批量转换工具

使用方法：
  node scripts/generate-kiro-pools.js <输入文件路径> [输出目录]

示例：
  node scripts/generate-kiro-pools.js tokens.json
  node scripts/generate-kiro-pools.js tokens.json ./my-configs

输入文件格式：JSON 数组，每个元素包含 refreshToken, email 等字段
        `);
        process.exit(1);
    }

    const inputFile = args[0];
    const outputDir = args[1] || DEFAULT_OUTPUT_DIR;

    // 检查输入文件
    if (!fs.existsSync(inputFile)) {
        console.error(`错误：输入文件不存在: ${inputFile}`);
        process.exit(1);
    }

    // 读取输入文件
    let tokens;
    try {
        const content = fs.readFileSync(inputFile, 'utf8');
        tokens = JSON.parse(content);
        
        if (!Array.isArray(tokens)) {
            console.error('错误：输入文件必须是 JSON 数组格式');
            process.exit(1);
        }
    } catch (error) {
        console.error(`错误：无法解析输入文件: ${error.message}`);
        process.exit(1);
    }

    console.log(`\n📦 找到 ${tokens.length} 个 token\n`);

    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`📁 创建目录: ${outputDir}`);
    }

    const poolEntries = [];
    const createdFiles = [];

    // 处理每个 token
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        // 验证必需字段
        if (!token.refreshToken) {
            console.warn(`⚠️  跳过第 ${i + 1} 个 token: 缺少 refreshToken`);
            continue;
        }

        // 生成文件名
        const filename = generateSafeFilename(token.email, i);
        const credFilePath = path.join(outputDir, `${filename}.json`);
        
        // 提取凭据
        const credentials = extractKiroCredentials(token);
        
        // 写入凭据文件（带备注）
        const credFileContent = {
            // 备注信息（放在最前面方便查看）
            _comment: `Email: ${token.email || 'unknown'} | Provider: ${token.provider || 'unknown'} | Added: ${token.addedAt || 'unknown'}`,
            _originalId: token.id,
            
            // 实际凭据
            refreshToken: credentials.refreshToken,
            accessToken: credentials.accessToken,
            authMethod: credentials.authMethod,
            region: credentials.region,
            profileArn: credentials.profileArn,
            expiresAt: credentials.expiresAt
        };

        fs.writeFileSync(credFilePath, JSON.stringify(credFileContent, null, 2), 'utf8');
        createdFiles.push(credFilePath);
        
        // 生成 pool 条目
        const poolEntry = generatePoolEntry(credFilePath, token, i);
        poolEntries.push(poolEntry);

        console.log(`✅ [${i + 1}/${tokens.length}] ${token.email || 'unknown'} -> ${credFilePath}`);
    }

    // 生成 provider_pools.json
    const poolsFilePath = path.join(outputDir, 'provider_pools_kiro.json');
    const poolsContent = {
        "claude-kiro-oauth": poolEntries
    };

    fs.writeFileSync(poolsFilePath, JSON.stringify(poolsContent, null, 2), 'utf8');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`\n✨ 转换完成！\n`);
    console.log(`📄 生成了 ${createdFiles.length} 个凭据文件`);
    console.log(`📋 Provider Pools 配置: ${poolsFilePath}`);
    console.log(`\n使用方法：`);
    console.log(`  1. 将 ${poolsFilePath} 的内容合并到项目根目录的 provider_pools.json`);
    console.log(`  2. 或者直接复制整个文件并重命名为 provider_pools.json`);
    console.log(`\n启动命令：`);
    console.log(`  node src/api-server.js --model-provider claude-kiro-oauth --provider-pools-file provider_pools.json`);
    console.log('');
}

main().catch(console.error);
