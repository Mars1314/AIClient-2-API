/**
 * 诊断脚本：检查部署后的代码是否包含最新修改
 * 用于排查封禁检测不生效的问题
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('='.repeat(80));
console.log('🔍 诊断部署后的代码');
console.log('='.repeat(80));

const checks = [];

// 1. 检查 forceRefreshToken 方法是否存在
console.log('\n📋 检查 1: forceRefreshToken 方法是否存在');
const kiroFilePath = path.join(__dirname, 'src/claude/claude-kiro.js');
try {
    const kiroContent = fs.readFileSync(kiroFilePath, 'utf8');
    const hasForceRefresh = kiroContent.includes('async forceRefreshToken()');

    if (hasForceRefresh) {
        console.log('✅ forceRefreshToken 方法存在');
        checks.push({ name: 'forceRefreshToken 方法', status: 'PASS' });
    } else {
        console.log('❌ forceRefreshToken 方法不存在');
        console.log('   可能原因: 代码没有正确部署或被覆盖');
        checks.push({ name: 'forceRefreshToken 方法', status: 'FAIL' });
    }
} catch (error) {
    console.log(`❌ 无法读取文件: ${error.message}`);
    checks.push({ name: 'forceRefreshToken 方法', status: 'ERROR' });
}

// 2. 检查 _doTokenRefresh 错误处理是否包含封禁检测
console.log('\n📋 检查 2: _doTokenRefresh 封禁检测逻辑');
try {
    const kiroContent = fs.readFileSync(kiroFilePath, 'utf8');
    const hasBannedDetection = kiroContent.includes('errorType = \'BANNED\'') &&
                               kiroContent.includes('TemporarilySuspended');

    if (hasBannedDetection) {
        console.log('✅ _doTokenRefresh 包含封禁检测逻辑');
        checks.push({ name: '_doTokenRefresh 封禁检测', status: 'PASS' });
    } else {
        console.log('❌ _doTokenRefresh 缺少封禁检测逻辑');
        console.log('   可能原因: 错误处理代码没有更新');
        checks.push({ name: '_doTokenRefresh 封禁检测', status: 'FAIL' });
    }
} catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
    checks.push({ name: '_doTokenRefresh 封禁检测', status: 'ERROR' });
}

// 3. 检查 getUsageLimits 错误处理
console.log('\n📋 检查 3: getUsageLimits 封禁检测逻辑');
try {
    const kiroContent = fs.readFileSync(kiroFilePath, 'utf8');
    const hasGetUsageCheck = kiroContent.includes('if (refreshError.message.includes(\'BANNED:\')') ||
                            kiroContent.includes('BANNED: Account suspended');

    if (hasGetUsageCheck) {
        console.log('✅ getUsageLimits 包含封禁检测逻辑');
        checks.push({ name: 'getUsageLimits 封禁检测', status: 'PASS' });
    } else {
        console.log('❌ getUsageLimits 缺少封禁检测逻辑');
        checks.push({ name: 'getUsageLimits 封禁检测', status: 'FAIL' });
    }
} catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
    checks.push({ name: 'getUsageLimits 封禁检测', status: 'ERROR' });
}

// 4. 检查 provider-pool-manager.js 的改进
console.log('\n📋 检查 4: provider-pool-manager.js 封禁检测逻辑');
const poolManagerPath = path.join(__dirname, 'src/provider-pool-manager.js');
try {
    const poolContent = fs.readFileSync(poolManagerPath, 'utf8');
    const hasImmediateReturn = poolContent.includes('isBannedError') &&
                               poolContent.includes('success: false') &&
                               poolContent.includes('isBanned: true');

    if (hasImmediateReturn) {
        console.log('✅ provider-pool-manager 包含立即返回逻辑');
        checks.push({ name: 'provider-pool-manager 立即返回', status: 'PASS' });
    } else {
        console.log('❌ provider-pool-manager 缺少立即返回逻辑');
        console.log('   可能原因: 仍然使用旧的 "继续尝试获取配额" 逻辑');
        checks.push({ name: 'provider-pool-manager 立即返回', status: 'FAIL' });
    }
} catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
    checks.push({ name: 'provider-pool-manager 立即返回', status: 'ERROR' });
}

// 5. 检查是否有缓存的服务实例
console.log('\n📋 检查 5: 服务实例缓存清理');
try {
    const poolContent = fs.readFileSync(poolManagerPath, 'utf8');
    const hasClearCache = poolContent.includes('clearServiceInstance(providerType, providerConfig.uuid)');

    if (hasClearCache) {
        console.log('✅ 健康检查时会清除缓存实例');
        checks.push({ name: '缓存清理', status: 'PASS' });
    } else {
        console.log('⚠️  没有清除缓存，可能使用旧的实例');
        checks.push({ name: '缓存清理', status: 'WARN' });
    }
} catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
    checks.push({ name: '缓存清理', status: 'ERROR' });
}

// 总结
console.log('\n' + '='.repeat(80));
console.log('📊 检查结果汇总');
console.log('='.repeat(80));

const passed = checks.filter(c => c.status === 'PASS').length;
const failed = checks.filter(c => c.status === 'FAIL').length;
const errors = checks.filter(c => c.status === 'ERROR').length;
const warnings = checks.filter(c => c.status === 'WARN').length;

console.log(`\n✅ 通过: ${passed}`);
console.log(`❌ 失败: ${failed}`);
console.log(`⚠️  警告: ${warnings}`);
console.log(`💥 错误: ${errors}`);

console.log('\n📋 详细结果:');
checks.forEach((check, index) => {
    const icon = check.status === 'PASS' ? '✅' :
                 check.status === 'FAIL' ? '❌' :
                 check.status === 'WARN' ? '⚠️' : '💥';
    console.log(`${index + 1}. ${icon} ${check.name}: ${check.status}`);
});

// 提供诊断建议
console.log('\n' + '='.repeat(80));
console.log('💡 诊断建议');
console.log('='.repeat(80));

if (failed > 0 || errors > 0) {
    console.log('\n❌ 发现问题，可能的原因：');
    console.log('   1. 代码没有正确部署到生产环境');
    console.log('   2. 修改的文件被旧版本覆盖');
    console.log('   3. Node.js 进程没有重启，仍在运行旧代码');
    console.log('   4. 使用了不同的代码分支');

    console.log('\n🔧 建议的修复步骤：');
    console.log('   1. 确认当前目录是否正确');
    console.log('   2. 重新执行代码修改（复制粘贴完整的修改）');
    console.log('   3. 重启 Node.js 服务');
    console.log('   4. 清除浏览器缓存并刷新页面');
    console.log('   5. 检查 git 状态: git status');
} else if (warnings > 0) {
    console.log('\n⚠️  代码看起来正常，但有一些警告');
    console.log('\n🔧 建议检查：');
    console.log('   1. 重启 Node.js 服务以确保使用最新代码');
    console.log('   2. 查看实际运行日志，确认是否调用了新方法');
    console.log('   3. 使用封禁账号测试，观察控制台输出');
} else {
    console.log('\n✅ 所有检查通过，代码部署正确！');
    console.log('\n🔧 如果仍然不生效，请检查：');
    console.log('   1. Node.js 进程是否已重启');
    console.log('   2. 浏览器是否使用了缓存的旧代码（强制刷新 Ctrl+Shift+R）');
    console.log('   3. 实际运行时的日志输出');
}

console.log('\n' + '='.repeat(80));
console.log('🔍 下一步诊断步骤');
console.log('='.repeat(80));

console.log('\n1️⃣ 查看实时日志:');
console.log('   npm start 时观察控制台输出');
console.log('   点击检测时应该看到:');
console.log('   - [Kiro] Force refreshing token for health check...');
console.log('   - [ProviderPoolManager] 🚫 Account is BANNED (如果是封禁账号)');

console.log('\n2️⃣ 检查 Node.js 进程:');
console.log('   ps aux | grep node');
console.log('   确认运行的是最新代码的进程');

console.log('\n3️⃣ 手动测试:');
console.log('   node test-ban-detection.js');
console.log('   node test-improved-health-check.js');

console.log('\n4️⃣ 检查部署环境:');
console.log('   确认生产环境和开发环境使用相同的代码');
console.log('   检查是否有多个代码目录');

console.log('\n' + '='.repeat(80));
console.log('诊断脚本执行完成');
console.log('='.repeat(80));
