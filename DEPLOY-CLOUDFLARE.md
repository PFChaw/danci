# 部署到 Cloudflare Pages（连 GitHub，push 自动更新）

照着做，全程点鼠标，不需要懂服务器。

---

## 0. 准备

- 一个 GitHub 账号（免费）
- 一个 Cloudflare 账号（免费，邮箱注册即可，不用绑卡）
- 本包解压到本地任意目录

---

## 1. 推到 GitHub

在解压后的目录里打开终端（PowerShell / Git Bash 都行）：

```bash
git init -b main
git add .
git commit -m "背单词工具：纯静态版"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

没有仓库就先在 GitHub 网页 **New repository** 建一个空仓库（**不要**勾选 Add a README / .gitignore，否则推送会冲突）。

推送中途要密码时，用 **Personal Access Token** 当密码（GitHub → Settings → Developer settings → Tokens → Generate new token，勾 `repo`）。

---

## 2. 连到 Cloudflare

1. 打开 https://dash.cloudflare.com ，登录
2. 左侧 **Workers & Pages** → 右上 **Create application**
3. 在 “Make something new” 里选 **Connect GitHub**
   - （新版界面可能写 *Import an existing Git repository*；**不要**选 “Upload your static files”，那是手动上传）
4. 第一次会跳 GitHub 授权页：选 **Only select repositories** → 勾刚建的仓库 → **Install & Authorize**
5. 回到 Cloudflare，选中该仓库 → **Begin setup**

---

## 3. 构建设置（关键，别填错）

| 项目 | 填什么 |
|---|---|
| Project name | 随意，会成为网址前缀 |
| Production branch | `main` |
| Framework preset | `None` |
| **Build command** | **留空**（我们不需要构建） |
| **Build output directory** | `/`（仓库根目录，因为 `index.html` 就在根上） |
| Environment variables | 不用填 |

点 **Save and Deploy**。第一次构建大约 30–60 秒。

成功后得到：`https://<项目名>.pages.dev` —— 手机、电脑都能打开，进度正常保存。

---

## 4. 以后怎么更新

改完代码：

```bash
git add .
git commit -m "改了点什么"
git push
```

Cloudflare 会自动重新部署（Workers & Pages → 你的项目 → Deployments 能看到进度），网址不变。

---

## 5. 常见问题

**打开只看到 404 / 目录列表**
- Build output directory 填错了。必须是 `/`（或空着让它用默认），不是 `dist`（我们没用构建）。

**页面白屏**
- 打开浏览器控制台看报错；多半是 `data/books/*.json` 没一起推上去（检查 `git status` 里有没有这些文件）。

**改了代码但网页没变**
- 浏览器缓存：`Ctrl + F5`（手机：清站点数据或换个浏览器试）。
- 或者 Deployments 里上一次还在进行中。

**手机能看但进度存不住**
- 确认打开的是 `https://` 网址，不是微信/WPS 里的文件预览。

**想绑自己的域名**
- Pages → 你的项目 → Custom domains → Set up a domain。
- 域名接在 Cloudflare 上时不用备案；只有「域名 + 中国大陆服务器」才需要 ICP。

**想不连 GitHub、手动上传**
- 本地跑 `node tools/build-single.mjs` 得到 `背单词.html`（单文件，词库内联），把它拖到 *Upload your static files* 页面；更新时重新拖一次。

---

## 6. 完成后检查清单

- [ ] `https://<项目名>.pages.dev` 打开是首页（"一个简单的 / 背单词工具"）
- [ ] 点「开始吧！」能选词书、设每天词数
- [ ] 学一个词，三个点按轮次点亮
- [ ] 刷新页面，今日进度还在
- [ ] 手机浏览器打开同一网址，样式的深色/浅色与主题色正常
- [ ] 设置 → 数据 → 导出进度，能下载 JSON
