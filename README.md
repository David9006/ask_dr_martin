# Ask Dr. Martin

课本第 37 页上方那个 "Ask Dr. Martin" 网页的可运行实现：纯 HTML / CSS / JavaScript 前端
＋ Cloudflare Pages Functions API ＋ D1 数据库，没有构建步骤，也不需要任何 npm 依赖。

## 运行

### 本地开发（推荐）

```bash
npm start            # node server/dev.mjs
# 打开 http://127.0.0.1:8787
```

这个脚本用 Node 自带的 `node:sqlite` 模拟 D1，跑的是**和线上完全同一份** `src/api/` 代码，
所以本地通过的功能部署后行为一致。需要 Node.js 22.5 或更高版本。

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `ADM_DB` | `server/data/ask-dr-martin.db` | 本地 SQLite 文件路径 |

### 本地开发（真实 Workers 运行时）

想看 Cloudflare 真正执行的效果，用 Wrangler：

```bash
npx wrangler d1 execute ask-dr-martin-db --local --file=./schema.sql   # 首次
npx wrangler pages dev                                                # http://127.0.0.1:8787
```

也可以直接双击 `public/index.html`（`file://`）：页面会把账户请求发到
`http://127.0.0.1:8787`（接口允许跨域），前提是本地服务已启动。

## 已实现的功能

### 顶栏

- **HOME / CLUBS / NEWS / SERVICES / Q&A** 五个标签页可以真正切换页面内容，支持
  `#home`、`#clubs`、`#qa` 之类的 hash 深链接、鼠标点击以及键盘
  `←` `→` `Home` `End` 操作。
- **账户表单**（Email/Handle + Password + `Login` / `Sign Up`）：
  - 未登录时显示表单；点 `Sign Up` 会多出一行 **Repeat Password**，再点一次即注册。
  - 注册用邮箱（密码至少 8 位），用户名自动取邮箱前缀（如 `casey@example.com` → `casey`，
    重名时自动加数字）；之后可以用**邮箱或用户名**登录。
  - 已登录时隐藏表单，改为显示 `Hi, 用户名` 和 `Log out`。
  - 有行内错误提示，登录失败提示、重复邮箱、密码过短、两次密码不一致等都有对应文案。
- 右侧的 ⚙ 按钮打开 **AI settings** 面板。

### 横幅（hero）

- 横幅直接使用课本页面里的原图（医生照片、蓝色医疗背景、跑步剪影），裁切后放在
  `assets/hero-banner.jpg`；原图中印死的标题和搜索框已修掉，改用可交互的 HTML
  标题与搜索框覆盖在同一位置。
- 绿色的 "Ask Dr. Martin" 标题、带放大镜的提问框和绿色 `find` 按钮仍为 HTML 控件。
- 在横幅里提问会自动切到 **Q&A** 标签页并生成回答。

### 内容卡片

- **HOME**：Dr. Martin 给 Jeremy 的回信（与课本文字一致），卡片内保留细灰色滚动条；
  "click here" 会打开跑步指南弹窗。
- **CLUBS**：三个示例俱乐部，未登录时点加入会提示先登录，登录后按账户注册。
- **NEWS**：诊所时间、社区跑、补水活动等示例新闻。
- **SERVICES**：在线问诊、体检、营养与恢复计划、跑步损伤筛查。
- **Q&A**：默认只显示问题列表；点进某条问题才切换到答案视图，左上角的
  “← All questions” 可以返回列表。提问统一使用页面顶部横幅里的输入框，不再重复放置。
  内置了课本中的提问（“I'm a bit fed up with getting sick all the time…”），它的回答与课本原图一致
  （包含 “Hi Jeremy,” 抬头和署名）；HOME 里显示的信则去掉抬头。
  登录用户问过并且**拿到了回答**的问题会自动保存到账号里，出现在列表最上面（`You · 日期`），
  换浏览器登录同一账号也能看到；未登录时这些记录只留在本机 `localStorage`。

### 提问与 AI 回答

`find` 的行为：

1. 切到 **Q&A** 标签页，显示问题。
2. **没配置 API key** 时：如果问题能在内置问答库里匹配到，就直接显示归档回答；
   否则提示去 AI settings 填写 key。
3. **已配置** 时：调用 OpenAI 兼容的 `POST {baseUrl}/chat/completions`，带
   `Authorization: Bearer <key>` 和 Dr. Martin 人设的 system prompt，显示
   "Dr. Martin is reading your question…" 动画，拿到结果后显示回答并存入历史
   （最多 20 条）。
4. 出错时按情况提示：key 被拒绝（401/403）、endpoint 或模型不存在（404）、限流（429）、
   网络 / CORS 失败、45 秒超时，并给出「重试」「Open AI settings」「查看归档回答」等按钮。
