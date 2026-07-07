# Requirements Document

## Introduction

本项目是一个时间轴社交关系网络可视化系统，用于展示王乐江在不同学习时期（小学到大学）的同学和社交关系。系统采用纯静态前端架构，无需后端服务器，通过 GitHub Pages 和 Cloudflare 部署，提供快速、直观的关系网络可视化体验。

## Glossary

- **System**: 时间轴社交关系网络可视化系统
- **Owner**: 项目所有者（王乐江），具有编辑权限的唯一用户
- **Visitor**: 访问者，只能查看关系网络的用户
- **Timeline_Period**: 时间段，指小学、初中一班、初中二班、高一、高二-三、23年高中复读班19班、23年高中复读班20班、大一、大二-大四等学习时期
- **Person**: 人物，关系网络中的个体
- **Relationship**: 关系，包括同学、朋友、暗恋、恋人、断联等类型
- **Classmate_Relationship**: 同学关系，同一班级内的默认关系
- **Special_Relationship**: 特殊关系，包括朋友、暗恋、恋人、断联等非默认关系
- **Relationship_Graph**: 关系图，以某个人物为中心的可视化关系网络
- **Class_Roster**: 班级名单，某个时间段内的所有同学列表
- **Data_File**: 数据文件，存储人物和关系信息的 JSON 文件
- **Edit_Mode**: 编辑模式,Owner 可以修改数据的状态
- **View_Mode**: 查看模式,Visitor 只能浏览的状态

## Requirements

### 需求 1: 时间轴系统管理

**用户故事:** 作为用户，我想查看不同时期的班级和人物信息，以便了解王乐江在各个学习阶段的社交网络。

#### 验收标准

1. THE System SHALL 支持以下时间段：小学、初中一班、初中二班、高一、高二-三、23年高中复读班19班、23年高中复读班20班、大一、大二-大四
2. WHEN 用户选择一个 Timeline_Period，THE System SHALL 显示该时期的所有 Person
3. THE System SHALL 为每个 Timeline_Period 存储完整的 Class_Roster
4. THE System SHALL 标识王乐江未参与的时间段（初中二班、23年高中复读班20班）
5. WHEN 显示时间轴，THE System SHALL 按时间顺序排列所有 Timeline_Period

### 需求 2: 关系类型定义

**用户故事:** 作为用户，我想看到不同类型的社交关系，以便理解人物之间的联系强度和性质。

#### 验收标准

1. THE System SHALL 支持以下 Relationship 类型：同学、朋友、暗恋、恋人、断联
2. THE System SHALL 将同一 Timeline_Period 内的所有 Person 自动建立 Classmate_Relationship
3. THE System SHALL 支持跨 Timeline_Period 的朋友关系
4. WHEN 一个 Person 具有多种 Relationship 类型，THE System SHALL 同时显示所有关系
5. THE System SHALL 为每种 Relationship 类型分配不同的视觉标识（颜色、线条样式等）

### 需求 3: 人物关系图可视化

**用户故事:** 作为用户，我想点击任意人物查看其关系网，以便探索个体的社交连接。

#### 验收标准

1. WHEN 用户点击一个 Person，THE System SHALL 生成以该 Person 为中心的 Relationship_Graph
2. THE Relationship_Graph SHALL 显示该 Person 所在班级的所有 Classmate_Relationship
3. THE Relationship_Graph SHALL 显示该 Person 的所有 Special_Relationship
4. THE Relationship_Graph SHALL 使用类似王者荣耀关系网的可视化样式
5. WHEN 显示 Relationship_Graph，THE System SHALL 突出显示中心 Person
6. THE System SHALL 支持在 Relationship_Graph 中点击其他 Person 切换到该 Person 的关系网

### 需求 4: 数据访问控制

**用户故事:** 作为项目所有者，我想独占编辑权限，以便保护数据的准确性和完整性。

#### 验收标准

1. THE System SHALL 仅允许 Owner 进入 Edit_Mode
2. WHEN 用户不是 Owner，THE System SHALL 仅提供 View_Mode
3. THE System SHALL 在 Edit_Mode 下提供添加、修改、删除 Person 和 Relationship 的功能
4. THE System SHALL 在 View_Mode 下禁用所有编辑功能
5. WHEN Owner 身份验证失败，THE System SHALL 自动切换到 View_Mode

