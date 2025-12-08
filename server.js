const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');

// 数据目录 - 用于存储用户配置（持久化）
const DATA_DIR = path.join(os.homedir(), '.tcpmapping');

// 获取配置文件路径（按优先级搜索）
function getConfigPath(filename) {
  // 优先级1: 当前工作目录
  const cwdPath = path.join(process.cwd(), filename);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // 优先级2: 用户数据目录 (~/.tcpmapping/)
  const dataPath = path.join(DATA_DIR, filename);
  if (fs.existsSync(dataPath)) {
    return dataPath;
  }

  // 优先级3: 包安装目录（仅作为模板）
  const pkgPath = path.join(__dirname, filename);
  if (fs.existsSync(pkgPath)) {
    return pkgPath;
  }

  return null;
}

// 获取配置保存路径
function getConfigSavePath(filename) {
  // 如果当前工作目录有配置文件，保存到当前目录
  const cwdPath = path.join(process.cwd(), filename);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // 否则保存到用户数据目录
  ensureDataDir();
  return path.join(DATA_DIR, filename);
}

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`创建配置目录: ${DATA_DIR}`);
  }
}

// 全局变量
let config = {};
const servers = new Map(); // 存储所有TCP转发服务器实例
const connections = new Map(); // 存储活跃连接信息
const app = express();

// 认证配置
let authConfig = {};

// 登录失败记录
const loginAttempts = new Map();

