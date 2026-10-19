const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// 数据目录 - 用于存储用户配置（持久化）
const DATA_DIR = process.env.TCPMAPPING_DATA_DIR || path.join(os.homedir(), '.tcpmapping');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_NAME = 'tcpmapping.sid';
const VERSION = require('./package.json').version;

// 默认认证策略（仅在认证配置缺少对应字段时补齐，不会创建默认用户）
const DEFAULT_PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false,
  passwordExpireDays: 90
};

const DEFAULT_SESSION_CONFIG = {
  sessionTimeout: 24,
  maxFailedAttempts: 5,
  lockoutDuration: 30
};

// 日志级别定义
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// 全局变量
let config = {};
const servers = new Map(); // key(host:port) -> { server, mapping }
const connections = new Map(); // 连接ID -> 连接信息（可序列化）
const connectionSockets = new Map(); // 连接ID -> { clientSocket, targetSocket, finalize }
const mappingStats = new Map(); // 映射ID -> 累计统计
const connectionHistory = []; // 最近关闭的连接记录（有界）
const pendingStarts = new Set(); // 正在启动的映射
const loginAttempts = new Map(); // IP -> { count, lastAttempt }

const CONNECTION_HISTORY_LIMIT = 500; // 最多保留的已关闭连接记录数

// 认证配置
let authConfig = null;

// 用于防止通过响应时间枚举用户名
let dummyPasswordHash = null;

// HTTP 服务实例
let httpServer = null;
let shuttingDown = false;

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
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

// 原子写入文件，避免写入过程中崩溃导致配置损坏
function writeFileAtomic(filePath, data, mode) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const options = mode ? { mode } : undefined;
  fs.writeFileSync(tmpPath, data, options);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      // 忽略清理失败
    }
    throw error;
  }
}

// 查找认证配置文件（仅限用户目录，不使用包安装目录）
function findAuthConfigPath() {
  const candidates = [
    path.join(process.cwd(), 'auth-config.json'),
    path.join(DATA_DIR, 'auth-config.json')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// 加载认证配置
function loadAuthConfig() {
  const authConfigPath = findAuthConfigPath();
  if (!authConfigPath) {
    console.error('警告: 未找到 auth-config.json，WebUI 管理界面将不可用');
    console.error('请运行 "tcpmapping setup-password" 或 "npm run setup-password" 设置管理员密码');
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(authConfigPath, 'utf8'));

    if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
      console.error(`警告: 认证配置 ${authConfigPath} 中没有有效用户，WebUI 管理界面将不可用`);
      return null;
    }

    // 补齐策略配置，兼容旧版本配置
    parsed.passwordPolicy = { ...DEFAULT_PASSWORD_POLICY, ...(parsed.passwordPolicy || {}) };
    parsed.sessionConfig = { ...DEFAULT_SESSION_CONFIG, ...(parsed.sessionConfig || {}) };

    console.log(`加载认证配置: ${authConfigPath}`);
    return parsed;
  } catch (error) {
    console.error(`警告: 读取认证配置失败 (${error.message})，WebUI 管理界面将不可用`);
    return null;
  }
}

// 验证用户密码
function validateUserCredentials(username, password) {
  if (!authConfig || !Array.isArray(authConfig.users)) {
    return { success: false, message: '系统尚未配置管理员密码，请运行 tcpmapping setup-password' };
  }

  const user = authConfig.users.find(u => u.username === username);
  const hash = user && typeof user.passwordHash === 'string'
    ? user.passwordHash
    : dummyPasswordHash;

  let passwordMatches = false;
  try {
    passwordMatches = bcrypt.compareSync(password || '', hash);
  } catch (error) {
    passwordMatches = false;
  }

  // 统一提示，避免通过错误信息枚举用户名
  if (!user || user.enabled === false || !passwordMatches) {
    return { success: false, message: '用户名或密码错误' };
  }

  // 检查密码是否过期
  const expireDays = Number(authConfig.passwordPolicy.passwordExpireDays) || 0;
  if (expireDays > 0) {
    const changedAt = Date.parse(user.lastPasswordChange);
    if (!Number.isFinite(changedAt)) {
      return { success: false, message: '密码状态异常，请运行 tcpmapping setup-password 重新设置密码' };
    }
    if (Date.now() - changedAt > expireDays * 24 * 60 * 60 * 1000) {
      return { success: false, message: `密码已超过 ${expireDays} 天未修改，请运行 tcpmapping setup-password 重置` };
    }
  }

  return { success: true, user: user };
}

// 清理过期的登录失败记录
function pruneLoginAttempts() {
  const lockoutTime = (authConfig ? authConfig.sessionConfig.lockoutDuration : 30) * 60 * 1000;
  const now = Date.now();
  for (const [ip, attempts] of loginAttempts) {
    if (now - attempts.lastAttempt > lockoutTime * 2) {
      loginAttempts.delete(ip);
    }
  }
}

