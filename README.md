# TankGame Online

这是一个完全由 AI 协助开发的在线低多边形坦克大战游戏（实验性质），用于学习与试玩。

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

构建与发布

1. 构建生产包

```bash
pnpm run build
```

2. 生成 release 发布包（会把必要文件复制到 `./release`）

Windows (CMD/PowerShell):

```powershell
scripts\build-release.bat
# 或者使用 PowerShell 脚本（注：我不喜欢powershell，所以就管过，可能会有问题）
powershell -File scripts\build-release.ps1
```

Linux / macOS:

```bash
bash scripts/build-release.sh
```

生成物会放到 `./release`（或你指定的输出目录），其中包含 `client` 静态 `dist`、`server` 编译产物、`Dockerfile`、部署脚本与 `VERSION` 文件。

将 release 上传到 GitHub Releases

1. 在本地创建一个签名（或非签名）Tag：

```bash
VERSION=$(node -e "console.log(require('./package.json').version)")
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin --tags
```

2. 在 GitHub 仓库页面创建一个 Release（上传 `release/*.zip` 或通过页面选择 Tag 并上传二进制包）。

如果你使用 `gh` CLI（GitHub CLI），可以：

```bash
gh release create "v$VERSION" ./release/tankgame-online-"$VERSION".zip --title "v$VERSION" --notes "Release $VERSION"
```

备注
- 若希望我代为创建并推送 Git tag / Release，请确保 CI 或本机已配置好 Git 凭据和 `gh`（或授权 token），并明确授权我代表你执行推送操作。

许可证

请参见仓库中的 `LICENSE`。

Enjoy!

在线试玩

- 试玩地址： http://tank.miemie.me:3000/
# tankgame_online