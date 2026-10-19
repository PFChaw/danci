# 背单词工具

线上地址：https://danci-25c.pages.dev

一个**纯静态**的背单词网页：三轮成组学习 + 艾宾浩斯复习 + 生词本，9 本词书，深浅色主题与自定义主题色，进度存在浏览器本地，可导出/导入。

没有后端、没有数据库、不用注册。把仓库连到 Cloudflare Pages，push 一下就是一个自己的网址，手机也能用。

---

## 它怎么学

一组词（每天一组，数量可设 10 / 20 / 30 / 50）**一起过三轮**，每个词点亮一个点：

| 轮次 | 你看到 | 你要做 |
|---|---|---|
| 第 1 轮 | 英文 + 音标 + **3 个中文选项** | 选出正确释义 |
| 第 2 轮 | 英文 + 音标（不给选项） | 纯回想，自评「认识 / 模糊 / 不认识」 |
| 第 3 轮 | **只有中文** | 把英文拼出来 |

- 整组都过完第 1 轮，才进第 2 轮；同理到第 3 轮。一个词不重复走同一步。
- 答错不点亮，这个词会排到本轮队尾，等下再遇到。
- 三个点全亮 → 进复习队列。

**复习曲线**：答对一次进下一档，间隔 1 / 2 / 4 / 7 / 15 天；走完 15 天这档就算掌握，不再出现。答错退一档、4 小时后重来；选「模糊」原地不动、4 小时后再问。今天到期的词按到期时间排序，跨词书都会来。

**生词本**：任何时候答错的词自动进生词本；在生词本里或在日常复习里累计答对 3 次就自动移出（答错不清零）。也可以手动多选删除、一键清空。

---

## 本地跑起来

只要有 Python（或任何静态服务器）：

```bash
# 在本目录执行
python -m http.server 8080
# 然后打开 http://localhost:8080
```

> 直接双击 `index.html` 也能看，但浏览器在 `file://` 下禁用 localStorage，**进度存不住**（页面顶部会提示）。要看进度就必须用 `http://` 或 `https://` 打开。

想局域网里用手机看：`python -m http.server 8080 --bind 0.0.0.0`，手机访问 `http://<电脑内网IP>:8080`（同一 WiFi，放行防火墙）。

---

## 部署到 Cloudflare Pages（连 GitHub，push 即更新）

### 1. 把仓库推上去

**懒人版**：解压后在 PowerShell 里跑（会自动 init / commit / push）

```powershell
powershell -ExecutionPolicy Bypass -File push-to-github.ps1 -Repo https://github.com/<你的用户名>/<仓库名>.git
```

或者手动：

```bash
# 解压本包到任意目录，然后
git init -b main
git add .
git commit -m "背单词工具：纯静态版"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 2. 在 Cloudflare 里连仓库

1. 打开 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create application**
2. 选 **Connect GitHub**（新版界面在 “Make something new” 里，也可能叫 *Import an existing Git repository*；**不是** “Upload your static files”）
3. 授权 Cloudflare 访问你的 GitHub，选中刚推的仓库 → **Begin setup**
4. 构建设置：

   | 项 | 填什么 |
   |---|---|
   | Framework preset | `None` |
   | Build command | **留空** |
   | Build output directory | `/`（就是仓库根目录） |
   | 环境变量 | 不需要 |

5. **Save and Deploy**，一两分钟后得到 `https://<项目名>.pages.dev`

### 3. 以后更新

改完 `git push`，Cloudflare 自动重新发布，网址不变。

> 想绑定自己的域名：Pages → Custom domains。挂在 Cloudflare 上的域名不需要备案；只有「域名 + 中国大陆服务器」才需要。

### 备选：不连 GitHub，直接传

- 单文件版：`node tools/build-single.mjs` 生成 `背单词.html`（约 7.6 MB，词库内联，双击即用），拖到 Cloudflare 的 *Upload your static files* 即可（更新要手动重传）。
- 或者把 `node tools/make-dist.mjs` 生成的 `dist/` 目录整个拖进去。

---

## 目录结构

```
index.html            单页界面：首页 / 学习 / 生词本 / 统计 / 设置
css/style.css         全部样式（黑绿白主题、深浅色、自定义主题色、动效）
js/engine.js          学习引擎：三轮、整组推进、复习曲线、生词本、导入导出
js/app.js             界面逻辑：渲染、快捷键、主题色、引导流程
data/books/*.json     9 本词书（每词：单词 / 音标 / 释义 / 例句 / 例句翻译）
data/books/index.json 词书清单
tests/                引擎单测 + 真实浏览器端到端测试（可选）
tools/                打包脚本（单文件版、dist）
```

---

## 数据与备份

- 进度存在浏览器 `localStorage`，键名 `danci.v1.state`。
- 设置 → 数据 → **导出进度** 得到一个 JSON；换电脑/换浏览器用 **导入进度** 恢复。
- 换词书不影响已学进度：复习队列是跨词书的，只有「上新词」按当前词书取。
- 清浏览器数据 = 丢进度，重要的话定期导出一份。

---

## 自定义

- **词书**：设置里可切 9 本（六级核心 1956 / 六级 5406 / 四级 3846 / 考研 4801 / 托福 6970 / 雅思 5038 / GRE 7504 / 高考 3671 / 中考 1598）。
- **每天多少词**：10 / 20 / 30 / 50，改了当天已开的那组会立刻按新数量调整。
- **主题色**：设置 → 主题色，9 个预设色板 + 0–360° 色相滑块 + 背景「跟随主题 / 纯黑纯白」，深浅两套共用一套主题色。
- **换词库**：把 `data/books/` 里的 JSON 换成自己的（格式 `[{ "id":1, "word":"abandon", "phonetic":"/əˈbændən/", "translation":"v. 放弃", "example":"", "example_cn":"" }]`），再改 `index.json` 清单即可。

---

## 测试（可选）

```bash
node tests/engine.test.mjs                 # 引擎：三轮 / 复习 / 生词本 / 导入导出
node tests/ui.cdp.mjs                      # 真实浏览器点击全流程（需本机 Edge）
node tests/onb.cdp.mjs                     # 首页 → 选词书 → 每日词数 → 欢迎 → 学习
node tests/accent.cdp.mjs                  # 主题色：色板 / 滑块 / 背景 / 刷新保留
node tests/nostore.cdp.mjs 背单词.html      # 禁用 localStorage 时的降级表现
```

---

## 数据来源与许可

- 代码：**MIT**（见 `LICENSE`）。
- 词条释义/音标：**ECDICT**（https://github.com/skywind3000/ECDICT ，MIT）。
- 例句：**Tatoeba**（https://tatoeba.org ，CC-BY 2.0 FR），已做繁转简与长度筛选，部分词没有合适例句则留空。
- 发音：浏览器自带 `speechSynthesis`，不依赖外部音频。

---

## 已知限制

- 进度只在**当前浏览器**，没有账号同步；多设备请用导出/导入。
- 首次打开要下载 2–7 MB 的词书 JSON（随词书大小而异），之后走缓存。
- 没有拼写纠错提示，只判断对/错；第三轮可以点「跳过」。
- 微信 / WPS / 文件管理器直接打开 HTML 属于 `file://`，存不了进度 —— 用 `http://` 或部署到 https 即可。