5. 回答成功且已登录时，会 `POST /api/answers` 把「问题 + 回答」存进账号；报错、取消、
   只是命中了内置归档的情况都不记录。

## 配置 AI

点击顶栏 ⚙ → **AI settings**：

| 字段 | 说明 |
| --- | --- |
| Endpoint base URL | 默认 `https://api.openai.com/v1`，也可填任何 OpenAI 兼容服务 |
| Model | 默认 `gpt-4o-mini`，填服务商支持的模型名 |
| API key | 只保存在当前浏览器的 `localStorage`，不会写进代码 |

注意：

- 浏览器直连要求该接口允许来自本页面的 **CORS** 请求；不允许时页面会提示网络错误。
- key 保存在 `localStorage("adm.ai.settings")` 中，同域下的脚本可以读取，因此只建议在
  自己信任的电脑和浏览器上使用；做公开部署时应改成由后端代理请求。
- 不填 key 时页面其它功能（标签页、订阅表单、归档回答）完全可用。

## 账户服务

业务逻辑集中在 `src/api/`，由两个很薄的适配层复用：`functions/` 给 Cloudflare Pages，
`server/` 给本地 Node。
本地 `npm start` 用同一份代码跑在 Node 上。

| 文件 | 作用 |
| --- | --- |
| `functions/api/[[path]].js` | Pages Function 入口，所有 `/api/*` 请求都走这里 |
| `src/api/handler.js` | 路由、校验、D1 查询、登录限流 |
| `src/api/http.js` | JSON/错误响应、CORS、请求体解析 |
| `src/api/crypto.js` | PBKDF2 密码哈希、会话令牌与 SHA-256 摘要 |
| `schema.sql` | 建表语句，本地与 D1 共用 |
| `server/dev.mjs` | 本地开发服务器（静态文件 + 调同一个 handler） |
| `server/d1-node.mjs` | 把 `node:sqlite` 包装成 D1 的 `prepare().bind()` 接口 |

接口：

| 方法 & 路径 | 说明 |
| --- | --- |
| `POST /api/auth/register` | `{email, password}` → 创建账户并返回令牌 |
| `POST /api/auth/login` | `{identifier, password}`，`identifier` 可填邮箱或用户名 |
| `POST /api/auth/logout` | 注销当前令牌 |
| `GET /api/auth/me` | 校验令牌并返回当前用户 |
| `GET /api/answers` | 当前用户保存的问答 |
| `POST /api/answers` | `{question, answer}`，同一个问题会更新而不是重复插入 |
| `GET /api/health` | 健康检查 |

安全措施：

- 密码用 **PBKDF2-SHA256（10 万次迭代，WebCrypto）** 加盐哈希。这里不用 scrypt 是因为
  Workers 有 CPU 时间预算，PBKDF2 由原生实现、开销更可控；迭代次数上限定为 10 万，
  因为 Cloudflare 的 WebCrypto 明确拒绝超过 100000 的 PBKDF2 迭代
  （`Pbkdf2 failed: iteration counts above 100000 are not supported`）。
  迭代次数记录在每个哈希串内部，日后提高上限时旧密码仍可校验。
- 会话令牌 32 字节随机数，数据库只存 SHA-256 摘要，有效期 30 天，退出即删除。
- 登录失败同一 IP + 账号 15 分钟内最多 8 次，超过返回 429（按 isolate 计数，属于尽力而为）。
- 请求体上限 64 KB；本地静态服务做了目录穿越防护。
- 问答按用户隔离，其他账户看不到你的记录。

**注意**：会话令牌和 AI key 仍存在浏览器 `localStorage`。公开上线前建议再加邮箱验证、
密码重置和更严格的风控。

## 本地存储

| key | 内容 |
| --- | --- |
| `adm.session` | 登录令牌与当前用户信息 |
| `adm.ai.settings` | AI 接口地址、模型、API key |
| `adm.qa.history` | 未登录时的提问与回答（最多 20 条） |
| `adm.api.base` | （可选）`file://` 下覆盖账户服务地址 |

## 文件结构

```
public/                Cloudflare Pages 的构建输出目录
  index.html           页面结构与所有标签页内容
  styles.css           配色、顶栏斜角标签、横幅、账户表单、卡片、弹窗、toast、响应式
  assets/hero-banner.jpg  横幅原图（已获授权），裁切并修复过
  js/config.js         可选：指向另一个域名的账户服务（默认同源）
  js/data.js           归档问答、俱乐部 / 新闻 / 服务、跑步指南数据
  js/ai.js             AI 设置读写、OpenAI 兼容请求、错误信息映射
  js/auth.js           账户接口客户端与会话保存
  js/app.js            标签页路由、账户表单、搜索与回答渲染、弹窗、toast

functions/            Pages Functions（部署到 /api/*）
  api/[[path]].js     入口，转调 src/api/handler.js

src/api/              共享业务逻辑（Pages 与本地 Node 都复用）
  handler.js          账户与问答
  http.js             JSON / CORS / 校验工具
  crypto.js           PBKDF2 哈希与会话令牌

server/               本地开发用（不会部署）
  dev.mjs             静态文件 + 调用同一个 handler
  d1-node.mjs         node:sqlite → D1 接口的适配层

schema.sql            建表语句（本地与 D1 通用）
wrangler.toml         Pages 项目配置与 D1 绑定
package.json          npm start / dev / deploy 脚本
```

