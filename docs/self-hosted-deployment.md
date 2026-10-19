# 自托管部署（Docker）

本项目可以部署到 Ubuntu／Debian 服务器。容器使用 Node.js 22，主机不需要安装项目依赖；运行时由非 root 的容器账号启动。默认映射到本机回环地址 `127.0.0.1:3180`，避免新部署时意外监听公网网卡。若需在 VPN 内访问，请在项目目录 `.env` 中将 `APP_BIND_HOST` 设为服务器的 VPN 网卡地址，再启动 Compose；不要把 `.dev.vars` 中的服务密钥写进 `.env`。

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

   默认通过 `http://127.0.0.1:3180` 打开页面。设置 `APP_BIND_HOST` 后，通过服务器对应的 VPN 地址和端口 3180 访问；不要将应用端口直接开放到公网。

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

自托管使用 Wrangler 的本地 Worker runtime。Compose 会只读挂载 Ubuntu／Debian 主机 CA bundle，并设置 `NODE_EXTRA_CA_CERTS`，让 Workerd 验证上游 HTTPS 证书；不要关闭 TLS 证书校验。

应用服务使用 Wrangler 的本地 Worker runtime 托管 Vinext worker bundle，适用于个人或 VPN 内使用。公开体验站点由 Sites 独立托管；自托管实例若要开放互联网访问，还需要 HTTPS、访问控制、限流和扶摇数据展示授权核验。
