const fs = require('fs');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// 获取配置保存目录
function getConfigDir() {
  // 优先使用环境变量指定的目录
  if (process.env.TCPMAPPING_DATA_DIR) {
    return process.env.TCPMAPPING_DATA_DIR;
  }
  // 其次使用当前工作目录
  return process.cwd();
}

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 非 TTY 环境（如管道输入）使用行队列，避免缓冲区中的行被丢弃
const inputQueue = [];
const inputWaiters = [];

function readInputLine(prompt) {
  if (!process.stdin.isTTY) {
    process.stdout.write(prompt);

    if (inputQueue.length > 0) {
      return Promise.resolve(inputQueue.shift());
    }

    return new Promise((resolve) => {
      inputWaiters.push(resolve);
    });
  }

  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

if (!process.stdin.isTTY) {
  rl.on('line', (line) => {
    const waiter = inputWaiters.shift();
    if (waiter) {
      waiter(line);
    } else {
      inputQueue.push(line);
    }
  });

  rl.on('close', () => {
    while (inputWaiters.length > 0) {
      inputWaiters.shift()(null);
    }
  });
}

// 默认密码策略
const DEFAULT_PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false,
  passwordExpireDays: 90
};

// 密码复杂度验证
function validatePassword(password, policy) {
  const rules = { ...DEFAULT_PASSWORD_POLICY, ...(policy || {}) };
  const errors = [];

  if (password.length < rules.minLength) {
    errors.push(`密码长度至少需要${rules.minLength}个字符`);
  }

  if (rules.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('密码必须包含至少一个大写字母');
  }

  if (rules.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('密码必须包含至少一个小写字母');
  }

  if (rules.requireNumbers && !/\d/.test(password)) {
    errors.push('密码必须包含至少一个数字');
  }

  if (rules.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/;'`~]/.test(password)) {
    errors.push('密码必须包含至少一个特殊字符');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

// 获取用户输入（隐藏密码）
function getPassword(prompt) {
  return new Promise((resolve) => {
    // 非 TTY 环境（如管道输入）无法使用原始模式，退回到普通输入
    if (!process.stdin.isTTY) {
      readInputLine(prompt).then(resolve);
      return;
    }

    // Windows 兼容：使用简单的输入方式
    // 在某些终端上密码可能可见，但这是最兼容的方式
    if (process.platform === 'win32') {
      // Windows: 尝试隐藏输入
      const spawn = require('child_process').spawnSync;
      process.stdout.write(prompt);

      try {
        // 使用 PowerShell 读取密码
        const result = spawn('powershell', [
          '-Command',
          '$pwd = Read-Host -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwd))'
        ], { stdio: ['inherit', 'pipe', 'inherit'] });

        if (result.status === 0 && result.stdout) {
          resolve(result.stdout.toString().trim());
          return;
        }
      } catch (e) {
        // PowerShell 不可用，回退到普通输入
      }

      // 回退方案：普通输入（密码可见）
      console.log('(密码将可见)');
      rl.question('', (answer) => resolve(answer));
      return;
    }

    // Unix/Mac: 使用 raw mode 隐藏密码
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');

    let password = '';

    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C: 恢复终端状态后退出
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        process.stdout.write('\n');
        process.exit(130);
      } else if (char === '\u007f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char.charCodeAt(0) >= 32) {
        password += char;
        process.stdout.write('*');
      }
    };

    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

// 读取现有的认证配置
function loadAuthConfig() {
  try {
    const configPath = path.join(getConfigDir(), 'auth-config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    if (!Array.isArray(config.users)) {
      config.users = [];
    }
    config.passwordPolicy = { ...DEFAULT_PASSWORD_POLICY, ...(config.passwordPolicy || {}) };
    config.sessionConfig = config.sessionConfig || {
      sessionTimeout: 24,
      maxFailedAttempts: 5,
      lockoutDuration: 30
    };

    return config;
  } catch (error) {
    // 如果文件不存在，返回默认配置
    return {
      users: [],
      passwordPolicy: { ...DEFAULT_PASSWORD_POLICY },
      sessionConfig: {
        sessionTimeout: 24,
        maxFailedAttempts: 5,
        lockoutDuration: 30
      }
    };
  }
}

// 保存认证配置（原子写入，且仅当前用户可读写）
function saveAuthConfig(config) {
  const configDir = getConfigDir();
  // 确保目录存在
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  const configPath = path.join(configDir, 'auth-config.json');
  const tmpPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, configPath);

  try {
    fs.chmodSync(configPath, 0o600);
  } catch (error) {
    // Windows 等平台可能不支持 chmod，忽略
  }

  console.log(`配置已保存到: ${configPath}`);
}

// 主要设置流程
async function setupPassword() {
  console.log('=== TCP转发服务器 - 密码设置工具 ===\n');
  
  try {
    // 读取现有配置
    const authConfig = loadAuthConfig();
    
    // 获取用户名
    const usernameInput = await readInputLine('请输入用户名 (默认: admin): ');
    const username = (usernameInput || '').trim() || 'admin';

    let password = '';
    let isValidPassword = false;

    // 获取并验证密码
    while (!isValidPassword) {
      password = await getPassword('请输入新密码: ');

      if (password === null) {
        console.log('\n输入已结束，密码设置已取消');
        process.exit(1);
      }

      if (password.length === 0) {
        console.log('密码不能为空，请重新输入');
        continue;
      }

      const validation = validatePassword(password, authConfig.passwordPolicy);

      if (!validation.isValid) {
        console.log('\n密码不符合要求:');
        validation.errors.forEach(error => console.log(`  - ${error}`));
        console.log('');
        continue;
      }

      // 确认密码
      const confirmPassword = await getPassword('请再次输入密码确认: ');

      if (confirmPassword === null) {
        console.log('\n输入已结束，密码设置已取消');
        process.exit(1);
      }

      if (password !== confirmPassword) {
        console.log('\n两次输入的密码不一致，请重新输入\n');
        continue;
      }

      isValidPassword = true;
    }
    
    // 生成密码哈希
    const passwordHash = await bcrypt.hash(password, 12);
    
    // 查找现有用户或创建新用户
    let userIndex = authConfig.users.findIndex(u => u.username === username);
    
    if (userIndex === -1) {
      // 创建新用户
      authConfig.users.push({
        username: username,
        passwordHash: passwordHash,
        role: 'admin',
        lastPasswordChange: new Date().toISOString(),
        enabled: true
      });
      console.log(`\n✓ 已创建新用户: ${username}`);
    } else {
      // 更新现有用户
      authConfig.users[userIndex].passwordHash = passwordHash;
      authConfig.users[userIndex].lastPasswordChange = new Date().toISOString();
      // 重置密码时同时启用账户，避免因账户被禁用而无法登录
      authConfig.users[userIndex].enabled = true;
      console.log(`\n✓ 已更新用户密码: ${username}`);
    }
    
    // 保存配置
    saveAuthConfig(authConfig);
    
    console.log('✓ 密码设置完成');
    const policy = authConfig.passwordPolicy;
    console.log('\n密码策略要求:');
    console.log(`  - 最少${policy.minLength}个字符`);
    if (policy.requireUppercase) console.log('  - 包含大写字母');
    if (policy.requireLowercase) console.log('  - 包含小写字母');
    if (policy.requireNumbers) console.log('  - 包含数字');
    if (policy.requireSpecialChars) console.log('  - 包含特殊字符');
    if (policy.passwordExpireDays > 0) {
      console.log(`  - 密码有效期: ${policy.passwordExpireDays}天`);
    }
    
  } catch (error) {
    console.error('设置密码时发生错误:', error.message);
  } finally {
    rl.close();
  }
}

// 运行设置
setupPassword(); 