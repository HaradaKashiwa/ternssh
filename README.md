<p align="center">
  <img src="web/public/logo.png" alt="ternssh logo" width="96" height="96" />
</p>

<h1 align="center">ternssh</h1>

<p align="center">
  基于 Cloudflare 的 SSH 工作台<br />
  可拖拽仪表盘 · 终端 · SFTP · 状态监控
</p>

<p align="center">
  <a href="LICENSE">GPL-3.0-or-later</a>
  ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/HaradaKashiwa/ternssh">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" />
  </a>
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/HaradaKashiwa/ternssh/refs/heads/main/docs/preview.png">
    <img src="docs/preview.png" alt="ternssh 仪表盘预览" width="1024" />
  </a>
</p>

---

## 简介

**ternssh** 是一款运行在 Cloudflare Edge 上的 SSH 管理工具。用户通过可拖拽的仪表盘组件（服务器列表、终端、文件管理、状态监控等）构建属于自己的 SSH 工作台。

- **开放模式**：无需登录，适合个人本地或内网部署
- **Access 模式**：Cloudflare Access 门禁（JWT 校验），通过后共享同一套服务器数据

## 功能特性

| 类别 | 能力 |
|------|------|
| **服务器管理** | 分组树形结构、拖拽排序、复制/编辑、密码与私钥认证 |
| **终端** | xterm.js + WebSocket；同一服务器多标签终端；命令联想与历史补全 |
| **文件管理** | SFTP 浏览、上传/下载、拖拽上传、目录操作；双击或右键编辑远程文件（CodeMirror 语法高亮，最大 2 MB） |
| **监控** | CPU / 内存 / 磁盘（Status）、网络带宽（Network）、进程列表（Process） |
| **快捷命令** | 预设与自定义命令，支持当前终端或全部会话 |
| **凭据库** | 已保存密码 / 私钥 vault（D1），添加服务器时可复用 |
| **仪表盘** | 网格拖拽布局，组件大小与位置持久化 |
| **个性化** | 浅色 / 深色 / 跟随系统、背景图、组件透明度、布局间距、终端配色 |
| **国际化** | 中文 / English |
| **站点设置** | 自定义站点名称（顶栏与浏览器标题） |
| **一键还原** | 还原本地偏好并重置数据库（服务器、凭据、布局等） |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React + Vite + Tailwind + CodeMirror | 构建为静态资源，由 Workers 同域托管；文件编辑使用 CodeMirror 6 |
| 后端 | Cloudflare Workers | REST API、路由、身份解析 |
| 实时连接 | Durable Objects | 每个 SSH 会话一个 DO 实例，WebSocket 长连接 |
| SSH 协议 | 自研 TypeScript 栈 | 握手、Shell、SFTP、远程命令执行 |
| 数据库 | Cloudflare D1 | 用户、服务器、布局、凭据、会话等 |
| 认证（可选） | Cloudflare Access | 边缘 JWT 校验；通过后使用共享工作区 |
| DNS | Cloudflare 1.1.1.1 DoH | 域名主机名解析（IP 直连则跳过） |

## 快速开始

### 环境要求

- Node.js 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 本地开发

```bash
git clone https://github.com/HaradaKashiwa/ternssh.git
cd ternssh
npm install

# 应用 D1 迁移（首次必须）
npm run db:migrate:local

# 方式 A：前后端分离（热更新）
npm run dev:server   # Workers + 静态资源，默认 http://localhost:8787
npm run dev:web      # Vite 开发服务器，代理 /api

# 方式 B：接近生产的集成预览
npm run build
npm run dev:server
```

### 部署

项目有两份 Wrangler 配置，用途不同：

| 文件 | 用途 | D1 | 变量 |
|------|------|-----|------|
| `wrangler.jsonc` | 本地 `wrangler dev` | `local-ternssh-db` | 无（Access 等请在控制台配置） |
| `wrangler.production.jsonc` | 生产部署（gitignore） | 真实远程 ID | 无 |

#### 部署命令

| 命令 | 场景 | 实际做了什么 |
|------|------|--------------|
| **`npm run deploy`** | Cloudflare 一键部署 / Builds 的 Deploy 步骤（自动检测） | 生成 production 配置 → D1 迁移 → `wrangler deploy --config wrangler.production.jsonc` |
| **`npm run release`** | 本地一键（构建 + 发布） | `build` → `deploy` |
| **`npm run cf:deploy`** | 同 `deploy`（兼容旧文档） | 同上 |
| ~~`npx wrangler deploy`~~ | **不要用于生产** | 默认读 `wrangler.jsonc`，D1 为本地占位 ID，不含迁移步骤 |

**结论：Cloudflare 一键部署会自动检测 `npm run build` + `npm run deploy`，直接接受即可。不要用裸的 `npx wrangler deploy`。**

