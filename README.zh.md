# 📦 @goodandready/dsh-time-machine

<div align="center">

<h3>DeepSeek Harness 自动化影子 Git 快照、工作区时光机与一键即时回滚插件</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-time-machine"><img src="https://img.shields.io/npm/v/@goodandready/dsh-time-machine.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10b981.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<!-- 官方展示中心跳转按钮 -->
<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/作者全部项目-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="作者全部项目"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

</div>

---

## ⚡ 插件概览

**`dsh-time-machine`** 为 **DeepSeek Harness** 智能体提供全自动工作区安全护栏与即时状态回滚引擎。

智能体在执行多文件批量重构、依赖安装或高危终端命令时，一旦发生代码损坏或逻辑回归，手动 Git 回退不仅繁琐，还容易丢失未跟踪的新建文件。

本插件在后台利用**影子 Git 快照技术（Shadow Git Snapshots）**自动捕获工作区状态，不污染用户 Git 提交树与分支，支持**一键即时回退、可视化文件 Diff 对比以及命令失败时的主动自愈挽救**。

```mermaid
graph LR
    subgraph AgentAction [智能体执行操作]
        Agent[🤖 智能体: 批量修改文件 / 执行终端命令] --> Trigger{执行前置拦截}
    end

    subgraph TimeMachine [dsh-time-machine 引擎核心]
        Trigger --> ShadowGit[影子 Git 快照引擎]
        ShadowGit --> Snapshots[(时序检查点历史队列)]
        Snapshots --> DiffEngine[可视化工作区 Diff 计算器]
    end

    subgraph SafetyNet [安全防护与界面集成]
        DiffEngine --> Sidebar[🕒 侧边栏 Time Machine 时间轴]
        Snapshots --> Rollback[⏪ 一键毫秒级即时回滚]
        Rollback --> CleanState[恢复纯净安全状态]
        Trigger -.->|命令报错| AutoHeal[🩹 自动弹出回滚修复建议]
    end

    style AgentAction fill:#1e1e2e,stroke:#89b4fa,stroke-width:2px,color:#cdd6f4
    style TimeMachine fill:#181825,stroke:#cba6f7,stroke-width:2px,color:#cdd6f4
    style SafetyNet fill:#11111b,stroke:#a6e3a1,stroke-width:2px,color:#cdd6f4
```

---

## 📦 安装指南

```bash
dsh plugin --profile web add @goodandready/dsh-time-machine
```

---

## 📄 开源协议

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
