# Ask Dr. Martin

课本第 37 页上方那个 "Ask Dr. Martin" 网页的可运行实现。前端是纯 HTML / CSS / JavaScript，
没有构建步骤；账户服务是一个零依赖的 Node 脚本，数据库用 Node 自带的 `node:sqlite`。

## 运行

需要 Node.js 22.5 或更高版本（`node:sqlite` 从该版本开始提供）。

```bash
npm start            # 等价于 node server/server.js
# 打开 http://127.0.0.1:8787
```

服务器同时提供静态页面和 `/api/*` 接口，所以注册、登录、保存问答都同源，不需要额外配置。

也可以继续像以前一样直接双击 `index.html`（`file://`）：页面会自动把账户请求发到
`http://127.0.0.1:8787`（服务器允许跨域），前提是本地服务已经启动。

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `ADM_DB` | `server/data/ask-dr-martin.db` | SQLite 数据库文件路径 |

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

零依赖，`server/` 下三个文件：

| 文件 | 作用 |
| --- | --- |
| `server/server.js` | HTTP 服务：静态文件 + `/api/*` 路由、CORS、登录限流 |
| `server/db.js` | SQLite（`node:sqlite`）表结构与查询 |
| `server/auth.js` | scrypt 密码哈希、随机会话令牌与 SHA-256 摘要 |

接口：

| 方法 & 路径 | 说明 |
| --- | --- |
| `POST /api/auth/register` | `{email, password}` → 创建账户并返回令牌 |
| `POST /api/auth/login` | `{identifier, password}`，`identifier` 可填邮箱或用户名 |
| `POST /api/auth/logout` | 注销当前令牌 |
| `GET /api/auth/me` | 校验令牌并返回当前用户 |
| `GET /api/answers` | 当前用户保存的问答 |
| `POST /api/answers` | `{question, answer}`，同一个问题会更新而不是重复插入 |

安全措施：

- 密码用 scrypt（N=16384）加盐哈希，数据库里只有哈希值。
- 会话令牌 32 字节随机数，数据库只存 SHA-256 摘要，有效期 30 天，退出即删除。
- 登录失败同一 IP + 账号 15 分钟内最多 8 次，超过返回 429。
- 请求体上限 64 KB；静态文件路径做了目录穿越防护。
- 问答按用户隔离，其他账户看不到你的记录。

**注意**：这是本地演示用的服务，令牌和 AI key 仍存放在浏览器 `localStorage`；
如果要公开部署，需要加 HTTPS、邮箱验证、CSRF/会话加固和真正的密钥托管。

## 本地存储

| key | 内容 |
| --- | --- |
| `adm.session` | 登录令牌与当前用户信息 |
| `adm.ai.settings` | AI 接口地址、模型、API key |
| `adm.qa.history` | 未登录时的提问与回答（最多 20 条） |
| `adm.api.base` | （可选）`file://` 下覆盖账户服务地址 |

## 文件结构

```
index.html        页面结构与所有标签页内容
styles.css        配色、顶栏斜角标签、横幅、账户表单、卡片、弹窗、toast、响应式
package.json      npm start 脚本（无依赖）
server/server.js  HTTP 服务：静态文件 + 账户/问答 API
server/db.js      SQLite 表结构与查询
server/auth.js    scrypt 哈希与会话令牌
assets/
  hero-banner.jpg 横幅原图（已获授权），裁切并修复过
js/config.js      可选：指向另一个域名的账户服务（默认为同源）
js/data.js        归档问答、俱乐部 / 新闻 / 服务、跑步指南数据
js/ai.js          AI 设置读写、OpenAI 兼容请求、错误信息映射
js/auth.js        账户接口客户端与会话保存
js/app.js         标签页路由、账户表单、搜索与回答渲染、弹窗、toast
```

## 发布到 GitHub

可以安全提交的内容：`index.html`、`styles.css`、`js/`、`assets/`、`server/*.js`、`package.json`、`README.md`。代码里没有任何硬编码密钥。

**不要提交**（`.gitignore` 已覆盖）：