// 加载认证配置
function loadAuthConfig() {
  try {
    const authConfigPath = getConfigPath('auth-config.json');
    if (!authConfigPath) {
      throw new Error('认证配置文件不存在');
    }
    const authConfigData = fs.readFileSync(authConfigPath, 'utf8');
    console.log(`加载认证配置: ${authConfigPath}`);
    return JSON.parse(authConfigData);
  } catch (error) {
    console.error('警告: 未找到认证配置文件，使用默认配置');
    console.error('请运行 "tcpmapping setup-password" 或 "npm run setup-password" 来设置安全密码');
    
    // 返回默认配置（仅用于向后兼容）
    return {
      users: [{
        username: 'admin',
        passwordHash: bcrypt.hashSync('admin123', 10),
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
  }
}

// 验证用户密码
function validateUserCredentials(username, password) {
  const user = authConfig.users.find(u => u.username === username && u.enabled);
  
  if (!user) {
    return { success: false, message: '用户不存在或已被禁用' };
  }
  
  // 检查密码是否过期
  const passwordAge = Date.now() - new Date(user.lastPasswordChange).getTime();
  const passwordExpireMs = authConfig.passwordPolicy.passwordExpireDays * 24 * 60 * 60 * 1000;
  
  if (passwordAge > passwordExpireMs) {
    return { success: false, message: '密码已过期，请联系管理员重置' };
  }
  
  // 验证密码
  if (bcrypt.compareSync(password, user.passwordHash)) {
    return { success: true, user: user };
  } else {
    return { success: false, message: '密码错误' };
  }
}

// 检查登录尝试限制
function checkLoginAttempts(clientIP) {
  const attempts = loginAttempts.get(clientIP) || { count: 0, lastAttempt: 0 };
  const now = Date.now();
  const lockoutTime = authConfig.sessionConfig.lockoutDuration * 60 * 1000;
  
  // 如果在锁定期内
  if (attempts.count >= authConfig.sessionConfig.maxFailedAttempts) {
    if (now - attempts.lastAttempt < lockoutTime) {
      const remainingTime = Math.ceil((lockoutTime - (now - attempts.lastAttempt)) / 1000 / 60);
      return { 
        allowed: false, 
        message: `由于多次登录失败，账户已被锁定，请${remainingTime}分钟后再试` 
      };
    } else {
      // 锁定期已过，重置计数
      loginAttempts.set(clientIP, { count: 0, lastAttempt: now });
    }
  }
  
  return { allowed: true };
}

// 记录登录失败
function recordLoginFailure(clientIP) {
  const attempts = loginAttempts.get(clientIP) || { count: 0, lastAttempt: 0 };
  attempts.count++;
  attempts.lastAttempt = Date.now();
  loginAttempts.set(clientIP, attempts);
}

// 清除登录失败记录
function clearLoginFailures(clientIP) {
  loginAttempts.delete(clientIP);
}

// 日志级别定义
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// 读取配置文件
function loadConfig() {
  try {
    const configPath = getConfigPath('config.json');
    if (!configPath) {
      console.log('未找到配置文件，使用默认配置');
      console.log('运行 "tcpmapping init" 创建配置文件');
      return getDefaultConfig();
    }
    const configData = fs.readFileSync(configPath, 'utf8');
    const loadedConfig = JSON.parse(configData);
    console.log(`加载配置文件: ${configPath}`);

    // 验证配置
    if (!loadedConfig.mappings || !Array.isArray(loadedConfig.mappings)) {
      loadedConfig.mappings = [];
    }

    // 添加默认WebUI配置
    if (!loadedConfig.webui) {
      loadedConfig.webui = {
        enabled: true,
        port: 9999,
        host: '0.0.0.0'
      };
    }

    return loadedConfig;
  } catch (error) {
    console.error('读取配置文件失败:', error.message);
    return getDefaultConfig();
  }
}

// 获取默认配置
function getDefaultConfig() {
  return {
    mappings: [],
    webui: {
      enabled: true,
      port: 9999,
      host: '0.0.0.0'
    },
    logging: {
      enabled: true,
      level: 'info'
    }
  };
}

// 保存配置文件
function saveConfig(newConfig) {
  try {
    const configPath = getConfigSavePath('config.json');
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    config = newConfig;
    console.log(`配置已保存: ${configPath}`);
    return true;
  } catch (error) {
    console.error('保存配置文件失败:', error.message);
    return false;
  }
}

// 日志输出函数
function log(level, message) {
  if (config.logging && config.logging.enabled) {
    const configLevel = config.logging.level || 'info';
    const currentLevelValue = LOG_LEVELS[level] || 999;
    const configLevelValue = LOG_LEVELS[configLevel] || 2;
    
    // 只有当前日志级别的优先级 <= 配置级别优先级时才输出
    if (currentLevelValue <= configLevelValue) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
  }
}

// 生成连接ID
function generateConnectionId() {
  return Math.random().toString(36).substring(2, 15);
}

// 生成映射唯一ID
function generateMappingId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// 验证端口号
function isValidPort(port) {
  const p = parseInt(port);
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

// 验证IP地址或主机名
function isValidHost(host) {
  if (!host || typeof host !== 'string') return false;
  // 允许 0.0.0.0, localhost, IP地址, 或域名
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return ipPattern.test(host) || hostnamePattern.test(host);
}

// 验证映射配置
function validateMappingInput(mapping) {
  const errors = [];

  if (!mapping.name || mapping.name.trim().length === 0) {
    errors.push('映射名称不能为空');
  }

  if (!mapping.listen || !isValidPort(mapping.listen.port)) {
    errors.push('监听端口必须在 1-65535 范围内');
  }

  if (!mapping.target || !isValidHost(mapping.target.host)) {
    errors.push('目标主机地址格式无效');
  }

  if (!mapping.target || !isValidPort(mapping.target.port)) {
    errors.push('目标端口必须在 1-65535 范围内');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

// 默认连接超时（毫秒）
const CONNECTION_TIMEOUT = 30000;
const IDLE_TIMEOUT = 300000; // 5分钟空闲超时

// 创建转发连接
function createForwardConnection(clientSocket, mapping) {
  const connectionId = generateConnectionId();
  const clientInfo = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;

  // 记录连接信息
  connections.set(connectionId, {
    id: connectionId,
    mappingName: mapping.name,
    sourcePort: mapping.listen.port,
    clientAddress: clientInfo,
    targetAddress: `${mapping.target.host}:${mapping.target.port}`,
    startTime: new Date(),
    lastActivity: Date.now(),
    bytesReceived: 0,
    bytesSent: 0,
    status: 'connecting'
  });

  const targetSocket = new net.Socket();

  // 设置连接超时
  targetSocket.setTimeout(CONNECTION_TIMEOUT);

  // 设置socket超时（空闲超时）
  clientSocket.setTimeout(IDLE_TIMEOUT);
  targetSocket.setTimeout(IDLE_TIMEOUT);

  // 更新活动时间
  const updateActivity = () => {
    const conn = connections.get(connectionId);
    if (conn) {
      conn.lastActivity = Date.now();
    }
  };

  // 连接到目标服务器
  targetSocket.connect(mapping.target.port, mapping.target.host, () => {
    log('info', `[${mapping.name}] 已连接到目标服务器 ${mapping.target.host}:${mapping.target.port}`);
    const conn = connections.get(connectionId);
    if (conn) {
      conn.status = 'connected';
      connections.set(connectionId, conn);
    }
  });

  // 处理超时
  targetSocket.on('timeout', () => {
    log('warn', `[${mapping.name}] 目标连接超时`);
    connections.delete(connectionId);
    targetSocket.destroy();
    clientSocket.destroy();
  });

  clientSocket.on('timeout', () => {
    log('warn', `[${mapping.name}] 客户端连接空闲超时`);
    connections.delete(connectionId);
    targetSocket.destroy();
    clientSocket.destroy();
  });

  // 处理目标服务器连接错误
  targetSocket.on('error', (err) => {
    log('error', `[${mapping.name}] 目标服务器连接错误: ${err.message}`);
    connections.delete(connectionId);
    clientSocket.destroy();
  });

  // 处理目标服务器连接关闭
  targetSocket.on('close', () => {
    log('info', `[${mapping.name}] 目标服务器连接已关闭`);
    connections.delete(connectionId);
    clientSocket.destroy();
  });

  // 处理客户端连接关闭
  clientSocket.on('close', () => {
    log('info', `[${mapping.name}] 客户端连接已关闭`);
    connections.delete(connectionId);
    targetSocket.destroy();
  });

  // 处理客户端连接错误
  clientSocket.on('error', (err) => {
    log('error', `[${mapping.name}] 客户端连接错误: ${err.message}`);
    connections.delete(connectionId);
    targetSocket.destroy();
  });

  // 数据转发：客户端 -> 目标服务器
  clientSocket.on('data', (data) => {
    log('debug', `[${mapping.name}] 转发数据到目标服务器，大小: ${data.length} 字节`);
    updateActivity();
    const conn = connections.get(connectionId);
    if (conn) {
      conn.bytesReceived += data.length;
      connections.set(connectionId, conn);
    }
    targetSocket.write(data);
  });

  // 数据转发：目标服务器 -> 客户端
  targetSocket.on('data', (data) => {
    log('debug', `[${mapping.name}] 转发数据到客户端，大小: ${data.length} 字节`);
    updateActivity();
    const conn = connections.get(connectionId);
    if (conn) {
      conn.bytesSent += data.length;
      connections.set(connectionId, conn);
    }
    clientSocket.write(data);
  });

  return targetSocket;
}

// 创建单个端口转发服务器
function createForwardingServer(mapping) {
  const server = net.createServer((clientSocket) => {
    const clientInfo = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    log('info', `[${mapping.name}] 新客户端连接: ${clientInfo}`);

    // 创建转发连接
    createForwardConnection(clientSocket, mapping);
  });

  // 处理服务器错误
  server.on('error', (err) => {
    log('error', `[${mapping.name}] 服务器错误: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${mapping.listen.port} 已被占用，请检查配置或停止占用该端口的程序`);
    }
  });

  // 启动服务器
  server.listen(mapping.listen.port, mapping.listen.host, () => {
    log('info', `[${mapping.name}] 转发服务器已启动，监听地址: ${mapping.listen.host}:${mapping.listen.port}`);
    log('info', `[${mapping.name}] 目标服务器: ${mapping.target.host}:${mapping.target.port}`);
    console.log(`✓ [${mapping.name}] ${mapping.listen.port} -> ${mapping.target.host}:${mapping.target.port}`);
  });

  return server;
}

// 启动端口映射
function startMapping(mapping) {
  const key = `${mapping.listen.host}:${mapping.listen.port}`;
  
  if (servers.has(key)) {
    return { success: false, message: '端口映射已存在' };
  }

  try {
    const server = createForwardingServer(mapping);
    servers.set(key, { server, mapping });
    return { success: true, message: '端口映射已启动' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 停止端口映射
function stopMapping(host, port) {
  const key = `${host}:${port}`;
  
  if (!servers.has(key)) {
    return { success: false, message: '端口映射不存在' };
  }

  try {
    const { server } = servers.get(key);
    server.close();
    servers.delete(key);
    
    // 清理相关连接
    for (const [id, conn] of connections) {
      if (conn.sourcePort === port) {
        connections.delete(id);
      }
    }
    
    return { success: true, message: '端口映射已停止' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 启动所有端口映射
function startAllMappings() {
  config.mappings.forEach((mapping, index) => {
    if (!mapping.listen || !mapping.target) {
      console.error(`映射配置 ${index + 1} 缺少必要的 listen 或 target 配置`);
      return;
    }
    
    if (!mapping.name) {
      mapping.name = `映射${index + 1}`;
    }

    startMapping(mapping);
  });
}

// 生成或读取 session secret
function getSessionSecret() {
  const secretPath = path.join(__dirname, '.session-secret');
  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf8').trim();
    }
  } catch (error) {
    // 忽略读取错误
  }
  // 生成新的随机 secret
  const crypto = require('crypto');
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch (error) {
    console.warn('警告: 无法保存 session secret，重启后会话将失效');
  }
  return secret;
}

// 中间件配置
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24小时
}));

// 静态文件服务
app.use(express.static('public'));

// 认证中间件
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  } else {
    return res.status(401).json({ success: false, message: '需要登录' });
  }
}

// 路由定义

// 主页
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

// 登录页面
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 管理面板
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API: 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // 检查登录尝试限制
  const attemptCheck = checkLoginAttempts(clientIP);
  if (!attemptCheck.allowed) {
    return res.status(429).json({ success: false, message: attemptCheck.message });
  }
  
  // 验证用户凭据
  const validation = validateUserCredentials(username, password);
  
  if (validation.success) {
    // 登录成功
    req.session.authenticated = true;
    req.session.username = username;
    req.session.userRole = validation.user.role;
    
    // 清除登录失败记录
    clearLoginFailures(clientIP);
    
    log('info', `用户 ${username} 从 ${clientIP} 登录成功`);
    res.json({ success: true, message: '登录成功' });
  } else {
    // 登录失败
    recordLoginFailure(clientIP);
    
    log('warn', `用户 ${username} 从 ${clientIP} 登录失败: ${validation.message}`);
    res.status(401).json({ success: false, message: validation.message });
  }
});

// API: 登出
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: '已登出' });
});

