# Implementation Plan: 时间轴社交关系网络可视化系统

## Overview

本实现计划将时间轴社交关系网络可视化系统的设计转换为可执行的开发任务。系统采用纯静态前端架构（HTML/CSS/JavaScript + Vis.js），通过 GitHub Pages 和 Cloudflare 部署到 wanglejiang.online 域名。

实现策略：
1. 先搭建核心基础设施（项目结构、数据层）
2. 然后实现可视化引擎（关系图渲染）
3. 接着添加交互功能（时间轴、导航）
4. 最后完善认证和编辑功能

## Tasks

- [x] 1. 项目初始化和数据准备
  - [x] 1.1 创建项目目录结构和核心文件
    - 创建 index.html、styles.css、app.js
    - 创建 lib/ 目录存放第三方库
    - 创建 data.json 存放初始数据
    - 添加 .gitignore 文件
    - _Requirements: 6.1, 6.2_

  - [x] 1.2 转换用户提供的班级名单为 JSON 格式
    - 按照设计文档的 Data Schema 创建完整的 data.json
    - 包含所有时间段（小学到大学）的 periods 数组
    - 包含所有人物的 roster 数据
    - 包含王乐江的朋友、暗恋、恋人等 relationships 数据
    - 包含其他已知关系（赵增智-何晶晶、王鹏飞-魏菲菲、原新文暗恋王敏）
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [x] 1.3 设置基础 HTML 结构
    - 创建主容器 div（时间轴、关系图、编辑面板）
    - 引入 Vis.js CDN 或本地库文件
    - 添加基础 meta 标签（viewport、charset）
    - 添加中文字体支持
    - _Requirements: 6.1, 9.1_

- [x] 2. 数据层实现
  - [x] 2.1 实现 DataLoader 类
    - 实现 loadData() 方法从 data.json 加载数据
    - 实现缓存机制和 cache busting
    - 实现错误处理逻辑
    - _Requirements: 5.1, 5.2, 10.1_

  - [x] 2.2 实现 DataValidator 类
    - 实现 validateSchema() 验证 JSON 结构
    - 实现 validateReferences() 验证关系引用的人物存在
    - 验证所有 relationships 的 person1 和 person2 在相应 period 的 roster 中
    - _Requirements: 5.6, 7.5_

  - [x] 2.3 实现 RelationshipCalculator 类
    - 实现 getClassmates() 获取同学关系
    - 实现 getSpecialRelationships() 获取特殊关系
    - 实现 buildGraphData() 构建 Vis.js 所需的图数据结构
    - 实现关系类型颜色映射（同学、朋友、暗恋、恋人、断联）
    - 实现同学关系自动生成逻辑
    - _Requirements: 2.2, 2.4, 2.5_

  - [ ] 2.4 编写数据层单元测试 (跳过 - 用户指示)
    - 测试 DataValidator 的各种数据格式验证场景
    - 测试 RelationshipCalculator 的关系计算逻辑
    - 测试边界情况（空数据、无效引用等）
    - _Requirements: 5.6, 7.5_

- [x] 3. Checkpoint - 验证数据层功能
  - 确保 data.json 格式正确且通过 DataValidator 验证
  - 确保 RelationshipCalculator 能正确构建图数据
  - 如有疑问或错误，向用户报告

- [x] 4. 可视化引擎实现
  - [x] 4.1 实现 GraphRenderer 类（基于 Vis.js）
    - 实现 render() 方法渲染关系图
    - 配置 Vis.js options（节点样式、边样式、物理引擎）
    - 实现中心节点高亮显示（金色）
    - 实现不同关系类型的视觉差异（颜色、线条样式）
    - 实现节点点击事件处理
    - _Requirements: 3.1, 3.4, 3.5, 2.5_

  - [x] 4.2 实现力导向布局和物理引擎配置
    - 配置 forceAtlas2Based 物理引擎参数
    - 实现稳定后停止物理模拟的逻辑
    - 调整节点间距和弹簧参数以获得美观布局
    - _Requirements: 3.4, 10.3_

  - [x] 4.3 实现 InteractionHandler 交互逻辑
    - 实现节点点击切换中心人物
    - 实现缩放和拖拽功能
    - 实现触摸手势支持（移动端）
    - 实现节点悬停提示
    - _Requirements: 3.6, 9.4_

  - [x] 4.4 编写可视化引擎集成测试
    - 测试 GraphRenderer 渲染不同规模的图数据
    - 测试交互功能（点击、缩放、拖拽）
    - 测试移动端触摸手势
    - _Requirements: 3.6, 9.4_