| 路径 | 原因 |
| --- | --- |
| `server/data/`、`*.db`、`*.db-shm`、`*.db-wal` | SQLite 数据库，含注册邮箱与密码哈希（虽然是 scrypt 哈希，也不该公开） |
| `.env`、`.env.*`、`.dev.vars` | 本地密钥/环境变量 |
| `*.pem`、`*.key` | 私钥文件 |
| `node_modules/`、`.wrangler/`、`*.log`、`.DS_Store` | 依赖、工具缓存、日志、系统文件 |

另外两点：

- AI 的 API key 从来没有写进文件，它只存在用户浏览器的 `localStorage` 里，所以不用担心提交时泄露；也请不要把 key 填进 `js/config.js`。
- `assets/hero-banner.jpg` 是课本素材（你已取得授权），可以随仓库发布，但对外公开时请确认授权范围允许公开托管。

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

**先说明限制**：Cloudflare Pages 只能托管静态文件，不能运行 `server/server.js`（Node + `node:sqlite`）。所以有三种做法：

### 方案 A：只部署前端（最快，账户功能不可用）

1. 把仓库连到 Cloudflare：Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，选这个仓库。
2. 构建设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：**`/`**（如果按下面“建议”把静态文件移进 `public/`，就填 `public`）
3. **Save and Deploy**，之后每次 push 自动部署。

或者不用 Git，直接上传：

```bash
npx wrangler pages deploy . --project-name ask-dr-martin
```

结果：页面、标签页、归档问答都正常；但顶栏注册/登录会提示 “Cannot reach the account service.”，因为后端不存在。

> 提示：输出目录设成仓库根目录时，`server/*.js`、`package.json` 也会被当成静态文件公开（不含密钥，但没必要）。更干净的做法是把 `index.html`、`styles.css`、`js/`、`assets/` 移到 `public/`，输出目录填 `public`。

### 方案 B：Pages Functions + D1（账户功能也能用）

Pages 支持在仓库根目录放 `functions/` 目录，用 Workers 运行时处理 `/api/*`，数据存 D1（SQLite）。需要把 `server/` 改写成 Functions：

- `functions/api/auth/register.js`、`login.js`、`logout.js`、`me.js`
- `functions/api/answers/index.js`（`GET` 列表 / `POST` 保存）
- `schema.sql` + `wrangler.toml`（`pages_build_output_dir = "public"`，`[[d1_databases]] binding = "DB"`）
- Workers 里没有 `node:sqlite` 和 `scrypt`，改用 `env.DB.prepare(...)` 和 WebCrypto 的 **PBKDF2-SHA256** 做密码哈希

步骤：

```bash
npx wrangler login
npx wrangler d1 create ask-dr-martin-db       # 把返回的 database_id 写进 wrangler.toml
npx wrangler d1 execute ask-dr-martin-db --remote --file=./schema.sql
npx wrangler pages deploy public --project-name ask-dr-martin
```

Git 部署时在 Dashboard → 项目 → **Settings → Functions → D1 database bindings** 里绑定 `DB` 到该数据库，并设置同样的构建输出目录。

前端不需要改动：接口同源，`js/config.js` 保持 `window.ADM_API_BASE = ''`。

### 方案 C：前端在 Pages，Node 接口放别处

1. 按方案 A 部署静态站点。
2. 把 `server/` 部署到 Render / Railway / Fly.io 之类能跑 Node 的地方（启动命令 `node server/server.js`，需要 `PORT`、`ADM_DB`）。
3. 在 `js/config.js` 里指向它：

```js
window.ADM_API_BASE = 'https://your-api.example.com';
```

服务端已经返回 `Access-Control-Allow-Origin: *`，跨域下 Bearer 令牌可以正常工作。

注意：免费实例的磁盘通常重启即清空；要长期保留账户，请挂载持久磁盘（或把 `db.js` 换成 Turso/Postgres）。

## 说明

- 横幅图片来自课本页面，已按你的说明取得版权许可；`assets/hero-banner.jpg` 中保留了
  医生照片与跑者剪影，仅把原图上的标题和搜索框抹掉，以便叠加可用的 HTML 控件。
  其余内容（俱乐部、新闻、服务）是示例数据，集中在 `js/data.js`，替换即可。
- 桌面端回信卡片保留课本中的内部滚动条效果；窄屏（≤640px）会自动取消高度限制，
  按普通页面滚动。
- 数据库文件默认写在 `server/data/`（已在 `.gitignore` 中忽略），删掉它即可清空所有账户。
