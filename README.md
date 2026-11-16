# 云海问道

[立即游玩](https://zzc-zdc.github.io/yunhai-wendao/) · [完整源码仓库](https://github.com/zzc-zdc/yunhai-wendao) · [五轮自检报告](docs/QA.md)

一款完整可运行的东方修仙 Canvas 2D 浏览器游戏。五境修行、十五门主动神通、三大区域、首领与共享掉落、炼器炼丹，以及无需玩家注册的 2–4 人房间联机。所有场景、角色与战斗特效均由程序绘制。

默认用 PeerJS 公共 WebSocket 信令服务建立 WebRTC 数据通道；朋友只需打开网址，输入房间号。配置公开 key 后可切换为 `@gamerelay/sdk`。静态站点不需要自建游戏服务器。

## 运行

使用 Node.js 22 或更新的受支持版本。项目开发与测试使用 Node 22.14.0。

```sh
npm ci
npm run dev
```

打开终端显示的网址，默认 `http://localhost:5173/`。不要双击 `index.html` 使用 `file://`，ES 模块和联机需要 HTTP 或 HTTPS。

```sh
npm test             # 纯模拟确定性、成长与边界测试
npm run build       # 输出 dist/，可直接静态托管
npm run preview     # http://localhost:4173/，检查生产构建
```

浏览器测试需要先保持 `npm run dev` 运行，再在另一个终端执行：

```sh
# Windows 默认使用已安装的 Microsoft Edge。
# Linux/macOS 首次安装测试浏览器：
npx playwright install chromium

npm run test:browser
node tests/network.mjs
node tests/network-edge.mjs
node tests/production.mjs  # 直接检查已经部署的公开版本
```

`tests/network*.mjs` 会使用真实公共信令服务，必须联网。测试生成截图和 JSON 记录到 `artifacts/`，不进入 Git。浏览器测试中的成长与失败场景通过开发专用检查接口构造条件，再用真实界面触发和验证；基础移动、御剑、打怪与掉落有真实输入测试。生产构建不暴露这个接口。

## 玩法与操作

修炼聚灵 → 出阵斩妖与参悟古碑 → 回问道台突破 → 解锁神通与新区域 → 购买功法、炼器炼丹 → 结伴挑战首领。

| 操作                       | 按键                                    |
| -------------------------- | --------------------------------------- |
| 行走                       | WASD / 方向键                           |
| 瞄准、御剑连击             | 移动鼠标、按住左键 / U                  |
| 三门当前境界神通           | 1 / 2 / 3，或 J / K / L，也可点技能按钮 |
| 闪身，短暂无敌             | 空格                                    |
| 吐纳；移动、攻击或受击收息 | C                                       |
| 突破 / 坊市 / 舆图 / 组队  | B / E / M / T                           |
| 回春散 / 参悟附近古碑      | H / F                                   |
| 菜单、关闭面板             | Esc                                     |

中央问道台是安全区，可回复气血、突破、交易与传送。古碑在小地图标为金色星芒，靠近后按 F。首领橙色地面预警表示冲锋；用闪身躲避。怪物死亡留下可吸附拾取的灵石、灵材和灵草。

| 境界 | 神通                     | 区域进度               |
| ---- | ------------------------ | ---------------------- |
| 炼气 | 青锋引、莲华渡、听风斩   | 青篁渡                 |
| 筑基 | 离火诀、霜天落、惊雷敕   | 开启赤焰墟             |
| 金丹 | 金乌巡、归墟引、陨星劫   | 挑战区域首领，积累道印 |
| 元婴 | 分光影、紫微阙、缚仙绫   | 开启星渊秘境           |
| 化神 | 星河倾、苍龙吟、太虚归一 | 挑战太虚星君           |

突破同时检查修为、灵材、斩妖、探索与首领条件。渡厄丹确保下一次突破成功。失败保留境界，可立即继续；死亡后在同一页面魂归问道台，损失 5% 灵石。

## 朋友如何加入

1. 所有人打开同一个已部署的网址，无需登录或安装。
2. 一人点击「开辟洞天」，得到默认 6 位房间号，例如 `A7K3M9`。
3. 朋友输入该房间号并点击「入队」，或直接打开房主复制的邀请链接。
4. 邀请链接写入地址栏，例如 `https://你的域名/游戏路径/?room=A7K3M9`。这是网址参数，不会触发静态服务器的子路径 404。
5. 最多四人；队伍人数会缩放怪物血量，同区域存活队友共享掉落与击杀收益。聊天和快捷传音在组队面板中。

房主关闭页面或离队会关闭洞天，其他人收到明确提示，并保留修为转为可玩的独行状态。短时数据通道断开会尝试自动重连三次；重复身份、房间满、无效编号、服务不可达都有反馈。房主后台暂停全队，返回后恢复；客机后台进入暂离，不继续移动或受击。

## 联机配置

全部可调参数集中在 `src/config.js` 顶部的 `CONFIG`，包括技能、价格、掉落、境界、速度、冷却、网络节奏、粒子与实体上限。

**默认无需手动替换任何配置即可使用 PeerJS。** 这是公共信令 + WebRTC 方案，WebSocket 用于建立连接，游戏数据走点对点数据通道。无需玩家注册；公共服务和 NAT 的限制见下文。

要使用优先指定的 GameRelay：

1. 部署者在 [GameRelay](https://gamerelay.io/) 创建游戏实例，取得 `gr_pub_...` **公开 key**。玩家仍无需注册。
2. 在 GameRelay 配置允许访问的站点来源，加入正式 HTTPS 域名和需要的本地开发来源。
3. 修改 `src/config.js` 中 `CONFIG.network.publicKey` 的占位符：

   ```js
   publicKey: 'gr_pub_替换成你的公开key';
   ```

   也可复制 `.env.example` 为 `.env.local`，设置 `VITE_GAMERELAY_PUBLIC_KEY=gr_pub_你的公开key`；环境变量优先于源码。**不要放 `gr_sec_...` 或任何私密 key。**

4. 重新构建和部署。自动选择 GameRelay；房间号采用该服务实际返回的编号，邀请 URL 同时带 `net=relay`。
5. GitHub Actions 可在仓库 `Settings → Secrets and variables → Actions → Variables` 新建 `GAMERELAY_PUBLIC_KEY`，工作流已映射为构建变量。默认变量未设置时仍使用 PeerJS。

`CONFIG.network.provider='peer'` 可强制使用默认方案。若局域网或企业网络要求自有 TURN，可在 `CONFIG.network.iceServers` 添加可用的 TURN 配置；有严格网络限制时，推荐配置 GameRelay 自带的转发能力。不要把服务端私钥写进客户端。

## 推送 Git 仓库

在本目录创建空仓库后推送，或直接在 GitHub 下载/克隆完整项目。命令如下：

```sh
git init -b main
git add .
git commit -m "Build Yunhai Wendao multiplayer cultivation game"
git remote add origin https://github.com/你的用户名/yunhai-wendao.git
git push -u origin main
```

`node_modules/`、`dist/`、实际 `.env`、测试截图不进入仓库。完整锁文件 `package-lock.json` 固定依赖版本。首次提交前只需确认 `git status` 中都是本项目文件。

## GitHub Pages

1. 将仓库推送到 GitHub。使用 GitHub Free 时通常需要公开仓库。
2. 进入仓库 `Settings → Pages → Build and deployment → Source`，选择 **GitHub Actions**。
3. `.github/workflows/pages.yml` 在 `main` 推送时自动执行 `npm ci`、模拟测试、构建并发布 `dist/`。
4. 打开 `Actions → Build, verify and deploy Pages` 查看结果；也可点击 `Run workflow` 手动发布。
5. 成功后访问 `https://你的用户名.github.io/仓库名/`。在这个页面开房，生成的邀请链接会自动保留仓库子目录。

Vite 的 `base:'./'` 已配置为相对路径，因此支持项目级 Pages 和普通域名根目录。不要把源代码根目录作为静态成品上传，应该上传 `dist/`。

## Cloudflare Pages

在 `Workers & Pages → Create application → Pages → Import an existing Git repository` 连接仓库，填写：

| 设置                   | 值              |
| ---------------------- | --------------- |
| Production branch      | `main`          |
| Framework preset       | None            |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Node 环境版本          | 22              |

需要 GameRelay 时，增加公开环境变量 `VITE_GAMERELAY_PUBLIC_KEY`。部署成功后的 `https://项目名.pages.dev/` 就是朋友的网址。也可以在本地构建后，将整个 `dist/` 上传到 Pages 的 Direct Upload。

GitHub Pages 和 Cloudflare Pages 都只负责静态页面，不承载游戏服务端。联机来自上面的公共信令或 GameRelay。

## 工程结构

```text
yunhai-wendao/
├── index.html                   # 标题、HUD、房间与通用面板
├── package.json / package-lock.json
├── vite.config.js               # 相对部署路径
├── .env.example
├── .gitattributes / .gitignore
├── .prettierrc.json / .prettierignore
├── .github/workflows/pages.yml
├── public/THIRD_PARTY_NOTICES.txt # 随静态成品发布的许可声明
├── scripts/source-bundle.mjs    # 按文件生成完整源码文档
├── src/
│   ├── config.js                # 所有平衡参数与限额
│   ├── math.js                  # PRNG、固定步长累加器、碰撞数学
│   ├── simulation.js            # 权威世界、怪物、战斗与成长
│   ├── renderer.js              # 地形缓存、程序化角色与环境
│   ├── effects.js               # 粒子池、十五种分层神通与突破
│   ├── network.js               # PeerJS / GameRelay、房间、异常处理
│   ├── input.js                 # 按键队列、序列与确认
│   ├── storage.js               # 存档校验与导入导出
│   ├── audio.js                 # 可静音的程序音效
│   ├── main.js                  # 生命周期、同步与界面
│   └── style.css
├── tests/
│   ├── simulation.test.js
│   ├── browser.mjs
│   ├── network.mjs
│   ├── network-edge.mjs
│   ├── production.mjs
│   └── smoke.mjs
├── docs/QA.md                   # 五轮自检、修复与证据
├── docs/ARCHITECTURE.md
├── THIRD_PARTY_NOTICES.md
└── LICENSE
```

## 已知限制

- 这是原创 2D 程序化东方幻想游戏，参考冷青山雾、朱砂金饰、衣袍和剑光等美术方向；不包含《永劫无间》的素材、角色模型或 3D AAA 渲染。
- 支持刷新率上限达到 165Hz 及更高的浏览器呈现；不主动锁帧。实际帧率受硬件、浏览器、窗口遮挡与录屏影响。固定模拟保证 60/144/165Hz 的速度一致。
- 默认 PeerJS 公共信令没有本项目可控制的可用性承诺；对称 NAT、UDP 被封等网络可能无法建立直连。可换网络，配置 TURN，或配置 GameRelay。连接失败不会阻断单机。
- 已实测多独立浏览器会话通过真实公共信令完成四人联机；这不等于验证所有运营商/NAT 组合。GameRelay 未取得专属 key，因此其真实服务端完整对局未纳入已通过的端到端结果；SDK 按实际类型和官方 API 实现，缺 key 的降级路径已测试。
- 房主离开采用明确关闭房间并保存的策略，没有静默接管；这也避免在不完整状态上继续模拟。房主后台会暂停全队。
- 10Hz 权威快照 + 30Hz 输入传输，客机预测与校正；不是严格锁步网络。高延迟时可能发生位置修正，伤害与资源以房主为准。
- 本地存档没有账号、云同步或防作弊。房主是权威浏览器，不是可信专用服务端；适用于朋友合作，不适用于竞技排名或付费经济。离房后的怪物状态重新生成，角色成长保留。
- 区域是三张有边界的探索场景；植被、石桥与地表是美术地物，不设置复杂地形碰撞。触屏提供基本控制，主要验证平台为桌面 Chromium；没有实机 iOS/Android 全机型验证。

详细检查与未验证范围见 [五轮自检报告](docs/QA.md)。不能据此宣称绝对零 Bug。

源码已经格式化，可用 `npm run check:format` 检查，或 `npm run format` 整理。执行 `node scripts/source-bundle.mjs` 会把 Git 跟踪的全部文本文件逐个完整写入 `artifacts/完整源码.md`。

## 资料与许可证

实际依赖为 MIT 许可的 PeerJS 与 GameRelay SDK；项目原创代码采用 MIT。引用与许可证在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。固定步长、池化、缓存与粒子生命周期参考了开源实现和官方文档，见 [架构说明](docs/ARCHITECTURE.md)。

部署步骤依据 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) 与 [Cloudflare Pages 官方文档](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)。