// 获取指定端口的连接数量
function getConnectionCountByPort(port) {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.sourcePort === port) {
      count++;
    }
  }
  return count;
}

// 获取指定端口的连接统计
function getConnectionStatsByPort(port) {
  let count = 0;
  let bytesReceived = 0;
  let bytesSent = 0;
  for (const conn of connections.values()) {
    if (conn.sourcePort === port) {
      count++;
      bytesReceived += conn.bytesReceived;
      bytesSent += conn.bytesSent;
    }
  }
  return { count, bytesReceived, bytesSent };
}

// API: 获取端口映射列表
app.get('/api/mappings', requireAuth, (req, res) => {
  const mappings = config.mappings.map(mapping => {
    const stats = getConnectionStatsByPort(mapping.listen.port);
    return {
      ...mapping,
      status: servers.has(`${mapping.listen.host}:${mapping.listen.port}`) ? 'running' : 'stopped',
      connectionCount: stats.count,
      bytesReceived: stats.bytesReceived,
      bytesSent: stats.bytesSent
    };
  });
  res.json({ success: true, data: mappings });
});

// API: 添加端口映射
app.post('/api/mappings', requireAuth, (req, res) => {
  const { name, listen, target } = req.body;

  const mapping = {
    name: name || '',
    listen: {
      host: (listen && listen.host) || '0.0.0.0',
      port: listen ? parseInt(listen.port) : 0
    },
    target: {
      host: (target && target.host) || '',
      port: target ? parseInt(target.port) : 0
    }
  };

  // 输入验证
  const validation = validateMappingInput(mapping);
  if (!validation.isValid) {
    return res.status(400).json({ success: false, message: validation.errors.join('; ') });
  }

  // 检查端口是否已被使用
  const exists = config.mappings.some(m =>
    m.listen.host === mapping.listen.host && m.listen.port === mapping.listen.port
  );

  if (exists) {
    return res.status(400).json({ success: false, message: '端口映射已存在' });
  }

  // 添加唯一ID
  mapping.id = generateMappingId();

  config.mappings.push(mapping);

  if (saveConfig(config)) {
    const result = startMapping(mapping);
    res.json({ ...result, data: mapping });
  } else {
    res.status(500).json({ success: false, message: '保存配置失败' });
  }
});

