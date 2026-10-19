# TcpMapping

TCP port forwarding server with WebUI management and real-time connection monitoring.

TCP端口转发服务器，支持WebUI管理界面和实时连接监控。

---

## Features | 功能特性

- **TCP Port Forwarding** - Forward TCP traffic to backend servers | TCP端口转发
- **Multiple Mappings** - Manage multiple forwarding rules simultaneously | 多端口映射
- **WebUI Management** - Add, edit, start, stop and delete mappings in real time | WebUI管理界面
- **Bilingual & Themes** - Simplified Chinese / English UI, dark and light themes | 中英文界面与深色模式
- **Connection Monitoring** - Live connection details, per-mapping cumulative traffic and a searchable history of closed connections | 实时连接、累计流量与已关闭连接记录
- **Service Resources** - Live CPU, memory and traffic usage of the forwarding process itself | 服务进程自身的 CPU、内存与实时流量
- **Robust Forwarding** - Backpressure handling, TCP half-close support and idle timeouts | 背压控制、半关闭与空闲超时
- **Secure by Default** - bcrypt hashing, login lockout, session hardening, no default password | 默认安全

---

## Installation | 安装

### NPM Global Install (Recommended) | NPM全局安装（推荐）

```bash
npm install -g @chenpu17/tcpmapping

tcpmapping setup-password   # Set admin password | 设置管理员密码
tcpmapping init             # Create config file | 创建配置文件
tcpmapping start            # Start server | 启动服务
```

### Local Install | 本地安装

```bash
git clone https://github.com/chenpu17/TcpMapping.git
cd TcpMapping
npm install
npm run setup-password
npm start
```

---

## CLI Commands | CLI命令

| Command | Description |
|---------|-------------|
| `tcpmapping start` | Start server in background | 后台启动服务 |
| `tcpmapping stop` | Stop server | 停止服务 |
| `tcpmapping restart` | Restart server | 重启服务 |
| `tcpmapping status` | Show status and config paths | 查看状态和配置路径 |
| `tcpmapping logs` | Show recent logs | 查看最近日志 |
| `tcpmapping logs -f` | Follow logs in real-time | 实时跟踪日志 |
| `tcpmapping setup-password` | Set admin password | 设置管理员密码 |
| `tcpmapping init` | Create config file | 创建配置文件 |

---

## WebUI

After starting, visit **http://localhost:9999**

启动后访问 **http://localhost:9999**

Default username | 默认用户名: `admin`

> For security, the WebUI listens on `127.0.0.1` by default. To access it from another machine, set `webui.host` to `0.0.0.0` in `config.json` and restrict access with a firewall.
>
> 出于安全考虑，WebUI 默认只监听 `127.0.0.1`。如需远程访问，请将 `config.json` 中的 `webui.host` 改为 `0.0.0.0`，并通过防火墙限制访问来源。

---

## Configuration | 配置

Config file location (priority order) | 配置文件位置（优先级）:
1. `./config.json` - Current directory | 当前目录
2. `~/.tcpmapping/config.json` - User data directory | 用户数据目录

### Example | 示例

```json
{
  "mappings": [
    {
      "name": "web-server",
      "listen": { "host": "0.0.0.0", "port": 8080 },
      "target": { "host": "192.168.1.100", "port": 3000 }
    },
    {
      "name": "database",
      "listen": { "host": "127.0.0.1", "port": 3307 },
      "target": { "host": "db.example.com", "port": 3306 }
    }
  ],
  "webui": { "enabled": true, "host": "127.0.0.1", "port": 9999 },
  "logging": { "enabled": true, "level": "info" },
  "timeouts": { "connect": 30000, "idle": 300000 }
}
```

For remote WebUI access, set `webui.host` to `"0.0.0.0"` and protect the port with a firewall.

如需远程访问 WebUI，请将 `webui.host` 设为 `"0.0.0.0"`，并使用防火墙保护该端口。

### Config Options | 配置项

