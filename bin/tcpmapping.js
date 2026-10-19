#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const APP_NAME = 'tcpmapping';
const DATA_DIR = process.env.TCPMAPPING_DATA_DIR || path.join(os.homedir(), '.tcpmapping');
const PID_FILE = path.join(DATA_DIR, 'tcpmapping.pid');
const LOG_FILE = path.join(DATA_DIR, 'tcpmapping.log');
const SERVER_FILE = path.join(__dirname, '..', 'server.js');
const SETUP_PASSWORD_FILE = path.join(__dirname, '..', 'setup-password.js');

// 获取命令行参数
const args = process.argv.slice(2);
const command = args[0] || 'help';

// 颜色输出（非 TTY 或设置了 NO_COLOR 时自动关闭）
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const colorize = (code) => (text) => useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text);

const colors = {
  green: colorize(32),
  red: colorize(31),
  yellow: colorize(33),
  blue: colorize(34),
  cyan: colorize(36),
  gray: colorize(90)
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

// 读取配置文件
function readConfig() {
  const candidates = [
    path.join(process.cwd(), 'config.json'),
    path.join(DATA_DIR, 'config.json')
  ];

  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        return { path: configPath, data: JSON.parse(fs.readFileSync(configPath, 'utf8')) };
      }
    } catch (error) {
      console.warn(colors.yellow(`警告: 配置文件解析失败 (${configPath}): ${error.message}`));
    }
  }

  return { path: null, data: null };
}

// 获取配置文件路径（按优先级）
function getConfigPath() {
  return readConfig().path;
}

// 获取认证配置文件路径
function getAuthConfigPath() {
  const candidates = [
    path.join(process.cwd(), 'auth-config.json'),
    path.join(DATA_DIR, 'auth-config.json')
  ];

  for (const authPath of candidates) {
    if (fs.existsSync(authPath)) {
      return authPath;
    }
  }

  return null;
}

// 获取 WebUI 访问信息
function getWebuiInfo() {
  const config = readConfig().data;
  const webui = (config && config.webui) || {};

  return {
    enabled: webui.enabled !== false,
    host: webui.host || '127.0.0.1',
    port: Number(webui.port) || 9999
  };
}

// 将监听地址转换为可访问地址
function getAccessHost(host) {
  if (host === '0.0.0.0' || host === '::' || !host) {
    return 'localhost';
  }
  if (host.includes(':')) {
    return `[${host}]`;
  }
  return host;
}

// 检查进程是否存在
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // 无权限说明进程存在（属于其他用户）
    return error.code === 'EPERM';
  }
}

// 检查进程是否运行
function isRunning() {
  ensureDataDir();

  if (!fs.existsSync(PID_FILE)) {
    return null;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);

  if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
    return pid;
  }

  // 进程不存在，清理过期的 PID 文件
  try {
    fs.unlinkSync(PID_FILE);
  } catch (error) {
    // 忽略清理失败
  }
  return null;
}

// 读取日志末尾内容
function readLogTail(lineCount) {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return null;
    }

    const stat = fs.statSync(LOG_FILE);
    const maxBytes = 64 * 1024;
    const size = Math.min(stat.size, maxBytes);
    if (size === 0) {
      return '';
    }

    const buffer = Buffer.alloc(size);
    const fd = fs.openSync(LOG_FILE, 'r');
    try {
      fs.readSync(fd, buffer, 0, size, stat.size - size);
    } finally {
      fs.closeSync(fd);
    }

    return buffer.toString('utf8').split('\n').slice(-lineCount).join('\n');
  } catch (error) {
    return null;
  }
}

// 启动服务
async function start() {
  const pid = isRunning();
  if (pid) {
    console.log(colors.yellow(`${APP_NAME} 已在运行 (PID: ${pid})`));
    return;
  }

  if (!getAuthConfigPath()) {
    console.log(colors.yellow('未设置管理员密码，请先运行:'));
    console.log(colors.cyan('  tcpmapping setup-password'));
    return;
  }

  ensureDataDir();
  console.log(colors.blue(`正在启动 ${APP_NAME}...`));

  const out = fs.openSync(LOG_FILE, 'a');
  const err = fs.openSync(LOG_FILE, 'a');

  let child;
  try {
    child = spawn(process.execPath, [SERVER_FILE], {
      detached: true,
      stdio: ['ignore', out, err],
      // 使用当前目录，以便 server 可以找到当前目录的 config.json
      cwd: process.cwd()
    });
  } finally {
    // 子进程已继承文件描述符，父进程可以关闭
    fs.closeSync(out);
    fs.closeSync(err);
  }

  fs.writeFileSync(PID_FILE, String(child.pid));
  child.unref();

  // 短暂等待，捕获启动即失败的情况（如端口被占用、配置错误）
  await delay(500);

  if (!isAlive(child.pid)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch (error) {
      // 忽略
    }
    console.log(colors.red(`${APP_NAME} 启动失败`));
    const tail = readLogTail(15);
    if (tail) {
      console.log(colors.gray('最近日志:'));
      console.log(tail);
    }
    console.log(colors.gray(`完整日志: ${LOG_FILE}`));
    process.exitCode = 1;
    return;
  }

  const webui = getWebuiInfo();
  console.log(colors.green(`${APP_NAME} 启动成功 (PID: ${child.pid})`));
  if (webui.enabled) {
    console.log(colors.cyan(`WebUI: http://${getAccessHost(webui.host)}:${webui.port}`));
    if (webui.host === '0.0.0.0' || webui.host === '::') {
      console.log(colors.yellow('提示: WebUI 监听在所有网卡上，请确保使用强密码'));
    }
  }
  console.log(colors.gray(`日志文件: ${LOG_FILE}`));
  const configPath = getConfigPath();
  if (configPath) {
    console.log(colors.gray(`配置文件: ${configPath}`));
  }
}