// API: 删除端口映射 (支持ID或索引)
app.delete('/api/mappings/:identifier', requireAuth, (req, res) => {
  const identifier = req.params.identifier;
  let mappingIndex = -1;

  // 先尝试通过ID查找
  mappingIndex = config.mappings.findIndex(m => m.id === identifier);

  // 如果没找到，尝试作为索引使用（向后兼容）
  if (mappingIndex === -1) {
    const index = parseInt(identifier);
    if (!isNaN(index) && index >= 0 && index < config.mappings.length) {
      mappingIndex = index;
    }
  }

  if (mappingIndex === -1) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const mapping = config.mappings[mappingIndex];

  // 停止服务器
  stopMapping(mapping.listen.host, mapping.listen.port);

  // 从配置中移除
  config.mappings.splice(mappingIndex, 1);

  if (saveConfig(config)) {
    res.json({ success: true, message: '端口映射已删除' });
  } else {
    res.status(500).json({ success: false, message: '保存配置失败' });
  }
});

// API: 启动单个映射
app.post('/api/mappings/:identifier/start', requireAuth, (req, res) => {
  const identifier = req.params.identifier;
  let mapping = config.mappings.find(m => m.id === identifier);

  // 向后兼容：尝试索引
  if (!mapping) {
    const index = parseInt(identifier);
    if (!isNaN(index) && index >= 0 && index < config.mappings.length) {
      mapping = config.mappings[index];
    }
  }

  if (!mapping) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const result = startMapping(mapping);
  res.json(result);
});

