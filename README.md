# TCP转发服务器

一个功能强大、安全可靠的TCP端口转发服务器，支持多端口映射、WebUI管理界面和实时连接监控。

## 功能特性

### 核心功能
- **TCP协议端口转发** - 将TCP请求转发到后端服务器
- **多端口映射配置** - 同时支持多个端口转发规则
- **动态配置管理** - 通过WebUI实时添加/删除/启动/停止端口映射
- **连接监控** - 实时显示每个映射的连接数和流量统计

### WebUI管理界面
- 现代化响应式Web界面
- 实时系统状态监控（映射数、连接数、运行时间）
- 每个端口映射的连接数和流量统计
- 映射的启动/停止控制

### 安全特性
- 强密码策略（8字符+大小写+数字）
- 登录失败保护（5次失败锁定30分钟）
- 会话管理（24小时自动超时）
- bcrypt 12轮密码哈希加密
- 自动生成的Session Secret

## 快速开始

### 安装
```bash
# 安装依赖
npm install

# 设置管理员密码
npm run setup-password

# 启动服务器
npm start
```

### 访问
启动后访问 **http://localhost:9999** 进入管理界面。

## 配置说明

编辑 `config.json` 配置端口映射：

```json
{
  "mappings": [
    {
      "name": "服务名称",
      "listen": { "host": "0.0.0.0", "port": 8080 },
      "target": { "host": "192.168.1.100", "port": 3000 }
    }
  ],
  "webui": { "enabled": true, "port": 9999, "host": "0.0.0.0" },
  "logging": { "enabled": true, "level": "info" }
}
```

## 项目结构

```
├── server.js           # 主服务器
├── config.json         # 端口映射配置
├── auth-config.json    # 认证配置（敏感）
├── setup-password.js   # 密码设置工具
├── package.json        # 项目配置
├── .gitignore          # Git忽略规则
├── public/             # Web界面
│   ├── login.html      # 登录页面
│   └── dashboard.html  # 管理面板
└── docs/               # 文档目录
    ├── API.md          # API接口文档
    ├── 功能总结.md      # 功能清单
    └── 安全配置说明.md  # 安全指南
```

## API接口

详细API文档请参阅 [docs/API.md](docs/API.md)

主要接口：
- `GET /api/health` - 健康检查（无需认证）
- `POST /api/login` - 登录
- `GET /api/mappings` - 获取映射列表（含连接数统计）
- `POST /api/mappings` - 添加映射
- `PUT /api/mappings/:id` - 更新映射
- `DELETE /api/mappings/:id` - 删除映射
- `POST /api/mappings/:id/start` - 启动映射
- `POST /api/mappings/:id/stop` - 停止映射
- `GET /api/connections` - 获取连接状态
- `GET /api/status` - 获取系统状态

## 技术栈

- **后端**: Node.js, Express.js, bcryptjs
- **前端**: 原生HTML/CSS/JavaScript
- **安全**: bcrypt密码哈希, Session管理

## 许可证

MIT License 