// 停止服务
async function stop() {
  const pid = isRunning();
  if (!pid) {
    console.log(colors.yellow(`${APP_NAME} 未在运行`));
    return;
  }

  console.log(colors.blue(`正在停止 ${APP_NAME} (PID: ${pid})...`));

  try {
    process.kill(pid, 'SIGTERM');

    // 最多等待 5 秒，让服务优雅退出
    let attempts = 0;
    while (attempts < 20 && isAlive(pid)) {
      await delay(250);
      attempts++;
    }

    // 仍未退出则强制终止
    if (isAlive(pid)) {
      console.log(colors.yellow('服务未在预期时间内退出，正在强制终止...'));
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        // 进程可能已退出
      }
      await delay(200);
    }

    try {
      fs.unlinkSync(PID_FILE);
    } catch (error) {
      // 忽略
    }

    console.log(colors.green(`${APP_NAME} 已停止`));
  } catch (error) {
    console.log(colors.red(`停止 ${APP_NAME} 失败: ${error.message}`));
  }
}

// 重启服务
async function restart() {
  console.log(colors.blue(`正在重启 ${APP_NAME}...`));
  await stop();
  await delay(300);
  await start();
}

// 请求健康检查接口
function fetchHealth(host, port) {
  return new Promise((resolve) => {
    const request = http.get({
      host: host,
      port: port,
      path: '/api/health',
      timeout: 2000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          resolve(null);
        }
      });
    });

    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

// 查看状态
async function status() {
  const pid = isRunning();
  const configPath = getConfigPath();
  const authPath = getAuthConfigPath();
  const webui = getWebuiInfo();

  console.log(colors.cyan('=== TcpMapping Status ===\n'));

  if (pid) {
    console.log(colors.green(`服务状态: 运行中 (PID: ${pid})`));

    if (webui.enabled) {
      const host = webui.host === '0.0.0.0' || webui.host === '::' ? '127.0.0.1' : webui.host;
      const health = await fetchHealth(host, webui.port);

      if (health) {
        console.log(`  WebUI: http://${getAccessHost(webui.host)}:${webui.port}`);
        console.log(`  运行时间: ${Math.floor(health.uptime / 60)} 分钟`);
        console.log(`  活跃映射: ${health.activeMappings}`);
        console.log(`  活跃连接: ${health.activeConnections}`);
      } else {
        console.log(colors.yellow(`  健康检查失败: http://${getAccessHost(webui.host)}:${webui.port}/api/health`));
      }
    } else {
      console.log(colors.gray('  WebUI: 已禁用'));
    }
  } else {
    console.log(colors.red('服务状态: 已停止'));
  }

  console.log('');
  console.log(colors.cyan('=== Configuration ===\n'));
  console.log(`数据目录: ${DATA_DIR}`);
  console.log(`配置文件: ${configPath || colors.yellow('未找到 (运行: tcpmapping init)')}`);
  console.log(`认证配置: ${authPath || colors.yellow('未找到 (运行: tcpmapping setup-password)')}`);
  console.log(`日志文件: ${LOG_FILE}`);
}

