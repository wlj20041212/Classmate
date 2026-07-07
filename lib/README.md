# 第三方库目录

本目录用于存放项目依赖的第三方 JavaScript 库。

## 所需库

### Vis.js Network (必需)
- **用途**: 关系图可视化渲染
- **版本**: 9.1.9 或更高
- **下载地址**: https://unpkg.com/vis-network@9.1.9/dist/vis-network.min.js
- **CDN 备选**: https://cdn.jsdelivr.net/npm/vis-network@9.1.9/dist/vis-network.min.js

## 安装方法

### 方法 1: 手动下载 (推荐用于静态部署)
1. 访问下载地址
2. 保存文件为 `vis-network.min.js` 到本目录
3. 确保 index.html 中的引用路径正确

### 方法 2: 使用 CDN (开发阶段快速测试)
在 index.html 中直接引用 CDN 链接，无需下载到本地：
```html
<script src="https://unpkg.com/vis-network@9.1.9/dist/vis-network.min.js"></script>
```

### 方法 3: 使用 npm (如果未来添加构建工具)
```bash
npm install vis-network
```

## 当前状态
- [ ] vis-network.min.js - 待下载

## 注意事项
- 生产部署时建议使用本地文件而非 CDN，以确保稳定性
- 如使用 CDN，确保网络连接稳定
- 定期检查库更新以获得性能优化和 bug 修复