| Option | Description |
|--------|-------------|
| `mappings[].name` | Mapping name | 映射名称 |
| `mappings[].listen.host` | Listen address (0.0.0.0 for all) | 监听地址 |
| `mappings[].listen.port` | Listen port | 监听端口 |
| `mappings[].target.host` | Target host IP or domain | 目标主机 |
| `mappings[].target.port` | Target port | 目标端口 |
| `webui.enabled` | Enable the WebUI (default: true) | 是否启用 WebUI |
| `webui.host` | WebUI bind address (default: 127.0.0.1) | WebUI监听地址 |
| `webui.port` | WebUI port (default: 9999) | WebUI端口 |
| `logging.enabled` | Enable logging (default: true) | 是否输出日志 |
| `logging.level` | Log level: debug/info/warn/error | 日志级别 |
| `timeouts.connect` | Target connect timeout in ms (default: 30000) | 连接超时（毫秒） |
| `timeouts.idle` | Idle timeout in ms, 0 disables (default: 300000) | 空闲超时（毫秒，0为禁用） |

### Environment Variables | 环境变量

| Variable | Description |
|----------|-------------|
| `TCPMAPPING_DATA_DIR` | Override the data directory | 覆盖数据目录 |
| `WEBUI_PORT` | Override the WebUI port | 覆盖WebUI端口 |
| `WEBUI_HOST` | Override the WebUI bind address | 覆盖WebUI监听地址 |
| `SESSION_SECRET` | Override the session secret | 覆盖会话密钥 |

---

## Data Persistence | 数据持久化

User configuration is stored in `~/.tcpmapping/`:

用户配置存储在 `~/.tcpmapping/` 目录：

- `config.json` - Port mapping configuration | 端口映射配置
- `auth-config.json` - Authentication configuration | 认证配置
- `.session-secret` - Session signing secret (0600) | 会话签名密钥（0600）
- `tcpmapping.log` - Log file | 日志文件
- `tcpmapping.pid` - PID file | PID文件

**Upgrading will NOT overwrite your configuration.**

**升级不会覆盖你的配置文件。**

---

## Security | 安全特性

- **No Default Password** - The WebUI will not start until `setup-password` is run | 无默认密码
- **Strong Password Policy** - Length, character classes and expiry are configurable | 可配置的强密码策略
- **Login Protection** - Lock after 5 failed attempts for 30 minutes | 登录保护
- **Session Hardening** - Session ID regeneration on login, HttpOnly + SameSite cookies | 会话加固
- **CSRF Protection** - Cross-origin state-changing requests are rejected | 跨站请求防护
- **Security Headers** - CSP, X-Frame-Options, nosniff and no-store API responses | 安全响应头
- **Localhost by Default** - The WebUI listens on 127.0.0.1 unless configured otherwise | 默认仅本机访问
- **Atomic Config Writes** - Configuration files are written atomically | 配置原子写入
- **Password Encryption** - bcrypt hashing | bcrypt加密

---

## API

See [docs/API.md](docs/API.md) for API documentation.

详细API文档请参阅 [docs/API.md](docs/API.md)

### Quick Reference | 快速参考

```bash
# Health check (no auth) | 健康检查
curl http://localhost:9999/api/health

# Login | 登录
curl -X POST http://localhost:9999/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourPassword"}' \
  -c cookies.txt

# Get mappings | 获取映射列表
curl http://localhost:9999/api/mappings -b cookies.txt
```

---

## FAQ | 常见问题

### Forgot password? | 忘记密码？

```bash
tcpmapping setup-password
# or | 或
npm run reset-password
```

### Check if running? | 检查运行状态？

```bash
tcpmapping status
```

### Port already in use? | 端口被占用？

Edit `webui.port` or `mappings[].listen.port` in config.json.

修改 config.json 中的 `webui.port` 或 `mappings[].listen.port`。

---

## Development | 开发

Run the smoke test (starts an isolated server, verifies login, CRUD, TCP forwarding and statistics):

运行冒烟测试（启动独立实例，验证登录、映射增删改、TCP 转发与统计）：

```bash
npm install
npm test
```

---

## Changelog | 更新日志

See [CHANGELOG.md](CHANGELOG.md) for details.

详见 [CHANGELOG.md](CHANGELOG.md)。

---

## License | 许可证

MIT License
