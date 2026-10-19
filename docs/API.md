# API 接口文档

## 概述

TCP转发服务器提供RESTful API接口，用于管理端口映射、监控连接状态和系统管理。

- **Base URL**: `http://localhost:9999`
- **认证方式**: Session Cookie
- **数据格式**: JSON
- **提示语言**: 可选请求头 `X-Language: zh-CN | en-US`，未提供时根据 `Accept-Language` 自动选择；影响响应中的 `message` 字段。

---

## 公开接口（无需认证）

### 健康检查

检查服务器运行状态，用于监控和负载均衡。

```
GET /api/health
```

**响应示例**:
```json
{
  "status": "ok",
  "version": "2.4.1",
  "timestamp": "2025-12-08T08:30:00.000Z",
  "uptime": 3600,
  "activeMappings": 3,
  "activeConnections": 5
}
```

---

## 认证接口

### 登录

```
POST /api/login
Content-Type: application/json
```

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

**请求示例**:
```json
{
  "username": "admin",
  "password": "YourPassword123"
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "登录成功"
}
```

**错误响应**:
- `401`: 用户名或密码错误
- `429`: 登录尝试次数过多，账户已锁定
- `503`: 服务器尚未配置管理员密码（请运行 `tcpmapping setup-password`）

> 登录成功后会重新生成 Session ID。所有写操作（POST/PUT/DELETE）如果携带 `Origin` 请求头，其 Host 必须与当前服务一致，否则返回 `403`。

### 登出

```
POST /api/logout
```

**响应示例**:
```json
{
  "success": true,
  "message": "已登出"
}
```

---

## 端口映射管理（需要认证）

### 获取映射列表

```
GET /api/mappings
```

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": "miww2f23ponqwz",
      "name": "Dify",
      "listen": {
        "host": "0.0.0.0",
        "port": 5588
      },
      "target": {
        "host": "113.45.34.202",
        "port": 5588
      },
      "status": "running",
      "connectionCount": 3,
      "bytesReceived": 102400,
      "bytesSent": 204800,
      "totalConnections": 42,
      "totalBytesReceived": 1048576,
      "totalBytesSent": 2097152
    }
  ]
}
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 映射唯一标识符 |
| name | string | 映射名称 |
| listen.host | string | 监听主机地址 |
| listen.port | number | 监听端口 |
| target.host | string | 目标主机地址 |
| target.port | number | 目标端口 |
| status | string | 状态: running / stopped |
| connectionCount | number | 当前活跃连接数 |
| bytesReceived | number | 当前活跃连接的上行流量（字节） |
| bytesSent | number | 当前活跃连接的下行流量（字节） |
| totalConnections | number | 累计连接数（服务启动以来） |
| totalBytesReceived | number | 累计上行流量（字节） |
| totalBytesSent | number | 累计下行流量（字节） |

> 累计统计保存在内存中，服务重启后归零。

### 添加映射

```
POST /api/mappings
Content-Type: application/json
```

**请求参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 映射名称 |
| listen.host | string | 否 | 监听地址，默认 0.0.0.0 |
| listen.port | number | 是 | 监听端口 (1-65535) |
| target.host | string | 是 | 目标主机地址 |
| target.port | number | 是 | 目标端口 (1-65535) |

**请求示例**:
```json
{
  "name": "Web服务",
  "listen": {
    "port": 8080
  },
  "target": {
    "host": "192.168.1.100",
    "port": 3000
  }
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "端口映射已启动",
  "data": {
    "id": "abc123xyz",
    "name": "Web服务",
    "listen": {
      "host": "0.0.0.0",
      "port": 8080
    },
    "target": {
      "host": "192.168.1.100",
      "port": 3000
    }
  }
}
```

**验证规则**:
- 映射名称不能为空，且不超过 100 个字符
- 端口必须在 1-65535 范围内
- 监听地址和目标主机必须是有效的 IP 地址或域名
- 监听地址 + 端口不能与已有映射重复
- 端口被占用时会返回 `400`，且不会写入配置

### 更新映射

```
PUT /api/mappings/:identifier
Content-Type: application/json
```

**路径参数**:
- `identifier`: 映射ID或索引

**请求示例**:
```json
{
  "name": "新名称",
  "target": {
    "host": "192.168.1.200",
    "port": 3001
  }
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "端口映射已更新",
  "data": {
    "id": "abc123xyz",
    "name": "新名称",
    "listen": {
      "host": "0.0.0.0",
      "port": 8080
    },
    "target": {
      "host": "192.168.1.200",
      "port": 3001
    }
  }
}
```

> 只更新请求中提供的字段。若映射原本处于停止状态，更新后仍保持停止。
> 仅修改名称或目标地址时不会重启监听，已有连接不受影响（新连接使用新目标）；修改监听地址或端口时会重新绑定，已有连接会被断开。

### 删除映射

```
DELETE /api/mappings/:identifier
```

**路径参数**:
- `identifier`: 映射ID或索引

**响应示例**:
```json
{
  "success": true,
  "message": "端口映射已删除"
}
```

### 启动映射

```
POST /api/mappings/:identifier/start
```

**响应示例**:
```json
{
  "success": true,
  "message": "端口映射已启动"
}
```

### 停止映射

```
POST /api/mappings/:identifier/stop
```

**响应示例**:
```json
{
  "success": true,
  "message": "端口映射已停止"
}
```

---

## 监控接口（需要认证）

### 获取连接状态