### 需求 5: 数据持久化与管理

**用户故事:** 作为项目所有者，我想便捷地添加和管理人物关系数据，以便保持关系网络的更新。

#### 验收标准

1. THE System SHALL 将所有数据存储在客户端 Data_File 中
2. THE Data_File SHALL 使用 JSON 格式
3. WHEN Owner 在 Edit_Mode 下修改数据，THE System SHALL 生成更新后的 Data_File
4. THE System SHALL 提供导出 Data_File 的功能
5. THE System SHALL 提供批量导入 Person 和 Relationship 的功能
6. WHEN 导入数据，THE System SHALL 验证数据格式的正确性

### 需求 6: 静态部署架构

**用户故事:** 作为项目所有者，我想使用纯静态前端部署，以便降低维护成本和提高访问速度。

#### 验收标准

1. THE System SHALL 使用纯静态前端技术（HTML、CSS、JavaScript）
2. THE System SHALL 不依赖任何后端服务器
3. THE System SHALL 支持通过 GitHub Pages 部署
4. THE System SHALL 支持通过 Cloudflare CDN 加速访问
5. THE System SHALL 配置低缓存策略以确保数据更新的及时性
6. WHEN 部署到域名 wanglejiang.online，THE System SHALL 正确加载所有资源

### 需求 7: 初始数据加载

**用户故事:** 作为项目所有者，我想系统自动加载已有的班级和关系数据，以便快速启动项目。

#### 验收标准

1. THE System SHALL 加载所有 Timeline_Period 的完整 Class_Roster
2. THE System SHALL 加载王乐江在各时期的朋友、暗恋对象、恋人关系
3. THE System SHALL 加载其他已知的 Special_Relationship（如赵增智-何晶晶、王鹏飞-魏菲菲、原新文暗恋王敏）
4. WHEN 初始化数据，THE System SHALL 自动生成所有 Classmate_Relationship
5. THE System SHALL 验证所有 Relationship 引用的 Person 存在于相应的 Class_Roster 中

### 需求 8: 跨班关系展示

**用户故事:** 作为用户，我想查看跨班级的朋友关系，以便了解不同时期的社交连接。

#### 验收标准

1. WHEN 一个 Person 在多个 Timeline_Period 中存在，THE System SHALL 显示该 Person 的所有时期标签
2. WHEN 显示跨班朋友关系，THE System SHALL 标注两个 Person 所属的 Timeline_Period
3. THE Relationship_Graph SHALL 使用不同的视觉标识区分同班和跨班关系
4. THE System SHALL 支持筛选显示特定 Timeline_Period 的关系
5. WHEN 王乐江未参与某个 Timeline_Period（初中二班、23年高中复读班20班），THE System SHALL 清晰标注这些时期用于跨班关系标注

### 需求 9: 响应式界面设计

**用户故事:** 作为用户，我想在不同设备上流畅使用系统，以便随时查看关系网络。

#### 验收标准

1. THE System SHALL 支持桌面浏览器的完整功能
2. THE System SHALL 支持移动设备浏览器的核心功能
3. WHEN 屏幕宽度小于 768 像素，THE System SHALL 自动调整布局
4. THE Relationship_Graph SHALL 支持触摸手势操作（缩放、拖拽）
5. THE System SHALL 在不同设备上保持可读性和可操作性

### 需求 10: 性能优化

**用户故事:** 作为用户，我想快速加载和交互，以便获得流畅的使用体验。

#### 验收标准

1. WHEN 首次加载，THE System SHALL 在 3 秒内显示主界面
2. WHEN 切换 Timeline_Period，THE System SHALL 在 500 毫秒内更新显示
3. WHEN 生成 Relationship_Graph，THE System SHALL 在 1 秒内完成渲染
4. THE System SHALL 使用延迟加载策略处理大量 Person 数据
5. THE System SHALL 缓存已生成的 Relationship_Graph 以提高响应速度

