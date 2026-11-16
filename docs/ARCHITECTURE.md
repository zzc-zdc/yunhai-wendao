# 架构与取舍

## 一条固定的时间轴

`requestAnimationFrame` 仅接收浏览器提供的呈现机会。`FixedClock` 积累经过的秒数，每攒够 `1/60` 秒才调用一次逻辑更新，然后将剩余比例交给渲染器插值。运动单位是像素/秒，冷却与计时器单位都是秒。

`document.hidden` 时不推进逻辑；恢复后清空累加器和时间基准。一次异常停顿最多补 15 步，防止浏览器恢复时出现数百步追赶。这个上限意味着严重卡顿时允许慢下来，正常 60/144/165Hz 不会丢模拟时间。

环境与特效也按固定秒更新。HUD 的纯 CSS 过渡不影响游戏数值。角色受击停顿只影响姿态动画，不暂停权威世界，避免多人时相互改变模拟时钟。

## 权威与网络

所有客户端有相同世界种子，Mulberry32 生成相同怪物出生布局，闲逛轨迹由时间和种子计算。交互 AI 的目标依赖实时玩家输入，因此不做会累积误差的完全锁步：房主推进真实 AI、碰撞、伤害、掉落、消费与突破，客机只预测移动并定期接受校正。

- 输入：30Hz，包含方向、瞄准、攻击、动作队列和单调序号。
- 世界：10Hz，包含玩家与关键怪物状态、弹道、掉落、待释放技能及 PRNG 状态。
- 动作：独立序号；重发不会重复购买、扣蓝或释放。房主快照回传确认号。
- 房间：至多四人；加入前握手、版本校验和容量检查。未握手的连接不能提交游戏操作。
- 校验：坐标/数值有限性、境界/区域/怪物类型范围、数组上限、消息大小与颜色格式检查。
- 背压：RTC 缓冲积压时舍弃过时的状态快照；动作留在输入队列，等待确认。
- GameRelay：使用官方 SDK 的 `connect`、`createRoom`、`joinRoom`、`send` 与真实事件名称。大快照分片，每片至多 6000 字符；重组数量与时间受限。不会因为 SDK 缺 key 破坏单机。
- 房主关闭与 SDK 主机变化都明确终止旧对局，客机保留修为继续独行。

PeerJS 公共信令是建立 WebRTC 的中介，部署站点没有游戏后端。默认 STUN 包括 Google 和 Cloudflare；成功握手不能保证任意 NAT 都能直连，所以错误、超时、重试和单机恢复都是实际功能。

## 渲染预算

每张区域的地表、数千条草叶、石阶、建筑、纹理与树木绘制到离屏 Canvas，按区域惰性缓存。角色、怪物、灵气与战斗使用前景 Canvas。物体按脚下 Y 坐标排序。

特效拥有聚气、释放、飞行/范围展开、命中与余波阶段；底部法阵、中部主体、顶部粒子与屏幕色闪分层。光晕渐变缓存为小画布重复绘制，避免逐粒子创建渐变或使用大量 `shadowBlur`。

粒子池预分配 1700 个对象，耗尽时跳过新粒子，不影响伤害。低帧率或绘制成本较高时减少粒子；投射物、待释放技能、视觉效果、伤害数字与掉落也各有上限。Canvas backing store 为 CSS 尺寸乘 `min(devicePixelRatio,2)`，2K DPR2 使用 5120×2880。

## 查阅与采用的公开资料

| 资料                                                                                                                                                 | 在本项目中的用途                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Kontra GameLoop 源码](https://github.com/straker/kontra/blob/main/src/gameLoop.js)                                                                  | 对照累加器、后台暂停与固定更新边界；本项目独立实现秒制逻辑与插值 |
| [Kontra Pool 源码](https://github.com/straker/kontra/blob/main/src/pool.js)                                                                          | 对照对象复用与最大容量；实现固定大小粒子池                       |
| [PeerJS 仓库](https://github.com/peers/peerjs) 与 [DataConnection](https://github.com/peers/peerjs/blob/master/lib/dataconnection/DataConnection.ts) | 实际依赖；对照连接事件、数据通道与缓冲行为                       |
| [PeerJS 官方教程](https://peerjs.com/client/getting-started)                                                                                         | 建房、加入与消息生命周期                                         |
| [GameRelay SDK](https://github.com/gamerelay/sdk) 和 npm 包附带类型/llms 文档                                                                        | 实际依赖；使用对应版本 API，兼容原生房间编号与断线事件           |
| [Phaser 粒子文档](https://docs.phaser.io/phaser/concepts/gameobjects/particles)                                                                      | 生命周期、发射范围、速度/透明度曲线与多层组合思路                |
| [PixiJS 性能指南](https://pixijs.com/8.x/guides/concepts/performance-tips)                                                                           | 先测量成本、减少状态切换、复用静态渲染结果                       |
| [MDN Canvas 性能指南](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)                                        | 离屏缓存、避免反复昂贵绘制、分离静态与动态内容                   |
| [《永劫无间》官方场景展示](https://www.narakathegame.com/m/app/news/20220907/35657_1041136.html)                                                     | 冷青、朱砂、古建、枫叶与衣袍的方向参考；没有复制游戏素材         |

除了安装和打包的两项 MIT SDK，不复制上述引擎或商业游戏源码/素材。选择自己可验证的轻量 Canvas 实现，以满足纯程序特效、静态部署、固定模拟和高刷新率要求。
