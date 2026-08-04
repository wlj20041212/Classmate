FROM searxng/searxng:latest

# 覆盖默认配置，开启 JSON 输出、关闭 limiter 避免拦截
COPY settings.yml /etc/searxng/settings.yml

# 确保 limiter 配置不拦截请求
COPY limiter.toml /etc/searxng/limiter.toml

EXPOSE 8080