- [x] 5. 时间轴导航实现
  - [x] 5.1 实现 TimelineController 类
    - 实现 selectPeriod() 选择时间段
    - 实现 getPeriodData() 获取时期数据
    - 实现时期切换时的数据加载逻辑
    - _Requirements: 1.2, 1.5_

  - [x] 5.2 实现 TimelineSelector UI 组件
    - 渲染时间轴选择器按钮
    - 高亮当前选中时期
    - 标识王乐江未参与的时期（初中二班、23年高中复读班20班）
    - 实现按钮点击触发时期切换
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 5.3 集成时间轴和关系图显示
    - 连接 TimelineSelector 和 GraphRenderer
    - 实现选择时期后自动更新关系图
    - 默认显示第一个时期（小学）
    - _Requirements: 1.2, 10.2_

  - [x] 5.4 编写时间轴导航集成测试
    - 测试时期切换是否正确更新关系图
    - 测试默认时期显示
    - 测试性能（切换时间应 <500ms）
    - _Requirements: 1.2, 10.2_

- [x] 6. Checkpoint - 验证核心可视化功能
  - 确保时间轴可以正确切换
  - 确保关系图正确显示所有关系类型
  - 确保节点点击可以切换中心人物
  - 如有疑问或问题，向用户报告

- [x] 7. 认证系统实现
  - [x] 7.1 实现 AuthManager 类
    - 实现 sha256() 方法计算密码哈希
    - 实现 authenticate() 验证密码
    - 实现 saveAuthState() 和 loadAuthState() 使用 sessionStorage
    - 实现 checkOwnerMode() 检查当前模式
    - 在代码中存储 Owner 密码的 SHA-256 哈希值
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 7.2 实现 AuthView 登录界面
    - 创建密码输入表单
    - 创建登录/退出按钮
    - 显示当前模式（Owner/Visitor）
    - 实现登录失败提示
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 7.3 实现模式切换逻辑
    - Owner 模式显示编辑面板
    - Visitor 模式隐藏编辑功能
    - 页面加载时自动恢复认证状态
    - _Requirements: 4.2, 4.4_

  - [x] 7.4 编写认证系统单元测试
    - 测试正确密码验证
    - 测试错误密码验证
    - 测试 sessionStorage 状态持久化
    - _Requirements: 4.5_

- [x] 8. 编辑功能实现
  - [x] 8.1 实现 DataManager 类
    - 实现 addPerson() 添加人物
    - 实现 addRelationship() 添加关系
    - 实现 updateRelationship() 更新关系
    - 实现 deleteRelationship() 删除关系
    - 所有方法需检查 Owner 权限
    - 实现 saveData() 将数据保存到 localStorage
    - _Requirements: 4.3, 5.3_

  - [x] 8.2 实现 EditPanel UI 组件
    - 创建添加人物表单（姓名、时期选择器）
    - 创建添加关系表单（人物1、人物2、关系类型、时期、备注）
    - 创建关系列表和删除按钮
    - 仅在 Owner 模式下显示
    - _Requirements: 4.3, 4.4_

  - [x] 8.3 实现数据导入导出功能
    - 实现 exportData() 导出 JSON 文件
    - 实现 importData() 导入 JSON 文件
    - 添加导入导出按钮到 EditPanel
    - 验证导入数据格式
    - 提示用户需手动提交到 GitHub
    - _Requirements: 5.4, 5.5, 5.6_

  - [x] 8.4 编写编辑功能集成测试
    - 测试添加人物功能
    - 测试添加关系功能
    - 测试数据导出导入
    - 测试权限控制（Visitor 无法编辑）
    - _Requirements: 4.3, 5.5_

- [x] 9. 跨班关系展示优化
  - [x] 9.1 实现跨时期人物标识
    - 在关系图中标注人物所属的所有时期
    - 区分同班和跨班关系的视觉样式
    - _Requirements: 8.1, 8.3_

  - [x] 9.2 实现关系筛选功能
    - 添加筛选器（显示所有关系/仅同班/仅跨班）
    - 实现特殊关系类型筛选（朋友、暗恋、恋人）
    - _Requirements: 8.4_

  - [x] 9.3 编写跨班关系展示测试
    - 测试跨时期人物正确标识
    - 测试筛选功能
    - _Requirements: 8.1, 8.4_