`npm run deploy` 与裸 `wrangler deploy` 的区别：

1. **配置文件**：`wrangler.production.jsonc`（真实 D1 ID） vs `wrangler.jsonc`（本地开发）
2. **D1 迁移**：自动执行 `migrations apply --remote` vs 无
3. **控制台变量**：production 配置不含 `vars`，不会覆盖你在 Dashboard 设置的 `ACCESS_*`；裸 deploy 历史上容易把 `vars` 同步错（现已从 `wrangler.jsonc` 移除 `vars`，但仍缺 D1 ID 与迁移）

**首次部署到 Cloudflare：**

```bash
# 1. 创建远程 D1 数据库
npx wrangler d1 create ternssh
# 记下输出的 database_id

# 2. 生成本地生产配置（二选一）

# 方式 A：复制模板后手动编辑 account_id / database_id
npm run deploy:config
# 编辑 wrangler.production.jsonc

# 方式 B：用环境变量生成（适合 CI / Cloudflare 构建）
export D1_DATABASE_ID=<上一步的 database_id>
export CLOUDFLARE_ACCOUNT_ID=<可选，多账号时指定>

# 3. 部署
npm run release
```

**Cloudflare 一键部署 / Workers Builds（Git 连接）**：

Cloudflare 会自动检测 `package.json` 中的 `build` 与 `deploy` 脚本，预填为：

| 步骤 | 命令（自动检测） |
|------|------------------|
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |

直接接受即可，无需改成 `npx wrangler deploy`。Build 阶段会 `postbuild` 生成 production 配置；Deploy 阶段跑迁移并发布。

D1 可自动发现（账号下名为 `ternssh` 的数据库），或在 Build variables 中设置 `D1_DATABASE_ID` / `CLOUDFLARE_ACCOUNT_ID`。

Access 相关变量（`ACCESS_ENABLED`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`）**只在 Workers Dashboard → Variables and Secrets 配置**，不要写进 wrangler 配置文件。

> 若看到 Wrangler 警告「本地 ACCESS_ENABLED: false 将覆盖远程」，说明 Deploy command 误用了 `npx wrangler deploy`，请改回 `npm run deploy`。

| 组件 | 平台 |
|------|------|
| API + 前端 | Cloudflare Workers（`server/public/` 为 Vite 产物） |
| 数据库 | Cloudflare D1 |
| SSH 会话 | Durable Objects (`SshSession`) |
| 认证（可选） | Cloudflare Access |

**开放模式**：在 Worker 控制台设置 `ACCESS_ENABLED=false`（或不设置该变量）。

**Access 模式**：在 Zero Trust 创建 Self-hosted Application，并在 **Workers → Settings → Variables and Secrets** 中配置（不要写进 `wrangler.production.jsonc`，否则每次部署会被覆盖）：

| 名称 | 类型 | 示例 |
|------|------|------|
| `ACCESS_ENABLED` | Variable | `true` |
| `ACCESS_TEAM_DOMAIN` | Variable | `your-team.cloudflareaccess.com`（不要加 `https://`） |
| `ACCESS_AUD` | Secret 或 Variable | 从 Access 应用复制的 AUD Tag（64 位 hex） |

Access 应用的 **Application domain** 必须与你实际访问的域名一致（`workers.dev` 或自定义域名需分别创建应用并匹配 AUD）。

### Docker 部署（自托管）

ternssh 基于 Cloudflare Workers 运行时。Docker 镜像通过 **Wrangler 本地模式** 启动完整应用（API + 前端 + 本地 D1 + Durable Objects），适合内网自托管或快速体验，**不等同于** Cloudflare 边缘生产部署。

