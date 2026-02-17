# TankGame Online

这是一个完全由 AI 协助开发的在线低多边形坦克大战游戏（实验性质），用于学习与试玩。

有需要改进的地方都提到issues里好了，我会定期收集整理改进的~

在线试玩

- 试玩地址： http://tank.miemie.me:3000/
  
主要内容
- 服务端：基于 Node + TypeScript 的游戏逻辑（WebSocket）
- 客户端：基于 Vite + Three 的浏览器端渲染
- 共享：游戏协议、物理与类型定义放在 `shared`

快速开始（开发）

1. 安装依赖

```bash
pnpm install
```

2. 本地开发（同时启动 server 和 client）

```bash
pnpm run dev
# 或分别运行
pnpm --filter @tankgame/server dev
pnpm --filter @tankgame/client dev
```

3. 运行测试

```bash
pnpm run test
```

4. 自己架设一键安装包

···bash

bash release/install.sh

```



请参见仓库中的 `LICENSE`。

Enjoy!


# tankgame_online
