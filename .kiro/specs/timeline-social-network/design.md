# Design Document

## Overview

时间轴社交关系网络可视化系统是一个纯静态前端应用，用于展示王乐江在不同学习时期的社交关系网络。系统采用模块化架构，使用现代 JavaScript 和图形可视化库实现交互式关系图展示，通过 JSON 文件管理数据，支持 GitHub Pages 和 Cloudflare 部署。

## High-Level Design

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (Client)                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   UI Layer   │  │  Auth Layer  │  │  Edit Panel  │      │
│  │  (View)      │  │  (Password)  │  │  (Owner)     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│  ┌──────┴──────────────────┴──────────────────┴───────┐    │
│  │           Application Controller                    │    │
│  │  - TimelineController                               │    │
│  │  - RelationshipGraphController                      │    │
│  │  - DataManager                                      │    │
│  └──────┬──────────────────────────────────────────────┘    │
│         │                                                    │
│  ┌──────┴──────────────────────────────────────────────┐    │
│  │           Data Layer                                 │    │
│  │  - DataLoader (JSON)                                │    │
│  │  - DataValidator                                    │    │
│  │  - RelationshipCalculator                           │    │
│  └──────┬──────────────────────────────────────────────┘    │
│         │                                                    │
│  ┌──────┴──────────────────────────────────────────────┐    │
│  │    Visualization Layer (D3.js / Vis.js)             │    │
│  │  - GraphRenderer                                    │    │
│  │  - LayoutEngine                                     │    │
│  │  - InteractionHandler                               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
        ┌─────────────────────────────────────┐
        │     Static Files (GitHub Pages)     │
        │  - data.json                        │
        │  - index.html                       │
        │  - app.js, styles.css               │
        │  - lib/ (D3.js/Vis.js)              │
        └─────────────────────────────────────┘
                          │
                          ↓
        ┌─────────────────────────────────────┐
        │   Cloudflare CDN (wanglejiang.online)│
        │  - Low cache                        │
        │  - Global distribution              │
        └─────────────────────────────────────┘
```

### Component Design

#### 1. Data Layer

**DataLoader**
- 职责：从 JSON 文件加载数据
- 方法：
  - `loadData()`: 加载 data.json
  - `validateData()`: 验证数据完整性

**DataValidator**
- 职责：验证数据格式和引用完整性
- 方法：
  - `validateSchema()`: 验证 JSON schema
  - `validateReferences()`: 验证关系引用的人物存在

**RelationshipCalculator**
- 职责：计算人物之间的关系
- 方法：
  - `getClassmates(personId, period)`: 获取同学关系
  - `getSpecialRelationships(personId)`: 获取特殊关系
  - `getAllRelationships(personId, period)`: 获取所有关系

#### 2. Controller Layer

**TimelineController**
- 职责：管理时间轴导航和时期切换
- 方法：
  - `selectPeriod(periodId)`: 选择时间段
  - `getPeriodData(periodId)`: 获取时期数据
  - `renderTimeline()`: 渲染时间轴UI

**RelationshipGraphController**
- 职责：管理关系图的生成和更新
- 方法：
  - `showPersonGraph(personId, periodId)`: 显示人物关系图
  - `updateGraph(personId)`: 更新关系图
  - `cacheGraph(personId, graphData)`: 缓存关系图

**DataManager**
- 职责：管理数据的增删改查
- 方法：
  - `addPerson(person, periodId)`: 添加人物
  - `updateRelationship(relationship)`: 更新关系
  - `deletePerson(personId)`: 删除人物
  - `exportData()`: 导出JSON
  - `importData(jsonString)`: 导入JSON

#### 3. Visualization Layer

**GraphRenderer**
- 职责：使用 D3.js/Vis.js 渲染关系图
- 方法：
  - `render(graphData, container)`: 渲染图形
  - `applyLayout(layoutType)`: 应用布局算法
  - `highlightNode(nodeId)`: 高亮节点

**LayoutEngine**
- 职责：计算节点布局
- 方法：
  - `forceDirectedLayout()`: 力导向布局
  - `circularLayout()`: 圆形布局
  - `hierarchicalLayout()`: 层次布局

**InteractionHandler**
- 职责：处理用户交互
- 方法：
  - `onNodeClick(nodeId)`: 节点点击事件
  - `onZoom(scale)`: 缩放事件
  - `onDrag(nodeId, position)`: 拖拽事件

#### 4. UI Layer

**TimelineView**
- 渲染时间轴选择器
- 显示当前选中时期

**GraphView**
- 渲染关系图容器
- 显示图例和控制按钮

**EditPanel**
- 提供编辑表单（Owner模式）
- 导入/导出按钮

**AuthView**
- 密码输入界面
- 模式切换提示

### Data Schema

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
      "roster": ["张童伟", "原新文", "..."]
    },
    {
      "id": "middle_class1",
      "name": "初中一班",
      "order": 2,
      "participated": true,
      "roster": ["马晓萌", "朱磊", "马陇江", "..."]
    },
    {
      "id": "middle_class2",
      "name": "初中二班",
      "order": 3,
      "participated": false,
      "roster": ["史小勇", "赵增智", "王鹏飞", "..."]
    }
  ],
  "relationships": [
    {
      "id": "rel_001",
      "period": "middle_class1",
      "person1": "王乐江",
      "person2": "夏航航",
      "type": "friend",
      "note": ""
    },
    {
      "id": "rel_002",
      "period": "middle_class1",
      "person1": "王乐江",
      "person2": "祁鹏飞",
      "type": "friend",
      "note": "断联"
    },
    {
      "id": "rel_003",
      "period": "middle_class1",
      "person1": "王乐江",
      "person2": "王梦博",
      "type": "crush",
      "note": ""
    },
    {
      "id": "rel_004",
      "period": "middle_class2",
      "person1": "赵增智",
      "person2": "何晶晶",
      "type": "lover",
      "note": ""
    }
  ]
}
```

