# 时间轴社交关系网络可视化系统

展示王乐江在不同学习时期（小学到大学）的社交关系网络的可视化系统。

🌐 **在线访问**: [wanglejiang.online](https://wanglejiang.online)

## 项目概述

本项目是一个纯静态前端应用，使用 HTML、CSS、JavaScript 和 Vis.js 实现交互式关系图可视化。系统采用类王者荣耀关系网样式，支持时间轴导航和关系网络探索。

系统支持两种模式：
- **Visitor 模式**: 所有用户可以浏览和探索关系网络
- **Owner 模式**: 项目所有者可以编辑和管理数据（密码保护）

## 功能特性

- ✅ 时间轴导航：9 个学习时期自由切换（小学、初中、高中、复读、大学）
- ✅ 关系图可视化：类王者荣耀关系网样式，力导向布局
- ✅ 交互式探索：点击人物节点切换中心人物，缩放拖拽
- ✅ 关系类型区分：同学（蓝）、朋友（绿）、暗恋（粉，虚线）、恋人（红）
- ✅ 跨班关系展示：橙色虚线边框标识跨班人物，支持范围筛选
- ✅ 关系筛选器：全部/同班/跨班范围筛选 + 类型多选
- ✅ Owner 编辑模式：SHA-256 密码保护的数据编辑功能
- ✅ 数据导入导出：JSON 格式，支持手动提交到 GitHub
- ✅ 响应式设计：支持桌面和移动设备
- ✅ 性能优化：LRU 缓存、懒加载、防抖节流
- ✅ 自动部署：GitHub Actions 自动部署到 GitHub Pages

## 项目结构

```
classmate/
├── index.html              # 主 HTML 文件
├── styles.css              # 样式文件（响应式布局）
├── app.js                  # 应用主脚本（所有类定义）
├── data.json               # 数据文件（人物和关系）
├── .nojekyll               # 禁用 Jekyll 处理
├── CNAME                   # 自定义域名配置 (wanglejiang.online)
├── _headers                # Cloudflare 缓存策略配置
├── .gitignore              # Git 忽略配置
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Pages 自动部署 workflow
├── lib/                    # 第三方库目录
│   └── README.md           # 库安装说明
├── .kiro/                  # Kiro 规范文档目录
│   └── specs/
│       └── timeline-social-network/
│           ├── requirements.md  # 需求文档
│           ├── design.md        # 设计文档
│           └── tasks.md         # 任务列表
└── README.md               # 本文件
```

## 快速开始

### 本地运行

由于是纯静态网站，直接在浏览器中打开 `index.html` 即可。

**推荐使用本地服务器**（避免 CORS 问题）：
```bash
# 使用 Python 3
python -m http.server 8000

# 使用 Node.js http-server
npx http-server -p 8000

# 使用 PHP
php -S localhost:8000
```

然后访问 `http://localhost:8000`

### 数据准备

`data.json` 文件包含完整的班级名单和关系数据，结构如下：

```json
{
  "version": "1.0.0",
  "owner": "王乐江",
  "periods": [
    {
      "id": "primary",
      "name": "小学",
      "order": 1,
      "participated": true,
      "roster": ["王乐江", "张童伟", "原新文"]
    }
  ],
  "relationships": [
    {
      "id": "rel_001",
      "period": "primary",
      "person1": "王乐江",
      "person2": "张童伟",
      "type": "friend",
      "note": ""
    }
  ]
}
```

关系类型：`classmate`（同学）、`friend`（朋友）、`crush`（暗恋）、`lover`（恋人）

## 部署

### GitHub Pages（自动部署）

项目已配置 GitHub Actions 自动部署（`.github/workflows/deploy.yml`）：

1. 将代码推送到 `main` 或 `master` 分支
2. GitHub Actions 自动构建并部署到 GitHub Pages
3. 访问 `https://<username>.github.io/<repository>/`

### Cloudflare CDN 配置

项目通过 Cloudflare 加速，配置步骤：

1. **域名 DNS 解析**：在 Cloudflare 控制台添加 CNAME 记录，将 `wanglejiang.online` 指向 GitHub Pages 地址
2. **缓存策略**：`_headers` 文件已配置缓存策略
   - `data.json`: 5 分钟缓存（确保数据更新及时生效）
   - HTML: 5 分钟缓存
   - CSS/JS: 1 天缓存
   - 图片/字体: 7 天缓存
3. **HTTPS 强制**：在 Cloudflare 控制台启用 "Always Use HTTPS" 和 "Automatic HTTPS Rewrites"
4. **SSL 模式**：设置为 "Full" 或 "Full (strict)"

## Owner 模式使用说明

Owner 可以通过密码验证进入编辑模式来更新数据。

### 进入 Owner 模式

1. 点击页面右上角的"Owner 登录"按钮
2. 输入密码
3. 验证成功后进入 Owner 模式，显示编辑面板

### 编辑功能

- **添加人物**：输入姓名，选择时期，点击添加
- **添加关系**：选择人物1、人物2、关系类型、时期，填写备注
- **删除关系**：在关系列表中点击删除按钮
- **导入数据**：上传 JSON 文件覆盖当前数据
- **导出数据**：下载当前 `data.json` 文件

### 数据持久化流程

由于是纯静态应用，数据修改后需要：

1. 在 Owner 模式下编辑数据
2. 点击"导出 data.json"下载更新后的数据
3. 将下载的 `data.json` 手动提交到 GitHub 仓库
4. GitHub Actions 自动重新部署
5. 等待 CDN 缓存刷新（约 5 分钟）后生效

## 技术栈

- **前端框架**: 无（纯原生 JavaScript ES6+）
- **可视化库**: Vis.js Network v9.1.9（通过 CDN 加载）
- **样式**: CSS3（Flexbox/Grid，响应式媒体查询）
- **认证**: SHA-256 密码哈希（Web Crypto API）+ sessionStorage
- **缓存**: LRU 缓存（GraphCache，最大 50 个图数据）
- **部署**: GitHub Pages + Cloudflare CDN
- **域名**: wanglejiang.online

## 性能指标

- 首次加载时间: < 3 秒
- 时期切换时间: < 500ms
- 关系图渲染时间: < 1 秒
- 缓存命中率: > 2x 加速

## 浏览器兼容性

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- 移动浏览器：iOS Safari 14+, Chrome Android 90+

## 开发指南

### 添加新时间段

在 `data.json` 的 `periods` 数组中添加新对象：
```json
{
  "id": "new_period",
  "name": "新时期名称",
  "order": 10,
  "participated": true,
  "roster": ["人物1", "人物2"]
}
```

### 添加新关系

在 `data.json` 的 `relationships` 数组中添加新对象：
```json
{
  "id": "rel_xxx",
  "period": "period_id",
  "person1": "人物A",
  "person2": "人物B",
  "type": "friend",
  "note": "备注信息"
}
```

### 修改 Owner 密码

密码以 SHA-256 哈希值存储在 `app.js` 的 `AuthManager` 类中。修改密码：

1. 计算新密码的 SHA-256 哈希值
2. 替换 `app.js` 中 `AuthManager` 构造函数里的 `this.passwordHash` 值

## 联系方式

项目所有者：王乐江
域名：wanglejiang.online

---

**当前状态**: ✅ 项目已完成开发和部署配置
**版本**: 1.0.0