## 发布到 GitHub

可以安全提交的内容：`public/`（页面与前端代码）、`functions/`、`src/`、`server/`、`schema.sql`、`wrangler.toml`、`package.json`、`README.md`。代码里没有任何硬编码密钥。

**不要提交**（`.gitignore` 已覆盖）：

| 路径 | 原因 |
| --- | --- |
| `server/data/`、`*.db`、`*.db-shm`、`*.db-wal` | 本地 SQLite 数据库，含注册邮箱与密码哈希（虽然是哈希，也不该公开） |
| `.env`、`.env.*`、`.dev.vars` | 本地密钥/环境变量 |
| `*.pem`、`*.key` | 私钥文件 |
| `node_modules/`、`.wrangler/`、`.dev.vars`、`*.log`、`.DS_Store` | 依赖、Wrangler 本地状态、日志、系统文件 |

另外两点：

- AI 的 API key 从来没有写进文件，它只存在用户浏览器的 `localStorage` 里，所以不用担心提交时泄露；也请不要把 key 填进 `public/js/config.js`。
- `public/assets/hero-banner.jpg` 是课本素材（你已取得授权），可以随仓库发布，但对外公开时请确认授权范围允许公开托管。
- `wrangler.toml` 里的 `database_id` 不是密钥，可以提交；真正的 D1 访问由 Cloudflare 账号权限控制。

首次发布：

```bash
git init
git add -A
git commit -m "Ask Dr. Martin"
git branch -M main
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

## 部署到 Cloudflare Pages

这个项目就是按 **Pages 全栈**（静态资源 + Functions + D1）组织的，不需要改代码。

### 1. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create ask-dr-martin-db
```

把输出里的 `database_id` 填进 [wrangler.toml](./wrangler.toml)（现在的
`00000000-0000-0000-0000-000000000000` 只是让本地开发能跑起来的占位值）：

```toml
[[d1_databases]]
binding = "DB"
database_name = "ask-dr-martin-db"
database_id = "真正的 id"
```

然后建表：

```bash
npx wrangler d1 execute ask-dr-martin-db --remote --file=./schema.sql
```

### 2. 部署

**方式一：直接上传**

```bash
npx wrangler pages deploy public --project-name ask-dr-martin
```

**方式二：接 GitHub（推荐，push 自动部署）**

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选择仓库后：

| 设置 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | 留空 |
| Build output directory | `public` |

`functions/` 必须在仓库根目录（不能放进 `public/`），Pages 会自动把它编译成 `/api/*`；
`functions/` 里可以用相对路径 import 仓库内其他目录（本项目就从 `src/api/` 引入业务逻辑）。
如果是在 Dashboard 里创建的 D1，记得去 **Settings → Bindings → D1 database** 把变量名设为 `DB`。

### 3. 验证

部署完成后打开 `https://<项目>.pages.dev/api/health`，应返回 `{"ok":true}`；
再在页面右上角注册一个账号、提一个问题，答案应该出现在 Q&A 列表里。

### 常见问题

| 现象 | 原因 |
| --- | --- |
| `/api/*` 返回 `{"error":{"code":"db_unbound"}}` | 没绑定 D1，或绑定名不是 `DB` |
| `/api/*` 返回 `no such table: users` | 没有执行 `schema.sql`（本地/远端搞混了） |
| 静态页面 404 | Build output directory 没设成 `public` |
| 登录一直 401 | 密码哈希算法只支持 PBKDF2；旧版 scrypt 本地库需要重建 |

## 说明

- 横幅图片来自课本页面，已按你的说明取得版权许可；`assets/hero-banner.jpg` 中保留了
  医生照片与跑者剪影，仅把原图上的标题和搜索框抹掉，以便叠加可用的 HTML 控件。
  其余内容（俱乐部、新闻、服务）是示例数据，集中在 `js/data.js`，替换即可。
- 桌面端回信卡片保留课本中的内部滚动条效果；窄屏（≤640px）会自动取消高度限制，
  按普通页面滚动。
- 本地数据库默认写在 `server/data/`（已在 `.gitignore` 中忽略），删掉它即可清空本地账户。
- 线上数据在 D1 里，清空用 `npx wrangler d1 execute ask-dr-martin-db --remote --command "DELETE FROM answers; DELETE FROM sessions; DELETE FROM users;"`。
