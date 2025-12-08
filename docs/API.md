# API 接口文档

## 概述

TCP转发服务器提供RESTful API接口，用于管理端口映射、监控连接状态和系统管理。

- **Base URL**: `http://localhost:9999`
- **认证方式**: Session Cookie
- **数据格式**: JSON

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
- `401`: 密码错误 / 用户不存在
- `429`: 登录尝试次数过多，账户已锁定

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
      "bytesSent": 204800
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
| connectionCount | number | 当前连接数 |
| bytesReceived | number | 上行流量（字节） |
| bytesSent | number | 下行流量（字节） |

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
- 映射名称不能为空
- 端口必须在 1-65535 范围内
- 目标主机必须是有效的IP地址或域名
- 监听端口不能与已有映射重复

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
  "message": "端口映射已启动",
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
        "port": 5588,
        "mappingName": "Dify",
        "totalConnections": 3,
        "connections": [
          {
            "id": "conn123",
            "mappingName": "Dify",
            "sourcePort": 5588,
            "clientAddress": "192.168.1.10:54321",
            "targetAddress": "113.45.34.202:5588",
            "startTime": "2025-12-08T08:00:00.000Z",
            "lastActivity": 1733648400000,
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

### 获取系统状态

```
GET /api/status
```

**响应示例**:
```json
{
  "success": true,
  "data": {
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
    }
  }
}
```

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
| 400 | 请求参数错误 |
| 401 | 未认证 / 认证失败 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

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
