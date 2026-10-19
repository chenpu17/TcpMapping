#!/usr/bin/env node
/**
 * 冒烟测试：启动一个真实的服务器实例，验证登录、映射增删改、TCP 转发与统计。
 * 运行方式: npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');

const SERVER_FILE = path.join(__dirname, '..', 'server.js');
const RUN_ID = `${process.pid}-${Date.now()}`;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function request(port, method, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body !== undefined ? JSON.stringify(options.body) : null;
    const headers = { ...(options.headers || {}) };

    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (options.cookie) {
      headers.Cookie = options.cookie;
    }
    if (options.origin) {
      headers.Origin = options.origin;
    }

    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(data);
        } catch (error) {
          // 非 JSON 响应
        }
        resolve({ status: res.statusCode, headers: res.headers, body, raw: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('请求超时')));

    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await request(port, 'GET', '/api/health');
      if (response.status === 200 && response.body && response.body.status === 'ok') {
        return response.body;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw new Error(`服务器未能在 ${timeoutMs}ms 内就绪${lastError ? `: ${lastError.message}` : ''}`);
}

function connectTo(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function roundTrip(socket, payload) {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`未在预期时间内收到数据，已收到 ${received.length} 字节`));
    }, 3000);

    const onData = (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= payload.length) {
        cleanup();
        resolve(received);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.write(payload);
  });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `tcpmapping-smoke-${RUN_ID}-`));
  const webPort = await getFreePort();
  const listenPort = await getFreePort();
  const echoPort = await getFreePort();

  // 认证配置
  const authConfig = {
    users: [{
      username: 'tester',
      passwordHash: bcrypt.hashSync('TestPass123', 4),
      role: 'admin',
      lastPasswordChange: new Date().toISOString(),
      enabled: true
    }],
    passwordPolicy: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
      passwordExpireDays: 90
    },
    sessionConfig: {
      sessionTimeout: 24,
      maxFailedAttempts: 5,
      lockoutDuration: 30
    }
  };

  fs.writeFileSync(path.join(tmpDir, 'auth-config.json'), JSON.stringify(authConfig, null, 2));

  // 服务器配置：默认不包含任何映射
  fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
    mappings: [],
    webui: { enabled: true, host: '127.0.0.1', port: webPort },
    logging: { enabled: true, level: 'debug' },
    timeouts: { connect: 3000, idle: 0 }
  }, null, 2));

  // 回显服务器
  const echoServer = net.createServer(socket => socket.pipe(socket));
  await new Promise((resolve, reject) => {
    echoServer.once('error', reject);
    echoServer.listen(echoPort, '127.0.0.1', resolve);
  });

  let serverProcess = null;
  const logs = [];

  try {
    serverProcess = spawn(process.execPath, [SERVER_FILE], {
      cwd: tmpDir,
      env: { ...process.env, TCPMAPPING_DATA_DIR: tmpDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', chunk => logs.push(chunk.toString()));
    serverProcess.stderr.on('data', chunk => logs.push(chunk.toString()));

    await waitForHealth(webPort);
    console.log('✓ 服务启动与健康检查');

    // 未登录访问受保护接口
    const unauthorized = await request(webPort, 'GET', '/api/mappings');
    assert.strictEqual(unauthorized.status, 401, '未登录访问应返回 401');
    console.log('✓ 未登录访问被正确拒绝');

    // 未登录不能访问管理页面
    const dashboard = await request(webPort, 'GET', '/dashboard');
    assert.strictEqual(dashboard.status, 302, '未登录访问管理页应重定向');
    assert.strictEqual(dashboard.headers.location, '/login');

    const dashboardHtml = await request(webPort, 'GET', '/dashboard.html');
    assert.strictEqual(dashboardHtml.status, 302, '未登录不能直接访问 dashboard.html');

    const loginPage = await request(webPort, 'GET', '/login');
    assert.strictEqual(loginPage.status, 200);
    assert.ok(loginPage.headers['content-security-policy'], '应设置 CSP 响应头');
    assert.strictEqual(loginPage.headers['x-frame-options'], 'DENY');

    // 多语言与主题脚本可访问
    const commonJs = await request(webPort, 'GET', '/common.js');
    assert.strictEqual(commonJs.status, 200);
    assert.ok(commonJs.raw.includes('I18n'), '应提供前端国际化脚本');
    console.log('✓ 页面访问控制与安全响应头');

    // 跨站写请求应被拒绝
    const crossOrigin = await request(webPort, 'POST', '/api/login', {
      body: { username: 'tester', password: 'TestPass123' },
      origin: 'http://evil.example'
    });
    assert.strictEqual(crossOrigin.status, 403, '跨站写请求应返回 403');
    console.log('✓ 跨站请求防护');

    // 登录
    const login = await request(webPort, 'POST', '/api/login', {
      body: { username: 'tester', password: 'TestPass123' }
    });
    assert.strictEqual(login.status, 200, `登录失败: ${login.raw}`);
    assert.strictEqual(login.body.success, true);

    const setCookie = login.headers['set-cookie'];
    assert.ok(Array.isArray(setCookie) && setCookie.length > 0, '登录响应应包含 Cookie');
    const cookie = setCookie[0].split(';')[0];
    console.log('✓ 登录成功并获取会话');

    // 错误密码
    const badLogin = await request(webPort, 'POST', '/api/login', {
      body: { username: 'tester', password: 'WrongPass123' }
    });
    assert.strictEqual(badLogin.status, 401);
    assert.strictEqual(badLogin.body.success, false);
    console.log('✓ 错误密码被拒绝');

    // 英文 API 提示
    const enBadLogin = await request(webPort, 'POST', '/api/login', {
      body: { username: 'tester', password: 'WrongPass123' },
      headers: { 'X-Language': 'en-US' }
    });
    assert.strictEqual(enBadLogin.status, 401);
    assert.strictEqual(enBadLogin.body.message, 'Invalid username or password');

    // Accept-Language 以首选语言为准（英文在前，即使后面带 zh 也应返回英文）
    const acceptLangLogin = await request(webPort, 'POST', '/api/login', {
      body: { username: 'tester', password: 'WrongPass123' },
      headers: { 'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8' }
    });
    assert.strictEqual(acceptLangLogin.body.message, 'Invalid username or password');

    const enValidation = await request(webPort, 'POST', '/api/mappings', {
      cookie,
      headers: { 'X-Language': 'en-US' },
      body: {
        name: '',
        listen: { host: '127.0.0.1', port: 0 },
        target: { host: '', port: 0 }
      }
    });
    assert.strictEqual(enValidation.status, 400);
    assert.ok(enValidation.body.message.includes('Mapping name is required'), '校验错误应支持英文');
    console.log('✓ API 提示支持中英文');

    // 添加映射
    const created = await request(webPort, 'POST', '/api/mappings', {
      cookie,
      body: {
        name: 'smoke-test',
        listen: { host: '127.0.0.1', port: listenPort },
        target: { host: '127.0.0.1', port: echoPort }
      }
    });
    assert.strictEqual(created.status, 200, `添加映射失败: ${created.raw}`);
    assert.strictEqual(created.body.success, true);
    const mappingId = created.body.data.id;
    assert.ok(mappingId, '映射应包含 id');
    console.log('✓ 添加端口映射');

    // 转发数据
    const socket = await connectTo(listenPort);
    const message = Buffer.from('hello-tcpmapping');
    const echoed = await roundTrip(socket, message);
    assert.strictEqual(echoed.toString(), message.toString(), '转发数据应原样返回');
    console.log('✓ TCP 转发正常');

    // 半关闭：客户端发送完数据后关闭写方向，仍应收到响应
    const halfClosePayload = Buffer.from('half-close');
    const halfClosed = await new Promise((resolve, reject) => {
      const halfSocket = net.connect({ host: '127.0.0.1', port: listenPort });
      let received = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        halfSocket.destroy();
        reject(new Error('半关闭场景未收到响应'));
      }, 3000);

      halfSocket.once('connect', () => halfSocket.end(halfClosePayload));
      halfSocket.on('data', chunk => { received = Buffer.concat([received, chunk]); });
      halfSocket.once('end', () => {
        clearTimeout(timeout);
        resolve(received);
      });
      halfSocket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    assert.strictEqual(halfClosed.toString(), halfClosePayload.toString(), '半关闭后应仍能收到响应');
    console.log('✓ TCP 半关闭转发正常');

    // 统计信息（保持连接打开）
    let stats = null;
    const statsDeadline = Date.now() + 2000;
    while (Date.now() < statsDeadline) {
      const response = await request(webPort, 'GET', '/api/mappings', { cookie });
      stats = response.body.data.find(item => item.id === mappingId);
      if (stats && stats.bytesReceived >= message.length && stats.connectionCount === 1) {
        break;
      }
      await delay(100);
    }
    assert.ok(stats, '应能获取映射统计');
    assert.strictEqual(stats.status, 'running');
    assert.strictEqual(stats.connectionCount, 1, '应统计到 1 个活跃连接');
    assert.ok(stats.bytesReceived >= message.length, '应累计上行流量');
    assert.ok(stats.bytesSent >= message.length, '应累计下行流量');
    assert.ok(stats.totalBytesReceived >= message.length, '应累计总上行流量');
    console.log('✓ 连接与流量统计正确');

    // 服务进程自身资源占用
    const statusResponse = await request(webPort, 'GET', '/api/status', { cookie });
    assert.strictEqual(statusResponse.status, 200);
    const resources = statusResponse.body.data.resources;
    assert.ok(resources, '状态接口应包含服务资源');
    assert.ok(Number.isFinite(resources.cpuPercent)
      && resources.cpuPercent >= 0
      && resources.cpuPercent <= 100, 'CPU 使用率应在 0-100 之间');
    assert.ok(resources.cpuCount >= 1, '应报告 CPU 核心数');
    assert.ok(resources.memory.rss > 0, '应报告进程内存占用');
    assert.ok(resources.memory.systemTotal > 0, '应报告系统内存总量');
    assert.ok(resources.traffic.totalReceived >= message.length, '应累计进程总上行流量');
    assert.ok(resources.traffic.totalSent >= message.length, '应累计进程总下行流量');
    assert.ok(Number.isFinite(resources.traffic.receivedPerSecond), '应报告实时上行速率');
    assert.ok(Number.isFinite(resources.traffic.sentPerSecond), '应报告实时下行速率');
    assert.ok(resources.sampledAt, '应包含采样时间');
    console.log('✓ 服务资源监控数据正确');

    // 停止映射会断开活跃连接
    const closed = new Promise(resolve => socket.once('close', resolve));
    const stopped = await request(webPort, 'POST', `/api/mappings/${mappingId}/stop`, { cookie });
    assert.strictEqual(stopped.body.success, true);
    await Promise.race([closed, delay(2000).then(() => { throw new Error('停止映射后连接未被断开'); })]);
    console.log('✓ 停止映射会断开连接');

    // 关闭后的连接应留下记录：源地址、目的地址、持续时长、结束原因
    const historyResponse = await request(webPort, 'GET',
      `/api/connections/history?mappingId=${encodeURIComponent(mappingId)}&limit=10`, { cookie });
    assert.strictEqual(historyResponse.status, 200, `查询连接记录失败: ${historyResponse.raw}`);
    assert.ok(historyResponse.body.data.items.length > 0, '应记录已关闭的连接');
    const historyEntry = historyResponse.body.data.items[0];
    assert.strictEqual(historyEntry.mappingId, mappingId);
    assert.ok(historyEntry.clientAddress.includes('127.0.0.1'), '应记录源地址');
    assert.ok(historyEntry.targetAddress.includes(String(echoPort)), '应记录目的地址');
    assert.ok(Number.isFinite(historyEntry.durationMs) && historyEntry.durationMs >= 0, '应记录持续时长');
    assert.ok(historyEntry.closeReason, '应记录关闭原因');
    console.log('✓ 连接记录包含源地址、目的地址与持续时长');

    // 英文界面下关闭原因也应翻译
    const enHistory = await request(webPort, 'GET',
      `/api/connections/history?mappingId=${encodeURIComponent(mappingId)}&limit=10`,
      { cookie, headers: { 'X-Language': 'en-US' } });
    assert.strictEqual(enHistory.status, 200);
    const enReason = enHistory.body.data.items[0].closeReason;
    assert.ok(!/[一-龥]/.test(enReason), '英文环境下的关闭原因不应包含中文');

    // 重新启动
    const started = await request(webPort, 'POST', `/api/mappings/${mappingId}/start`, { cookie });
    assert.strictEqual(started.body.success, true, `启动失败: ${started.raw}`);
    console.log('✓ 映射可重新启动');

    // 更新映射（仅修改名称）
    const updated = await request(webPort, 'PUT', `/api/mappings/${mappingId}`, {
      cookie,
      body: { name: 'smoke-test-renamed' }
    });
    assert.strictEqual(updated.status, 200, `更新失败: ${updated.raw}`);
    assert.strictEqual(updated.body.data.name, 'smoke-test-renamed');
    assert.strictEqual(updated.body.data.target.port, echoPort, '未提供的字段应保持不变');
    console.log('✓ 更新映射配置');

    // 端口冲突应被拒绝
    const conflict = await request(webPort, 'POST', '/api/mappings', {
      cookie,
      body: {
        name: 'conflict',
        listen: { host: '127.0.0.1', port: listenPort },
        target: { host: '127.0.0.1', port: echoPort }
      }
    });
    assert.strictEqual(conflict.status, 400);
    console.log('✓ 重复端口被拒绝');

    // 删除映射
    const deleted = await request(webPort, 'DELETE', `/api/mappings/${mappingId}`, { cookie });
    assert.strictEqual(deleted.body.success, true);

    const listAfterDelete = await request(webPort, 'GET', '/api/mappings', { cookie });
    assert.strictEqual(listAfterDelete.body.data.length, 0);
    console.log('✓ 删除映射');

    // 登出后会话失效
    await request(webPort, 'POST', '/api/logout', { cookie });
    const afterLogout = await request(webPort, 'GET', '/api/mappings', { cookie });
    assert.strictEqual(afterLogout.status, 401);
    console.log('✓ 登出后会话失效');

    console.log('\n所有冒烟测试通过 ✅');
  } catch (error) {
    console.error('\n测试失败 ❌');
    console.error(error.stack || error.message);
    if (logs.length > 0) {
      console.error('\n--- 服务器日志 ---');
      console.error(logs.join(''));
    }
    process.exitCode = 1;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
      await delay(300);
      if (serverProcess.exitCode === null) {
        serverProcess.kill('SIGKILL');
      }
    }

    echoServer.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理失败
    }
  }
}

main();
