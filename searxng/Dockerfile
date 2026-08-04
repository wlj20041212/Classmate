FROM searxng/searxng:latest

# 完全覆盖配置，避免触发 limiter/redis 依赖
COPY settings.yml /etc/searxng/settings.yml

# Render 需要明确暴露端口
ENV PORT=8080
EXPOSE 8080
