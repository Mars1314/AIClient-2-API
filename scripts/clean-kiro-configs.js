#!/usr/bin/env node
/**
 * 一键清理 Kiro 配置脚本
 * 清理 configs/kiro/ 目录下的所有凭据文件，并清空 provider_pools.json 中的 kiro 配置
 */

const fs = require('fs');
const path = require('path');

const KIRO_CONFIG_DIR = path.join(process.cwd(), 'configs', 'kiro');
const POOLS_FILE = path.join(process.cwd(), 'provider_pools.json');

console.log('🧹 开始清理 Kiro 配置...\n');

// 1. 清理 configs/kiro/ 目录
let deletedFiles = 0;
if (fs.existsSync(KIRO_CONFIG_DIR)) {
    const files = fs.readdirSync(KIRO_CONFIG_DIR);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const filePath = path.join(KIRO_CONFIG_DIR, file);
            fs.unlinkSync(filePath);
            console.log(`  ✓ 删除: ${file}`);
            deletedFiles++;
        }
    }
}
console.log(`\n📁 已删除 ${deletedFiles} 个凭据文件`);

// 2. 清空 provider_pools.json 中的 kiro 配置
let clearedPools = 0;
if (fs.existsSync(POOLS_FILE)) {
    try {
        const pools = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8'));
        if (pools['claude-kiro-oauth'] && pools['claude-kiro-oauth'].length > 0) {
            clearedPools = pools['claude-kiro-oauth'].length;
            pools['claude-kiro-oauth'] = [];
            fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2), 'utf8');
        }
    } catch (e) {
        console.error('❌ 解析 provider_pools.json 失败:', e.message);
    }
}
console.log(`📋 已清空 ${clearedPools} 个 Provider Pool 配置`);

console.log('\n✅ 清理完成！现在可以重新导入配置。');
