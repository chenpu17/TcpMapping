# TcpMapping

TCP端口转发服务器，支持多端口映射、WebUI管理界面和实时连接监控。

## 功能特性

- **TCP端口转发** - 将TCP流量转发到后端服务器
- **多端口映射** - 同时管理多个转发规则
- **WebUI管理** - 现代化Web界面，实时监控和管理
- **连接监控** - 实时显示每个映射的连接数和流量统计
- **安全认证** - bcrypt密码加密、登录失败保护、会话管理

## 安装方式

### 方式一：NPM全局安装（推荐）

```bash
# 全局安装
npm install -g @chenpu17/tcpmapping

# 初始化配置文件
tcpmapping init

# 设置管理员密码
tcpmapping setup-password

# 启动服务
tcpmapping start
```

### 方式二：本地安装

```bash
# 克隆项目
git clone https://github.com/chenpu17/TcpMapping.git
cd TcpMapping

# 安装依赖
npm install

# 设置管理员密码
npm run setup-password

# 启动服务器
npm start
```

## CLI命令

全局安装后，可使用以下命令：

| 命令 | 说明 |
|------|------|
| `tcpmapping start` | 后台启动服务 |
| `tcpmapping stop` | 停止服务 |
| `tcpmapping restart` | 重启服务 |
| `tcpmapping status` | 查看服务状态 |
| `tcpmapping logs` | 查看最近日志 |
| `tcpmapping logs -f` | 实时跟踪日志 |
| `tcpmapping setup-password` | 设置管理员密码 |
| `tcpmapping init` | 创建默认配置文件 |
| `tcpmapping version` | 显示版本号 |
| `tcpmapping help` | 显示帮助信息 |

## 访问WebUI

启动服务后，访问 **http://localhost:9999** 进入管理界面。

默认用户名：`admin`

## 配置说明

编辑 `config.json` 配置端口映射：

```json
{
  "mappings": [
    {
      "name": "Web服务",
      "listen": { "host": "0.0.0.0", "port": 8080 },
      "target": { "host": "192.168.1.100", "port": 3000 }
    },
    {
      "name": "数据库",
      "listen": { "host": "0.0.0.0", "port": 3307 },
      "target": { "host": "192.168.1.100", "port": 3306 }
    }
  ],
  "webui": {
    "enabled": true,
    "port": 9999,
    "host": "0.0.0.0"
  },
  "logging": {
    "enabled": true,
    "level": "info"
  }
}
```

### 配置项说明

| 配置项 | 说明 |
|--------|------|
| `mappings[].name` | 映射名称，用于标识 |
| `mappings[].listen.host` | 监听地址，0.0.0.0表示所有网卡 |
| `mappings[].listen.port` | 监听端口 |
| `mappings[].target.host` | 目标主机IP或域名 |
| `mappings[].target.port` | 目标端口 |
| `webui.enabled` | 是否启用WebUI |
| `webui.port` | WebUI端口，默认9999 |
| `logging.level` | 日志级别：debug/info/warn/error |

## 使用示例

### 示例1：转发本地开发服务

将本地8080端口转发到开发服务器的3000端口：

```json
{
  "name": "开发服务",
  "listen": { "host": "0.0.0.0", "port": 8080 },
  "target": { "host": "127.0.0.1", "port": 3000 }
}
```

### 示例2：转发远程数据库

将本地3307端口转发到远程MySQL：

```json
{
  "name": "MySQL",
  "listen": { "host": "127.0.0.1", "port": 3307 },
  "target": { "host": "db.example.com", "port": 3306 }
}
```

### 示例3：通过WebUI动态添加

1. 访问 http://localhost:9999
2. 登录管理界面
3. 点击"添加映射"按钮
4. 填写映射信息并保存

## 安全特性

- **强密码策略** - 8字符以上，包含大小写字母和数字
- **登录保护** - 5次失败后锁定30分钟
- **会话超时** - 24小时自动过期
- **密码加密** - bcrypt 12轮哈希

## API接口

详细API文档请参阅 [docs/API.md](docs/API.md)

### 快速参考

```bash
# 健康检查（无需认证）
curl http://localhost:9999/api/health

# 登录
curl -X POST http://localhost:9999/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourPassword"}' \
  -c cookies.txt

# 获取映射列表
curl http://localhost:9999/api/mappings -b cookies.txt

# 添加映射
curl -X POST http://localhost:9999/api/mappings \
  -H "Content-Type: application/json" \
  -d '{"name":"测试","listen":{"port":8888},"target":{"host":"127.0.0.1","port":80}}' \
  -b cookies.txt
```

## 项目结构

```
├── bin/
│   └── tcpmapping.js    # CLI入口
├── public/
│   ├── login.html       # 登录页面
│   └── dashboard.html   # 管理面板
├── docs/
│   └── API.md           # API文档
├── server.js            # 主服务器
├── setup-password.js    # 密码设置工具
├── config.json          # 端口映射配置
└── package.json         # 项目配置
```

## 常见问题

### Q: 忘记密码怎么办？

运行密码重置命令：
```bash
# NPM全局安装
tcpmapping setup-password

# 本地安装
npm run reset-password
```

### Q: 如何查看服务是否运行？

```bash
tcpmapping status
```

### Q: 端口被占用怎么办？

修改 `config.json` 中的 `webui.port` 或映射的 `listen.port`。

### Q: 如何查看实时日志？

```bash
tcpmapping logs -f
```

## 许可证

MIT License
