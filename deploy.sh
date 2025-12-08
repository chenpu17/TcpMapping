#!/bin/bash

# TCP转发服务器自动部署脚本
# 
# 使用方法:
#   chmod +x deploy.sh
#   ./deploy.sh

set -e

echo "======================================"
echo "TCP转发服务器 - 自动部署脚本"
echo "======================================"
echo ""

# 检查Node.js环境
echo "🔍 检查运行环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到Node.js，请先安装Node.js (版本 >= 14.0.0)"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2)
echo "✅ Node.js版本: $NODE_VERSION"

# 检查npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到npm包管理器"
    exit 1
fi

echo "✅ npm可用"
echo ""

# 安装依赖
echo "📦 安装依赖包..."
npm install
echo "✅ 依赖安装完成"
echo ""

# 检查是否已存在认证配置
if [ -f "auth-config.json" ]; then
    echo "🔐 发现现有的认证配置文件"
    read -p "是否要重新设置密码？(y/N): " reset_password
    if [[ $reset_password =~ ^[Yy]$ ]]; then
        echo "重新设置密码..."
        npm run setup-password
    else
        echo "使用现有密码配置"
    fi
else
    echo "🔐 首次部署，需要设置管理员密码"
    echo "密码要求："
    echo "  - 最少8个字符"
    echo "  - 包含大写字母、小写字母和数字"
    echo ""
    npm run setup-password
fi

echo ""

# 检查端口占用
echo "🔍 检查端口占用情况..."

# 检查WebUI端口
WEBUI_PORT=9999
if netstat -an 2>/dev/null | grep ":$WEBUI_PORT " > /dev/null; then
    echo "⚠️  警告: WebUI端口 $WEBUI_PORT 已被占用"
    echo "   请检查是否有其他实例正在运行"
fi

# 检查配置文件中的端口
if [ -f "config.json" ]; then
    echo "✅ 发现现有配置文件"
    # 这里可以添加更详细的端口检查逻辑
else
    echo "⚠️  未找到config.json，将使用默认配置"
fi

echo ""

# 设置文件权限
echo "🔒 设置文件权限..."
if [ -f "auth-config.json" ]; then
    chmod 600 auth-config.json
    echo "✅ 认证配置文件权限已设置为 600"
fi

# 询问是否立即启动服务
echo "🚀 准备启动服务器..."
read -p "是否现在启动TCP转发服务器？(Y/n): " start_server

if [[ ! $start_server =~ ^[Nn]$ ]]; then
    echo ""
    echo "启动服务器..."
    echo "======================================"
    echo "服务器信息:"
    echo "  - WebUI管理界面: http://localhost:9999"
    echo "  - 按 Ctrl+C 停止服务器"
    echo "======================================"
    echo ""
    
    # 启动服务器
    npm start
else
    echo ""
    echo "✅ 部署完成！"
    echo ""
    echo "手动启动命令:"
    echo "  npm start                # 启动完整版服务器（推荐）"
    echo "  npm run old             # 启动基础版服务器"
    echo "  npm run setup-password  # 重新设置密码"
    echo ""
    echo "WebUI管理界面: http://localhost:9999"
    echo ""
    echo "详细文档:"
    echo "  README.md              # 基本使用说明"
    echo "  安全配置说明.md        # 安全配置指南"
    echo ""
fi