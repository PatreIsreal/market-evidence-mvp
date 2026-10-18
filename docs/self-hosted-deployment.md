# 自托管部署（Docker）

本项目可以部署到 Ubuntu／Debian 服务器。容器使用 Node.js 22，主机不需要安装项目依赖；运行时由非 root 的容器账号启动。当前配置将应用映射到 VPN 地址 `192.168.188.2:3180`，适合个人或内网访问。

## 首次部署

1. 安装 Docker Engine 与 Docker Compose v2，并确保部署账号有权限运行 `docker compose`。
2. 将项目源码复制到服务器上的独立目录，进入该目录。
3. 在服务器目录创建 `.dev.vars`，内容格式如下；值只放在服务器本地。项目自身的 `.dev.vars` 是本地模式文件，不要提交：

   ```dotenv
   APP_DATA_MODE=live
   FUYAO_BASE_URL=https://fuyao.aicubes.cn
   FUYAO_API_KEY=服务器环境变量中的扶摇密钥
   MODEL_BASE_URL=https://api.deepseek.com
   MODEL_API_KEY=服务器环境变量中的 DeepSeek 密钥
   MODEL_NAME=deepseek-flash
   MODEL_THINKING_MODE=disabled
   ```

4. 限制该文件权限并启动：

   ```sh
   chmod 600 .dev.vars
   docker compose up -d --build
   docker compose ps
   ```

5. 验证本机服务：

   ```sh
   curl http://127.0.0.1:3180/api/health
   ```

   通过 `http://192.168.188.2:3180` 打开页面。端口只绑定到该 VPN 地址，不会监听服务器其他网卡。

## 更新与运维

在项目目录更新源码后运行 `docker compose up -d --build`。查看状态与日志：

```sh
docker compose ps
docker compose logs --tail=100 -f market-evidence
```

停止服务：

```sh
docker compose down
```

运行时凭据以 Docker Compose secret 文件挂载，入口脚本在容器启动时将其复制到容器内、交给专用非 root 用户读取；Dockerfile 和镜像构建上下文排除 `.dev.vars`。不要把它放入 Git、源码压缩包或镜像。

应用服务使用 Wrangler 的本地 Worker runtime 托管 Vinext worker bundle。它适用于当前个人/内网 MVP；若要开放互联网访问，应再配置 HTTPS、身份认证及反向代理，并检查扶摇数据展示授权。
