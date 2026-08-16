# DeepSeek Harness 桌面版

把 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 的 Web UI 封装成独立的 Windows 桌面应用。非官方社区封装，与 DeepSeek 官方无关。

## 特性

- 独立桌面进程，任务栏显示鲸鱼图标，无浏览器地址栏
- 内置 Node 22 运行时和完整 dsh 服务器，**用户电脑无需安装 Node/npm**
- 自动管理服务器生命周期：启动时拉起，退出时清理
- 端口 3080 已被占用时自动复用现有实例
- 数据与插件配置保存在用户目录 `~/.dsh`，与 npx 方式互通

## 下载安装

到 [Releases](../../releases) 页面下载 `DeepSeek Harness Setup x.x.x.exe`，双击安装即可。

> 安装包未做代码签名，首次运行 SmartScreen 会提示"Windows 已保护你的电脑"，点击"更多信息 → 仍要运行"。

## 从源码构建

前置要求：Node.js ≥ 18、npm（构建机器上需要，最终产物不需要）。

```powershell
# 1. 安装构建依赖（electron、electron-builder）
npm install

# 2. 下载 Node 运行时 + 安装服务器依赖（国内走 npmmirror 镜像）
powershell -ExecutionPolicy Bypass -File scripts/prepare.ps1

# 3. 打包安装程序
npx electron-builder --win nsis
```

产物在 `dist\DeepSeek Harness Setup <version>.exe`。国内网络建议先设置镜像环境变量：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 目录结构

```
├── main.js              # Electron 主进程：窗口、服务器生命周期管理
├── build/dsh.ico        # 应用图标（黑色鲸鱼）
├── runtime/node/        # 捆绑的 Node 22 运行时（构建时下载，不入库）
├── server/              # dsh 服务器依赖树（构建时安装，不入库）
│   └── dsh-modules/     # npm node_modules 改名而来，规避打包器过滤
└── scripts/prepare.ps1  # 一键准备构建环境
```

## 已知限制

- 仅支持 Windows x64
- 升级 dsh 版本：改 `server/package.json` 里的版本号，重跑 `scripts/prepare.ps1` 再打包

## 许可

本项目封装代码以 MIT 发布。DeepSeek Harness 本体及其依赖遵循各自的开源许可。