```
GET /api/connections
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total": 5,
    "byPort": [
      {
        "host": "0.0.0.0",
        "port": 5588,
        "mappingName": "Dify",
        "totalConnections": 3,
        "connections": [
          {
            "id": "conn123",
            "mappingName": "Dify",
            "sourceHost": "0.0.0.0",
            "sourcePort": 5588,
            "listenAddress": "192.168.1.5:5588",
            "clientAddress": "192.168.1.10:54321",
            "targetAddress": "113.45.34.202:5588",
            "startTime": "2025-12-08T08:00:00.000Z",
            "lastActivity": 1733648400000,
            "durationMs": 120000,
            "bytesReceived": 10240,
            "bytesSent": 20480,
            "status": "connected"
          }
        ]
      }
    ]
  }
}
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| listenAddress | string | 客户端实际连接到的本地地址（如配置为 `0.0.0.0`，这里显示真实网卡地址） |
| clientAddress | string | 客户端源地址（IP:端口） |
| targetAddress | string | 转发目的地址（IP:端口） |
| durationMs | number | 连接已持续时长（毫秒） |

### 获取最近连接记录

```
GET /api/connections/history?mappingId=<id>&limit=100
```

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mappingId | string | 否 | 只返回指定映射的记录 |
| limit | number | 否 | 返回条数，默认 50，最大 200 |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "total": 120,
    "limit": 100,
    "items": [
      {
        "id": "conn123",
        "mappingId": "abc123xyz",
        "mappingName": "Web服务",
        "listenAddress": "192.168.1.5:5588",
        "clientAddress": "192.168.1.10:54321",
        "targetAddress": "113.45.34.202:5588",
        "startTime": "2025-12-08T08:00:00.000Z",
        "endTime": "2025-12-08T08:02:00.000Z",
        "durationMs": 120000,
        "bytesReceived": 10240,
        "bytesSent": 20480,
        "status": "connected",
        "closeReason": "客户端关闭"
      }
    ]
  }
}
```

> 记录只在内存中保留最近 500 条已关闭连接，服务重启后清空；通过 CLI（`tcpmapping start`）启动时，连接关闭日志会同时写入日志文件。`status` 为 `connecting` 表示目标连接尚未建立即结束。

### 获取系统状态

```
GET /api/status
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "version": "2.4.1",
    "username": "admin",
    "totalMappings": 3,
    "activeMappings": 3,
    "totalConnections": 5,
    "uptime": 3600.5,
    "memoryUsage": {
      "rss": 51544064,
      "heapTotal": 10272768,
      "heapUsed": 8239376,
      "external": 2104438,
      "arrayBuffers": 18635
    },
    "resources": {
      "cpuPercent": 1.25,
      "cpuCount": 8,
      "memory": {
        "rss": 51544064,
        "heapTotal": 10272768,
        "heapUsed": 8239376,
        "external": 2104438,
        "arrayBuffers": 18635,
        "systemTotal": 17179869184,
        "systemFree": 4294967296
      },
      "traffic": {
        "receivedPerSecond": 20480,
        "sentPerSecond": 18240,
        "totalReceived": 104857600,
        "totalSent": 99614720
      },
      "sampledAt": "2025-12-08T08:30:00.000Z"
    }
  }
}
```

**`resources` 字段说明**:

| 字段 | 说明 |
|------|------|
| `cpuPercent` | 服务进程 CPU 使用率，已按核心数归一化到 0-100（占整机比例），每秒采样一次 |
| `cpuCount` | 可用 CPU 核心数 |
| `memory.rss` | 进程常驻内存（RSS） |
| `memory.heapUsed` / `heapTotal` | V8 堆已用 / 已申请内存 |
| `memory.systemTotal` / `systemFree` | 系统总内存 / 当前可用内存，用于计算进程占系统内存的比例 |
| `traffic.receivedPerSecond` | 实时上行速率（客户端 → 目标），字节/秒，按采样间隔计算 |
| `traffic.sentPerSecond` | 实时下行速率（目标 → 客户端），字节/秒 |
| `traffic.totalReceived` / `totalSent` | 进程启动以来的累计上下行流量，映射被删除后仍然保留 |
| `sampledAt` | 最近一次采样时间（ISO 8601） |

> 资源数据由进程内每秒采样器维护；`cpuPercent` 是整机占比（单核满载为 `100 / cpuCount`%），不是单核使用率。

---

## 错误响应

所有API在发生错误时返回统一格式：

```json
{
  "success": false,
  "message": "错误描述信息"
}
```

**HTTP状态码**:
| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 / 端口被占用 / 配置保存失败 |
| 401 | 未认证 / 认证失败 |
| 403 | 跨站请求被拒绝 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
| 503 | 尚未配置管理员密码 |

---

## 使用示例

### cURL 示例

```bash
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

# 停止映射
curl -X POST http://localhost:9999/api/mappings/0/stop -b cookies.txt

# 删除映射
curl -X DELETE http://localhost:9999/api/mappings/0 -b cookies.txt

# 健康检查
curl http://localhost:9999/api/health
```

### JavaScript 示例

```javascript
// 登录
const login = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'YourPassword' })
});

// 获取映射列表
const mappings = await fetch('/api/mappings').then(r => r.json());

// 添加映射
const newMapping = await fetch('/api/mappings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: '新映射',
    listen: { port: 8888 },
    target: { host: '127.0.0.1', port: 80 }
  })
}).then(r => r.json());
```