// API: 停止单个映射
app.post('/api/mappings/:identifier/stop', requireAuth, (req, res) => {
  const identifier = req.params.identifier;
  let mapping = config.mappings.find(m => m.id === identifier);

  // 向后兼容：尝试索引
  if (!mapping) {
    const index = parseInt(identifier);
    if (!isNaN(index) && index >= 0 && index < config.mappings.length) {
      mapping = config.mappings[index];
    }
  }

  if (!mapping) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const result = stopMapping(mapping.listen.host, mapping.listen.port);
  res.json(result);
});

// API: 更新映射配置
app.put('/api/mappings/:identifier', requireAuth, (req, res) => {
  const identifier = req.params.identifier;
  let mappingIndex = config.mappings.findIndex(m => m.id === identifier);

  // 向后兼容：尝试索引
  if (mappingIndex === -1) {
    const index = parseInt(identifier);
    if (!isNaN(index) && index >= 0 && index < config.mappings.length) {
      mappingIndex = index;
    }
  }

  if (mappingIndex === -1) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const oldMapping = config.mappings[mappingIndex];
  const { name, listen, target } = req.body;

  const newMapping = {
    id: oldMapping.id || generateMappingId(),
    name: name || oldMapping.name,
    listen: {
      host: (listen && listen.host) || oldMapping.listen.host,
      port: listen ? parseInt(listen.port) : oldMapping.listen.port
    },
    target: {
      host: (target && target.host) || oldMapping.target.host,
      port: target ? parseInt(target.port) : oldMapping.target.port
    }
  };

  // 验证新配置
  const validation = validateMappingInput(newMapping);
  if (!validation.isValid) {
    return res.status(400).json({ success: false, message: validation.errors.join('; ') });
  }

  // 检查新端口是否与其他映射冲突（排除自身）
  const portChanged = oldMapping.listen.port !== newMapping.listen.port ||
                      oldMapping.listen.host !== newMapping.listen.host;
  if (portChanged) {
    const exists = config.mappings.some((m, i) =>
      i !== mappingIndex &&
      m.listen.host === newMapping.listen.host &&
      m.listen.port === newMapping.listen.port
    );
    if (exists) {
      return res.status(400).json({ success: false, message: '端口映射已存在' });
    }
  }

  // 停止旧的映射
  stopMapping(oldMapping.listen.host, oldMapping.listen.port);

  // 更新配置
  config.mappings[mappingIndex] = newMapping;

  if (saveConfig(config)) {
    // 启动新的映射
    const result = startMapping(newMapping);
    res.json({ ...result, data: newMapping });
  } else {
    res.status(500).json({ success: false, message: '保存配置失败' });
  }
});

