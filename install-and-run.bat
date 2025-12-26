@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 默认端口
set SERVER_PORT=3000
set HOST=localhost

:: 从config.json读取端口配置
if exist "config.json" (
    for /f "tokens=2 delims=:," %%a in ('findstr /i "SERVER_PORT" config.json') do (
        set "PORT_TMP=%%a"
        set "PORT_TMP=!PORT_TMP: =!"
        if defined PORT_TMP set SERVER_PORT=!PORT_TMP!
    )
    for /f "tokens=2 delims=:," %%a in ('findstr /i "\"HOST\"" config.json') do (
        set "HOST_TMP=%%a"
        set "HOST_TMP=!HOST_TMP: =!"
        set "HOST_TMP=!HOST_TMP:"=!"
        if defined HOST_TMP if not "!HOST_TMP!"=="null" set HOST=!HOST_TMP!
    )
)

:: 设置窗口标题（包含端口）
title AI Client 2 API Server [Port: !SERVER_PORT!] - 请勿关闭！

echo ========================================
echo   AI Client 2 API 快速安装启动脚本
echo   端口: !SERVER_PORT!
echo   ⚠️  请勿关闭此窗口，关闭后服务将停止！
echo ========================================
echo.

:: 检查Node.js是否已安装
echo [检查] 正在检查Node.js是否已安装...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：未检测到Node.js，请先安装Node.js
    echo 📥 下载地址：https://nodejs.org/
    echo 💡 推荐安装LTS版本
    pause
    exit /b 1
)

:: 获取Node.js版本
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js已安装，版本: !NODE_VERSION!

:: 检查package.json是否存在
if not exist "package.json" (
    echo ❌ 错误：未找到package.json文件
    echo 请确保在项目根目录下运行此脚本
    pause
    exit /b 1
)

echo ✅ 找到package.json文件

:: 检查node_modules目录是否存在
if not exist "node_modules" (
    echo [安装] node_modules目录不存在，正在安装依赖...
    echo 这可能需要几分钟时间，请耐心等待...
    echo 正在执行: npm install...
    :: 使用npm install并设置超时机制
    npm install --timeout=300000
    if !errorlevel! neq 0 (
        echo ❌ 依赖安装失败
        echo 请检查网络连接或手动运行 'npm install'
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成
) else (
    echo ✅ node_modules目录已存在
)

:: 检查package-lock.json是否存在
if not exist "package-lock.json" (
    echo [更新] package-lock.json不存在，正在更新依赖...
    echo 正在执行: npm install...
    :: 使用npm install并设置超时机制
    npm install --timeout=300000
    if !errorlevel! neq 0 (
        echo ❌ 依赖更新失败
        echo 请检查网络连接或手动运行 'npm install'
        pause
        exit /b 1
    )
    echo ✅ 依赖更新完成
) else (
    echo ✅ package-lock.json文件存在
)

:: 检查src目录和api-server.js是否存在
if not exist "src\api-server.js" (
    echo ❌ 错误：未找到src\api-server.js文件
    pause
    exit /b 1
)

echo ✅ 项目文件检查完成

:: 启动应用程序
echo.
echo ========================================
echo   启动AI Client 2 API服务器...
echo ========================================
echo.
echo 🌐 服务器将在 http://!HOST!:!SERVER_PORT! 启动
echo 📖 访问 http://!HOST!:!SERVER_PORT! 查看管理界面
echo.
echo ╔══════════════════════════════════════╗
echo ║  ⚠️  警告：请勿关闭此窗口！          ║
echo ║  关闭窗口将导致API服务停止运行       ║
echo ║  按 Ctrl+C 可安全停止服务器          ║
echo ╚══════════════════════════════════════╝
echo.

:: 启动服务器
node src\api-server.js