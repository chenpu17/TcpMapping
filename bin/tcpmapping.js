#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = 'tcpmapping';
const DATA_DIR = path.join(os.homedir(), '.tcpmapping');
const PID_FILE = path.join(DATA_DIR, 'tcpmapping.pid');
const LOG_FILE = path.join(DATA_DIR, 'tcpmapping.log');
const SERVER_FILE = path.join(__dirname, '..', 'server.js');
const SETUP_PASSWORD_FILE = path.join(__dirname, '..', 'setup-password.js');

// 获取命令行参数
const args = process.argv.slice(2);
const command = args[0] || 'help';

// 颜色输出
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`
};

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 获取配置文件路径（按优先级）
function getConfigPath() {
  // 优先级1: 当前工作目录
  const cwdPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  // 优先级2: 用户数据目录
  const dataPath = path.join(DATA_DIR, 'config.json');
  if (fs.existsSync(dataPath)) {
    return dataPath;
  }

  return null;
}

// 获取认证配置文件路径
function getAuthConfigPath() {
  const cwdPath = path.join(process.cwd(), 'auth-config.json');
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  const dataPath = path.join(DATA_DIR, 'auth-config.json');
  if (fs.existsSync(dataPath)) {
    return dataPath;
  }

  return null;
}

// 检查进程是否运行
function isRunning() {
  ensureDataDir();
  if (!fs.existsSync(PID_FILE)) {
    return false;
  }

  const pid = fs.readFileSync(PID_FILE, 'utf8').trim();

  try {
    process.kill(parseInt(pid), 0);
    return parseInt(pid);
  } catch (e) {
    // 进程不存在，清理PID文件
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

// 启动服务
function start() {
  const pid = isRunning();
  if (pid) {
    console.log(colors.yellow(`${APP_NAME} is already running (PID: ${pid})`));
    return;
  }

  // 检查是否已初始化
  const configPath = getConfigPath();
  const authPath = getAuthConfigPath();

  if (!authPath) {
    console.log(colors.yellow('未设置管理员密码，请先运行:'));
    console.log(colors.cyan('  tcpmapping setup-password'));
    return;
  }

  ensureDataDir();
  console.log(colors.blue(`Starting ${APP_NAME}...`));

  const out = fs.openSync(LOG_FILE, 'a');
  const err = fs.openSync(LOG_FILE, 'a');

  const child = spawn('node', [SERVER_FILE], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: process.cwd() // 使用当前目录，以便server可以找到当前目录的config
  });

  fs.writeFileSync(PID_FILE, child.pid.toString());
  child.unref();

  console.log(colors.green(`${APP_NAME} started successfully (PID: ${child.pid})`));
  console.log(colors.cyan(`WebUI: http://localhost:9999`));
  console.log(colors.gray(`Log file: ${LOG_FILE}`));
  if (configPath) {
    console.log(colors.gray(`Config: ${configPath}`));
  }
}

// 停止服务
function stop() {
  const pid = isRunning();
  if (!pid) {
    console.log(colors.yellow(`${APP_NAME} is not running`));
    return;
  }

  console.log(colors.blue(`Stopping ${APP_NAME} (PID: ${pid})...`));

  try {
    process.kill(pid, 'SIGTERM');

    // 等待进程退出
    let attempts = 0;
    while (attempts < 10) {
      try {
        process.kill(pid, 0);
        // 进程仍在运行
        require('child_process').execSync('sleep 0.5');
        attempts++;
      } catch (e) {
        // 进程已退出
        break;
      }
    }

    // 如果进程仍在运行，强制终止
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      // 进程已退出
    }

    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }

    console.log(colors.green(`${APP_NAME} stopped successfully`));
  } catch (e) {
    console.log(colors.red(`Failed to stop ${APP_NAME}: ${e.message}`));
  }
}

// 重启服务
function restart() {
  console.log(colors.blue(`Restarting ${APP_NAME}...`));
  stop();
  setTimeout(() => {
    start();
  }, 1000);
}