- [x] 10. 响应式设计和样式优化
  - [x] 10.1 实现响应式 CSS 布局
    - 使用 Flexbox/Grid 布局
    - 添加媒体查询（断点：768px）
    - 优化移动端时间轴显示（垂直布局）
    - 优化移动端关系图尺寸
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x] 10.2 优化整体视觉设计
    - 设计主题色彩方案
    - 统一按钮和表单样式
    - 添加 hover 和 active 状态样式
    - 优化中文字体显示（Microsoft YaHei、SimHei）
    - _Requirements: 9.5_

  - [x] 10.3 实现图例和帮助说明
    - 添加关系类型图例（颜色、线条说明）
    - 添加操作说明（如何切换时期、如何点击节点）
    - 添加 Owner 模式使用说明
    - _Requirements: 3.4, 2.5_

  - [x] 10.4 进行跨设备测试
    - 测试桌面浏览器（Chrome、Firefox、Safari、Edge）
    - 测试移动设备（iOS Safari、Chrome Android）
    - 验证响应式布局在不同分辨率下的表现
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 11. 性能优化
  - [x] 11.1 实现关系图缓存机制
    - 创建 GraphCache 类（LRU 缓存，最大50个）
    - 缓存已生成的图数据
    - 实现缓存键生成逻辑（personId + periodId）
    - _Requirements: 10.5_

  - [x] 11.2 实现懒加载策略
    - 仅加载当前时期的数据
    - 延迟加载 Vis.js 物理引擎
    - 优化初始渲染速度
    - _Requirements: 10.1, 10.4_

  - [x] 11.3 添加防抖和节流
    - 为搜索输入添加防抖（300ms）
    - 为窗口 resize 事件添加节流
    - _Requirements: 10.2, 10.3_

  - [x] 11.4 进行性能基准测试
    - 测试首次加载时间（目标 <3秒）
    - 测试时期切换时间（目标 <500ms）
    - 测试关系图渲染时间（目标 <1秒）
    - 测试大规模数据（100+ 人物）的性能
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 12. Checkpoint - 验证完整功能
  - 确保所有核心功能正常工作
  - 确保性能达标
  - 确保响应式设计在各设备上正常
  - 如有问题，向用户报告

- [x] 13. 部署配置
  - [x] 13.1 配置 GitHub Pages
    - 创建 .github/workflows/deploy.yml
    - 配置自动部署 workflow
    - 测试 GitHub Pages 部署
    - _Requirements: 6.3_

  - [x] 13.2 配置 Cloudflare
    - 创建 CNAME 文件（wanglejiang.online）
    - 配置 DNS CNAME 记录
    - 配置缓存策略（低缓存）
    - 配置 _headers 文件设置 Cache-Control
    - 启用 HTTPS（强制）
    - _Requirements: 6.4, 6.5, 6.6_

  - [ ] 13.3 测试域名访问
    - 验证 wanglejiang.online 可正常访问
    - 验证 HTTPS 正常工作
    - 验证 CDN 加速生效
    - 验证数据文件正确加载（Cache-Control 生效）
    - _Requirements: 6.6_

  - [ ] 13.4 进行生产环境测试
    - 测试所有功能在生产环境正常工作
    - 测试不同地区访问速度
    - 测试缓存更新机制
    - _Requirements: 6.4, 6.5_

- [x] 14. 文档和收尾
  - [x] 14.1 编写 README.md
    - 项目介绍和功能说明
    - 本地开发指南
    - 部署指南
    - Owner 模式使用说明（如何更新数据）
    - _Requirements: 4.3, 5.3_

  - [x] 14.2 创建用户使用指南
    - Visitor 模式操作说明
    - Owner 模式编辑流程
    - 数据更新流程（编辑 → 导出 → 提交 GitHub）
    - _Requirements: 4.3, 5.3, 5.4_

  - [x] 14.3 代码清理和优化
    - 移除 console.log 调试语句
    - 添加必要的代码注释
    - 格式化代码
    - 清理未使用的文件
    - _Requirements: 所有_

- [x] 15. Final Checkpoint - 最终验证
  - 确保所有功能完整实现
  - 确保所有测试通过
  - 确保生产环境部署成功
  - 确保文档完整
  - 向用户交付完整系统

## Notes

- **可选任务标记**: 带 `*` 的任务为可选测试任务，可根据时间和资源情况决定是否执行
- **需求追溯**: 每个任务都标注了对应的需求编号，确保完整覆盖所有需求
- **Checkpoints**: 在关键阶段设置 checkpoint，确保增量验证和及时发现问题
- **技术栈**: JavaScript ES6+、Vis.js、纯静态 HTML/CSS
- **部署**: GitHub Pages + Cloudflare CDN
- **域名**: wanglejiang.online
- **数据文件**: data.json（包含完整的班级名单和关系数据）
- **认证**: SHA-256 密码哈希，sessionStorage 状态持久化
- **性能目标**: 首次加载 <3秒，时期切换 <500ms，关系图渲染 <1秒

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 6, "tasks": ["5.1", "5.2", "7.1"] },
    { "id": 7, "tasks": ["5.3", "5.4", "7.2", "8.1"] },
    { "id": 8, "tasks": ["7.3", "7.4", "8.2", "9.1"] },
    { "id": 9, "tasks": ["8.3", "8.4", "9.2", "9.3"] },
    { "id": 10, "tasks": ["10.1", "10.2", "11.1"] },
    { "id": 11, "tasks": ["10.3", "10.4", "11.2"] },
    { "id": 12, "tasks": ["11.3", "11.4"] },
    { "id": 13, "tasks": ["13.1"] },
    { "id": 14, "tasks": ["13.2"] },
    { "id": 15, "tasks": ["13.3", "13.4"] },
    { "id": 16, "tasks": ["14.1", "14.2"] },
    { "id": 17, "tasks": ["14.3"] }
  ]
}
```