### Technology Stack

**Core Technologies:**
- HTML5
- CSS3 (with Flexbox/Grid)
- Vanilla JavaScript (ES6+)

**Visualization Library:**
- **推荐选项 1: Vis.js Network** 
  - 优点：轻量，易用，内置力导向布局
  - 适合：中等规模关系网（<500节点）
  
- **推荐选项 2: D3.js v7**
  - 优点：灵活，强大，自定义程度高
  - 适合：需要复杂交互和动画效果

- **推荐选项 3: Cytoscape.js**
  - 优点：专注图论可视化，性能好
  - 适合：大规模关系网（>500节点）

**部署工具:**
- GitHub Pages
- Cloudflare DNS + CDN

### Authentication Strategy

由于是纯静态前端，推荐以下方案：

**方案 1: 密码哈希验证（推荐）**
```javascript
// 在代码中存储密码的 SHA-256 哈希
const OWNER_PASSWORD_HASH = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"; // "password"

function verifyOwner(inputPassword) {
  const hash = sha256(inputPassword);
  return hash === OWNER_PASSWORD_HASH;
}
```

**方案 2: GitHub OAuth（更安全，但需要配置）**
- 使用 GitHub OAuth App
- 仅允许特定 GitHub 用户名（wanglejiang）编辑

### Deployment Configuration

**GitHub Pages 配置:**
```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
```

**Cloudflare 配置:**
- DNS CNAME: wanglejiang.online → username.github.io
- Cache Level: Bypass (或 Standard with short TTL)
- Browser Cache TTL: 30 minutes
- Always Online: Off (确保数据更新及时)

**CNAME 文件:**
```
wanglejiang.online
```

**缓存控制头（通过 _headers 文件）:**
```
/*
  Cache-Control: public, max-age=1800
  
/data.json
  Cache-Control: no-cache, must-revalidate
```

## Low-Level Design

### Module: DataLoader

```javascript
class DataLoader {
  constructor(dataUrl = './data.json') {
    this.dataUrl = dataUrl;
    this.cache = null;
  }

  async loadData() {
    if (this.cache) {
      return this.cache;
    }
    
    try {
      const response = await fetch(this.dataUrl + '?_=' + Date.now()); // Cache busting
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.cache = await response.json();
      return this.cache;
    } catch (error) {
      console.error('Failed to load data:', error);
      throw error;
    }
  }

  clearCache() {
    this.cache = null;
  }
}
```