// 查看状态
function status() {
  const pid = isRunning();
  const configPath = getConfigPath();
  const authPath = getAuthConfigPath();

  console.log(colors.cyan('=== TcpMapping Status ===\n'));

  // 服务状态
  if (pid) {
    console.log(colors.green(`Service: Running (PID: ${pid})`));

    // 尝试获取健康状态
    try {
      const http = require('http');
      const req = http.get('http://localhost:9999/api/health', { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const health = JSON.parse(data);
            console.log(`  Uptime: ${Math.floor(health.uptime / 60)} minutes`);
            console.log(`  Active Mappings: ${health.activeMappings}`);
            console.log(`  Active Connections: ${health.activeConnections}`);
          } catch (e) {}
          showPaths();
        });
      });
      req.on('error', () => showPaths());
      req.on('timeout', () => { req.destroy(); showPaths(); });
    } catch (e) {
      showPaths();
    }
  } else {
    console.log(colors.red('Service: Stopped'));
    showPaths();
  }

  function showPaths() {
    console.log('');
    console.log(colors.cyan('=== Configuration ===\n'));
    console.log(`Data Dir: ${DATA_DIR}`);
    console.log(`Config: ${configPath || colors.yellow('Not found (run: tcpmapping init)')}`);
    console.log(`Auth: ${authPath || colors.yellow('Not found (run: tcpmapping setup-password)')}`);
    console.log(`Log: ${LOG_FILE}`);
  }
}

// 查看日志
function logs(follow = false) {
  ensureDataDir();
  if (!fs.existsSync(LOG_FILE)) {
    console.log(colors.yellow('No log file found'));
    return;
  }

  if (follow) {
    console.log(colors.blue(`Tailing ${LOG_FILE}... (Ctrl+C to exit)`));
    const tail = spawn('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
  } else {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').slice(-50);
    console.log(lines.join('\n'));
  }
}

// 设置密码
function setupPassword() {
  ensureDataDir();
  console.log(colors.blue('Setting up password...'));
  console.log(colors.gray(`Config will be saved to: ${DATA_DIR}`));
  console.log('');

  const child = spawn('node', [SETUP_PASSWORD_FILE], {
    stdio: 'inherit',
    cwd: DATA_DIR, // 在数据目录运行，使auth-config.json保存到数据目录
    env: { ...process.env, TCPMAPPING_DATA_DIR: DATA_DIR }
  });

  child.on('exit', (code) => {
    process.exit(code);
  });
}

// 初始化配置
function init() {
  ensureDataDir();

  // 检查当前目录和数据目录是否已有配置
  const cwdConfig = path.join(process.cwd(), 'config.json');
  const dataConfig = path.join(DATA_DIR, 'config.json');

  if (fs.existsSync(cwdConfig)) {
    console.log(colors.yellow(`config.json already exists in current directory`));
    console.log(colors.gray(`  ${cwdConfig}`));
    return;
  }

  if (fs.existsSync(dataConfig)) {
    console.log(colors.yellow(`config.json already exists in data directory`));
    console.log(colors.gray(`  ${dataConfig}`));
    console.log('');
    console.log('To create a local config, copy it to current directory:');
    console.log(colors.cyan(`  cp ${dataConfig} ./config.json`));
    return;
  }

  const defaultConfig = {
    mappings: [],
    webui: { port: 9999 },
    logging: { level: "info" }
  };

  // 保存到数据目录
  fs.writeFileSync(dataConfig, JSON.stringify(defaultConfig, null, 2));
  console.log(colors.green('Created config.json'));
  console.log(colors.gray(`  ${dataConfig}`));
  console.log('');
  console.log('Edit the config file to add your port mappings.');
  console.log('Or copy it to current directory for project-specific config:');
  console.log(colors.cyan(`  cp ${dataConfig} ./config.json`));
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

${colors.yellow('Usage:')}
  tcpmapping <command>

${colors.yellow('Commands:')}
  ${colors.green('start')}           Start the server in background
  ${colors.green('stop')}            Stop the server
  ${colors.green('restart')}         Restart the server
  ${colors.green('status')}          Show server status and config paths
  ${colors.green('logs')}            Show recent logs
  ${colors.green('logs -f')}         Follow logs in real-time
  ${colors.green('setup-password')}  Set up admin password
  ${colors.green('init')}            Create default config.json
  ${colors.green('version')}         Show version
  ${colors.green('help')}            Show this help message

${colors.yellow('Config Paths (priority order):')}
  1. ./config.json       (current directory - project config)
  2. ~/.tcpmapping/      (user data directory - global config)

${colors.yellow('Examples:')}
  tcpmapping init             # Create config file
  tcpmapping setup-password   # Set admin password
  tcpmapping start            # Start server
  tcpmapping status           # Check status and config paths

${colors.yellow('WebUI:')}
  After starting, visit http://localhost:9999
`);
}

// 执行命令
switch (command) {
  case 'start':
    start();
    break;
  case 'stop':
    stop();
    break;
  case 'restart':
    restart();
    break;
  case 'status':
    status();
    break;
  case 'logs':
    logs(args[1] === '-f');
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
