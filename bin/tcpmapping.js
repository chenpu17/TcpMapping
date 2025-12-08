#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_NAME = 'tcpmapping';
const PID_FILE = path.join(os.tmpdir(), 'tcpmapping.pid');
const LOG_FILE = path.join(os.tmpdir(), 'tcpmapping.log');
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
  cyan: (text) => `\x1b[36m${text}\x1b[0m`
};

// 检查进程是否运行
function isRunning() {
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

  console.log(colors.blue(`Starting ${APP_NAME}...`));

  const out = fs.openSync(LOG_FILE, 'a');
  const err = fs.openSync(LOG_FILE, 'a');

  const child = spawn('node', [SERVER_FILE], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: path.dirname(SERVER_FILE)
  });

  fs.writeFileSync(PID_FILE, child.pid.toString());
  child.unref();

  console.log(colors.green(`${APP_NAME} started successfully (PID: ${child.pid})`));
  console.log(colors.cyan(`WebUI: http://localhost:9999`));
  console.log(colors.cyan(`Log file: ${LOG_FILE}`));
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
  if (pid) {
    console.log(colors.green(`${APP_NAME} is running (PID: ${pid})`));

    // 尝试获取健康状态
    try {
      const http = require('http');
      const req = http.get('http://localhost:9999/api/health', { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const health = JSON.parse(data);
            console.log(colors.cyan(`  Status: ${health.status}`));
            console.log(colors.cyan(`  Uptime: ${Math.floor(health.uptime / 60)} minutes`));
            console.log(colors.cyan(`  Active Mappings: ${health.activeMappings}`));
            console.log(colors.cyan(`  Active Connections: ${health.activeConnections}`));
          } catch (e) {}
        });
      });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
    } catch (e) {}
  } else {
    console.log(colors.red(`${APP_NAME} is not running`));
  }
}

// 查看日志
function logs(follow = false) {
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
  console.log(colors.blue('Setting up password...'));
  const child = spawn('node', [SETUP_PASSWORD_FILE], {
    stdio: 'inherit',
    cwd: path.dirname(SETUP_PASSWORD_FILE)
  });

  child.on('exit', (code) => {
    process.exit(code);
  });
}

// 初始化配置
function init() {
  const configDir = process.cwd();
  const configFile = path.join(configDir, 'config.json');

  if (fs.existsSync(configFile)) {
    console.log(colors.yellow('config.json already exists'));
    return;
  }

  const defaultConfig = {
    mappings: [
      {
        name: "Example",
        listen: { host: "0.0.0.0", port: 8080 },
        target: { host: "127.0.0.1", port: 3000 }
      }
    ],
    webui: { enabled: true, port: 9999, host: "0.0.0.0" },
    logging: { enabled: true, level: "info" }
  };

  fs.writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2));
  console.log(colors.green('Created config.json'));
  console.log(colors.cyan('Edit config.json to configure your port mappings'));
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
  ${colors.green('status')}          Show server status
  ${colors.green('logs')}            Show recent logs
  ${colors.green('logs -f')}         Follow logs in real-time
  ${colors.green('setup-password')}  Set up admin password
  ${colors.green('init')}            Create default config.json
  ${colors.green('version')}         Show version
  ${colors.green('help')}            Show this help message

${colors.yellow('Examples:')}
  tcpmapping start          # Start server
  tcpmapping status         # Check if server is running
  tcpmapping logs -f        # Follow logs

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