### Module: RelationshipCalculator

```javascript
class RelationshipCalculator {
  constructor(data) {
    this.data = data;
    this.classmateCache = new Map();
  }

  getClassmates(personId, periodId) {
    const cacheKey = `${personId}_${periodId}`;
    if (this.classmateCache.has(cacheKey)) {
      return this.classmateCache.get(cacheKey);
    }

    const period = this.data.periods.find(p => p.id === periodId);
    if (!period) return [];

    const classmates = period.roster.filter(name => name !== personId);
    this.classmateCache.set(cacheKey, classmates);
    return classmates;
  }

  getSpecialRelationships(personId, periodId) {
    return this.data.relationships.filter(rel => 
      rel.period === periodId && 
      (rel.person1 === personId || rel.person2 === personId)
    );
  }

  buildGraphData(centerPersonId, periodId) {
    const nodes = [];
    const edges = [];
    
    // 中心节点
    nodes.push({
      id: centerPersonId,
      label: centerPersonId,
      type: 'center',
      color: '#FFD700' // 金色
    });

    // 同学节点
    const classmates = this.getClassmates(centerPersonId, periodId);
    classmates.forEach(name => {
      nodes.push({
        id: name,
        label: name,
        type: 'classmate',
        color: '#87CEEB' // 天蓝色
      });
      edges.push({
        from: centerPersonId,
        to: name,
        type: 'classmate',
        label: '同学',
        color: '#CCCCCC',
        dashes: false
      });
    });

    // 特殊关系
    const specialRels = this.getSpecialRelationships(centerPersonId, periodId);
    specialRels.forEach(rel => {
      const otherPerson = rel.person1 === centerPersonId ? rel.person2 : rel.person1;
      
      // 如果节点不存在，添加节点
      if (!nodes.find(n => n.id === otherPerson)) {
        nodes.push({
          id: otherPerson,
          label: otherPerson,
          type: rel.type,
          color: this.getColorByType(rel.type)
        });
      }

      // 添加特殊关系边
      edges.push({
        from: centerPersonId,
        to: otherPerson,
        type: rel.type,
        label: this.getTypeLabelChinese(rel.type) + (rel.note ? ` (${rel.note})` : ''),
        color: this.getColorByType(rel.type),
        width: 2,
        dashes: rel.type === 'crush' ? [5, 5] : false
      });
    });

    return { nodes, edges };
  }

  getColorByType(type) {
    const colors = {
      'friend': '#00FF00',    // 绿色
      'crush': '#FF69B4',     // 粉色
      'lover': '#FF0000',     // 红色
      'classmate': '#87CEEB'  // 天蓝色
    };
    return colors[type] || '#CCCCCC';
  }

  getTypeLabelChinese(type) {
    const labels = {
      'friend': '朋友',
      'crush': '暗恋',
      'lover': '恋人',
      'classmate': '同学'
    };
    return labels[type] || type;
  }
}
```

### Module: GraphRenderer (using Vis.js)

```javascript
class GraphRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.network = null;
    this.options = {
      nodes: {
        shape: 'circularImage',
        size: 30,
        font: {
          size: 14,
          face: 'Microsoft YaHei, SimHei, sans-serif'
        },
        borderWidth: 2,
        borderWidthSelected: 4
      },
      edges: {
        font: {
          size: 12,
          face: 'Microsoft YaHei, SimHei, sans-serif',
          align: 'middle'
        },
        arrows: {
          to: { enabled: false }
        },
        smooth: {
          type: 'continuous'
        }
      },
      physics: {
        enabled: true,
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 150,
          springConstant: 0.08
        },
        maxVelocity: 50,
        solver: 'forceAtlas2Based',
        timestep: 0.35,
        stabilization: {
          enabled: true,
          iterations: 100
        }
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        zoomView: true,
        dragView: true
      }
    };
  }

  render(graphData) {
    const data = {
      nodes: new vis.DataSet(graphData.nodes),
      edges: new vis.DataSet(graphData.edges)
    };

    if (this.network) {
      this.network.destroy();
    }

    this.network = new vis.Network(this.container, data, this.options);

    // 绑定事件
    this.network.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        this.onNodeClick(nodeId);
      }
    });

    // 稳定后停止物理模拟
    this.network.once('stabilizationIterationsDone', () => {
      this.network.setOptions({ physics: false });
    });
  }

  onNodeClick(nodeId) {
    // 触发自定义事件
    const event = new CustomEvent('personSelected', { detail: { personId: nodeId } });
    document.dispatchEvent(event);
  }

  destroy() {
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }
  }
}
```