// 查看日志
function logs(follow = false) {
  ensureDataDir();

  if (!fs.existsSync(LOG_FILE)) {
    console.log(colors.yellow('未找到日志文件'));
    return;
  }

  if (!follow) {
    const tail = readLogTail(50);
    if (tail !== null) {
      console.log(tail);
    }
    return;
  }

  console.log(colors.blue(`正在跟踪 ${LOG_FILE}... (Ctrl+C 退出)`));

  const tail = readLogTail(20);
  if (tail) {
    console.log(tail);
  }

  let offset = fs.statSync(LOG_FILE).size;

  // 使用轮询方式，兼容 Windows / macOS / Linux
  const watcher = (current) => {
    if (current.size < offset) {
      // 文件被截断（例如日志轮转）
      offset = 0;
    }

    if (current.size > offset) {
      try {
        const length = current.size - offset;
        const buffer = Buffer.alloc(length);
        const fd = fs.openSync(LOG_FILE, 'r');
        try {
          fs.readSync(fd, buffer, 0, length, offset);
        } finally {
          fs.closeSync(fd);
        }
        process.stdout.write(buffer);
        offset = current.size;
      } catch (error) {
        // 文件可能在读取过程中被轮转，忽略本次读取
      }
    }
  };

  fs.watchFile(LOG_FILE, { interval: 500 }, watcher);

  const cleanup = () => {
    fs.unwatchFile(LOG_FILE, watcher);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// 设置密码
function setupPassword() {
  ensureDataDir();
  console.log(colors.blue('正在设置管理员密码...'));
  console.log(colors.gray(`配置将保存到: ${DATA_DIR}`));
  console.log('');

  const child = spawn(process.execPath, [SETUP_PASSWORD_FILE], {
    stdio: 'inherit',
    cwd: DATA_DIR, // 在数据目录运行，使 auth-config.json 保存到数据目录
    env: { ...process.env, TCPMAPPING_DATA_DIR: DATA_DIR }
  });

  child.on('exit', (code) => {
    process.exit(code === null ? 1 : code);
  });
}

// 初始化配置
function init() {
  ensureDataDir();

  const cwdConfig = path.join(process.cwd(), 'config.json');
  const dataConfig = path.join(DATA_DIR, 'config.json');

  if (fs.existsSync(cwdConfig)) {
    console.log(colors.yellow('当前目录已存在 config.json'));
    console.log(colors.gray(`  ${cwdConfig}`));
    return;
  }

  if (fs.existsSync(dataConfig)) {
    console.log(colors.yellow('数据目录已存在 config.json'));
    console.log(colors.gray(`  ${dataConfig}`));
    console.log('');
    console.log('如需为当前项目创建独立配置，可复制一份:');
    console.log(colors.cyan(`  cp ${dataConfig} ./config.json`));
    return;
  }

  const defaultConfig = {
    mappings: [],
    webui: {
      enabled: true,
      // 默认只监听本机；如需远程访问管理面板，请改为 "0.0.0.0" 并配置防火墙
      host: '127.0.0.1',
      port: 9999
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

  fs.writeFileSync(dataConfig, JSON.stringify(defaultConfig, null, 2));
  console.log(colors.green('已创建 config.json'));
  console.log(colors.gray(`  ${dataConfig}`));
  console.log('');
  console.log('请编辑配置文件添加端口映射，或启动后通过 WebUI 添加。');
}

// 显示版本
function version() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  console.log(`${APP_NAME} v${pkg.version}`);
}

// 显示帮助
function help() {
  console.log(`
${colors.cyan('TCP Mapping Server')} - TCP端口转发服务器

${colors.yellow('用法:')}
  tcpmapping <command>

${colors.yellow('命令:')}
  ${colors.green('start')}           后台启动服务
  ${colors.green('stop')}            停止服务
  ${colors.green('restart')}         重启服务
  ${colors.green('status')}          查看服务状态和配置路径
  ${colors.green('logs')}            查看最近日志
  ${colors.green('logs -f')}         实时跟踪日志
  ${colors.green('setup-password')}  设置管理员密码
  ${colors.green('init')}            创建默认 config.json
  ${colors.green('version')}         显示版本
  ${colors.green('help')}            显示帮助

${colors.yellow('配置路径（按优先级）:')}
  1. ./config.json       当前目录（项目配置）
  2. ~/.tcpmapping/      用户数据目录（全局配置）

${colors.yellow('示例:')}
  tcpmapping init             # 创建配置文件
  tcpmapping setup-password   # 设置管理员密码
  tcpmapping start            # 启动服务
  tcpmapping status           # 查看状态和配置路径

${colors.yellow('WebUI:')}
  启动后访问 http://localhost:9999（默认仅本机可访问）
`);
}

// 执行命令
switch (command) {
  case 'start':
    start().catch(error => {
      console.error(colors.red(`启动失败: ${error.message}`));
      process.exitCode = 1;
    });
    break;
  case 'stop':
    stop().catch(error => {
      console.error(colors.red(`停止失败: ${error.message}`));
      process.exitCode = 1;
    });
    break;
  case 'restart':
    restart().catch(error => {
      console.error(colors.red(`重启失败: ${error.message}`));
      process.exitCode = 1;
    });
    break;
  case 'status':
    status().catch(error => {
      console.error(colors.red(`获取状态失败: ${error.message}`));
      process.exitCode = 1;
    });
    break;
  case 'logs':
    logs(args[1] === '-f' || args[1] === '--follow');
    break;
  case 'setup-password':
  case 'passwd':
    setupPassword();
    break;
  case 'init':
    init();
    break;
  case 'version':
  case '-v':
  case '--version':
    version();
    break;
  case 'help':
  case '-h':
  case '--help':
  default:
    help();
    break;
}
