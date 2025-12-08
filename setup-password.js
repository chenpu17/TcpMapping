const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 密码复杂度验证
function validatePassword(password) {
  const minLength = 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const errors = [];
  
  if (password.length < minLength) {
    errors.push(`密码长度至少需要${minLength}个字符`);
  }
  
  if (!hasUppercase) {
    errors.push('密码必须包含至少一个大写字母');
  }
  
  if (!hasLowercase) {
    errors.push('密码必须包含至少一个小写字母');
  }
  
  if (!hasNumbers) {
    errors.push('密码必须包含至少一个数字');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

// 获取用户输入（隐藏密码）
function getPassword(prompt) {
  return new Promise((resolve) => {
    // 对于密码输入，我们使用标准输入但隐藏输出
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    
    let password = '';
    
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        // 结束输入
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit();
      } else if (char === '\u007f') {
        // 退格键
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        // 普通字符
        password += char;
        process.stdout.write('*');
      }
    };
    
    process.stdin.on('data', onData);
  });
}

// 读取现有的认证配置
function loadAuthConfig() {
  try {
    const configPath = path.join(__dirname, 'auth-config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // 如果文件不存在，返回默认配置
    return {
      users: [],
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

// 保存认证配置
function saveAuthConfig(config) {
  const configPath = path.join(__dirname, 'auth-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// 主要设置流程
async function setupPassword() {
  console.log('=== TCP转发服务器 - 密码设置工具 ===\n');
  
  try {
    // 读取现有配置
    const authConfig = loadAuthConfig();
    
    // 获取用户名
    const username = await new Promise((resolve) => {
      rl.question('请输入用户名 (默认: admin): ', (input) => {
        resolve(input.trim() || 'admin');
      });
    });
    
    let password = '';
    let isValidPassword = false;
    
    // 获取并验证密码
    while (!isValidPassword) {
      password = await getPassword('请输入新密码: ');
      
      if (password.length === 0) {
        console.log('密码不能为空，请重新输入');
        continue;
      }
      
      const validation = validatePassword(password);
      
      if (!validation.isValid) {
        console.log('\n密码不符合要求:');
        validation.errors.forEach(error => console.log(`  - ${error}`));
        console.log('');
        continue;
      }
      
      // 确认密码
      const confirmPassword = await getPassword('请再次输入密码确认: ');
      
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
      console.log(`\n✓ 已更新用户密码: ${username}`);
    }
    
    // 保存配置
    saveAuthConfig(authConfig);
    
    console.log('✓ 密码设置完成');
    console.log('\n密码策略要求:');
    console.log('  - 最少8个字符');
    console.log('  - 包含大写字母');
    console.log('  - 包含小写字母');
    console.log('  - 包含数字');
    console.log(`  - 密码有效期: ${authConfig.passwordPolicy.passwordExpireDays}天`);
    
  } catch (error) {
    console.error('设置密码时发生错误:', error.message);
  } finally {
    rl.close();
  }
}

// 运行设置
setupPassword(); 