### Module: AuthManager

```javascript
class AuthManager {
  constructor() {
    this.isOwner = false;
    this.passwordHash = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
  }

  async authenticate(password) {
    const hash = await this.sha256(password);
    this.isOwner = (hash === this.passwordHash);
    this.saveAuthState();
    return this.isOwner;
  }

  async sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  saveAuthState() {
    if (this.isOwner) {
      sessionStorage.setItem('authMode', 'owner');
    } else {
      sessionStorage.removeItem('authMode');
    }
  }

  loadAuthState() {
    const authMode = sessionStorage.getItem('authMode');
    this.isOwner = (authMode === 'owner');
    return this.isOwner;
  }

  logout() {
    this.isOwner = false;
    sessionStorage.removeItem('authMode');
  }

  checkOwnerMode() {
    return this.isOwner;
  }
}
```

### Module: DataManager (Edit Mode)

```javascript
class DataManager {
  constructor(dataLoader, authManager) {
    this.dataLoader = dataLoader;
    this.authManager = authManager;
    this.data = null;
  }

  async init() {
    this.data = await this.dataLoader.loadData();
  }

  addPerson(name, periodId) {
    if (!this.authManager.checkOwnerMode()) {
      throw new Error('Unauthorized: Owner access required');
    }

    const period = this.data.periods.find(p => p.id === periodId);
    if (!period) {
      throw new Error('Period not found');
    }

    if (period.roster.includes(name)) {
      throw new Error('Person already exists in this period');
    }

    period.roster.push(name);
    this.saveData();
  }

  addRelationship(person1, person2, type, periodId, note = '') {
    if (!this.authManager.checkOwnerMode()) {
      throw new Error('Unauthorized: Owner access required');
    }

    const id = 'rel_' + Date.now();
    const relationship = {
      id,
      period: periodId,
      person1,
      person2,
      type,
      note
    };

    this.data.relationships.push(relationship);
    this.saveData();
    return relationship;
  }

  updateRelationship(relationshipId, updates) {
    if (!this.authManager.checkOwnerMode()) {
      throw new Error('Unauthorized: Owner access required');
    }

    const rel = this.data.relationships.find(r => r.id === relationshipId);
    if (!rel) {
      throw new Error('Relationship not found');
    }

    Object.assign(rel, updates);
    this.saveData();
  }

  deleteRelationship(relationshipId) {
    if (!this.authManager.checkOwnerMode()) {
      throw new Error('Unauthorized: Owner access required');
    }

    const index = this.data.relationships.findIndex(r => r.id === relationshipId);
    if (index === -1) {
      throw new Error('Relationship not found');
    }

    this.data.relationships.splice(index, 1);
    this.saveData();
  }

  exportData() {
    const dataStr = JSON.stringify(this.data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    a.click();
    
    URL.revokeObjectURL(url);
  }

  async importData(jsonString) {
    if (!this.authManager.checkOwnerMode()) {
      throw new Error('Unauthorized: Owner access required');
    }

    try {
      const newData = JSON.parse(jsonString);
      // 验证数据格式
      if (!newData.periods || !newData.relationships) {
        throw new Error('Invalid data format');
      }
      
      this.data = newData;
      this.saveData();
      return true;
    } catch (error) {
      throw new Error('Failed to import data: ' + error.message);
    }
  }

  saveData() {
    // 由于是纯静态，无法直接保存到服务器
    // 提示用户导出 data.json 并手动提交到 GitHub
    localStorage.setItem('pendingData', JSON.stringify(this.data));
    
    const event = new CustomEvent('dataChanged', { detail: { data: this.data } });
    document.dispatchEvent(event);
  }
}
```