// API: 获取连接状态
app.get('/api/connections', requireAuth, (req, res) => {
  const connectionList = Array.from(connections.values());
  
  // 按端口分组统计
  const stats = {};
  connectionList.forEach(conn => {
    if (!stats[conn.sourcePort]) {
      stats[conn.sourcePort] = {
        port: conn.sourcePort,
        mappingName: conn.mappingName,
        totalConnections: 0,
        connections: []
      };
    }
    stats[conn.sourcePort].totalConnections++;
    stats[conn.sourcePort].connections.push(conn);
  });

  res.json({
    success: true,
    data: {
      total: connectionList.length,
      byPort: Object.values(stats)
    }
  });
});

// API: 获取系统状态
app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      totalMappings: config.mappings.length,
      activeMappings: servers.size,
      totalConnections: connections.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    }
  });
});

// API: 健康检查（无需认证，用于监控）
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeMappings: servers.size,
    activeConnections: connections.size
  });
});

// 启动程序
function startServer() {
  // 加载配置
  config = loadConfig();
  
  // 加载认证配置
  authConfig = loadAuthConfig();
  
  // 启动TCP转发服务器
  console.log('==========================================');
  console.log('TCP转发服务器正在启动...');
  console.log('端口映射配置:');
  startAllMappings();
  console.log('==========================================');
  
  // 启动WebUI服务器
  if (config.webui && config.webui.enabled) {
    const webPort = config.webui.port || 9999;
    const webHost = config.webui.host || '0.0.0.0';

    app.listen(webPort, webHost, () => {
      console.log(`WebUI管理界面已启动: http://${webHost}:${webPort}`);
      console.log('==========================================');
    });
  }
}

// 优雅关闭
function gracefulShutdown() {
  log('info', '收到停止信号，正在关闭所有服务器...');
  console.log('正在停止所有服务器...');
  
  // 停止所有TCP转发服务器
  for (const [key, { server }] of servers) {
    server.close();
  }
  
  // 清理连接
  connections.clear();
  
  console.log('所有服务器已停止');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 启动服务器
startServer(); 