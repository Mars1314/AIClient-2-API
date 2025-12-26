@echo off
chcp 65001 >nul
echo 🧹 清理 Kiro 配置...
echo.

node scripts/clean-kiro-configs.js

echo.
pause