官方镜像托管于 [GitHub Container Registry](https://github.com/HaradaKashiwa/ternssh/pkgs/container/ternssh)。推送 `v*` 标签（如 `v1.0.0`）时会自动构建并发布到 `ghcr.io/haradakashiwa/ternssh`。

#### 使用预构建镜像（推荐）

```bash
# 拉取最新版
docker pull ghcr.io/haradakashiwa/ternssh:latest

# 启动
docker run -d \
  --name ternssh \
  -p 8787:8787 \
  -v ternssh-data:/app/.wrangler \
  --restart unless-stopped \
  ghcr.io/haradakashiwa/ternssh:latest

# 访问
open http://localhost:8787
```

指定版本（去掉 `v` 前缀，例如 tag `v1.0.0` 对应镜像 `1.0.0`）：

```bash
docker run -d \
  --name ternssh \
  -p 8787:8787 \
  -v ternssh-data:/app/.wrangler \
  ghcr.io/haradakashiwa/ternssh:1.0.0
```

Docker Compose：

```bash
# 默认 latest
docker compose -f docker-compose.ghcr.yml up -d

# 指定版本
TERNSSH_TAG=1.0.0 docker compose -f docker-compose.ghcr.yml up -d

# 自定义端口
PORT=8080 docker compose -f docker-compose.ghcr.yml up -d
```

#### 从源码构建

```bash
# 构建并启动
docker compose up -d --build

# 访问
open http://localhost:8787
```

仅使用 Docker CLI：

```bash
docker build -t ternssh .
docker run -d \
  --name ternssh \
  -p 8787:8787 \
  -v ternssh-data:/app/.wrangler \
  ternssh
```

| 项 | 说明 |
|----|------|
| 镜像地址 | `ghcr.io/haradakashiwa/ternssh`（`:latest` / `:1.0.0` / `:1.0` / `:1`） |
| 默认端口 | `8787`（可通过环境变量 `PORT` 修改） |
| 数据持久化 | 挂载卷 `/app/.wrangler`（本地 D1 与 DO 状态） |
| 健康检查 | `GET /api/health` |
| 认证 | 容器内默认为开放模式；Access 需额外配置 Workers 环境变量 |
| 发布触发 | 推送 Git tag `v*` → [docker-publish.yml](.github/workflows/docker-publish.yml) 自动推送到 GHCR |

> 生产环境若需全球边缘、托管 D1 与 Access 集成，请使用 `npm run release` 部署到 Cloudflare（或 Cloudflare 一键部署，自动检测 `build` + `deploy`）。

## 项目结构

```
ternssh/
├── web/                    # 前端（React + Vite）
│   ├── public/logo.png     # 项目 Logo（favicon / 顶栏）
│   └── src/
│       ├── components/     # UI、设置、凭据字段、CodeEditor
│       ├── dashboard/      # 网格布局、对话框
│       ├── widgets/        # 终端、文件、监控等小部件
│       ├── i18n/           # 中英文
│       ├── lib/            # API 客户端、会话、SFTP
│       └── theme/          # 主题与个性化
├── server/                 # Cloudflare Workers 后端
│   ├── src/
│   │   ├── routes/         # HTTP 路由
│   │   ├── do/             # Durable Objects（SSH 会话）
│   │   ├── db/             # D1 查询
│   │   ├── ssh/            # SSH / SFTP 协议实现
│   │   └── auth/           # Access JWT / 默认用户
│   └── migrations/         # D1 数据库迁移
└── wrangler.jsonc          # Workers / D1 / DO 配置
```

## 系统架构

```mermaid
flowchart TB
    subgraph Client["浏览器"]
        UI[React Dashboard]
        Widgets[Widgets<br/>终端 / 文件 / 监控 / 服务器列表]
        UI --> Widgets
    end

    subgraph Edge["Cloudflare Edge"]
        Access[Cloudflare Access<br/>可选]
        Worker[Workers<br/>REST API]
        DO[Durable Objects<br/>SSH Session + WebSocket]
        D1[(D1 SQLite)]
    end

    subgraph Remote["远程主机"]
        SSH[SSH Server]
    end

    Widgets -->|HTTPS| Access
    Access --> Worker
    Widgets -->|WSS| DO
    Worker --> D1
    Worker -->|路由 sessionId| DO
    DO -->|SSH| SSH
```

### 认证模式

| 模式 | 条件 | 行为 |
|------|------|------|
| **开放模式** | `ACCESS_ENABLED=false` | 无需登录；数据归属内置用户 `default` |
| **Access 模式** | 已配置 Cloudflare Access | 校验 JWT；通过 Access 的用户共享同一服务器与布局 |

### 职责划分

**Workers（无状态）** — 身份解析、CRUD、创建会话并路由到 DO

**Durable Objects（有状态）** — 维护 SSH 连接、Shell 通道、SFTP、状态采集 WebSocket

**D1（持久化）** — 用户、服务器、分组、凭据、布局、会话记录、凭据 vault

## 仪表盘小部件

| 小部件 | 说明 |
|--------|------|
| `server_list` | 分组树、连接/断开、搜索、拖拽排序 |
| `terminal` | 多标签终端、命令联想（Tab / ↑↓） |
| `file_manager` | SFTP 文件浏览与传输；双击或右键「编辑」打开代码编辑器，支持语法高亮与 Ctrl/Cmd+S 保存 |
| `status` | CPU、内存、磁盘、运行时间 |
| `network` | 网卡流量与带宽曲线 |
| `process` | Top 进程（CPU / 内存） |
| `quick_commands` | 快捷命令（当前终端 / 全部会话） |

默认布局：服务器列表 + 终端 + 文件管理（三列）。

### 文件编辑

文件管理小部件支持在浏览器内临时编辑远程文本文件：

- **打开方式**：双击文件，或右键菜单选择「编辑」
- **编辑器**：CodeMirror 6，含行号、语法高亮、括号匹配、代码折叠
- **语言识别**：按扩展名自动匹配（如 `.js`、`.ts`、`.py`、`.json`、`.yaml`、`.sh` 等）
- **保存**：工具栏保存按钮，或 `Ctrl/Cmd + S`；内容通过 SFTP 写回远程文件
- **限制**：仅普通文件，最大 2 MB；关闭时有未保存更改时会提示确认

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/me` | 当前用户与认证模式 |
| POST | `/api/v1/me/reset` | 清空用户数据并重置布局 |
| GET/PUT | `/api/v1/dashboards` | 仪表盘与组件布局 |
| POST | `/api/v1/dashboards/reset` | 同 `/me/reset` 的数据库重置 |
| GET | `/api/v1/servers/tree` | 服务器分组树 |
| CRUD | `/api/v1/servers` | 服务器管理 |
| CRUD | `/api/v1/servers/groups` | 分组管理 |
| PUT | `/api/v1/servers/move` | 拖拽排序 |
| GET/POST/DELETE | `/api/v1/saved-passwords` | 已保存密码 vault |
| GET/POST/DELETE | `/api/v1/saved-private-keys` | 已保存私钥 vault |
| POST | `/api/v1/sessions` | 创建 SSH 会话 |
| WS | `/api/v1/sessions/:id/ws` | 终端 WebSocket |
| WS | `/api/v1/sessions/:id/sftp/ws` | SFTP WebSocket |
| GET | `/api/v1/sessions/:id/status` | 远程主机指标采集 |

### SSH 会话生命周期

```mermaid
sequenceDiagram
    participant C as 前端
    participant W as Worker
    participant D as Durable Object
    participant S as SSH Server

    C->>W: POST /sessions { serverId }
    W->>D: 按 sessionId 创建 DO
    D->>S: SSH 握手 + Shell
    W-->>C: { sessionId, wsUrl, sftpWsUrl }
    C->>D: WebSocket 连接
    loop 终端 I/O
        C->>D: 输入
        D->>S: Shell write
        S->>D: Shell read
        D->>C: 输出
    end
```

## 数据库（D1）

迁移文件位于 `server/migrations/`：

| 迁移 | 内容 |
|------|------|
| `0001_init.sql` | users、servers、credentials、dashboards、widgets、sessions |
| `0002_server_groups.sql` | server_groups，servers 增加 group_id / sort_order |
| `0003_saved_passwords.sql` | saved_passwords 凭据 vault |
| `0004_saved_private_keys.sql` | saved_private_keys 凭据 vault |

```bash
npm run db:migrate:local   # 本地
npm run db:migrate         # 远程（deploy 已包含）
```

## 设置与个性化

在顶栏 **设置** 中可配置：

- **通用**：站点名称、语言、还原所有设置（双重确认）
- **个性化**：外观主题、背景图、组件透明度、布局间距、终端配色

还原所有设置会清除 localStorage 偏好，并调用 `POST /api/v1/me/reset` 清空该用户在 D1 中的服务器、凭据、会话与布局，恢复为初始状态。

## 安全说明

- **开放模式**无应用层认证，请勿在公网暴露敏感环境
- Access 模式仅作登录门禁，所有通过校验的请求使用内置用户 `default` 的数据
- SSH 密码/私钥存于 D1 `credentials` 表（按服务器引用）；vault 条目存于 `saved_passwords` / `saved_private_keys`
- 全站 HTTPS / WSS；DO 实例按 session 隔离

## 配置参考

- **`wrangler.jsonc`** — 本地开发（`wrangler dev`）；**不含 `vars`**，Access 变量仅在控制台配置
- **`wrangler.production.jsonc.example`** — 生产配置模板
- **`wrangler.production.jsonc`** — 你的生产配置（gitignore，从模板复制或脚本生成）；**不含 `vars`/密钥**，避免部署覆盖控制台配置

根目录 `wrangler.jsonc` 示例：

```jsonc
{
  "name": "ternssh",
  "main": "server/src/index.ts",
  "assets": {
    "directory": "./server/public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "ternssh",
    "database_id": "local-ternssh-db",
    "migrations_dir": "server/migrations"
  }],
  "durable_objects": {
    "bindings": [{ "name": "SSH_SESSION", "class_name": "SshSession" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SshSession"] }]
}
```

前端构建产物输出到 `server/public/`（`web/vite.config.ts` 的 `build.outDir`）。

## 开发路线

- [x] Workers + D1 脚手架，开放 / Access 双模式
- [x] 自研 SSH 协议栈、Durable Object 会话
- [x] 仪表盘拖拽布局与持久化
- [x] 终端、SFTP 文件管理、远程文件临时编辑、状态/网络/进程监控
- [x] 服务器分组、凭据 vault、多终端标签
- [x] 个性化、国际化、站点名称、一键还原
- [ ] 多仪表盘切换
- [ ] 插件化自定义小部件

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE) (GPLv3).