### UI Component: TimelineSelector

```javascript
class TimelineSelector {
  constructor(containerId, onPeriodChange) {
    this.container = document.getElementById(containerId);
    this.onPeriodChange = onPeriodChange;
    this.currentPeriod = null;
  }

  render(periods) {
    this.container.innerHTML = '';
    
    const timeline = document.createElement('div');
    timeline.className = 'timeline';
    
    periods.forEach(period => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      if (!period.participated) {
        item.classList.add('not-participated');
      }
      
      const button = document.createElement('button');
      button.textContent = period.name;
      button.dataset.periodId = period.id;
      button.onclick = () => this.selectPeriod(period.id);
      
      item.appendChild(button);
      timeline.appendChild(item);
    });
    
    this.container.appendChild(timeline);
  }

  selectPeriod(periodId) {
    this.currentPeriod = periodId;
    
    // 更新UI
    const buttons = this.container.querySelectorAll('button');
    buttons.forEach(btn => {
      if (btn.dataset.periodId === periodId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    // 触发回调
    if (this.onPeriodChange) {
      this.onPeriodChange(periodId);
    }
  }
}
```

### Performance Optimization Strategies

**1. 懒加载（Lazy Loading）**
```javascript
// 仅加载当前时期的数据
function loadPeriodData(periodId) {
  const period = allPeriods.find(p => p.id === periodId);
  return {
    roster: period.roster,
    relationships: relationships.filter(r => r.period === periodId)
  };
}
```

**2. 关系图缓存**
```javascript
class GraphCache {
  constructor(maxSize = 50) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get(key) {
    return this.cache.get(key);
  }

  has(key) {
    return this.cache.has(key);
  }
}
```

**3. 虚拟化渲染（大量节点时）**
- 仅渲染视口内的节点
- 使用 WebGL 渲染（Cytoscape.js 支持）

**4. 防抖和节流**
```javascript
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 应用于搜索
const searchInput = document.getElementById('search');
searchInput.addEventListener('input', debounce(handleSearch, 300));
```

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
- Set up project structure
- Implement DataLoader and DataValidator
- Create initial data.json with provided data
- Set up GitHub repository

### Phase 2: Visualization (Week 2)
- Integrate Vis.js library
- Implement GraphRenderer
- Implement RelationshipCalculator
- Create basic UI layout

### Phase 3: Interaction & Navigation (Week 3)
- Implement TimelineController
- Implement TimelineSelector UI
- Add node click interactions
- Implement graph caching

### Phase 4: Edit Mode (Week 4)
- Implement AuthManager
- Implement DataManager
- Create edit panel UI
- Add import/export功能

### Phase 5: Polish & Deploy (Week 5)
- Responsive design for mobile
- Performance optimization
- Deploy to GitHub Pages
- Configure Cloudflare DNS and CDN
- Testing on actual domain

## Testing Strategy

**Unit Tests:**
- DataValidator.validateSchema()
- RelationshipCalculator.buildGraphData()
- AuthManager.authenticate()

**Integration Tests:**
- Data loading → Graph rendering
- Period selection → Graph update
- Edit operations → Data export

**Manual Tests:**
- 跨浏览器测试（Chrome, Firefox, Safari, Edge）
- 移动设备测试（iOS Safari, Chrome Android）
- 性能测试（大量节点渲染时间）
- 域名访问测试（wanglejiang.online）

## Security Considerations

1. **密码保护**: 使用 SHA-256 哈希，避免明文密码
2. **XSS 防护**: 对用户输入进行转义
3. **数据备份**: 定期导出 data.json 到 GitHub
4. **HTTPS**: Cloudflare 强制 HTTPS

## Future Enhancements

1. **多语言支持**: 英文界面选项
2. **高级搜索**: 按关系类型筛选
3. **时间线动画**: 展示关系网络随时间演变
4. **数据统计**: 朋友数量、关系类型分布图表
5. **头像支持**: 为人物添加头像图片
6. **评论功能**: 为关系添加备注和故事