// 检查登录尝试限制
function checkLoginAttempts(clientIP) {
  pruneLoginAttempts();

  const attempts = loginAttempts.get(clientIP) || { count: 0, lastAttempt: 0 };
  const sessionConfig = authConfig ? authConfig.sessionConfig : DEFAULT_SESSION_CONFIG;
  const now = Date.now();
  const lockoutTime = sessionConfig.lockoutDuration * 60 * 1000;

  if (attempts.count >= sessionConfig.maxFailedAttempts) {
    if (now - attempts.lastAttempt < lockoutTime) {
      const remainingTime = Math.ceil((lockoutTime - (now - attempts.lastAttempt)) / 1000 / 60);
      return {
        allowed: false,
        message: `由于多次登录失败，账户已被锁定，请${remainingTime}分钟后再试`
      };
    }

    // 锁定期已过，重置计数
    loginAttempts.set(clientIP, { count: 0, lastAttempt: now });
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

// 使用环境变量覆盖 WebUI 监听配置
function applyEnvOverrides(loadedConfig) {
  if (process.env.WEBUI_PORT && isValidPort(process.env.WEBUI_PORT)) {
    loadedConfig.webui.port = Number(process.env.WEBUI_PORT);
  }
  if (process.env.WEBUI_HOST && isValidHost(process.env.WEBUI_HOST)) {
    loadedConfig.webui.host = process.env.WEBUI_HOST;
  }
  return loadedConfig;
}

// 读取配置文件
function loadConfig() {
  const defaults = getDefaultConfig();

  let configPath = null;
  try {
    configPath = getConfigPath('config.json');
    if (!configPath) {
      console.log('未找到配置文件，使用默认配置');
      console.log('运行 "tcpmapping init" 创建配置文件');
      return applyEnvOverrides(defaults);
    }

    const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`加载配置文件: ${configPath}`);

    if (!Array.isArray(loadedConfig.mappings)) {
      loadedConfig.mappings = [];
    }

    // 规范映射数据，补齐缺失字段
    loadedConfig.mappings = loadedConfig.mappings
      .filter(mapping => mapping && typeof mapping === 'object')
      .map((mapping, index) => {
        if (!mapping.name || typeof mapping.name !== 'string') {
          mapping.name = `映射${index + 1}`;
        }
        if (!mapping.listen || typeof mapping.listen !== 'object') {
          mapping.listen = { host: '0.0.0.0', port: 0 };
        } else {
          mapping.listen.host = String(mapping.listen.host || '0.0.0.0').trim();
          mapping.listen.port = Number(mapping.listen.port);
        }
        if (!mapping.target || typeof mapping.target !== 'object') {
          mapping.target = { host: '', port: 0 };
        } else {
          mapping.target.host = String(mapping.target.host || '').trim();
          mapping.target.port = Number(mapping.target.port);
        }
        if (!mapping.id || typeof mapping.id !== 'string') {
          mapping.id = generateMappingId();
        }
        return mapping;
      });

    // 提示重复的监听地址和端口
    const seenListen = new Set();
    loadedConfig.mappings.forEach(mapping => {
      const key = `${mapping.listen.host}:${mapping.listen.port}`;
      if (seenListen.has(key)) {
        console.warn(`警告: 检测到重复的监听地址 ${key}，仅第一个会生效，请检查配置文件`);
      }
      seenListen.add(key);
    });

    loadedConfig.webui = { ...defaults.webui, ...(loadedConfig.webui || {}) };
    loadedConfig.logging = { ...defaults.logging, ...(loadedConfig.logging || {}) };

    // 支持通过环境变量覆盖 WebUI 监听配置
    return applyEnvOverrides(loadedConfig);
  } catch (error) {
    console.error(`读取配置文件失败 (${configPath || 'config.json'}):`, error.message);
    console.error('已使用默认配置继续运行，原文件不会被覆盖');
    return applyEnvOverrides(defaults);
  }
}

// 获取默认配置
function getDefaultConfig() {
  return {
    mappings: [],
    webui: {
      enabled: true,
      port: 9999,
      // 默认只监听本机，避免管理面板暴露到公网
      host: '127.0.0.1'
    },
    logging: {
      enabled: true,
      level: 'info'
    },
    timeouts: {
      connect: 30000,
      idle: 300000
    }
  };
}

// 保存配置文件
function saveConfig(newConfig) {
  try {
    const configPath = getConfigSavePath('config.json');
    writeFileAtomic(configPath, JSON.stringify(newConfig, null, 2));
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
  if (!config.logging || config.logging.enabled === false) {
    return;
  }

  const configLevel = config.logging.level || 'info';
  const currentLevelValue = LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : 999;
  const configLevelValue = LOG_LEVELS[configLevel] !== undefined ? LOG_LEVELS[configLevel] : 2;

  // 只有当前日志级别的优先级 <= 配置级别优先级时才输出
  if (currentLevelValue <= configLevelValue) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

// 生成连接ID
function generateConnectionId() {
  return crypto.randomBytes(8).toString('hex');
}

// 生成映射唯一ID
function generateMappingId() {
  return crypto.randomBytes(8).toString('hex');
}

// 格式化 host:port，IPv6 地址自动加方括号
function formatEndpoint(host, port) {
  if (!host) return `:${port}`;
  const value = String(host);
  return value.includes(':') ? `[${value}]:${port}` : `${value}:${port}`;
}

// 格式化毫秒时长为易读文本
function formatDurationMs(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  if (totalSeconds < 86400) return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
  return `${Math.floor(totalSeconds / 86400)}d ${Math.floor((totalSeconds % 86400) / 3600)}h`;
}

// API 英文文案（用于 WebUI 切换到英文时）
const API_MESSAGES_EN = {
  '需要登录': 'Authentication required',
  '非法请求来源': 'Invalid request origin',
  '跨站请求被拒绝': 'Cross-site request rejected',
  '请输入用户名和密码': 'Please enter username and password',
  '用户名或密码错误': 'Invalid username or password',
  '登录成功': 'Login successful',
  '已登出': 'Logged out',
  '登录失败，请稍后重试': 'Login failed, please try again later',
  '系统尚未配置管理员密码，请运行 tcpmapping setup-password': 'Administrator password is not configured. Run tcpmapping setup-password first.',
  '系统尚未配置管理员密码，请先在服务器上运行 tcpmapping setup-password': 'Administrator password is not configured. Run tcpmapping setup-password on the server first.',
  '密码状态异常，请运行 tcpmapping setup-password 重新设置密码': 'Password state is invalid. Run tcpmapping setup-password to reset it.',
  '映射不存在': 'Mapping not found',
  '该监听地址和端口已存在映射': 'A mapping with this listen address and port already exists',
  '保存配置失败': 'Failed to save configuration',
  '端口映射已启动': 'Port mapping started',
  '端口映射已停止': 'Port mapping stopped',
  '端口映射已在运行': 'Port mapping is already running',
  '端口映射正在启动，请稍后重试': 'Port mapping is starting, please try again later',
  '端口映射不存在或未在运行': 'Port mapping does not exist or is not running',
  '端口映射已更新': 'Port mapping updated',
  '端口映射已删除': 'Port mapping deleted',
  '接口不存在': 'API endpoint not found',
  '服务器内部错误': 'Internal server error',
  '映射名称不能为空': 'Mapping name is required',
  '映射名称不能超过 100 个字符': 'Mapping name must not exceed 100 characters',
  '监听端口必须在 1-65535 范围内': 'Listen port must be between 1 and 65535',
  '监听地址格式无效': 'Invalid listen address',
  '目标主机地址格式无效': 'Invalid target host address',
  '目标端口必须在 1-65535 范围内': 'Target port must be between 1 and 65535'
};

// 动态消息（含变量）的英文转换
const API_MESSAGE_PATTERNS_EN = [
  [/^密码已超过 (\d+) 天未修改，请运行 tcpmapping setup-password 重置$/,
    (match, days) => `Password has not been changed for ${days} days. Run tcpmapping setup-password to reset it.`],
  [/^由于多次登录失败，账户已被锁定，请(\d+)分钟后再试$/,
    (match, minutes) => `Account locked after multiple failed attempts. Try again in ${minutes} minute(s).`],
  [/^监听端口 (.+) 已被占用$/,
    (match, address) => `Port ${address} is already in use`],
  [/^启动失败: (.+)$/,
    (match, detail) => `Failed to start: ${detail}`]
];

// 将 API 返回的中文提示转换为目标语言
function localizeApiMessage(message, lang) {
  if (lang !== 'en' || typeof message !== 'string') {
    return message;
  }

  if (API_MESSAGES_EN[message]) {
    return API_MESSAGES_EN[message];
  }

  for (const [pattern, build] of API_MESSAGE_PATTERNS_EN) {
    const match = message.match(pattern);
    if (match) {
      return build(...match);
    }
  }

  // 校验错误使用 "; " 拼接，逐条翻译
  if (message.includes('; ')) {
    return message.split('; ').map(part => localizeApiMessage(part, lang)).join('; ');
  }

  return message;
}

// 读取请求语言（前端通过 X-Language 指定）
function getRequestLanguage(req) {
  const explicit = String(req.get('X-Language') || '').toLowerCase();
  if (explicit.startsWith('zh')) return 'zh';
  if (explicit.startsWith('en')) return 'en';

  const acceptLanguage = String(req.get('Accept-Language') || '').toLowerCase();
  if (acceptLanguage.trim()) {
    // Accept-Language 的第一项是客户端的首选语言
    return acceptLanguage.trim().startsWith('zh') ? 'zh' : 'en';
  }

  return 'zh';
}

// 连接关闭原因英文对照
const CLOSE_REASONS_EN = {
  '客户端关闭': 'Client closed',
  '目标服务器关闭': 'Target closed',
  '目标连接超时': 'Target connect timeout',
  '目标连接空闲超时': 'Target idle timeout',
  '客户端空闲超时': 'Client idle timeout',
  '目标连接错误': 'Target connection error',
  '客户端连接错误': 'Client connection error',
  '端口映射已停止': 'Mapping stopped',
  '服务正在关闭': 'Server shutting down',
  '连接被主动断开': 'Closed by administrator'
};

function localizeCloseReason(reason, lang) {
  if (lang !== 'en') {
    return reason;
  }
  return CLOSE_REASONS_EN[reason] || reason;
}

// 验证端口号
function isValidPort(port) {
  const p = Number(port);
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

// 验证IP地址或主机名
function isValidHost(host) {
  if (!host || typeof host !== 'string') return false;

  const value = host.trim();
  if (!value || value.length > 253) return false;

  // IPv4 / IPv6
  if (net.isIP(value)) return true;

  // 域名
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return hostnamePattern.test(value);
}

// 验证映射配置
function validateMappingInput(mapping) {
  const errors = [];

  if (!mapping.name || typeof mapping.name !== 'string' || mapping.name.trim().length === 0) {
    errors.push('映射名称不能为空');
  } else if (mapping.name.trim().length > 100) {
    errors.push('映射名称不能超过 100 个字符');
  }

  if (!mapping.listen || !isValidPort(mapping.listen.port)) {
    errors.push('监听端口必须在 1-65535 范围内');
  }

  if (!mapping.listen || !isValidHost(mapping.listen.host)) {
    errors.push('监听地址格式无效');
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

// 读取超时配置（毫秒）
function getTimeouts() {
  const defaults = getDefaultConfig().timeouts;
  const timeouts = config.timeouts || {};

  const connect = Number(timeouts.connect);
  const idle = Number(timeouts.idle);

  return {
    // 连接超时至少 1 秒
    connect: Number.isFinite(connect) && connect > 0 ? Math.max(1000, connect) : defaults.connect,
    // 0 表示禁用空闲超时
    idle: Number.isFinite(idle) && idle >= 0 ? idle : defaults.idle
  };
}

// 获取映射的累计统计
function getMappingStats(mappingId) {
  let stats = mappingStats.get(mappingId);
  if (!stats) {
    stats = {
      totalConnections: 0,
      bytesReceived: 0,
      bytesSent: 0
    };
    mappingStats.set(mappingId, stats);
  }
  return stats;
}

// 主动销毁一条转发连接
function destroyConnection(connectionId, reason) {
  const pair = connectionSockets.get(connectionId);

  // 走统一的收尾逻辑，确保记录持续时长与关闭原因
  if (pair && typeof pair.finalize === 'function') {
    pair.finalize(reason || '连接被主动断开', 'info');
    return;
  }

  connections.delete(connectionId);
  connectionSockets.delete(connectionId);

  if (!pair) {
    return;
  }

  if (pair.clientSocket && !pair.clientSocket.destroyed) {
    try {
      pair.clientSocket.destroy();
    } catch (error) {
      // 忽略销毁错误
    }
  }

  if (pair.targetSocket && !pair.targetSocket.destroyed) {
    try {
      pair.targetSocket.destroy();
    } catch (error) {
      // 忽略销毁错误
    }
  }
}

// 创建转发连接
function createForwardConnection(clientSocket, mapping) {
  const connectionId = generateConnectionId();
  const clientInfo = formatEndpoint(clientSocket.remoteAddress, clientSocket.remotePort);
  const targetAddress = formatEndpoint(mapping.target.host, mapping.target.port);
  // clientSocket.localAddress 是实际命中的网卡地址，比 0.0.0.0 更有参考价值
  const listenAddress = clientSocket.localAddress
    ? formatEndpoint(clientSocket.localAddress, clientSocket.localPort)
    : formatEndpoint(mapping.listen.host, mapping.listen.port);
  const stats = getMappingStats(mapping.id);

  stats.totalConnections++;

  // 记录连接信息
  connections.set(connectionId, {
    id: connectionId,
    mappingId: mapping.id,
    mappingName: mapping.name,
    sourceHost: mapping.listen.host,
    sourcePort: mapping.listen.port,
    listenAddress: listenAddress,
    clientAddress: clientInfo,
    targetAddress: targetAddress,
    startTime: new Date(),
    lastActivity: Date.now(),
    bytesReceived: 0,
    bytesSent: 0,
    status: 'connecting'
  });

  const targetSocket = new net.Socket({ allowHalfOpen: true });
  const pair = { clientSocket, targetSocket, finalize: null };
  connectionSockets.set(connectionId, pair);

  const timeouts = getTimeouts();
  let finished = false;

  // 降低转发延迟，并启用 TCP KeepAlive 检测死连接
  clientSocket.setNoDelay(true);
  targetSocket.setNoDelay(true);
  clientSocket.setKeepAlive(true, 60000);
  targetSocket.setKeepAlive(true, 60000);

  const updateActivity = () => {
    const conn = connections.get(connectionId);
    if (conn) {
      conn.lastActivity = Date.now();
    }
  };

  // 统一收尾：只执行一次，避免重复销毁
  const finalize = (reason, level) => {
    if (finished) return;
    finished = true;

    const conn = connections.get(connectionId);

    connections.delete(connectionId);
    connectionSockets.delete(connectionId);

    // 记录已关闭连接的摘要，便于事后查询源地址、目的地址与持续时长
    if (conn) {
      const endTime = new Date();
      const durationMs = Math.max(0, endTime.getTime() - conn.startTime.getTime());

      connectionHistory.push({
        id: conn.id,
        mappingId: conn.mappingId,
        mappingName: conn.mappingName,
        listenAddress: conn.listenAddress,
        clientAddress: conn.clientAddress,
        targetAddress: conn.targetAddress,
        startTime: conn.startTime,
        endTime: endTime,
        durationMs: durationMs,
        bytesReceived: conn.bytesReceived,
        bytesSent: conn.bytesSent,
        status: conn.status,
        closeReason: reason
      });

      if (connectionHistory.length > CONNECTION_HISTORY_LIMIT) {
        connectionHistory.splice(0, connectionHistory.length - CONNECTION_HISTORY_LIMIT);
      }

      log(level || 'info',
        `[${mapping.name}] 连接关闭: ${clientInfo} -> ${targetAddress}，` +
        `持续 ${formatDurationMs(durationMs)}，↑${conn.bytesReceived}B ↓${conn.bytesSent}B (${reason})`);
    } else {
      log(level || 'info', `[${mapping.name}] 连接关闭: ${clientInfo} (${reason})`);
    }

    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!targetSocket.destroyed) targetSocket.destroy();
  };

  pair.finalize = finalize;

  // 连接超时 / 空闲超时
  if (timeouts.connect > 0) {
    targetSocket.setTimeout(timeouts.connect);
  }

  targetSocket.once('connect', () => {
    const conn = connections.get(connectionId);
    if (conn) {
      conn.status = 'connected';
      conn.lastActivity = Date.now();
    }

    log('info', `[${mapping.name}] 已连接到目标服务器 ${targetAddress}`);

    if (timeouts.idle > 0) {
      targetSocket.setTimeout(timeouts.idle);
    } else {
      targetSocket.setTimeout(0);
    }
  });

  clientSocket.setTimeout(timeouts.idle > 0 ? timeouts.idle : 0);

  targetSocket.on('timeout', () => {
    const conn = connections.get(connectionId);
    const message = conn && conn.status === 'connecting' ? '目标连接超时' : '目标连接空闲超时';
    log('warn', `[${mapping.name}] ${message}: ${targetAddress}`);
    finalize(message, 'warn');
  });

  clientSocket.on('timeout', () => {
    log('warn', `[${mapping.name}] 客户端连接空闲超时: ${clientInfo}`);
    finalize('客户端空闲超时', 'warn');
  });

  // 错误处理
  targetSocket.on('error', (err) => {
    log('error', `[${mapping.name}] 目标服务器连接错误: ${err.message} (${targetAddress})`);
    finalize('目标连接错误', 'error');
  });

  clientSocket.on('error', (err) => {
    log('error', `[${mapping.name}] 客户端连接错误: ${err.message} (${clientInfo})`);
    finalize('客户端连接错误', 'error');
  });

  // 关闭事件（对端正常关闭）
  targetSocket.on('close', () => finalize('目标服务器关闭'));
  clientSocket.on('close', () => finalize('客户端关闭'));

  // 支持 TCP 半关闭：一个方向结束后仍允许另一个方向继续传输
  clientSocket.on('end', () => {
    if (!targetSocket.destroyed && targetSocket.writable) {
      targetSocket.end();
    }
  });

  targetSocket.on('end', () => {
    if (!clientSocket.destroyed && clientSocket.writable) {
      clientSocket.end();
    }
  });

  // 流量统计
  clientSocket.on('data', (data) => {
    updateActivity();
    const conn = connections.get(connectionId);
    if (conn) {
      conn.bytesReceived += data.length;
    }
    stats.bytesReceived += data.length;
  });

  targetSocket.on('data', (data) => {
    updateActivity();
    const conn = connections.get(connectionId);
    if (conn) {
      conn.bytesSent += data.length;
    }
    stats.bytesSent += data.length;
  });

  // 使用 pipe 转发，自动处理背压，避免慢速对端导致内存无限增长
  clientSocket.pipe(targetSocket, { end: false });
  targetSocket.pipe(clientSocket, { end: false });

  // 发起连接（最后执行，确保监听器已就绪）
  targetSocket.connect(mapping.target.port, mapping.target.host);
}

// 创建单个端口转发服务器
function createForwardingServer(mapping) {
  const server = net.createServer({ allowHalfOpen: true }, (clientSocket) => {
    log('info', `[${mapping.name}] 新客户端连接: ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
    createForwardConnection(clientSocket, mapping);
  });

  return server;
}

// 启动端口映射（等待监听结果后再返回）
function startMapping(mapping) {
  return new Promise((resolve) => {
    const key = `${mapping.listen.host}:${mapping.listen.port}`;

    if (servers.has(key)) {
      return resolve({ success: true, message: '端口映射已在运行' });
    }

    if (pendingStarts.has(key)) {
      return resolve({ success: false, message: '端口映射正在启动，请稍后重试' });
    }

    pendingStarts.add(key);

    const server = createForwardingServer(mapping);
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      pendingStarts.delete(key);
      resolve(result);
    };

    const onListenError = (err) => {
      log('error', `[${mapping.name}] 启动失败: ${err.message}`);
      finish({
        success: false,
        message: err.code === 'EADDRINUSE'
          ? `监听端口 ${mapping.listen.host}:${mapping.listen.port} 已被占用`
          : `启动失败: ${err.message}`
      });
    };

    server.once('error', onListenError);

    server.once('listening', () => {
      server.removeListener('error', onListenError);
      server.on('error', (err) => {
        log('error', `[${mapping.name}] 服务器运行错误: ${err.message}`);
        servers.delete(key);
        // 运行期出错后关闭监听，避免留下无法通过接口管理的端口
        try {
          server.close();
        } catch (closeError) {
          // 忽略关闭错误
        }
      });

      servers.set(key, { server, mapping });

      log('info', `[${mapping.name}] 转发服务器已启动，监听地址: ${mapping.listen.host}:${mapping.listen.port}`);
      log('info', `[${mapping.name}] 目标服务器: ${mapping.target.host}:${mapping.target.port}`);
      console.log(`✓ [${mapping.name}] ${mapping.listen.host}:${mapping.listen.port} -> ${mapping.target.host}:${mapping.target.port}`);

      finish({ success: true, message: '端口映射已启动' });
    });

    try {
      server.listen(mapping.listen.port, mapping.listen.host);
    } catch (error) {
      onListenError(error);
    }
  });
}

// 停止端口映射
function stopMapping(host, port) {
  const key = `${host}:${port}`;

  if (!servers.has(key)) {
    return { success: false, message: '端口映射不存在或未在运行' };
  }

  try {
    const { server } = servers.get(key);
    servers.delete(key);
    server.close();

    // 主动断开该映射下的所有活跃连接
    for (const [id, conn] of connections) {
      if (conn.sourceHost === host && conn.sourcePort === port) {
        destroyConnection(id, '端口映射已停止');
      }
    }

    log('info', `[${host}:${port}] 端口映射已停止`);
    return { success: true, message: '端口映射已停止' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 启动所有端口映射
async function startAllMappings() {
  for (let index = 0; index < config.mappings.length; index++) {
    const mapping = config.mappings[index];

    if (!mapping.listen || !mapping.target || !isValidPort(mapping.listen.port) || !isValidPort(mapping.target.port)) {
      console.error(`映射配置 ${index + 1} 缺少必要的 listen 或 target 配置，已跳过`);
      continue;
    }

    const result = await startMapping(mapping);
    if (!result.success) {
      console.error(`映射配置 ${index + 1} (${mapping.name}) 启动失败: ${result.message}`);
    }
  }
}

// 生成或读取 session secret
function getSessionSecret() {
  ensureDataDir();

  const secretPath = path.join(DATA_DIR, '.session-secret');
  const legacyPath = path.join(__dirname, '.session-secret');

  // 兼容旧版本：把包目录中的 secret 迁移到数据目录
  try {
    if (!fs.existsSync(secretPath) && fs.existsSync(legacyPath)) {
      fs.copyFileSync(legacyPath, secretPath);
      try {
        fs.chmodSync(secretPath, 0o600);
      } catch (error) {
        // Windows 上可能不支持 chmod，忽略
      }
    }
  } catch (error) {
    // 忽略迁移失败
  }

  try {
    if (fs.existsSync(secretPath)) {
      const secret = fs.readFileSync(secretPath, 'utf8').trim();
      if (secret.length >= 32) {
        return secret;
      }
    }
  } catch (error) {
    // 忽略读取错误
  }

  // 生成新的随机 secret
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    writeFileAtomic(secretPath, secret, 0o600);
  } catch (error) {
    console.warn('警告: 无法保存 session secret，重启后会话将失效');
  }
  return secret;
}

// 加载认证配置（需在中间件创建前完成）
authConfig = loadAuthConfig();

// 生成用于时序混淆的哈希
dummyPasswordHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const app = express();
app.disable('x-powered-by');

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  next();
});

// 请求体解析（限制大小，避免恶意大请求）
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// 根据请求语言自动本地化 API 提示信息
app.use((req, res, next) => {
  req.lang = getRequestLanguage(req);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      body.message = localizeApiMessage(body.message, req.lang);
    }
    return originalJson(body);
  };

  next();
});

// 会话配置
const sessionTimeoutHours = authConfig
  ? (Number(authConfig.sessionConfig.sessionTimeout) || DEFAULT_SESSION_CONFIG.sessionTimeout)
  : DEFAULT_SESSION_CONFIG.sessionTimeout;

app.use(session({
  name: SESSION_NAME,
  secret: process.env.SESSION_SECRET || getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // 通过 HTTPS 反向代理部署时可按需改为 true
    maxAge: sessionTimeoutHours * 60 * 60 * 1000
  }
}));

// API 响应不做缓存
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// 简单的跨站请求防护：拒绝 Origin 与 Host 不一致的写操作
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const origin = req.get('origin');
  if (!origin) {
    return next();
  }

  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(req.get('host') || '').toLowerCase();
    if (originHost !== requestHost) {
      return res.status(403).json({ success: false, message: '跨站请求被拒绝' });
    }
  } catch (error) {
    return res.status(403).json({ success: false, message: '非法请求来源' });
  }

  next();
});

// 认证中间件（API）
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ success: false, message: '需要登录' });
}

// 认证中间件（页面）
function requirePageAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/login');
}

// 页面路由（放在静态文件之前，避免绕过登录直接访问 HTML）
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/login.html', (req, res) => {
  res.redirect('/login');
});

app.get('/dashboard', requirePageAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

app.get('/dashboard.html', requirePageAuth, (req, res) => {
  res.redirect('/dashboard');
});

// 静态文件服务（使用绝对路径，避免受启动目录影响）
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

// 在连接列表中按映射汇总当前活跃连接
function buildActiveStats() {
  const active = new Map();
  for (const conn of connections.values()) {
    let item = active.get(conn.mappingId);
    if (!item) {
      item = { count: 0, bytesReceived: 0, bytesSent: 0 };
      active.set(conn.mappingId, item);
    }
    item.count++;
    item.bytesReceived += conn.bytesReceived;
    item.bytesSent += conn.bytesSent;
  }
  return active;
}

// 根据 ID 或索引查找映射
function findMapping(identifier) {
  let index = config.mappings.findIndex(m => m.id === identifier);

  if (index === -1) {
    const parsed = parseInt(identifier, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed < config.mappings.length) {
      index = parsed;
    }
  }

  if (index === -1) {
    return null;
  }

  return { mapping: config.mappings[index], index };
}

// 从请求体构造映射对象（保留未提供的字段）
function buildMappingFromBody(body, base) {
  const source = body || {};
  const listen = source.listen && typeof source.listen === 'object' ? source.listen : {};
  const target = source.target && typeof source.target === 'object' ? source.target : {};

  return {
    id: (base && base.id) || generateMappingId(),
    name: source.name !== undefined ? String(source.name).trim() : (base ? base.name : ''),
    listen: {
      host: listen.host !== undefined ? String(listen.host).trim() : (base ? base.listen.host : '0.0.0.0'),
      port: listen.port !== undefined ? Number(listen.port) : (base ? base.listen.port : 0)
    },
    target: {
      host: target.host !== undefined ? String(target.host).trim() : (base ? base.target.host : ''),
      port: target.port !== undefined ? Number(target.port) : (base ? base.target.port : 0)
    }
  };
}

// ==================== 认证 API ====================

// API: 登录
app.post('/api/login', (req, res) => {
  if (!authConfig) {
    return res.status(503).json({
      success: false,
      message: '系统尚未配置管理员密码，请先在服务器上运行 tcpmapping setup-password'
    });
  }

  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '请输入用户名和密码' });
  }

  const clientIP = req.ip || req.socket.remoteAddress;

  // 检查登录尝试限制
  const attemptCheck = checkLoginAttempts(clientIP);
  if (!attemptCheck.allowed) {
    return res.status(429).json({ success: false, message: attemptCheck.message });
  }

  const validation = validateUserCredentials(username, password);

  if (!validation.success) {
    recordLoginFailure(clientIP);
    log('warn', `用户 ${username} 从 ${clientIP} 登录失败: ${validation.message}`);
    return res.status(401).json({ success: false, message: validation.message });
  }

  // 登录成功后重建会话，防止会话固定攻击
  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      log('error', `创建会话失败: ${regenerateError.message}`);
      return res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
    }

    req.session.authenticated = true;
    req.session.username = validation.user.username;
    req.session.userRole = validation.user.role || 'admin';

    req.session.save((saveError) => {
      if (saveError) {
        log('error', `保存会话失败: ${saveError.message}`);
        return res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
      }

      clearLoginFailures(clientIP);
      log('info', `用户 ${validation.user.username} 从 ${clientIP} 登录成功`);
      res.json({ success: true, message: '登录成功' });
    });
  });
});

// API: 登出
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(SESSION_NAME, { path: '/' });
    res.json({ success: true, message: '已登出' });
  });
});

// ==================== 映射管理 API ====================

// API: 获取端口映射列表
app.get('/api/mappings', requireAuth, (req, res) => {
  const activeStats = buildActiveStats();

  const mappings = config.mappings.map(mapping => {
    const active = activeStats.get(mapping.id) || { count: 0, bytesReceived: 0, bytesSent: 0 };
    const total = getMappingStats(mapping.id);
    const runtime = servers.get(`${mapping.listen.host}:${mapping.listen.port}`);

    return {
      ...mapping,
      status: runtime && runtime.mapping === mapping ? 'running' : 'stopped',
      connectionCount: active.count,
      bytesReceived: active.bytesReceived,
      bytesSent: active.bytesSent,
      totalConnections: total.totalConnections,
      totalBytesReceived: total.bytesReceived,
      totalBytesSent: total.bytesSent
    };
  });

  res.json({ success: true, data: mappings });
});

// API: 添加端口映射
app.post('/api/mappings', requireAuth, async (req, res) => {
  const mapping = buildMappingFromBody(req.body, null);

  const validation = validateMappingInput(mapping);
  if (!validation.isValid) {
    return res.status(400).json({ success: false, message: validation.errors.join('; ') });
  }

  const exists = config.mappings.some(m =>
    m.listen.host === mapping.listen.host && m.listen.port === mapping.listen.port
  );

  if (exists) {
    return res.status(400).json({ success: false, message: '该监听地址和端口已存在映射' });
  }

  // 先尝试启动，成功后再写入配置，避免出现"配置存在但端口未监听"的状态
  const result = await startMapping(mapping);
  if (!result.success) {
    return res.status(400).json(result);
  }

  config.mappings.push(mapping);
  getMappingStats(mapping.id);

  if (!saveConfig(config)) {
    config.mappings.pop();
    stopMapping(mapping.listen.host, mapping.listen.port);
    return res.status(500).json({ success: false, message: '保存配置失败' });
  }

  res.json({ ...result, data: mapping });
});

// API: 更新映射配置
app.put('/api/mappings/:identifier', requireAuth, async (req, res) => {
  const found = findMapping(req.params.identifier);
  if (!found) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const { mapping: oldMapping, index } = found;
  const newMapping = buildMappingFromBody(req.body, oldMapping);

  const validation = validateMappingInput(newMapping);
  if (!validation.isValid) {
    return res.status(400).json({ success: false, message: validation.errors.join('; ') });
  }

  const listenChanged = oldMapping.listen.host !== newMapping.listen.host ||
    oldMapping.listen.port !== newMapping.listen.port;

  // 仅修改名称或目标时无需重启监听，避免断开已有连接；
  // 新连接会自动使用新的目标地址。
  if (!listenChanged) {
    const previousName = oldMapping.name;
    const previousTarget = { ...oldMapping.target };

    oldMapping.name = newMapping.name;
    oldMapping.target = newMapping.target;

    if (!saveConfig(config)) {
      oldMapping.name = previousName;
      oldMapping.target = previousTarget;
      return res.status(500).json({ success: false, message: '保存配置失败' });
    }

    return res.json({ success: true, message: '端口映射已更新', data: oldMapping });
  }

  const exists = config.mappings.some((m, i) =>
    i !== index &&
    m.listen.host === newMapping.listen.host &&
    m.listen.port === newMapping.listen.port
  );
  if (exists) {
    return res.status(400).json({ success: false, message: '该监听地址和端口已存在映射' });
  }

  const wasRunning = servers.has(`${oldMapping.listen.host}:${oldMapping.listen.port}`);

  if (wasRunning) {
    stopMapping(oldMapping.listen.host, oldMapping.listen.port);
  }

  let startResult = { success: true, message: '端口映射已更新' };
  if (wasRunning) {
    startResult = await startMapping(newMapping);
    if (!startResult.success) {
      // 启动失败，恢复旧映射
      await startMapping(oldMapping);
      return res.status(400).json(startResult);
    }
  }

  config.mappings[index] = newMapping;

  if (!saveConfig(config)) {
    // 保存失败，回滚
    config.mappings[index] = oldMapping;
    if (wasRunning) {
      stopMapping(newMapping.listen.host, newMapping.listen.port);
      await startMapping(oldMapping);
    }
    return res.status(500).json({ success: false, message: '保存配置失败' });
  }

  res.json({ success: true, message: '端口映射已更新', data: newMapping });
});

// API: 删除端口映射 (支持ID或索引)
app.delete('/api/mappings/:identifier', requireAuth, (req, res) => {
  const found = findMapping(req.params.identifier);
  if (!found) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const { mapping, index } = found;
  const wasRunning = servers.has(`${mapping.listen.host}:${mapping.listen.port}`);

  stopMapping(mapping.listen.host, mapping.listen.port);
  config.mappings.splice(index, 1);
  mappingStats.delete(mapping.id);

  if (!saveConfig(config)) {
    // 保存失败，回滚
    config.mappings.splice(index, 0, mapping);
    if (wasRunning) {
      startMapping(mapping);
    }
    return res.status(500).json({ success: false, message: '保存配置失败' });
  }

  res.json({ success: true, message: '端口映射已删除' });
});

// API: 启动单个映射
app.post('/api/mappings/:identifier/start', requireAuth, async (req, res) => {
  const found = findMapping(req.params.identifier);
  if (!found) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const result = await startMapping(found.mapping);
  res.json(result);
});

// API: 停止单个映射
app.post('/api/mappings/:identifier/stop', requireAuth, (req, res) => {
  const found = findMapping(req.params.identifier);
  if (!found) {
    return res.status(404).json({ success: false, message: '映射不存在' });
  }

  const result = stopMapping(found.mapping.listen.host, found.mapping.listen.port);
  res.json(result);
});

// ==================== 监控 API ====================

// API: 获取连接状态
app.get('/api/connections', requireAuth, (req, res) => {
  const now = Date.now();
  const connectionList = Array.from(connections.values()).map(conn => ({
    ...conn,
    durationMs: Math.max(0, now - conn.startTime.getTime())
  }));

  // 按监听地址 + 端口分组统计
  const stats = {};
  connectionList.forEach(conn => {
    const key = `${conn.sourceHost}:${conn.sourcePort}`;
    if (!stats[key]) {
      stats[key] = {
        host: conn.sourceHost,
        port: conn.sourcePort,
        mappingName: conn.mappingName,
        totalConnections: 0,
        connections: []
      };
    }
    stats[key].totalConnections++;
    stats[key].connections.push(conn);
  });

  res.json({
    success: true,
    data: {
      total: connectionList.length,
      byPort: Object.values(stats)
    }
  });
});

// API: 获取最近关闭的连接记录（可记录源地址、目的地址、持续时长）
app.get('/api/connections/history', requireAuth, (req, res) => {
  const mappingId = typeof req.query.mappingId === 'string' ? req.query.mappingId : '';

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 50;
  }
  limit = Math.min(limit, 200);

  const matched = mappingId
    ? connectionHistory.filter(item => item.mappingId === mappingId)
    : connectionHistory;

  res.json({
    success: true,
    data: {
      total: matched.length,
      limit: limit,
      items: matched.slice(-limit).reverse().map(item => ({
        ...item,
        closeReason: localizeCloseReason(item.closeReason, req.lang)
      }))
    }
  });
});

// API: 获取系统状态
app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      version: VERSION,
      username: req.session.username || 'admin',
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
    version: VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeMappings: servers.size,
    activeConnections: connections.size
  });
});

// 未匹配的 API 返回 JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('请求处理错误:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// 启动程序
async function startServer() {
  config = loadConfig();

  console.log('==========================================');
  console.log(`TCP转发服务器 v${VERSION} 正在启动...`);
  console.log('端口映射配置:');
  await startAllMappings();
  console.log('==========================================');

  // 启动WebUI服务器
  if (config.webui && config.webui.enabled !== false) {
    if (!authConfig) {
      console.error('WebUI 未启动：缺少可用的认证配置');
      console.error('请运行 "tcpmapping setup-password" 设置管理员密码后重启服务');
      return;
    }

    const webPort = isValidPort(config.webui.port) ? Number(config.webui.port) : 9999;
    const webHost = isValidHost(config.webui.host) ? config.webui.host : '127.0.0.1';

    httpServer = app.listen(webPort, webHost, () => {
      console.log(`WebUI管理界面已启动: http://${webHost === '0.0.0.0' || webHost === '::' ? 'localhost' : webHost}:${webPort}`);
      if (webHost === '0.0.0.0' || webHost === '::') {
        console.warn('警告: WebUI 监听在所有网卡上，请确保使用强密码并考虑通过防火墙限制访问');
      }
      console.log('==========================================');
    });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`WebUI 启动失败: 端口 ${webPort} 已被占用`);
      } else {
        console.error(`WebUI 启动失败: ${err.message}`);
      }
    });
  } else {
    console.log('WebUI 已禁用（config.json 中 webui.enabled = false）');
  }
}

// 优雅关闭
function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  log('info', `收到 ${signal || '停止'} 信号，正在关闭所有服务器...`);
  console.log('正在停止所有服务器...');

  // 停止接收新连接
  if (httpServer) {
    httpServer.close();
  }

  for (const { server } of servers.values()) {
    try {
      server.close();
    } catch (error) {
      // 忽略关闭错误
    }
  }
  servers.clear();

  // 断开所有转发连接
  for (const id of Array.from(connectionSockets.keys())) {
    destroyConnection(id, '服务正在关闭');
  }

  console.log('所有服务器已停止');

  // 给日志和连接一点清理时间后退出
  setTimeout(() => process.exit(0), 200).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

// 启动服务器
startServer().catch((error) => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});
