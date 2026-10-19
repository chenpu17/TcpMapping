/**
 * 共享前端工具：多语言（zh-CN / en-US）与深色模式。
 * 通过 data-i18n* 属性标记静态文案，动态文案使用 I18n.t(key, params)。
 */
(function (global) {
  'use strict';

  const LANG_STORAGE_KEY = 'tcpmapping.lang';
  const THEME_STORAGE_KEY = 'tcpmapping.theme';

  const messages = {
    'zh-CN': {
      'page.dashboard': 'TCP转发服务器 - 管理面板',
      'page.login': 'TCP转发服务器 - 登录',
      'brand.name': 'TCP 转发服务器',
      'brand.subtitle': '管理面板',
      'header.welcome': '欢迎，{name}',
      'header.welcomeFallback': '管理员',
      'header.logout': '退出登录',

      'common.refresh': '刷新',
      'common.cancel': '取消',
      'common.edit': '编辑',
      'common.delete': '删除',
      'common.start': '启动',
      'common.stop': '停止',
      'common.running': '运行中',
      'common.stopped': '已停止',
      'common.connected': '已连接',
      'common.connecting': '连接中',
      'common.language': '语言',
      'common.theme': '切换深色 / 浅色模式',
      'common.requestFailed': '请求失败 (HTTP {status})',
      'common.invalidResponse': '服务器返回了无效响应',
      'common.sessionExpired': '登录状态已失效',
      'common.networkError': '操作失败，请检查网络连接',

      'stats.title': '系统状态',
      'stats.totalMappings': '总映射数',
      'stats.activeMappings': '活跃映射',
      'stats.activeConnections': '活跃连接',
      'stats.uptime': '运行时间',
      'stats.totalTraffic': '累计流量',

      'resources.title': '服务资源',
      'resources.cpu': 'CPU 使用率',
      'resources.cpuHint': '{count} 核 · 占整机',
      'resources.memory': '内存占用',
      'resources.memoryHint': '占系统内存 {percent}% · 堆 {heap}',
      'resources.traffic': '实时流量',
      'resources.trafficHint': '累计 ↑{up} ↓{down}',
      'resources.sampledAt': '采样于 {time}',
      'resources.waiting': '等待采样…',

      'mappings.title': '端口映射管理',
      'mappings.add': '+ 添加映射',
      'mappings.empty': '暂无端口映射，点击上方按钮添加',
      'mappings.thName': '名称',
      'mappings.thListen': '监听端口',
      'mappings.thTarget': '目标地址',
      'mappings.thConnections': '连接数',
      'mappings.thTraffic': '流量统计',
      'mappings.thStatus': '状态',
      'mappings.thActions': '操作',
      'mappings.currentTraffic': '当前 ↑{up} ↓{down}',
      'mappings.totalUpload': '累计上行流量',
      'mappings.totalDownload': '累计下行流量',

      'connections.title': '连接状态监控',
      'connections.empty': '当前没有活跃连接',
      'connections.activeCount': '活跃连接: {count}',
      'connections.actualListenLabel': '实际监听:',

      'history.title': '最近连接记录',
      'history.hint': '记录已关闭连接的源地址、目的地址与持续时长，最多保留最近 500 条（服务重启后清空）。',
      'history.thClosedAt': '关闭时间',
      'history.thMapping': '映射',
      'history.thSource': '源地址',
      'history.thDestination': '目的地址',
      'history.thDuration': '持续时长',
      'history.thTraffic': '流量',
      'history.thReason': '结束原因',
      'history.empty': '暂无已关闭的连接记录',
      'history.notEstablished': '（未建立）',
      'history.allMappings': '全部映射',

      'modal.addTitle': '添加端口映射',
      'modal.editTitle': '编辑端口映射',
      'modal.name': '映射名称',
      'modal.namePlaceholder': '例如：Web服务',
      'modal.listenHost': '监听地址',
      'modal.listenHostPlaceholder': '0.0.0.0 表示所有网卡',
      'modal.listenPort': '监听端口',
      'modal.targetHost': '目标主机',
      'modal.targetHostPlaceholder': 'IP地址或域名',
      'modal.targetPort': '目标端口',
      'modal.portPlaceholder': '1-65535',
      'modal.confirmAdd': '确认添加',
      'modal.saveChanges': '保存修改',
      'modal.saving': '保存中...',
      'modal.saveSuccess': '保存成功',
      'modal.addSuccess': '添加成功',
      'modal.operationFailed': '操作失败',
      'modal.mappingMissing': '映射不存在，请刷新后重试',

      'actions.deleteConfirm': '确定要删除映射「{name}」吗？',
      'actions.deleteFailed': '删除失败: {message}',
      'actions.startFailed': '启动失败: {message}',
      'actions.stopFailed': '停止失败: {message}',
      'actions.deleted': '映射已删除',
      'actions.started': '映射已启动',
      'actions.stopped': '映射已停止',

      'login.subtitle': '管理界面登录',
      'login.username': '用户名',
      'login.usernamePlaceholder': '请输入用户名',
      'login.password': '密码',
      'login.passwordPlaceholder': '请输入密码',
      'login.showPassword': '显示密码',
      'login.hidePassword': '隐藏密码',
      'login.submit': '登录',
      'login.submitting': '登录中...',
      'login.success': '登录成功，正在跳转...',
      'login.failedNetwork': '登录失败，请检查网络连接',
      'login.forgot': '忘记密码？运行 <code>tcpmapping setup-password</code> 或 <code>npm run reset-password</code> 重置',
      'login.footer': 'TCP 端口转发服务器'
    },

    'en-US': {
      'page.dashboard': 'TCP Forwarding Server - Admin',
      'page.login': 'TCP Forwarding Server - Sign In',
      'brand.name': 'TCP Forwarding Server',
      'brand.subtitle': 'Admin Dashboard',
      'header.welcome': 'Welcome, {name}',
      'header.welcomeFallback': 'Administrator',
      'header.logout': 'Log out',

      'common.refresh': 'Refresh',
      'common.cancel': 'Cancel',
      'common.edit': 'Edit',
      'common.delete': 'Delete',
      'common.start': 'Start',
      'common.stop': 'Stop',
      'common.running': 'Running',
      'common.stopped': 'Stopped',
      'common.connected': 'Connected',
      'common.connecting': 'Connecting',
      'common.language': 'Language',
      'common.theme': 'Toggle dark / light mode',
      'common.requestFailed': 'Request failed (HTTP {status})',
      'common.invalidResponse': 'The server returned an invalid response',
      'common.sessionExpired': 'Session expired',
      'common.networkError': 'Operation failed. Check your network connection.',

      'stats.title': 'System Status',
      'stats.totalMappings': 'Total mappings',
      'stats.activeMappings': 'Active mappings',
      'stats.activeConnections': 'Active connections',
      'stats.uptime': 'Uptime',
      'stats.totalTraffic': 'Total traffic',

      'resources.title': 'Service Resources',
      'resources.cpu': 'CPU usage',
      'resources.cpuHint': '{count} cores · of total',
      'resources.memory': 'Memory',
      'resources.memoryHint': '{percent}% of system memory · heap {heap}',
      'resources.traffic': 'Live traffic',
      'resources.trafficHint': 'Total ↑{up} ↓{down}',
      'resources.sampledAt': 'Sampled at {time}',
      'resources.waiting': 'Waiting for sample…',

      'mappings.title': 'Port Mappings',
      'mappings.add': '+ Add Mapping',
      'mappings.empty': 'No mappings yet. Click “Add Mapping” to create one.',
      'mappings.thName': 'Name',
      'mappings.thListen': 'Listen',
      'mappings.thTarget': 'Target',
      'mappings.thConnections': 'Connections',
      'mappings.thTraffic': 'Traffic',
      'mappings.thStatus': 'Status',
      'mappings.thActions': 'Actions',
      'mappings.currentTraffic': 'Current ↑{up} ↓{down}',
      'mappings.totalUpload': 'Total upload',
      'mappings.totalDownload': 'Total download',

      'connections.title': 'Live Connections',
      'connections.empty': 'No active connections',
      'connections.activeCount': 'Active connections: {count}',
      'connections.actualListenLabel': 'Local address:',

      'history.title': 'Recent Connections',
      'history.hint': 'Closed connections with source, destination and duration. Keeps the latest 500 records (cleared on restart).',
      'history.thClosedAt': 'Closed At',
      'history.thMapping': 'Mapping',
      'history.thSource': 'Source',
      'history.thDestination': 'Destination',
      'history.thDuration': 'Duration',
      'history.thTraffic': 'Traffic',
      'history.thReason': 'Close Reason',
      'history.empty': 'No closed connection records yet',
      'history.notEstablished': ' (not established)',
      'history.allMappings': 'All mappings',

      'modal.addTitle': 'Add Port Mapping',
      'modal.editTitle': 'Edit Port Mapping',
      'modal.name': 'Mapping Name',
      'modal.namePlaceholder': 'e.g. Web Service',
      'modal.listenHost': 'Listen Address',
      'modal.listenHostPlaceholder': '0.0.0.0 means all interfaces',
      'modal.listenPort': 'Listen Port',
      'modal.targetHost': 'Target Host',
      'modal.targetHostPlaceholder': 'IP address or hostname',
      'modal.targetPort': 'Target Port',
      'modal.portPlaceholder': '1-65535',
      'modal.confirmAdd': 'Add',
      'modal.saveChanges': 'Save Changes',
      'modal.saving': 'Saving...',
      'modal.saveSuccess': 'Saved successfully',
      'modal.addSuccess': 'Added successfully',
      'modal.operationFailed': 'Operation failed',
      'modal.mappingMissing': 'Mapping not found. Refresh and try again.',

      'actions.deleteConfirm': 'Delete mapping “{name}”?',
      'actions.deleteFailed': 'Delete failed: {message}',
      'actions.startFailed': 'Start failed: {message}',
      'actions.stopFailed': 'Stop failed: {message}',
      'actions.deleted': 'Mapping deleted',
      'actions.started': 'Mapping started',
      'actions.stopped': 'Mapping stopped',

      'login.subtitle': 'Sign in to the admin panel',
      'login.username': 'Username',
      'login.usernamePlaceholder': 'Enter your username',
      'login.password': 'Password',
      'login.passwordPlaceholder': 'Enter your password',
      'login.showPassword': 'Show password',
      'login.hidePassword': 'Hide password',
      'login.submit': 'Sign in',
      'login.submitting': 'Signing in...',
      'login.success': 'Signed in, redirecting...',
      'login.failedNetwork': 'Sign-in failed. Check your network connection.',
      'login.forgot': 'Forgot your password? Run <code>tcpmapping setup-password</code> or <code>npm run reset-password</code> to reset it.',
      'login.footer': 'TCP port forwarding server'
    }
  };

  const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'];
  let currentLanguage = detectLanguage();

  function detectLanguage() {
    try {
      const saved = localStorage.getItem(LANG_STORAGE_KEY);
      if (messages[saved]) {
        return saved;
      }
    } catch (error) {
      // localStorage 不可用时忽略
    }

    const candidates = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ''];

    for (const candidate of candidates) {
      const value = String(candidate).toLowerCase();
      if (value.startsWith('zh')) return 'zh-CN';
      if (value.startsWith('en')) return 'en-US';
    }

    return 'zh-CN';
  }

  function t(key, params) {
    const dictionary = messages[currentLanguage] || messages['zh-CN'];
    const template = dictionary[key] !== undefined
      ? dictionary[key]
      : (messages['zh-CN'][key] !== undefined ? messages['zh-CN'][key] : key);

    return String(template).replace(/\{(\w+)\}/g, (match, name) => {
      return params && params[name] !== undefined ? String(params[name]) : match;
    });
  }

  function applyStatic(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = t(element.getAttribute('data-i18n'));
    });

    scope.querySelectorAll('[data-i18n-html]').forEach(element => {
      element.innerHTML = t(element.getAttribute('data-i18n-html'));
    });

    scope.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
      element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
    });

    scope.querySelectorAll('[data-i18n-title]').forEach(element => {
      element.setAttribute('title', t(element.getAttribute('data-i18n-title')));
    });

    scope.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
      element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
    });
  }

  function setLanguage(language) {
    if (!messages[language]) {
      return currentLanguage;
    }

    currentLanguage = language;

    try {
      localStorage.setItem(LANG_STORAGE_KEY, language);
    } catch (error) {
      // 忽略存储失败
    }

    document.documentElement.setAttribute('lang', language === 'zh-CN' ? 'zh-CN' : 'en');
    applyStatic();

    const select = document.getElementById('languageSelect');
    if (select) {
      select.value = language;
    }

    document.dispatchEvent(new CustomEvent('languagechange', { detail: { language } }));
    return currentLanguage;
  }

  function getLanguage() {
    return currentLanguage;
  }

  document.documentElement.setAttribute('lang', currentLanguage === 'zh-CN' ? 'zh-CN' : 'en');

  // ==================== 主题 ====================

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch (error) {
      // 忽略存储失败
    }

    return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    });
  }

  function setTheme(theme) {
    const value = theme === 'dark' ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch (error) {
      // 忽略存储失败
    }
    applyTheme(value);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: value } }));
  }

  function toggleTheme() {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  // 在页面渲染前应用主题，避免闪烁
  applyTheme(getPreferredTheme());

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-theme-toggle]');
    if (toggle) {
      toggleTheme();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    applyStatic();

    const select = document.getElementById('languageSelect');
    if (select) {
      select.value = currentLanguage;
      select.addEventListener('change', event => setLanguage(event.target.value));
    }
  });

  global.I18n = {
    t,
    applyStatic,
    setLanguage,
    getLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES
  };

  global.Theme = {
    setTheme,
    toggleTheme,
    current: () => document.documentElement.getAttribute('data-theme')
  };
})(window);
