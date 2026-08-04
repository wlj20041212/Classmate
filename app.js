/**
 * 时间轴社交关系网络可视化系统
 * 主应用脚本
 */

/**
 * DataLoader 类 (任务 2.1)
 * 职责：从 JSON 文件加载数据
 * 功能：
 * - 从 data.json 加载数据
 * - 实现缓存机制
 * - Cache busting 避免浏览器缓存
 * - 错误处理
 * _Requirements: 5.1, 5.2, 10.1_
 */
class DataLoader {
    constructor(dataUrl = './data.json') {
        this.dataUrl = dataUrl;
        this.cache = null;
    }

    /**
     * 加载数据 (带缓存)
     * @returns {Promise<Object>} 数据对象
     */
    async loadData() {
        // 如果有缓存，直接返回
        if (this.cache) {
            console.log('[DataLoader] 使用缓存数据');
            return this.cache;
        }

        try {
            // Cache busting - 添加时间戳参数避免浏览器缓存
            const url = `${this.dataUrl}?_=${Date.now()}`;
            console.log(`[DataLoader] 从服务器加载: ${url}`);

            const response = await fetch(url);

            // 检查 HTTP 响应状态
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 解析 JSON
            const data = await response.json();
            
            // 缓存数据
            this.cache = data;
            
            console.log('[DataLoader] 数据加载成功', {
                version: data.version,
                owner: data.owner,
                periods: data.periods.length,
                relationships: data.relationships.length
            });

            return data;

        } catch (error) {
            console.error('[DataLoader] 数据加载失败:', error);
            
            // 提供更友好的错误信息
            if (error.name === 'SyntaxError') {
                throw new Error('数据文件格式错误（JSON 解析失败）');
            } else if (error.message.includes('HTTP error')) {
                throw new Error(`无法加载数据文件（HTTP ${error.message}）`);
            } else if (error.message.includes('Failed to fetch')) {
                throw new Error('网络错误：无法连接到服务器');
            } else {
                throw new Error(`数据加载失败: ${error.message}`);
            }
        }
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.cache = null;
        console.log('[DataLoader] 缓存已清除');
    }

    /**
     * 重新加载数据（强制从服务器加载）
     * @returns {Promise<Object>} 数据对象
     */
    async reloadData() {
        console.log('[DataLoader] 强制重新加载数据');
        this.clearCache();
        return await this.loadData();
    }

    /**
     * 检查是否有缓存
     * @returns {boolean} 是否有缓存
     */
    hasCache() {
        return this.cache !== null;
    }

    /**
     * 获取缓存的数据（不触发加载）
     * @returns {Object|null} 缓存的数据或 null
     */
    getCachedData() {
        return this.cache;
    }
}

/**
 * GraphCache 类 (任务 11.1 - 需求 10.5)
 * LRU 缓存：缓存已生成的图数据，避免重复计算
 * 最大容量 50 个条目
 */
class GraphCache {
    constructor(maxSize = 50) {
        this.maxSize = maxSize;
        this.cache = new Map();  // Map 保持插入顺序，便于实现 LRU
    }

    /**
     * 生成缓存键 (任务 11.1)
     * @param {string} personId - 人物姓名
     * @param {string} periodId - 时期 ID
     * @param {Object} filters - 筛选器状态
     * @returns {string} 缓存键
     */
    makeKey(personId, periodId, filters) {
        const filterKey = `${filters.scope}|${filters.types.friend}|${filters.types.crush}|${filters.types.lover}|${filters.types.roommate}|${filters.types.classmate}`;
        return `${personId}@${periodId}#${filterKey}`;
    }

    /**
     * 获取缓存项（命中时移动到最新位置）
     * @param {string} key - 缓存键
     * @returns {Object|null} 缓存的图数据，未命中返回 null
     */
    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        // 移动到最新位置（删除后重新插入）
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    /**
     * 设置缓存项（超出容量时淘汰最旧条目）
     * @param {string} key - 缓存键
     * @param {Object} value - 图数据
     */
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // 淘汰最旧条目（Map 的第一个 key）
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, value);
    }

    /**
     * 清空缓存
     */
    clear() {
        this.cache.clear();
    }

    /**
     * 获取缓存大小
     */
    get size() {
        return this.cache.size;
    }
}

/**
 * RelationshipCalculator 类 (任务 2.3, 9.2)
 * 职责：计算人物之间的关系，构建图数据
 * 功能：
 * - 获取同学关系（同班自动生成）
 * - 获取特殊关系（朋友、暗恋、恋人）
 * - 构建 Vis.js 所需的图数据结构
 * - 关系类型颜色映射
 * - 关系筛选（任务 9.2）
 * _Requirements: 2.2, 2.4, 2.5, 8.4_
 */
class RelationshipCalculator {
    constructor(data) {
        this.data = data;
        this.classmateCache = new Map();
        this.graphCache = new GraphCache(50);  // 任务 11.1: LRU 缓存
        
        // 任务 9.2: 筛选器状态
        this.filters = {
            scope: 'all',           // 'all' | 'same-class' | 'cross-class'
            types: {
                friend: true,
                crush: true,
                lover: true,
                roommate: true,     // 舍友
                classmate: true     // 默认显示同学关系
            }
        };
    }

    /**
     * 获取时期所属的阶段（小学/初中/高中/复读/大学）
     * 同阶段内的跨班关系应显示，跨阶段的关系不应混在一起
     * @param {string} periodId - 时期 ID
     * @returns {string} 阶段标识
     */
    getStage(periodId) {
        if (periodId.startsWith('primary')) return 'primary';
        if (periodId.startsWith('middle')) return 'middle';
        if (periodId.startsWith('high')) return 'high';
        if (periodId.startsWith('repeat')) return 'repeat';
        // 大一和大二-大四是先后关系（非平行班级），需分为不同阶段
        // 避免大二-大四的恋爱关系在大一页面显示
        if (periodId === 'college_1') return 'college_1';
        if (periodId === 'college_2_4') return 'college_2_4';
        return 'other';
    }

    /**
     * 获取人物的"本班"时期 ID (修复跨班同学逻辑)
     * - 如果人物在当前时期 roster 中，当前时期就是本班
     * - 否则（跨班人物，如王梦博在二班，当前页面是一班），找到他实际所在的其他时期
     * - 限制：只在同阶段内找本班，避免跨阶段（如初中人物在大学页面）误判
     * @param {string} personId - 人物姓名
     * @param {string} currentPeriodId - 当前页面时期 ID
     * @returns {string} 本班时期 ID
     */
    getHomePeriodId(personId, currentPeriodId) {
        const currentPeriod = this.data.periods.find(p => p.id === currentPeriodId);
        // 人物在当前时期 roster 中 → 当前时期就是本班
        if (currentPeriod && currentPeriod.roster.includes(personId)) {
            return currentPeriodId;
        }

        // 跨班人物：在同阶段内找他实际所在的时期
        const currentStage = this.getStage(currentPeriodId);
        const personPeriods = this.getPersonPeriods(personId);
        // 人物不在任何 roster 中（外部朋友，如杨天、马奴海）→ 无本班同学
        if (personPeriods.length === 0) return null;

        // 优先选择同阶段的其他时期作为他的"本班"
        const sameStagePeriod = personPeriods.find(p =>
            p.id !== currentPeriodId && this.getStage(p.id) === currentStage
        );
        if (sameStagePeriod) return sameStagePeriod.id;

        // 同阶段没找到（跨阶段，如大一人物在大二页面）→ 返回 null，表示无本班同学
        return null;
    }

    /**
     * 获取同学关系（同班级的其他人）
     * 修复：跨班中心人物的同学应该是他本班的同学，而非当前页面时期的同学
     * 例如点击王梦博(二班)后，他的同学应该是二班的人，而不是当前页面(一班)的人
     * @param {string} personId - 人物姓名
     * @param {string} periodId - 当前页面时间段 ID（用于判断是否跨班）
     * @returns {Array<string>} 同学姓名列表
     */
    getClassmates(personId, periodId) {
        // 用本班时期作为缓存键，保证同一人物的本班同学列表稳定
        const homePeriodId = this.getHomePeriodId(personId, periodId);

        // 跨阶段人物（如大一人物在大二页面）无本班同学
        if (homePeriodId === null) {
            return [];
        }

        const cacheKey = `${personId}_${homePeriodId}`;

        // 使用缓存提升性能
        if (this.classmateCache.has(cacheKey)) {
            return this.classmateCache.get(cacheKey);
        }

        const homePeriod = this.data.periods.find(p => p.id === homePeriodId);
        if (!homePeriod) {
            console.warn(`[RelationshipCalculator] Home period not found: ${homePeriodId}`);
            return [];
        }

        // 排除自己，其他都是同学
        const classmates = homePeriod.roster.filter(name => name !== personId);

        this.classmateCache.set(cacheKey, classmates);
        return classmates;
    }

    /**
     * 获取特殊关系（朋友、暗恋、恋人）
     * 修复：只查询与当前时期同阶段的关系，避免跨阶段（如初中暗恋在大学页面）混在一起
     * 同阶段内的跨班关系（如初中一班↔初中二班）仍能正常显示
     * @param {string} personId - 人物姓名
     * @param {string} periodId - 当前页面时间段 ID
     * @returns {Array<Object>} 关系对象列表
     */
    getSpecialRelationships(personId, periodId) {
        const currentStage = this.getStage(periodId);
        return this.data.relationships.filter(rel => {
            // 只查询同阶段的关系
            if (this.getStage(rel.period) !== currentStage) return false;
            return rel.person1 === personId || rel.person2 === personId;
        });
    }

    /**
     * 构建图数据（Vis.js 格式）（任务 9.2: 支持筛选；任务 11.1: LRU 缓存）
     * @param {string} centerPersonId - 中心人物姓名
     * @param {string} periodId - 时间段 ID
     * @returns {Object} { nodes: Array, edges: Array }
     */
    buildGraphData(centerPersonId, periodId) {
        // 任务 11.1: 先查缓存
        const cacheKey = this.graphCache.makeKey(centerPersonId, periodId, this.filters);
        const cached = this.graphCache.get(cacheKey);
        if (cached) {
            console.log(`[RelationshipCalculator] 缓存命中: ${cacheKey}`);
            return cached;
        }

        const nodes = [];
        const edges = [];
        const nodeSet = new Set(); // 避免重复节点
        const nodeMap = new Map(); // 节点 id -> nodes 数组中的索引，便于后续更新

        // 1. 添加中心节点
        nodes.push({
            id: centerPersonId,
            label: centerPersonId,
            type: 'center',
            color: {
                background: '#FFD700', // 金色
                border: '#FFA500',
                highlight: {
                    background: '#FFD700',
                    border: '#FF8C00'
                }
            },
            size: 40,
            font: { size: 16, bold: true }
        });
        nodeSet.add(centerPersonId);
        nodeMap.set(centerPersonId, 0);

        // 2. 先处理特殊关系（朋友/暗恋/恋人）- 优先级高于同学关系
        // 修复：特殊关系节点的颜色应覆盖同学蓝色，而非被同学蓝色覆盖
        const specialRels = this.getSpecialRelationships(centerPersonId, periodId);
        // 中心人物本班同学列表（用于判断同班/跨班）
        const centerClassmates = this.getClassmates(centerPersonId, periodId);

        specialRels.forEach(rel => {
            // 任务 9.2: 根据关系类型筛选
            if (!this.filters.types[rel.type]) {
                return; // 跳过未选中的关系类型
            }

            const otherPerson = rel.person1 === centerPersonId ? rel.person2 : rel.person1;

            // 确定关系范围（同班或跨班）- 基于中心人物的本班 roster
            const isSameClass = centerClassmates.includes(otherPerson);
            const scope = isSameClass ? 'same-class' : 'cross-class';

            // 任务 9.2: 根据范围筛选
            if (this.filters.scope === 'same-class' && !isSameClass) {
                return; // 只显示同班，跳过跨班关系
            }
            if (this.filters.scope === 'cross-class' && isSameClass) {
                return; // 只显示跨班，跳过同班关系
            }

            // 任务 9.1: 标识跨班人物 - 基于中心人物本班判断
            const isCrossClass = !isSameClass;
            const personPeriods = this.getPersonPeriods(otherPerson);
            const periodNames = personPeriods.map(p => p.name).join('、');

            const nodeData = {
                id: otherPerson,
                label: otherPerson,
                type: rel.type,
                color: this.getNodeColorByType(rel.type),
                size: 30,
                title: isCrossClass
                    ? `${otherPerson}\n(跨班人物 - 出现于: ${periodNames})`
                    : otherPerson
            };

            // 跨班人物使用虚线边框以视觉区分 (需求 8.3)
            if (isCrossClass) {
                nodeData.color = {
                    ...nodeData.color,
                    border: '#FF8C00'  // 橙色边框标识跨班
                };
                nodeData.borderWidth = 3;
                nodeData.shapeProperties = { borderDashes: [5, 5] };  // 虚线边框
                nodeData.label = `${otherPerson} ⟂`;
            }

            // 无论节点是否已存在，特殊关系颜色都应覆盖（优先级高于同学）
            if (nodeSet.has(otherPerson)) {
                // 更新已有节点的颜色和类型为特殊关系
                const idx = nodeMap.get(otherPerson);
                nodes[idx].color = nodeData.color;
                nodes[idx].type = nodeData.type;
                if (nodeData.borderWidth) nodes[idx].borderWidth = nodeData.borderWidth;
                if (nodeData.shapeProperties) nodes[idx].shapeProperties = nodeData.shapeProperties;
                if (nodeData.label !== otherPerson) nodes[idx].label = nodeData.label;
                if (nodeData.title !== otherPerson) nodes[idx].title = nodeData.title;
            } else {
                nodes.push(nodeData);
                nodeSet.add(otherPerson);
                nodeMap.set(otherPerson, nodes.length - 1);
            }

            // 添加特殊关系边
            // 修复：暗恋是单向关系，person1 是主动方，person2 是被动方
            // 当中心人物是被动方时，标签应显示为"被暗恋"
            let labelText = this.getTypeLabelChinese(rel.type);
            if (rel.type === 'crush') {
                const isPassive = rel.person2 === centerPersonId; // 中心人物是被暗恋者
                labelText = isPassive ? '被暗恋' : '暗恋';
            }
            labelText = labelText + (rel.note ? ` (${rel.note})` : '');

            edges.push({
                from: centerPersonId,
                to: otherPerson,
                type: rel.type,
                label: labelText,
                color: this.getEdgeColorByType(rel.type),
                width: 3,
                dashes: rel.type === 'crush' ? [5, 5] : false, // 暗恋用虚线
                font: { size: 12, color: '#333', strokeWidth: 3, strokeColor: '#fff' },
                scope: scope  // 标记关系范围
            });
        });

        // 3. 再添加同学节点和边 (任务 9.2: 应用筛选器)
        // 修复：同学节点仅在不存在时添加，不覆盖已存在的特殊关系节点颜色
        // 修复：已有特殊关系（朋友/暗恋/恋人/舍友）的人不再画同学边，避免双重连线
        if (this.filters.types.classmate) {
            const classmates = this.getClassmates(centerPersonId, periodId);
            // 收集已有特殊关系边连接的人物（双向）
            const specialRelated = new Set();
            edges.forEach(e => {
                if (e.type !== 'classmate') {
                    specialRelated.add(e.from);
                    specialRelated.add(e.to);
                }
            });
            classmates.forEach(name => {
                if (!nodeSet.has(name)) {
                    nodes.push({
                        id: name,
                        label: name,
                        type: 'classmate',
                        color: {
                            background: '#87CEEB', // 天蓝色
                            border: '#4682B4'
                        },
                        size: 25
                    });
                    nodeSet.add(name);
                    nodeMap.set(name, nodes.length - 1);
                }

                // 已有特殊关系的人不再画同学边
                if (specialRelated.has(name)) return;

                // 添加同学关系边
                edges.push({
                    from: centerPersonId,
                    to: name,
                    type: 'classmate',
                    label: '同学',
                    color: { color: '#CCCCCC', highlight: '#999999' },
                    width: 1,
                    dashes: false,
                    scope: 'same-class'  // 标记为同班关系
                });
            });
        }

        console.log(`[RelationshipCalculator] 构建图数据 (筛选后): ${nodes.length} 节点, ${edges.length} 边`);
        
        const result = { nodes, edges };
        // 任务 11.1: 写入缓存
        this.graphCache.set(cacheKey, result);
        
        return result;
    }

    /**
     * 根据关系类型获取节点颜色
     * @param {string} type - 关系类型
     * @returns {Object} 颜色配置
     */
    getNodeColorByType(type) {
        const colorMap = {
            'friend': {
                background: '#00FF7F', // 春绿色
                border: '#00C957',
                highlight: { background: '#00FF7F', border: '#00A040' }
            },
            'crush': {
                background: '#FF69B4', // 热粉色
                border: '#FF1493',
                highlight: { background: '#FF69B4', border: '#C71585' }
            },
            'lover': {
                background: '#FF0000', // 红色
                border: '#CC0000',
                highlight: { background: '#FF0000', border: '#990000' }
            },
            'roommate': {
                background: '#9370DB', // 中紫色
                border: '#7B68EE',
                highlight: { background: '#9370DB', border: '#6A5ACD' }
            },
            'classmate': {
                background: '#87CEEB', // 天蓝色
                border: '#4682B4',
                highlight: { background: '#87CEEB', border: '#4169E1' }
            }
        };
        
        return colorMap[type] || {
            background: '#CCCCCC',
            border: '#999999'
        };
    }

    /**
     * 根据关系类型获取边颜色
     * @param {string} type - 关系类型
     * @returns {Object} 颜色配置
     */
    getEdgeColorByType(type) {
        const colorMap = {
            'friend': { color: '#00C957', highlight: '#00FF7F' },
            'crush': { color: '#FF1493', highlight: '#FF69B4' },
            'lover': { color: '#FF0000', highlight: '#FF4500' },
            'roommate': { color: '#7B68EE', highlight: '#9370DB' },
            'classmate': { color: '#CCCCCC', highlight: '#999999' }
        };
        
        return colorMap[type] || { color: '#CCCCCC', highlight: '#999999' };
    }

    /**
     * 获取关系类型的中文标签
     * @param {string} type - 关系类型
     * @returns {string} 中文标签
     */
    getTypeLabelChinese(type) {
        const labels = {
            'friend': '朋友',
            'crush': '暗恋',
            'lover': '恋人',
            'roommate': '舍友',
            'classmate': '同学'
        };
        return labels[type] || type;
    }

    /**
     * 清除缓存 (任务 11.1: 包含 graphCache)
     */
    clearCache() {
        this.classmateCache.clear();
        this.graphCache.clear();
        console.log('[RelationshipCalculator] 缓存已清除 (classmate + graph)');
    }

    /**
     * 获取某个人物出现的所有时期 (任务 9.1 - 需求 8.1, 8.3)
     * @param {string} personId - 人物姓名
     * @returns {Array<Object>} 时期对象列表
     */
    getPersonPeriods(personId) {
        return this.data.periods.filter(p => p.roster.includes(personId));
    }

    /**
     * 判断某个人物在指定时期是否为跨班人物 (任务 9.1)
     * 跨班人物：不在当前时期 roster 中，但通过关系出现在图中
     * @param {string} personId - 人物姓名
     * @param {string} periodId - 当前时期 ID
     * @returns {boolean} 是否为跨班人物
     */
    isCrossClassPerson(personId, periodId) {
        const period = this.data.periods.find(p => p.id === periodId);
        if (!period) return false;
        return !period.roster.includes(personId);
    }

    /**
     * 获取某人在所有时期的关系统计
     * @param {string} personId - 人物姓名
     * @returns {Object} 统计信息
     */
    getPersonStats(personId) {
        const stats = {
            periods: [],
            totalClassmates: 0,
            totalFriends: 0,
            totalCrushes: 0,
            totalLovers: 0,
            totalRoommates: 0
        };

        this.data.periods.forEach(period => {
            if (period.roster.includes(personId)) {
                const classmates = this.getClassmates(personId, period.id);
                const specialRels = this.getSpecialRelationships(personId, period.id);
                
                const friends = specialRels.filter(r => r.type === 'friend').length;
                const crushes = specialRels.filter(r => r.type === 'crush').length;
                const lovers = specialRels.filter(r => r.type === 'lover').length;
                const roommates = specialRels.filter(r => r.type === 'roommate').length;
                
                stats.periods.push({
                    periodId: period.id,
                    periodName: period.name,
                    classmates: classmates.length,
                    friends,
                    crushes,
                    lovers,
                    roommates
                });
                
                stats.totalClassmates += classmates.length;
                stats.totalFriends += friends;
                stats.totalCrushes += crushes;
                stats.totalLovers += lovers;
                stats.totalRoommates += roommates;
            }
        });

        return stats;
    }

    /**
     * 设置筛选器（任务 9.2）
     * @param {Object} filters - 筛选器配置
     * @param {string} filters.scope - 范围筛选 'all' | 'same-class' | 'cross-class'
     * @param {Object} filters.types - 类型筛选 { friend, crush, lover, roommate, classmate }
     */
    setFilters(filters) {
        if (filters.scope !== undefined) {
            this.filters.scope = filters.scope;
            console.log(`[RelationshipCalculator] 设置范围筛选: ${filters.scope}`);
        }
        
        if (filters.types !== undefined) {
            Object.assign(this.filters.types, filters.types);
            console.log(`[RelationshipCalculator] 设置类型筛选:`, this.filters.types);
        }
    }

    /**
     * 获取当前筛选器状态（任务 9.2）
     * @returns {Object} 筛选器状态
     */
    getFilters() {
        return {
            scope: this.filters.scope,
            types: { ...this.filters.types }
        };
    }

    /**
     * 重置筛选器到默认状态（任务 9.2）
     */
    resetFilters() {
        this.filters = {
            scope: 'all',
            types: {
                friend: true,
                crush: true,
                lover: true,
                roommate: true,
                classmate: true
            }
        };
        console.log('[RelationshipCalculator] 筛选器已重置');
    }
}

/**
 * DataValidator 类 (任务 2.2)
 * 职责：验证数据格式和引用完整性
 * 验证点：
 * - JSON schema 结构验证
 * - 关系引用的人物存在性验证
 * - person1 和 person2 必须在对应 period 的 roster 中
 * _Requirements: 5.6, 7.5_
 */
class DataValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * 验证完整数据结构
     * @param {Object} data - 待验证的数据对象
     * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
     */
    validate(data) {
        this.errors = [];
        this.warnings = [];

        // 验证 schema
        const schemaValid = this.validateSchema(data);
        
        // 如果 schema 有效，继续验证引用
        if (schemaValid) {
            this.validateReferences(data);
        }

        return {
            valid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings
        };
    }

    /**
     * 验证 JSON schema 结构 (需求 5.6)
     * @param {Object} data - 待验证的数据对象
     * @returns {boolean} schema 是否有效
     */
    validateSchema(data) {
        // 验证顶层结构
        if (!data || typeof data !== 'object') {
            this.errors.push('数据必须是一个对象');
            return false;
        }

        // 验证必需字段
        if (!data.version) {
            this.errors.push('缺少必需字段: version');
        }

        if (!data.owner) {
            this.errors.push('缺少必需字段: owner');
        }

        if (!Array.isArray(data.periods)) {
            this.errors.push('periods 必须是数组');
            return false;
        }

        if (!Array.isArray(data.relationships)) {
            this.errors.push('relationships 必须是数组');
            return false;
        }

        // 验证 periods 数组
        data.periods.forEach((period, index) => {
            this.validatePeriod(period, index);
        });

        // 验证 relationships 数组
        data.relationships.forEach((rel, index) => {
            this.validateRelationship(rel, index);
        });

        return this.errors.length === 0;
    }

    /**
     * 验证单个 period 对象
     * @param {Object} period - period 对象
     * @param {number} index - 数组索引
     */
    validatePeriod(period, index) {
        const prefix = `periods[${index}]`;

        if (!period.id) {
            this.errors.push(`${prefix}: 缺少必需字段 id`);
        } else if (typeof period.id !== 'string') {
            this.errors.push(`${prefix}: id 必须是字符串`);
        }

        if (!period.name) {
            this.errors.push(`${prefix}: 缺少必需字段 name`);
        } else if (typeof period.name !== 'string') {
            this.errors.push(`${prefix}: name 必须是字符串`);
        }

        if (period.order === undefined) {
            this.errors.push(`${prefix}: 缺少必需字段 order`);
        } else if (typeof period.order !== 'number') {
            this.errors.push(`${prefix}: order 必须是数字`);
        }

        if (period.participated === undefined) {
            this.errors.push(`${prefix}: 缺少必需字段 participated`);
        } else if (typeof period.participated !== 'boolean') {
            this.errors.push(`${prefix}: participated 必须是布尔值`);
        }

        if (!Array.isArray(period.roster)) {
            this.errors.push(`${prefix}: roster 必须是数组`);
        } else {
            // 验证 roster 元素都是字符串
            period.roster.forEach((name, i) => {
                if (typeof name !== 'string') {
                    this.errors.push(`${prefix}.roster[${i}]: 必须是字符串`);
                }
            });

            // 检查重复名字
            const duplicates = this.findDuplicates(period.roster);
            if (duplicates.length > 0) {
                this.warnings.push(`${prefix}.roster: 存在重复名字: ${duplicates.join(', ')}`);
            }
        }
    }

    /**
     * 验证单个 relationship 对象
     * @param {Object} rel - relationship 对象
     * @param {number} index - 数组索引
     */
    validateRelationship(rel, index) {
        const prefix = `relationships[${index}]`;

        if (!rel.id) {
            this.errors.push(`${prefix}: 缺少必需字段 id`);
        } else if (typeof rel.id !== 'string') {
            this.errors.push(`${prefix}: id 必须是字符串`);
        }

        if (!rel.period) {
            this.errors.push(`${prefix}: 缺少必需字段 period`);
        } else if (typeof rel.period !== 'string') {
            this.errors.push(`${prefix}: period 必须是字符串`);
        }

        if (!rel.person1) {
            this.errors.push(`${prefix}: 缺少必需字段 person1`);
        } else if (typeof rel.person1 !== 'string') {
            this.errors.push(`${prefix}: person1 必须是字符串`);
        }

        if (!rel.person2) {
            this.errors.push(`${prefix}: 缺少必需字段 person2`);
        } else if (typeof rel.person2 !== 'string') {
            this.errors.push(`${prefix}: person2 必须是字符串`);
        }

        if (!rel.type) {
            this.errors.push(`${prefix}: 缺少必需字段 type`);
        } else if (typeof rel.type !== 'string') {
            this.errors.push(`${prefix}: type 必须是字符串`);
        } else {
            // 验证关系类型
            const validTypes = ['friend', 'crush', 'lover', 'roommate', 'classmate'];
            if (!validTypes.includes(rel.type)) {
                this.warnings.push(`${prefix}.type: 未知的关系类型 "${rel.type}"，有效类型: ${validTypes.join(', ')}`);
            }
        }

        if (rel.note === undefined) {
            this.errors.push(`${prefix}: 缺少必需字段 note`);
        } else if (typeof rel.note !== 'string') {
            this.errors.push(`${prefix}: note 必须是字符串`);
        }

        // 检查 person1 和 person2 是否相同
        if (rel.person1 && rel.person2 && rel.person1 === rel.person2) {
            this.warnings.push(`${prefix}: person1 和 person2 是同一个人 (${rel.person1})`);
        }
    }

    /**
     * 验证关系引用的完整性 (需求 5.6, 7.5)
     * 验证所有 relationships 的 person1 和 person2 在数据集中存在
     * 支持跨班/跨时期关系（任务 9）：人物只需存在于某个 period 的 roster 中即可，
     * 不强制要求两人都在关系所属 period 的 roster 中
     * @param {Object} data - 数据对象
     */
    validateReferences(data) {
        // 构建 period ID 映射
        const periodMap = new Map();
        data.periods.forEach(period => {
            periodMap.set(period.id, period);
        });

        // 构建全局人物集合（所有 period roster 的并集）
        const allPersons = new Set();
        data.periods.forEach(period => {
            period.roster.forEach(name => allPersons.add(name));
        });

        // 检查关系 ID 唯一性
        const relationshipIds = data.relationships.map(r => r.id);
        const duplicateRelIds = this.findDuplicates(relationshipIds);
        if (duplicateRelIds.length > 0) {
            this.errors.push(`关系 ID 重复: ${duplicateRelIds.join(', ')}`);
        }

        // 验证每个关系的引用
        data.relationships.forEach((rel, index) => {
            const prefix = `relationships[${index}]`;

            // 验证 period 引用存在
            if (!periodMap.has(rel.period)) {
                this.errors.push(`${prefix}: 引用的 period "${rel.period}" 不存在`);
                return; // 无法继续验证此关系
            }

            const period = periodMap.get(rel.period);
            const roster = period.roster;

            // 验证 person1 在全局人物集合中存在
            // 例外：特殊关系（friend/crush/lover/roommate）人物可以是外部人员，不强制在 roster 中
            // （如大学的杨天、马奴海等外部朋友；王子文是外部恋人等）
            const isSpecialType = ['friend', 'crush', 'lover', 'roommate'].includes(rel.type);
            if (rel.person1 && !allPersons.has(rel.person1) && !isSpecialType) {
                this.errors.push(`${prefix}: person1 "${rel.person1}" 不存在于任何 period 的 roster 中`);
            } else if (rel.person1 && !allPersons.has(rel.person1) && isSpecialType) {
                this.warnings.push(`${prefix}: person1 "${rel.person1}" 为外部人员（不在任何 roster 中）`);
            }

            // 验证 person2 在全局人物集合中存在
            if (rel.person2 && !allPersons.has(rel.person2) && !isSpecialType) {
                this.errors.push(`${prefix}: person2 "${rel.person2}" 不存在于任何 period 的 roster 中`);
            } else if (rel.person2 && !allPersons.has(rel.person2) && isSpecialType) {
                this.warnings.push(`${prefix}: person2 "${rel.person2}" 为外部人员（不在任何 roster 中）`);
            }

            // 跨班关系检查（任务 9）：如果人物不在关系所属 period 的 roster 中，仅给出警告
            if (rel.person1 && !roster.includes(rel.person1)) {
                this.warnings.push(`${prefix}: person1 "${rel.person1}" 不在 period "${rel.period}" 的 roster 中（跨班关系）`);
            }

            if (rel.person2 && !roster.includes(rel.person2)) {
                this.warnings.push(`${prefix}: person2 "${rel.person2}" 不在 period "${rel.period}" 的 roster 中（跨班关系）`);
            }

            // 特殊检查：如果 period.participated 为 false，owner 不应该出现在关系中
            if (!period.participated && data.owner) {
                if (rel.person1 === data.owner || rel.person2 === data.owner) {
                    this.warnings.push(`${prefix}: owner "${data.owner}" 在未参与的 period "${rel.period}" 中有关系记录`);
                }
            }
        });

        // 检查 period ID 唯一性
        const periodIds = data.periods.map(p => p.id);
        const duplicatePeriodIds = this.findDuplicates(periodIds);
        if (duplicatePeriodIds.length > 0) {
            this.errors.push(`period ID 重复: ${duplicatePeriodIds.join(', ')}`);
        }

        // 检查 owner 是否在至少一个参与的 period 的 roster 中
        if (data.owner) {
            const ownerInRoster = data.periods.some(period => 
                period.participated && period.roster.includes(data.owner)
            );
            if (!ownerInRoster) {
                this.warnings.push(`owner "${data.owner}" 未出现在任何参与的 period 的 roster 中`);
            }
        }
    }

    /**
     * 查找数组中的重复元素
     * @param {Array} arr - 数组
     * @returns {Array} 重复的元素
     */
    findDuplicates(arr) {
        const seen = new Set();
        const duplicates = new Set();
        
        arr.forEach(item => {
            if (seen.has(item)) {
                duplicates.add(item);
            } else {
                seen.add(item);
            }
        });
        
        return Array.from(duplicates);
    }

    /**
     * 获取验证结果摘要
     * @returns {string} 验证结果摘要
     */
    getSummary() {
        const total = this.errors.length + this.warnings.length;
        if (total === 0) {
            return '✓ 数据验证通过，无错误或警告';
        }
        
        let summary = '';
        if (this.errors.length > 0) {
            summary += `✗ ${this.errors.length} 个错误\n`;
        }
        if (this.warnings.length > 0) {
            summary += `⚠ ${this.warnings.length} 个警告\n`;
        }
        return summary;
    }
}

// ============== 可视化层 ==============

/**
 * GraphRenderer 类 (任务 4.1, 4.2)
 * 职责：使用 Vis.js 渲染关系图
 * 功能：
 * - 渲染关系图
 * - 配置节点和边的样式
 * - 配置力导向布局物理引擎
 * - 处理节点点击事件
 * _Requirements: 3.1, 3.4, 3.5, 2.5, 10.3_
 */
class GraphRenderer {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.network = null;
        this.currentPerson = null;
        this.currentPeriod = null;
        
        // Vis.js 配置选项
        this.options = {
            nodes: {
                shape: 'dot',
                size: 25,
                font: {
                    size: 14,
                    face: 'Microsoft YaHei, SimHei, sans-serif',
                    color: '#333',
                    strokeWidth: 3,
                    strokeColor: '#ffffff'
                },
                borderWidth: 2,
                borderWidthSelected: 4,
                shadow: {
                    enabled: true,
                    color: 'rgba(0,0,0,0.2)',
                    size: 5,
                    x: 0,
                    y: 0
                }
            },
            edges: {
                width: 2,
                font: {
                    size: 12,
                    face: 'Microsoft YaHei, SimHei, sans-serif',
                    align: 'middle',
                    strokeWidth: 3,
                    strokeColor: '#ffffff'
                },
                arrows: {
                    to: { enabled: false }
                },
                smooth: {
                    type: 'continuous',
                    roundness: 0.5
                },
                shadow: {
                    enabled: false
                }
            },
            physics: {
                enabled: true,
                forceAtlas2Based: {
                    gravitationalConstant: -50,
                    centralGravity: 0.015,
                    springLength: 150,
                    springConstant: 0.08,
                    damping: 0.4,
                    avoidOverlap: 0.5
                },
                maxVelocity: 50,
                solver: 'forceAtlas2Based',
                timestep: 0.35,
                stabilization: {
                    enabled: true,
                    iterations: 100,   // 任务 11.2: 减少迭代次数加速首屏
                    updateInterval: 50  // 减少更新频率以降低 CPU 占用
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                zoomView: true,
                dragView: true,
                navigationButtons: true,
                keyboard: {
                    enabled: true,
                    bindToWindow: false
                }
            },
            layout: {
                improvedLayout: true,
                hierarchical: false
            }
        };
    }

    /**
     * 渲染关系图
     * @param {Object} graphData - 图数据 { nodes, edges }
     * @param {string} centerPerson - 中心人物姓名
     * @param {string} periodId - 时间段 ID
     */
    render(graphData, centerPerson, periodId) {
        console.log(`[GraphRenderer] 渲染关系图: ${centerPerson} @ ${periodId}`);
        console.log(`[GraphRenderer] 节点: ${graphData.nodes.length}, 边: ${graphData.edges.length}`);
        
        this.currentPerson = centerPerson;
        this.currentPeriod = periodId;

        // 销毁旧的网络实例
        if (this.network) {
            this.network.destroy();
            this.network = null;
        }

        try {
            // 创建数据集
            const nodes = new vis.DataSet(graphData.nodes);
            const edges = new vis.DataSet(graphData.edges);

            const data = { nodes, edges };

            // 创建网络
            this.network = new vis.Network(this.container, data, this.options);

            // 绑定事件
            this.bindEvents();

            // 监听稳定化完成事件
            this.network.once('stabilizationIterationsDone', () => {
                console.log('[GraphRenderer] 布局稳定完成');
                // 停止物理模拟以提升性能
                this.network.setOptions({ physics: { enabled: false } });
                
                // 聚焦中心节点
                this.network.focus(centerPerson, {
                    scale: 1.0,
                    animation: {
                        duration: 500,
                        easingFunction: 'easeInOutQuad'
                    }
                });
            });

            console.log('[GraphRenderer] 关系图渲染完成');

        } catch (error) {
            console.error('[GraphRenderer] 渲染失败:', error);
            this.showError('关系图渲染失败: ' + error.message);
        }
    }

    /**
     * 绑定事件处理器
     */
    bindEvents() {
        // 节点点击事件
        this.network.on('click', (params) => {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                this.onNodeClick(nodeId);
            }
        });

        // 节点双击事件
        this.network.on('doubleClick', (params) => {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                console.log(`[GraphRenderer] 双击节点: ${nodeId}`);
                // 可以在这里实现快捷切换功能
            }
        });

        // 节点悬停事件
        this.network.on('hoverNode', (params) => {
            const nodeId = params.node;
            console.log(`[GraphRenderer] 悬停节点: ${nodeId}`);
            // 修改鼠标样式
            this.container.style.cursor = 'pointer';
        });

        this.network.on('blurNode', () => {
            this.container.style.cursor = 'default';
        });

        // 缩放事件
        this.network.on('zoom', (params) => {
            console.log(`[GraphRenderer] 缩放: ${params.scale.toFixed(2)}`);
        });
    }

    /**
     * 节点点击处理器
     * @param {string} nodeId - 节点 ID（人物姓名）
     */
    onNodeClick(nodeId) {
        console.log(`[GraphRenderer] 点击节点: ${nodeId}`);
        
        // 触发自定义事件，供应用层处理
        const event = new CustomEvent('personSelected', {
            detail: {
                personId: nodeId,
                periodId: this.currentPeriod,
                previousPerson: this.currentPerson
            }
        });
        document.dispatchEvent(event);
    }

    /**
     * 高亮节点
     * @param {string} nodeId - 节点 ID
     */
    highlightNode(nodeId) {
        if (!this.network) return;
        
        this.network.selectNodes([nodeId]);
        this.network.focus(nodeId, {
            scale: 1.2,
            animation: {
                duration: 300,
                easingFunction: 'easeInOutQuad'
            }
        });
    }

    /**
     * 重新启用物理模拟
     */
    enablePhysics() {
        if (!this.network) return;
        this.network.setOptions({ physics: { enabled: true } });
        console.log('[GraphRenderer] 物理模拟已启用');
    }

    /**
     * 禁用物理模拟
     */
    disablePhysics() {
        if (!this.network) return;
        this.network.setOptions({ physics: { enabled: false } });
        console.log('[GraphRenderer] 物理模拟已禁用');
    }

    /**
     * 适应窗口大小
     */
    fit() {
        if (!this.network) return;
        this.network.fit({
            animation: {
                duration: 500,
                easingFunction: 'easeInOutQuad'
            }
        });
    }

    /**
     * 显示错误消息
     * @param {string} message - 错误消息
     */
    showError(message) {
        this.container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #dc3545;">
                <div style="text-align: center;">
                    <h3>❌ 渲染错误</h3>
                    <p>${message}</p>
                </div>
            </div>
        `;
    }

    /**
     * 销毁网络实例
     */
    destroy() {
        if (this.network) {
            this.network.destroy();
            this.network = null;
            console.log('[GraphRenderer] 网络实例已销毁');
        }
    }

    /**
     * 获取当前网络统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        if (!this.network) return null;
        
        return {
            nodes: this.network.body.nodes.length,
            edges: this.network.body.edges.length,
            scale: this.network.getScale(),
            position: this.network.getViewPosition()
        };
    }
}

// ============== 控制器层 ==============

/**
 * TimelineController 类 (任务 5.1)
 * 职责：管理时间轴导航和时期切换
 * 功能：
 * - 选择时间段
 * - 获取时期数据
 * - 实现时期切换时的数据加载逻辑
 * _Requirements: 1.2, 1.4, 1.5_
 */
class TimelineController {
    constructor(data) {
        this.data = data;
        this.currentPeriodId = null;
        this.periods = [];
        this.onPeriodChangeCallback = null;
    }

    /**
     * 初始化时间轴控制器
     */
    init() {
        // 按 order 排序 periods
        this.periods = [...this.data.periods].sort((a, b) => a.order - b.order);
        
        console.log('[TimelineController] 初始化完成，共', this.periods.length, '个时期');
        
        // 默认选择第一个时期 (需求 1.5)
        if (this.periods.length > 0) {
            const firstPeriod = this.periods[0];
            console.log('[TimelineController] 默认选择第一个时期:', firstPeriod.name);
        }
    }

    /**
     * 选择时间段 (任务 5.1)
     * @param {string} periodId - 时间段 ID
     * @returns {boolean} 是否选择成功
     */
    selectPeriod(periodId) {
        console.log(`[TimelineController] 选择时期: ${periodId}`);
        
        const period = this.periods.find(p => p.id === periodId);
        if (!period) {
            console.error(`[TimelineController] 时期不存在: ${periodId}`);
            return false;
        }

        // 更新当前时期
        const previousPeriod = this.currentPeriodId;
        this.currentPeriodId = periodId;

        console.log(`[TimelineController] 切换时期: ${previousPeriod} -> ${periodId}`);
        console.log(`[TimelineController] 时期信息:`, {
            name: period.name,
            participated: period.participated,
            roster: period.roster.length + ' 人'
        });

        // 触发回调
        if (this.onPeriodChangeCallback) {
            this.onPeriodChangeCallback(periodId, period);
        }

        return true;
    }

    /**
     * 获取时期数据 (任务 5.1)
     * @param {string} periodId - 时间段 ID
     * @returns {Object|null} 时期数据对象
     */
    getPeriodData(periodId) {
        const period = this.periods.find(p => p.id === periodId);
        if (!period) {
            console.warn(`[TimelineController] 时期不存在: ${periodId}`);
            return null;
        }

        // 获取该时期的所有关系
        const relationships = this.data.relationships.filter(rel => rel.period === periodId);

        return {
            ...period,
            relationships: relationships,
            relationshipCount: relationships.length
        };
    }

    /**
     * 获取所有时期
     * @returns {Array<Object>} 时期列表
     */
    getAllPeriods() {
        return this.periods;
    }

    /**
     * 获取当前选中的时期 ID
     * @returns {string|null} 当前时期 ID
     */
    getCurrentPeriodId() {
        return this.currentPeriodId;
    }

    /**
     * 设置时期切换回调
     * @param {Function} callback - 回调函数 (periodId, periodData) => void
     */
    onPeriodChange(callback) {
        this.onPeriodChangeCallback = callback;
    }

    /**
     * 检查 owner 是否参与了某个时期
     * @param {string} periodId - 时间段 ID
     * @returns {boolean} 是否参与
     */
    isOwnerParticipated(periodId) {
        const period = this.periods.find(p => p.id === periodId);
        return period ? period.participated : false;
    }
}

/**
 * TimelineSelector UI 组件 (任务 5.2)
 * 职责：渲染时间轴选择器 UI
 * 功能：
 * - 渲染时间轴选择器按钮
 * - 高亮当前选中时期
 * - 标识王乐江未参与的时期（初中二班、23年高中复读班20班）
 * - 实现按钮点击触发时期切换
 * _Requirements: 1.2, 1.4, 1.5_
 */
class TimelineSelector {
    constructor(containerId, timelineController) {
        this.container = document.getElementById(containerId);
        this.timelineController = timelineController;
        this.currentPeriodId = null;
        
        if (!this.container) {
            throw new Error(`TimelineSelector: 容器 #${containerId} 不存在`);
        }
    }

    /**
     * 渲染时间轴选择器 (任务 5.2)
     */
    render() {
        console.log('[TimelineSelector] 渲染时间轴选择器');
        
        const periods = this.timelineController.getAllPeriods();
        
        // 清空容器
        this.container.innerHTML = '';
        
        // 创建时间轴容器
        const timeline = document.createElement('div');
        timeline.className = 'timeline';
        
        periods.forEach((period, index) => {
            const item = this.createTimelineItem(period, index);
            timeline.appendChild(item);
        });
        
        this.container.appendChild(timeline);
        
        console.log('[TimelineSelector] 渲染完成，共', periods.length, '个时期');
    }

    /**
     * 创建单个时间轴项
     * @param {Object} period - 时期数据
     * @param {number} index - 索引
     * @returns {HTMLElement} 时间轴项元素
     */
    createTimelineItem(period, index) {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        
        // 标识未参与的时期 (任务 5.2 - 需求 1.4)
        if (!period.participated) {
            item.classList.add('not-participated');
            item.title = `王乐江未参与此时期`;
        }
        
        // 创建按钮
        const button = document.createElement('button');
        button.dataset.periodId = period.id;
        button.textContent = period.name;
        
        // 添加未参与标识
        if (!period.participated) {
            const badge = document.createElement('span');
            badge.className = 'not-participated-badge';
            badge.textContent = '未参与';
            button.appendChild(badge);
        }
        
        // 绑定点击事件 (任务 5.2)
        button.addEventListener('click', () => {
            this.onPeriodButtonClick(period.id);
        });
        
        item.appendChild(button);
        
        return item;
    }

    /**
     * 时期按钮点击处理器 (任务 5.2)
     * @param {string} periodId - 时期 ID
     */
    onPeriodButtonClick(periodId) {
        console.log('[TimelineSelector] 点击时期按钮:', periodId);
        
        // 触发时期切换
        const success = this.timelineController.selectPeriod(periodId);
        
        if (success) {
            // 更新高亮 (任务 5.2)
            this.highlightPeriod(periodId);
            
            // 显示提示
            const periodData = this.timelineController.getPeriodData(periodId);
            if (periodData) {
                showToast(`切换到 ${periodData.name}`, 'info');
            }
        }
    }

    /**
     * 高亮当前选中时期 (任务 5.2)
     * @param {string} periodId - 时期 ID
     */
    highlightPeriod(periodId) {
        this.currentPeriodId = periodId;
        
        // 移除所有按钮的 active 类
        const buttons = this.container.querySelectorAll('button');
        buttons.forEach(btn => {
            if (btn.dataset.periodId === periodId) {
                btn.classList.add('active');
                console.log('[TimelineSelector] 高亮时期:', periodId);
            } else {
                btn.classList.remove('active');
            }
        });
    }

    /**
     * 选择并高亮时期
     * @param {string} periodId - 时期 ID
     */
    selectPeriod(periodId) {
        this.onPeriodButtonClick(periodId);
    }
}

/**
 * App 类 (任务 5.3)
 * 职责：整合所有组件，管理应用生命周期
 * 功能：
 * - 整合 DataLoader, DataValidator, RelationshipCalculator, GraphRenderer, TimelineController
 * - 连接 TimelineSelector 和 GraphRenderer
 * - 实现选择时期后自动更新关系图
 * - 默认显示第一个时期（小学）
 * _Requirements: 1.2, 1.5, 10.2_
 */
class App {
    constructor() {
        // 数据层
        this.dataLoader = null;
        this.dataValidator = null;
        this.relationshipCalculator = null;
        this.data = null;
        
        // 控制器层
        this.timelineController = null;
        this.dataManager = null; // 任务 8.2
        
        // 认证层
        this.authManager = null;
        this.authView = null;
        
        // 视图层
        this.graphRenderer = null;
        this.timelineSelector = null;
        this.editPanel = null; // 任务 8.2
        
        // 当前状态
        this.currentPerson = null;
        this.currentPeriod = null;
    }

    /**
     * 初始化应用 (任务 5.3)
     */
    async init() {
        console.log('[App] 开始初始化应用...');
        
        try {
            // 1. 加载数据
            await this.loadData();
            
            // 2. 验证数据
            this.validateData();
            
            // 3. 初始化各个组件
            this.initComponents();
            
            // 4. 渲染 UI
            this.renderUI();
            
            // 5. 绑定事件
            this.bindEvents();
            
            // 6. 默认显示第一个时期 (需求 1.5, 10.2)
            this.showDefaultPeriod();
            
            console.log('[App] 应用初始化完成！');
            
        } catch (error) {
            console.error('[App] 初始化失败:', error);
            throw error;
        }
    }

    /**
     * 加载数据
     */
    async loadData() {
        console.log('[App] 加载数据...');
        
        this.dataLoader = new DataLoader('./data.json');
        this.data = await this.dataLoader.loadData();
        
        console.log('[App] 数据加载完成:', {
            owner: this.data.owner,
            periods: this.data.periods.length,
            relationships: this.data.relationships.length
        });
    }

    /**
     * 验证数据
     */
    validateData() {
        console.log('[App] 验证数据...');
        
        this.dataValidator = new DataValidator();
        const result = this.dataValidator.validate(this.data);
        
        if (!result.valid) {
            console.error('[App] 数据验证失败:', result.errors);
            throw new Error('数据验证失败: ' + result.errors.join(', '));
        }
        
        if (result.warnings.length > 0) {
            console.warn('[App] 数据验证警告:', result.warnings);
        }
        
        console.log('[App] 数据验证通过');
    }

    /**
     * 初始化各个组件 (任务 5.3)
     */
    initComponents() {
        console.log('[App] 初始化组件...');
        
        // 数据层组件
        this.relationshipCalculator = new RelationshipCalculator(this.data);
        
        // 认证层组件 (任务 7.2)
        this.authManager = new AuthManager();
        const isOwner = this.authManager.loadAuthState(); // 从 sessionStorage 恢复认证状态
        
        // 控制器层组件
        this.timelineController = new TimelineController(this.data);
        this.timelineController.init();
        
        // 数据管理器 (任务 8.1 - 需求 4.3, 5.3)
        // 复用已加载的数据，避免重复请求
        this.dataManager = new DataManager(this.dataLoader, this.authManager);
        this.dataManager.data = this.data;
        
        // 视图层组件
        this.graphRenderer = new GraphRenderer('graphContainer');
        this.timelineSelector = new TimelineSelector('timelineSelector', this.timelineController);
        this.authView = new AuthView('authContainer', this.authManager); // 任务 7.2
        
        // 编辑面板 (任务 8.2 - 需求 4.3, 4.4)
        this.editPanel = new EditPanel('editPanelContent', this.dataManager, this.timelineController);
        
        // 任务 7.3: 页面加载时自动恢复认证状态并更新UI
        // 调用 onAuthChanged 来确保编辑面板的可见性与恢复的认证状态一致
        this.onAuthChanged(isOwner);
        
        console.log('[App] 组件初始化完成');
    }

    /**
     * 渲染 UI
     */
    renderUI() {
        console.log('[App] 渲染 UI...');
        
        // 渲染时间轴选择器
        this.timelineSelector.render();
        
        // 渲染认证界面 (任务 7.2)
        this.authView.render();
        
        // 渲染图例
        this.renderLegend();
        
        console.log('[App] UI 渲染完成');
    }

    /**
     * 绑定事件 (任务 5.3)
     */
    bindEvents() {
        console.log('[App] 绑定事件...');
        
        // 时期切换事件 (任务 5.3 - 连接 TimelineSelector 和 GraphRenderer)
        this.timelineController.onPeriodChange((periodId, periodData) => {
            console.log('[App] 时期切换事件:', periodId);
            this.onPeriodChanged(periodId, periodData);
        });
        
        // 人物选择事件 (需求 3.6)
        document.addEventListener('personSelected', (event) => {
            const { personId, periodId } = event.detail;
            console.log('[App] 人物选择事件:', personId, '@', periodId);
            // GA4 事件追踪：点击节点
            if (typeof gtag === 'function') {
                const periodData = this.timelineController.getPeriodData(periodId);
                gtag('event', 'select_node', {
                    person_name: personId,
                    period_name: periodData ? periodData.name : periodId
                });
            }
            this.showPersonGraph(personId, periodId);
        });
        
        // 认证状态变更事件 (任务 7.2)
        document.addEventListener('authChanged', (event) => {
            const { isOwner } = event.detail;
            console.log('[App] 认证状态变更:', isOwner ? 'Owner' : 'Visitor');
            this.onAuthChanged(isOwner);
        });
        
        // 数据变更事件 (任务 8.2 - 编辑后刷新关系图)
        // DataManager.saveData() 和 EditPanel 各 handler 都会触发此事件
        document.addEventListener('dataChanged', (event) => {
            console.log('[App] 数据变更事件:', event.detail?.action || 'save');
            this.onDataChanged();
        });
        
        // 任务 9.2: 关系筛选器事件
        this.bindFilterEvents();
        
        // 任务 11.3: 窗口 resize 节流（避免 Vis.js 频繁重布局）
        this.bindResizeThrottle();
        
        console.log('[App] 事件绑定完成');
    }
    
    /**
     * 窗口 resize 节流 (任务 11.3 - 需求 10.3)
     * 使用节流（每 200ms 最多触发一次）防止 resize 风暴
     */
    bindResizeThrottle() {
        let lastTime = 0;
        const throttleDelay = 200;
        
        window.addEventListener('resize', () => {
            const now = Date.now();
            if (now - lastTime < throttleDelay) return;
            lastTime = now;
            
            // 通知 Vis.js 重新计算尺寸
            if (this.graphRenderer && this.graphRenderer.network) {
                console.log('[App] resize: 刷新 Vis.js 布局');
                this.graphRenderer.network.redraw();
                if (this.currentPerson && this.currentPeriod) {
                    this.graphRenderer.network.focus(this.currentPerson, {
                        scale: 1.0,
                        animation: false
                    });
                }
            }
        });
    }
    
    /**
     * 绑定筛选器事件 (任务 9.2 - 需求 8.4)
     */
    bindFilterEvents() {
        const filterPanel = document.getElementById('filterPanel');
        if (!filterPanel) return;
        
        // 范围筛选按钮
        const scopeBtns = filterPanel.querySelectorAll('[data-scope]');
        scopeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                scopeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const scope = btn.getAttribute('data-scope');
                this.relationshipCalculator.setFilters({ scope });
                this.refreshCurrentGraph();
            });
        });
        
        // 类型筛选复选框
        const typeChecks = filterPanel.querySelectorAll('[data-type]');
        typeChecks.forEach(check => {
            check.addEventListener('change', () => {
                const type = check.getAttribute('data-type');
                this.relationshipCalculator.setFilters({
                    types: { [type]: check.checked }
                });
                this.refreshCurrentGraph();
            });
        });

        // 搜索栏：搜索当前时期的同学并切换中心人物
        const searchInput = document.getElementById('personSearch');
        const searchBtn = document.getElementById('personSearchBtn');
        if (searchInput && searchBtn) {
            const doSearch = () => {
                const query = searchInput.value.trim();
                if (!query) {
                    showToast('请输入要搜索的名字', 'info');
                    return;
                }
                if (!this.currentPeriod) {
                    showToast('请先选择一个时期', 'error');
                    return;
                }
                const periodData = this.timelineController.getPeriodData(this.currentPeriod);
                if (!periodData) {
                    showToast('当前时期数据不存在', 'error');
                    return;
                }
                // 在当前时期 roster 中搜索（支持部分匹配）
                const matched = periodData.roster.filter(name =>
                    name.includes(query)
                );

                // GA4 事件追踪：搜索人物
                if (typeof gtag === 'function') {
                    gtag('event', 'search_person', {
                        search_term: query,
                        period_name: periodData.name,
                        result_count: matched.length,
                        matched: matched.length > 0
                    });
                }

                if (matched.length === 0) {
                    showToast(`当前时期（${periodData.name}）没有找到"${query}"`, 'error');
                    return;
                }
                if (matched.length === 1) {
                    // 唯一匹配：直接切换中心
                    showToast(`✓ 已切换到 ${matched[0]}`, 'success');
                    this.showPersonGraph(matched[0], this.currentPeriod);
                    searchInput.value = '';
                } else {
                    // 多个匹配：切换到第一个并提示
                    showToast(`找到 ${matched.length} 人，已切换到 ${matched[0]}（可继续搜索更精确的名字）`, 'info');
                    this.showPersonGraph(matched[0], this.currentPeriod);
                }
            };
            searchBtn.addEventListener('click', doSearch);
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSearch();
            });
        }
    }
    
    /**
     * 刷新当前关系图 (任务 9.2)
     */
    refreshCurrentGraph() {
        if (this.currentPerson && this.currentPeriod) {
            console.log('[App] 筛选后刷新关系图');
            this.showPersonGraph(this.currentPerson, this.currentPeriod);
        }
    }
    
    /**
     * 数据变更处理器 (任务 8.2)
     * Owner 编辑数据后，重新计算关系并刷新当前关系图
     */
    onDataChanged() {
        // 重新构建关系计算器以反映最新数据
        this.relationshipCalculator = new RelationshipCalculator(this.data);
        
        // 刷新当前正在显示的关系图
        if (this.currentPerson && this.currentPeriod) {
            console.log('[App] 刷新关系图:', this.currentPerson, '@', this.currentPeriod);
            this.showPersonGraph(this.currentPerson, this.currentPeriod);
        }
    }

    /**
     * 时期切换处理器 (任务 5.3)
     * @param {string} periodId - 时期 ID
     * @param {Object} periodData - 时期数据
     */
    onPeriodChanged(periodId, periodData) {
        console.log('[App] 处理时期切换:', periodId);

        this.currentPeriod = periodId;

        // GA4 事件追踪：切换时期
        if (typeof gtag === 'function') {
            gtag('event', 'switch_period', {
                period_id: periodId,
                period_name: periodData.name
            });
        }

        // 更新图表标题
        const graphTitle = document.getElementById('graphTitle');
        if (graphTitle) {
            graphTitle.textContent = `${periodData.name} - ${this.data.owner}`;
        }
        
        // 自动更新关系图 (任务 5.3 - 需求 1.5, 10.2)
        // 默认显示 owner 的关系网
        const owner = this.data.owner;
        
        // 检查 owner 是否在这个时期
        if (periodData.roster.includes(owner)) {
            this.showPersonGraph(owner, periodId);
        } else {
            // 如果 owner 不在此时期，显示提示信息
            console.log('[App] Owner 未参与此时期:', periodId);
            this.showNotParticipatedMessage(periodData);
        }
    }

    /**
     * 认证状态变更处理器 (任务 7.2, 8.2)
     * @param {boolean} isOwner - 是否为 Owner 模式
     */
    onAuthChanged(isOwner) {
        console.log('[App] 处理认证状态变更:', isOwner ? 'Owner' : 'Visitor');
        
        // 显示/隐藏编辑面板 (需求 4.4: Visitor 模式下隐藏编辑功能)
        const editPanel = document.getElementById('editPanel');
        if (editPanel) {
            if (isOwner) {
                editPanel.style.display = 'block';
                console.log('[App] 显示编辑面板');
                
                // 渲染编辑面板内容 (任务 8.2)
                if (this.editPanel) {
                    this.editPanel.render();
                }
            } else {
                editPanel.style.display = 'none';
                console.log('[App] 隐藏编辑面板');
            }
        }
    }

    /**
     * 显示人物关系图 (需求 3.1)
     * @param {string} personId - 人物姓名
     * @param {string} periodId - 时期 ID
     */
    showPersonGraph(personId, periodId) {
        console.log('[App] 显示人物关系图:', personId, '@', periodId);
        
        this.currentPerson = personId;
        this.currentPeriod = periodId;
        
        // 构建图数据
        const graphData = this.relationshipCalculator.buildGraphData(personId, periodId);
        
        // 渲染关系图
        this.graphRenderer.render(graphData, personId, periodId);
        
        // 更新标题 - 跨班中心人物显示其实际所在班级名称
        const homePeriodId = this.relationshipCalculator.getHomePeriodId(personId, periodId);
        const homePeriodData = homePeriodId ? (this.timelineController.getPeriodData(homePeriodId) || periodData) : periodData;
        const graphTitle = document.getElementById('graphTitle');
        if (graphTitle && homePeriodData) {
            graphTitle.textContent = `${homePeriodData.name} - ${personId}`;
        }
        
        console.log('[App] 关系图显示完成');
    }

    /**
     * 显示默认时期 (任务 5.3 - 需求 1.5, 10.2)
     */
    showDefaultPeriod() {
        console.log('[App] 显示默认时期（第一个时期）');
        
        const periods = this.timelineController.getAllPeriods();
        if (periods.length > 0) {
            const firstPeriod = periods[0];
            console.log('[App] 选择第一个时期:', firstPeriod.name);
            
            // 选择第一个时期
            this.timelineSelector.selectPeriod(firstPeriod.id);
        } else {
            console.error('[App] 没有可用的时期');
            showToast('没有可用的时期数据', 'error');
        }
    }

    /**
     * 显示未参与提示信息
     * @param {Object} periodData - 时期数据
     */
    showNotParticipatedMessage(periodData) {
        const graphContainer = document.getElementById('graphContainer');
        if (!graphContainer) return;
        
        graphContainer.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">
                <div style="text-align: center; max-width: 500px;">
                    <h3 style="color: #999; margin-bottom: 20px;">📋 ${periodData.name}</h3>
                    <p style="font-size: 16px; line-height: 1.6;">
                        ${this.data.owner} 未参与此时期
                    </p>
                    <p style="font-size: 14px; color: #999; margin-top: 10px;">
                        该时期共有 ${periodData.roster.length} 人，${periodData.relationshipCount} 段关系
                    </p>
                    <p style="font-size: 14px; color: #999; margin-top: 20px;">
                        点击其他时期查看关系网络
                    </p>
                </div>
            </div>
        `;
    }

    /**
     * 渲染图例
     */
    renderLegend() {
        const legendContainer = document.getElementById('legend');
        if (!legendContainer) return;
        
        const legendItems = [
            { type: 'center', label: '中心人物', color: '#FFD700', border: '#FFA500' },
            { type: 'friend', label: '朋友', color: '#00FF7F', border: '#00C957' },
            { type: 'crush', label: '暗恋 (虚线)', color: '#FF69B4', border: '#FF1493' },
            { type: 'lover', label: '恋人', color: '#FF0000', border: '#CC0000' },
            { type: 'roommate', label: '舍友', color: '#9370DB', border: '#7B68EE' },
            { type: 'classmate', label: '同学', color: '#87CEEB', border: '#4682B4' },
            { type: 'cross-class', label: '跨班人物 (橙虚边框)', color: '#FFFFFF', border: '#FF8C00', dashed: true }
        ];
        
        legendContainer.innerHTML = legendItems.map(item => {
            const borderStyle = item.dashed ? '2px dashed ' + item.border : '2px solid ' + (item.border || '#ddd');
            return `
                <div class="legend-item" title="${item.label}">
                    <span class="legend-color" style="background-color: ${item.color}; border: ${borderStyle};"></span>
                    <span class="legend-label">${item.label}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * 重新加载数据
     */
    async reload() {
        console.log('[App] 重新加载数据...');
        
        try {
            // 清除缓存并重新加载
            this.dataLoader.clearCache();
            this.data = await this.dataLoader.loadData();
            
            // 重新验证
            this.validateData();
            
            // 重新初始化组件
            this.relationshipCalculator = new RelationshipCalculator(this.data);
            this.timelineController = new TimelineController(this.data);
            this.timelineController.init();
            
            // 重新渲染
            this.renderUI();
            this.bindEvents();
            this.showDefaultPeriod();
            
            showToast('数据重新加载成功', 'success');
            console.log('[App] 重新加载完成');
            
        } catch (error) {
            console.error('[App] 重新加载失败:', error);
            showToast('重新加载失败: ' + error.message, 'error');
        }
    }

    /**
     * 获取应用统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        return {
            periods: this.data.periods.length,
            relationships: this.data.relationships.length,
            currentPeriod: this.currentPeriod,
            currentPerson: this.currentPerson,
            owner: this.data.owner
        };
    }
}

// ============== 认证层 ==============

/**
 * AuthManager 类 (任务 7.1)
 * 职责：管理用户认证和权限控制
 * 功能：
 * - 密码哈希计算（SHA-256）
 * - 密码验证
 * - 认证状态管理（sessionStorage）
 * - Owner 模式检查
 * _Requirements: 4.1, 4.2, 4.5_
 */
class AuthManager {
    constructor() {
        this.isOwner = false;
        // Owner 密码的 SHA-256 哈希值 (实际密码: "password")
        // 生产环境中，这个哈希值应该是强密码的哈希
        this.passwordHash = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
    }

    /**
     * 计算 SHA-256 哈希值 (任务 7.1)
     * @param {string} message - 待哈希的字符串
     * @returns {Promise<string>} 十六进制哈希值
     */
    async sha256(message) {
        try {
            // 将字符串编码为 UTF-8 字节数组
            const msgBuffer = new TextEncoder().encode(message);
            
            // 使用 Web Crypto API 计算 SHA-256 哈希
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            
            // 将哈希结果转换为字节数组
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            
            // 将字节数组转换为十六进制字符串
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            return hashHex;
        } catch (error) {
            console.error('[AuthManager] SHA-256 计算失败:', error);
            throw new Error('密码哈希计算失败');
        }
    }

    /**
     * 验证密码 (任务 7.1)
     * @param {string} password - 用户输入的密码
     * @returns {Promise<boolean>} 是否验证成功
     */
    async authenticate(password) {
        console.log('[AuthManager] 开始验证密码...');
        
        try {
            // 计算输入密码的哈希值
            const hash = await this.sha256(password);
            
            // 比较哈希值
            const isValid = (hash === this.passwordHash);
            
            // 更新认证状态
            this.isOwner = isValid;
            
            // 保存认证状态到 sessionStorage
            this.saveAuthState();
            
            if (isValid) {
                console.log('[AuthManager] ✓ 密码验证成功，进入 Owner 模式');
            } else {
                console.log('[AuthManager] ✗ 密码验证失败');
            }
            
            return isValid;
            
        } catch (error) {
            console.error('[AuthManager] 认证失败:', error);
            this.isOwner = false;
            return false;
        }
    }

    /**
     * 保存认证状态到 sessionStorage (任务 7.1)
     */
    saveAuthState() {
        if (this.isOwner) {
            sessionStorage.setItem('authMode', 'owner');
            console.log('[AuthManager] 认证状态已保存到 sessionStorage');
        } else {
            sessionStorage.removeItem('authMode');
            console.log('[AuthManager] 认证状态已从 sessionStorage 移除');
        }
    }

    /**
     * 从 sessionStorage 加载认证状态 (任务 7.1)
     * @returns {boolean} 是否为 Owner 模式
     */
    loadAuthState() {
        const authMode = sessionStorage.getItem('authMode');
        this.isOwner = (authMode === 'owner');
        
        if (this.isOwner) {
            console.log('[AuthManager] 从 sessionStorage 加载认证状态: Owner 模式');
        } else {
            console.log('[AuthManager] 从 sessionStorage 加载认证状态: Visitor 模式');
        }
        
        return this.isOwner;
    }

    /**
     * 检查当前是否为 Owner 模式 (任务 7.1)
     * @returns {boolean} 是否为 Owner 模式
     */
    checkOwnerMode() {
        return this.isOwner;
    }

    /**
     * 登出，清除认证状态
     */
    logout() {
        console.log('[AuthManager] 用户登出');
        this.isOwner = false;
        sessionStorage.removeItem('authMode');
    }

    /**
     * 获取当前认证状态信息
     * @returns {Object} 认证状态信息
     */
    getAuthStatus() {
        return {
            isOwner: this.isOwner,
            mode: this.isOwner ? 'owner' : 'visitor',
            timestamp: Date.now()
        };
    }
}

/**
 * AuthView 类 (任务 7.2)
 * 职责：渲染认证界面和管理登录交互
 * 功能：
 * - 创建密码输入表单
 * - 创建登录/退出按钮
 * - 显示当前模式（Owner/Visitor）
 * - 实现登录失败提示
 * _Requirements: 4.1, 4.2, 4.5_
 */
class AuthView {
    constructor(containerId, authManager) {
        this.container = document.getElementById(containerId);
        this.authManager = authManager;
        
        if (!this.container) {
            throw new Error(`AuthView: 容器 #${containerId} 不存在`);
        }
    }

    /**
     * 渲染认证界面 (任务 7.2)
     */
    render() {
        console.log('[AuthView] 渲染认证界面');
        
        // 检查当前认证状态
        const isOwner = this.authManager.checkOwnerMode();
        
        if (isOwner) {
            this.renderOwnerMode();
        } else {
            this.renderVisitorMode();
        }
    }

    /**
     * 渲染 Visitor 模式界面 (任务 7.2)
     */
    renderVisitorMode() {
        this.container.innerHTML = `
            <div class="auth-view visitor-mode">
                <span class="mode-label">模式: <strong>Visitor</strong></span>
                <button id="loginButton" class="btn btn-primary" title="Owner 登录">
                    登录
                </button>
            </div>
        `;
        
        // 绑定登录按钮事件
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.addEventListener('click', () => {
                this.showLoginDialog();
            });
        }
        
        console.log('[AuthView] Visitor 模式界面已渲染');
    }

    /**
     * 渲染 Owner 模式界面 (任务 7.2)
     */
    renderOwnerMode() {
        this.container.innerHTML = `
            <div class="auth-view owner-mode">
                <span class="mode-label">模式: <strong style="color: #FFD700;">Owner</strong></span>
                <button id="logoutButton" class="btn btn-secondary" title="退出 Owner 模式">
                    退出
                </button>
            </div>
        `;
        
        // 绑定退出按钮事件
        const logoutButton = document.getElementById('logoutButton');
        if (logoutButton) {
            logoutButton.addEventListener('click', () => {
                this.handleLogout();
            });
        }

        console.log('[AuthView] Owner 模式界面已渲染');
    }

    /**
     * 显示登录对话框 (任务 7.2)
     */
    showLoginDialog() {
        console.log('[AuthView] 显示登录对话框');
        
        // 创建模态对话框
        const dialog = document.createElement('div');
        dialog.className = 'auth-dialog-overlay';
        dialog.innerHTML = `
            <div class="auth-dialog">
                <div class="auth-dialog-header">
                    <h3>Owner 登录</h3>
                    <button class="close-button" id="closeDialog" title="关闭">&times;</button>
                </div>
                <div class="auth-dialog-body">
                    <form id="loginForm">
                        <div class="form-group">
                            <label for="passwordInput">密码:</label>
                            <input 
                                type="password" 
                                id="passwordInput" 
                                placeholder="请输入 Owner 密码"
                                required
                                autocomplete="current-password"
                            />
                        </div>
                        <div class="auth-dialog-error" id="loginError" style="display: none;"></div>
                        <div class="auth-dialog-actions">
                            <button type="submit" class="btn btn-primary">
                                登录
                            </button>
                            <button type="button" class="btn btn-secondary" id="cancelButton">
                                取消
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // 绑定事件
        const loginForm = document.getElementById('loginForm');
        const closeButton = document.getElementById('closeDialog');
        const cancelButton = document.getElementById('cancelButton');
        const passwordInput = document.getElementById('passwordInput');
        
        // 自动聚焦密码输入框
        if (passwordInput) {
            passwordInput.focus();
        }
        
        // 表单提交
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleLogin(passwordInput.value, dialog);
            });
        }
        
        // 关闭对话框
        const closeDialog = () => {
            document.body.removeChild(dialog);
        };
        
        if (closeButton) {
            closeButton.addEventListener('click', closeDialog);
        }
        
        if (cancelButton) {
            cancelButton.addEventListener('click', closeDialog);
        }
        
        // 点击背景关闭
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                closeDialog();
            }
        });
    }

    /**
     * 处理登录 (任务 7.2)
     * @param {string} password - 用户输入的密码
     * @param {HTMLElement} dialog - 对话框元素
     */
    async handleLogin(password, dialog) {
        console.log('[AuthView] 处理登录请求');
        
        const loginError = document.getElementById('loginError');
        const submitButton = dialog.querySelector('button[type="submit"]');
        
        // 显示加载状态
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = '验证中...';
        }
        
        // 隐藏之前的错误信息
        if (loginError) {
            loginError.style.display = 'none';
        }
        
        try {
            // 验证密码
            const isValid = await this.authManager.authenticate(password);
            
            if (isValid) {
                // 登录成功
                console.log('[AuthView] 登录成功');
                showToast('登录成功，欢迎进入 Owner 模式！', 'success');
                
                // 关闭对话框
                document.body.removeChild(dialog);
                
                // 重新渲染认证界面
                this.render();
                
                // 触发认证状态变更事件
                const event = new CustomEvent('authChanged', { 
                    detail: { isOwner: true } 
                });
                document.dispatchEvent(event);
                
            } else {
                // 登录失败 (任务 7.2 - 实现登录失败提示)
                console.log('[AuthView] 登录失败：密码错误');
                
                if (loginError) {
                    loginError.textContent = '❌ 密码错误，请重试';
                    loginError.style.display = 'block';
                }
                
                showToast('密码错误，请重试', 'error');
                
                // 清空密码输入框
                const passwordInput = document.getElementById('passwordInput');
                if (passwordInput) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
            
        } catch (error) {
            console.error('[AuthView] 登录异常:', error);
            
            if (loginError) {
                loginError.textContent = '❌ 登录失败: ' + error.message;
                loginError.style.display = 'block';
            }
            
            showToast('登录失败: ' + error.message, 'error');
            
        } finally {
            // 恢复按钮状态
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = '登录';
            }
        }
    }

    /**
     * 处理退出 (任务 7.2)
     */
    handleLogout() {
        console.log('[AuthView] 处理退出请求');
        
        // 确认退出
        if (confirm('确定要退出 Owner 模式吗？')) {
            // 退出
            this.authManager.logout();
            
            showToast('已退出 Owner 模式', 'info');
            
            // 重新渲染认证界面
            this.render();
            
            // 触发认证状态变更事件
            const event = new CustomEvent('authChanged', { 
                detail: { isOwner: false } 
            });
            document.dispatchEvent(event);
            
            console.log('[AuthView] 已退出 Owner 模式');
        }
    }

    /**
     * 更新认证界面（用于外部触发）
     */
    update() {
        this.render();
    }
}

// ============== 数据管理层 ==============

/**
 * DataManager 类 (任务 8.1)
 * 职责：管理数据的增删改查（Edit Mode）
 * 功能：
 * - 添加人物到班级
 * - 添加关系
 * - 更新关系
 * - 删除关系
 * - 所有方法需检查 Owner 权限
 * - 保存数据到 localStorage
 * _Requirements: 4.3, 5.3_
 */
class DataManager {
    constructor(dataLoader, authManager) {
        this.dataLoader = dataLoader;
        this.authManager = authManager;
        this.data = null;
    }

    /**
     * 初始化数据管理器
     */
    async init() {
        console.log('[DataManager] 初始化数据管理器');
        this.data = await this.dataLoader.loadData();
        console.log('[DataManager] 数据管理器初始化完成');
    }

    /**
     * 添加人物到班级 (任务 8.1)
     * @param {string} name - 人物姓名
     * @param {string} periodId - 时间段 ID
     * @throws {Error} 如果没有 Owner 权限或操作失败
     */
    addPerson(name, periodId) {
        console.log(`[DataManager] 添加人物: ${name} 到 ${periodId}`);
        
        // 检查 Owner 权限 (任务 8.1 - 需求 4.3)
        if (!this.authManager.checkOwnerMode()) {
            const error = 'Unauthorized: Owner access required';
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 查找时期
        const period = this.data.periods.find(p => p.id === periodId);
        if (!period) {
            const error = `Period not found: ${periodId}`;
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 检查人物是否已存在
        if (period.roster.includes(name)) {
            const error = `Person already exists in this period: ${name}`;
            console.warn('[DataManager] ' + error);
            throw new Error(error);
        }

        // 添加人物
        period.roster.push(name);
        
        console.log(`[DataManager] ✓ 人物 ${name} 已添加到 ${period.name}`);
        
        // 保存数据 (任务 8.1 - 需求 5.3)
        this.saveData();
    }

    /**
     * 添加关系 (任务 8.1)
     * @param {string} person1 - 人物1姓名
     * @param {string} person2 - 人物2姓名
     * @param {string} type - 关系类型 (friend, crush, lover, roommate, classmate)
     * @param {string} periodId - 时间段 ID
     * @param {string} note - 备注 (可选)
     * @returns {Object} 创建的关系对象
     * @throws {Error} 如果没有 Owner 权限或操作失败
     */
    addRelationship(person1, person2, type, periodId, note = '') {
        console.log(`[DataManager] 添加关系: ${person1} - ${person2} (${type}) @ ${periodId}`);
        
        // 检查 Owner 权限 (任务 8.1 - 需求 4.3)
        if (!this.authManager.checkOwnerMode()) {
            const error = 'Unauthorized: Owner access required';
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 验证时期存在
        const period = this.data.periods.find(p => p.id === periodId);
        if (!period) {
            const error = `Period not found: ${periodId}`;
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 验证人物在时期的 roster 中
        if (!period.roster.includes(person1)) {
            const error = `Person1 "${person1}" not found in period "${periodId}"`;
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        if (!period.roster.includes(person2)) {
            const error = `Person2 "${person2}" not found in period "${periodId}"`;
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 生成唯一 ID
        const id = 'rel_' + Date.now();
        
        // 创建关系对象
        const relationship = {
            id,
            period: periodId,
            person1,
            person2,
            type,
            note
        };

        // 添加到数据中
        this.data.relationships.push(relationship);
        
        console.log(`[DataManager] ✓ 关系已添加:`, relationship);
        
        // 保存数据 (任务 8.1 - 需求 5.3)
        this.saveData();
        
        return relationship;
    }

    /**
     * 更新关系 (任务 8.1)
     * @param {string} relationshipId - 关系 ID
     * @param {Object} updates - 更新的字段 { person1?, person2?, type?, note? }
     * @throws {Error} 如果没有 Owner 权限或操作失败
     */
    updateRelationship(relationshipId, updates) {
        console.log(`[DataManager] 更新关系: ${relationshipId}`, updates);
        
        // 检查 Owner 权限 (任务 8.1 - 需求 4.3)
        if (!this.authManager.checkOwnerMode()) {
            const error = 'Unauthorized: Owner access required';
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 查找关系
        const rel = this.data.relationships.find(r => r.id === relationshipId);
        if (!rel) {
            const error = `Relationship not found: ${relationshipId}`;
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 如果更新了 person1 或 person2，验证人物在对应时期 roster 中
        // 注意：若同时更新了 period，应使用新时期的 roster 验证
        if (updates.person1 || updates.person2) {
            const effectivePeriodId = updates.period || rel.period;
            const period = this.data.periods.find(p => p.id === effectivePeriodId);
            if (period) {
                if (updates.person1 && !period.roster.includes(updates.person1)) {
                    const error = `Person1 "${updates.person1}" not found in period "${effectivePeriodId}"`;
                    console.error('[DataManager] ' + error);
                    throw new Error(error);
                }
                if (updates.person2 && !period.roster.includes(updates.person2)) {
                    const error = `Person2 "${updates.person2}" not found in period "${effectivePeriodId}"`;
                    console.error('[DataManager] ' + error);
                    throw new Error(error);
                }
            }
        }

        // 应用更新
        Object.assign(rel, updates);
        
        console.log(`[DataManager] ✓ 关系已更新:`, rel);
        
        // 保存数据 (任务 8.1 - 需求 5.3)
        this.saveData();
    }

    /**
     * 删除关系 (任务 8.1)
     * @param {string} relationshipId - 关系 ID
     * @throws {Error} 如果没有 Owner 权限或操作失败
     */
    deleteRelationship(relationshipId) {
        console.log(`[DataManager] 删除关系: ${relationshipId}`);
        
        // 检查 Owner 权限 (任务 8.1 - 需求 4.3)
        if (!this.authManager.checkOwnerMode()) {
            const error = 'Unauthorized: Owner access required';
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 查找关系索引
        const index = this.data.relationships.findIndex(r => r.id === relationshipId);
        if (index === -1) {
            const error = `Relationship not found: ${relationshipId}`;
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        // 删除关系
        const deleted = this.data.relationships.splice(index, 1);
        
        console.log(`[DataManager] ✓ 关系已删除:`, deleted[0]);
        
        // 保存数据 (任务 8.1 - 需求 5.3)
        this.saveData();
    }

    /**
     * 保存数据到 localStorage (任务 8.1 - 需求 5.3)
     * 由于是纯静态前端，无法直接保存到服务器
     * 数据保存到 localStorage，并触发 dataChanged 事件
     */
    saveData() {
        console.log('[DataManager] 保存数据到 localStorage');
        
        try {
            // 保存到 localStorage
            const dataStr = JSON.stringify(this.data);
            localStorage.setItem('pendingData', dataStr);
            localStorage.setItem('pendingDataTimestamp', Date.now().toString());
            
            console.log('[DataManager] ✓ 数据已保存到 localStorage');
            
            // 触发数据变更事件
            const event = new CustomEvent('dataChanged', { 
                detail: { 
                    data: this.data,
                    timestamp: Date.now()
                } 
            });
            document.dispatchEvent(event);
            
            // 提示用户导出数据
            showToast('数据已更新，请记得导出 data.json 并提交到 GitHub', 'info');
            
        } catch (error) {
            console.error('[DataManager] 保存数据失败:', error);
            throw new Error('保存数据失败: ' + error.message);
        }
    }

    /**
     * 导出数据为 JSON 文件
     */
    exportData() {
        console.log('[DataManager] 导出数据');
        
        try {
            const dataStr = JSON.stringify(this.data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'data.json';
            a.click();
            
            URL.revokeObjectURL(url);
            
            console.log('[DataManager] ✓ 数据已导出');
            showToast('数据已导出为 data.json', 'success');
            
        } catch (error) {
            console.error('[DataManager] 导出数据失败:', error);
            showToast('导出数据失败: ' + error.message, 'error');
        }
    }

    /**
     * 导入数据（从 JSON 字符串）(任务 8.3 - 需求 5.4, 5.5, 5.6)
     * 验证数据格式，通过后替换当前数据
     * @param {string} jsonString - JSON 字符串
     * @throws {Error} 如果没有 Owner 权限或数据格式错误
     */
    async importData(jsonString) {
        console.log('[DataManager] 导入数据');
        
        // 检查 Owner 权限 (需求 4.3)
        if (!this.authManager.checkOwnerMode()) {
            const error = 'Unauthorized: Owner access required';
            console.error('[DataManager] ' + error);
            throw new Error(error);
        }

        try {
            // 解析 JSON
            const newData = JSON.parse(jsonString);
            
            // 基础结构验证 (需求 5.6)
            if (!newData.periods || !Array.isArray(newData.periods)) {
                throw new Error('数据格式无效: periods 必须是数组');
            }
            
            if (!newData.relationships || !Array.isArray(newData.relationships)) {
                throw new Error('数据格式无效: relationships 必须是数组');
            }
            
            if (!newData.owner) {
                throw new Error('数据格式无效: owner 字段必填');
            }
            
            // 使用 DataValidator 进行完整验证 (需求 5.6)
            const validator = new DataValidator();
            const result = validator.validate(newData);
            
            if (!result.valid) {
                throw new Error('数据验证失败:\n' + result.errors.join('\n'));
            }
            
            // 替换当前数据
            this.data = newData;
            
            // 保存数据
            this.saveData();
            
            console.log('[DataManager] ✓ 数据导入成功');
            showToast('数据导入成功！请导出 data.json 并提交到 GitHub', 'success');
            
            return true;
            
        } catch (error) {
            console.error('[DataManager] 导入数据失败:', error);
            throw new Error('导入数据失败: ' + error.message);
        }
    }

    /**
     * 获取待保存数据（从 localStorage）
     * @returns {Object|null} 待保存的数据，如果没有则返回 null
     */
    getPendingData() {
        const dataStr = localStorage.getItem('pendingData');
        const timestamp = localStorage.getItem('pendingDataTimestamp');
        
        if (dataStr && timestamp) {
            return {
                data: JSON.parse(dataStr),
                timestamp: parseInt(timestamp),
                age: Date.now() - parseInt(timestamp)
            };
        }
        
        return null;
    }

    /**
     * 清除待保存数据
     */
    clearPendingData() {
        localStorage.removeItem('pendingData');
        localStorage.removeItem('pendingDataTimestamp');
        console.log('[DataManager] 待保存数据已清除');
    }

    /**
     * 获取数据统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        return {
            periods: this.data.periods.length,
            relationships: this.data.relationships.length,
            totalPersons: this.data.periods.reduce((sum, p) => sum + p.roster.length, 0),
            owner: this.data.owner,
            hasPendingChanges: localStorage.getItem('pendingData') !== null
        };
    }
}

/**
 * EditPanel 类 (任务 8.2)
 * 职责：提供 Owner 模式下的数据编辑界面
 * 功能：
 * - 创建添加人物表单（姓名、时期选择器）
 * - 创建添加关系表单（人物1、人物2、关系类型、时期、备注）
 * - 创建关系列表和删除按钮
 * - 仅在 Owner 模式下显示
 * _Requirements: 4.3, 4.4_
 */
class EditPanel {
    constructor(containerId, dataManager, timelineController) {
        this.container = document.getElementById(containerId);
        this.dataManager = dataManager;
        this.timelineController = timelineController;
        
        if (!this.container) {
            throw new Error(`EditPanel: 容器 #${containerId} 不存在`);
        }
    }

    /**
     * 渲染编辑面板 (任务 8.2)
     */
    render() {
        console.log('[EditPanel] 渲染编辑面板');
        
        // 清空容器（容器自身已带 .edit-panel 样式，提供 flex 布局）
        this.container.innerHTML = '';
        
        // 1. 添加人物表单 (任务 8.2 - 需求 4.3)
        this.container.appendChild(this.createAddPersonForm());
        
        // 2. 添加关系表单 (任务 8.2 - 需求 4.3)
        this.container.appendChild(this.createAddRelationshipForm());
        
        // 3. 关系列表 (任务 8.2 - 需求 4.4)
        this.container.appendChild(this.createRelationshipList());
        
        // 4. 导出/导入按钮
        this.container.appendChild(this.createDataManagementSection());
        
        console.log('[EditPanel] 编辑面板渲染完成');
    }

    /**
     * 创建添加人物表单 (任务 8.2 - 需求 4.3)
     * @returns {HTMLElement} 表单元素
     */
    createAddPersonForm() {
        const section = document.createElement('div');
        section.className = 'edit-section-item';
        section.innerHTML = `
            <h3 style="color: #667eea; margin-bottom: 15px;">添加人物</h3>
            <form id="addPersonForm" style="display: flex; flex-direction: column; gap: 12px;">
                <div class="form-group">
                    <label for="personName">姓名:</label>
                    <input 
                        type="text" 
                        id="personName" 
                        placeholder="输入人物姓名" 
                        required
                    />
                </div>
                <div class="form-group">
                    <label for="personPeriod">时期:</label>
                    <select id="personPeriod" required>
                        <option value="">-- 选择时期 --</option>
                    </select>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="submit" class="btn btn-success">
                        ➕ 添加人物
                    </button>
                    <button type="reset" class="btn btn-secondary">
                        清空
                    </button>
                </div>
            </form>
        `;
        
        // 填充时期选项
        const periodSelect = section.querySelector('#personPeriod');
        const periods = this.timelineController.getAllPeriods();
        periods.forEach(period => {
            const option = document.createElement('option');
            option.value = period.id;
            option.textContent = period.name + (period.participated ? '' : ' (未参与)');
            periodSelect.appendChild(option);
        });
        
        // 绑定表单提交事件
        const form = section.querySelector('#addPersonForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddPerson();
        });
        
        return section;
    }

    /**
     * 创建添加关系表单 (任务 8.2 - 需求 4.3)
     * @returns {HTMLElement} 表单元素
     */
    createAddRelationshipForm() {
        const section = document.createElement('div');
        section.className = 'edit-section-item';
        section.style.borderTop = '1px solid #e0e0e0';
        section.style.paddingTop = '20px';
        section.style.marginTop = '20px';
        
        section.innerHTML = `
            <h3 style="color: #667eea; margin-bottom: 15px;">添加关系</h3>
            <form id="addRelationshipForm" style="display: flex; flex-direction: column; gap: 12px;">
                <div class="form-group">
                    <label for="relPeriod">时期:</label>
                    <select id="relPeriod" required>
                        <option value="">-- 选择时期 --</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="relPerson1">人物1:</label>
                    <select id="relPerson1" required>
                        <option value="">-- 选择人物1 --</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="relPerson2">人物2:</label>
                    <select id="relPerson2" required>
                        <option value="">-- 选择人物2 --</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="relType">关系类型:</label>
                    <select id="relType" required>
                        <option value="">-- 选择关系类型 --</option>
                        <option value="friend">朋友</option>
                        <option value="crush">暗恋</option>
                        <option value="lover">恋人</option>
                        <option value="roommate">舍友</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="relNote">备注 (可选):</label>
                    <input 
                        type="text" 
                        id="relNote" 
                        placeholder="例如：断联"
                    />
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="submit" class="btn btn-success">
                        ➕ 添加关系
                    </button>
                    <button type="reset" class="btn btn-secondary">
                        清空
                    </button>
                </div>
            </form>
        `;
        
        // 填充时期选项
        const periodSelect = section.querySelector('#relPeriod');
        const periods = this.timelineController.getAllPeriods();
        periods.forEach(period => {
            const option = document.createElement('option');
            option.value = period.id;
            option.textContent = period.name;
            periodSelect.appendChild(option);
        });
        
        // 时期选择变化时更新人物列表
        periodSelect.addEventListener('change', () => {
            this.updatePersonSelects(periodSelect.value);
        });
        
        // 绑定表单提交事件
        const form = section.querySelector('#addRelationshipForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddRelationship();
        });
        
        return section;
    }

    /**
     * 创建关系列表 (任务 8.2 - 需求 4.4)
     * @returns {HTMLElement} 列表元素
     */
    createRelationshipList() {
        const section = document.createElement('div');
        section.className = 'edit-section-item';
        section.style.borderTop = '1px solid #e0e0e0';
        section.style.paddingTop = '20px';
        section.style.marginTop = '20px';
        
        section.innerHTML = `
            <h3 style="color: #667eea; margin-bottom: 15px;">关系列表</h3>
            <div class="form-group">
                <label for="filterPeriod">筛选时期:</label>
                <select id="filterPeriod">
                    <option value="">-- 全部时期 --</option>
                </select>
            </div>
            <div id="relationshipList" style="margin-top: 15px;">
                <!-- 关系列表将动态生成 -->
            </div>
        `;
        
        // 填充时期筛选选项
        const filterSelect = section.querySelector('#filterPeriod');
        const periods = this.timelineController.getAllPeriods();
        periods.forEach(period => {
            const option = document.createElement('option');
            option.value = period.id;
            option.textContent = period.name;
            filterSelect.appendChild(option);
        });
        
        // 绑定筛选事件
        filterSelect.addEventListener('change', () => {
            this.renderRelationshipList(filterSelect.value);
        });
        
        // 初始渲染所有关系
        this.renderRelationshipList('');
        
        return section;
    }

    /**
     * 创建数据管理区域（导出/导入）
     * @returns {HTMLElement} 数据管理区域
     */
    createDataManagementSection() {
        const section = document.createElement('div');
        section.className = 'edit-section-item';
        section.style.borderTop = '1px solid #e0e0e0';
        section.style.paddingTop = '20px';
        section.style.marginTop = '20px';
        
        section.innerHTML = `
            <h3 style="color: #667eea; margin-bottom: 15px;">数据管理</h3>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button id="exportDataBtn" class="btn btn-primary">
                    💾 导出数据
                </button>
                <button id="importDataBtn" class="btn btn-primary">
                    📥 导入数据
                </button>
                <input type="file" id="importFileInput" accept=".json" style="display: none;" />
            </div>
            <p style="margin-top: 10px; font-size: 0.9rem; color: #666;">
                提示：修改数据后，请导出 data.json 并提交到 GitHub 以持久化保存。
            </p>
        `;
        
        // 绑定导出按钮
        const exportBtn = section.querySelector('#exportDataBtn');
        exportBtn.addEventListener('click', () => {
            this.handleExportData();
        });
        
        // 绑定导入按钮
        const importBtn = section.querySelector('#importDataBtn');
        const fileInput = section.querySelector('#importFileInput');
        
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            this.handleImportData(e.target.files[0]);
        });
        
        return section;
    }

    /**
     * 更新人物选择器（根据时期）
     * @param {string} periodId - 时期 ID
     */
    updatePersonSelects(periodId) {
        const person1Select = document.getElementById('relPerson1');
        const person2Select = document.getElementById('relPerson2');
        
        if (!person1Select || !person2Select) return;
        
        // 清空选项
        person1Select.innerHTML = '<option value="">-- 选择人物1 --</option>';
        person2Select.innerHTML = '<option value="">-- 选择人物2 --</option>';
        
        if (!periodId) return;
        
        // 获取时期数据
        const periodData = this.timelineController.getPeriodData(periodId);
        if (!periodData) return;
        
        // 填充人物选项
        periodData.roster.forEach(person => {
            const option1 = document.createElement('option');
            option1.value = person;
            option1.textContent = person;
            person1Select.appendChild(option1);
            
            const option2 = document.createElement('option');
            option2.value = person;
            option2.textContent = person;
            person2Select.appendChild(option2);
        });
        
        console.log(`[EditPanel] 更新人物列表: ${periodData.roster.length} 人`);
    }

    /**
     * 渲染关系列表 (任务 8.2 - 需求 4.4)
     * @param {string} filterPeriod - 筛选的时期 ID（空字符串表示全部）
     */
    renderRelationshipList(filterPeriod = '') {
        const listContainer = document.getElementById('relationshipList');
        if (!listContainer) return;
        
        // 获取所有关系
        const allRelationships = this.dataManager.data.relationships;
        
        // 筛选关系
        const relationships = filterPeriod 
            ? allRelationships.filter(rel => rel.period === filterPeriod)
            : allRelationships;
        
        // 如果没有关系
        if (relationships.length === 0) {
            listContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #999; background: #f9f9f9; border-radius: 5px;">
                    暂无关系数据
                </div>
            `;
            return;
        }
        
        // 渲染关系列表
        listContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                ${relationships.map(rel => this.createRelationshipItem(rel)).join('')}
            </div>
        `;
        
        // 绑定编辑和删除按钮事件
        relationships.forEach(rel => {
            const editBtn = listContainer.querySelector(`#editRel_${rel.id}`);
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    this.handleEditRelationship(rel.id, rel);
                });
            }
            const deleteBtn = listContainer.querySelector(`#deleteRel_${rel.id}`);
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    this.handleDeleteRelationship(rel.id, rel);
                });
            }
        });
        
        console.log(`[EditPanel] 关系列表已渲染: ${relationships.length} 条关系`);
    }

    /**
     * 创建单个关系项 HTML
     * @param {Object} rel - 关系对象
     * @returns {string} HTML 字符串
     */
    createRelationshipItem(rel) {
        const periodData = this.timelineController.getPeriodData(rel.period);
        const periodName = periodData ? periodData.name : rel.period;
        
        const typeLabels = {
            'friend': '朋友',
            'crush': '暗恋',
            'lover': '恋人',
            'roommate': '舍友',
            'classmate': '同学'
        };
        const typeLabel = typeLabels[rel.type] || rel.type;
        
        const typeColors = {
            'friend': '#00FF7F',
            'crush': '#FF69B4',
            'lover': '#FF0000',
            'roommate': '#9370DB',
            'classmate': '#87CEEB'
        };
        const typeColor = typeColors[rel.type] || '#CCCCCC';
        
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #f9f9f9; border-radius: 5px; border-left: 4px solid ${typeColor};">
                <div style="flex: 1;">
                    <div style="font-weight: 500; margin-bottom: 5px;">
                        ${rel.person1} ↔️ ${rel.person2}
                    </div>
                    <div style="font-size: 0.85rem; color: #666;">
                        <span style="background: ${typeColor}; color: white; padding: 2px 8px; border-radius: 3px; margin-right: 8px;">
                            ${typeLabel}
                        </span>
                        <span>${periodName}</span>
                        ${rel.note ? ` • ${rel.note}` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button 
                        id="editRel_${rel.id}" 
                        class="btn btn-primary" 
                        style="padding: 6px 12px; font-size: 0.9rem;"
                        title="修改关系"
                    >
                        ✏️ 修改
                    </button>
                    <button 
                        id="deleteRel_${rel.id}" 
                        class="btn btn-danger" 
                        style="padding: 6px 12px; font-size: 0.9rem;"
                        title="删除关系"
                    >
                        🗑️ 删除
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 处理添加人物 (任务 8.2)
     */
    async handleAddPerson() {
        const nameInput = document.getElementById('personName');
        const periodSelect = document.getElementById('personPeriod');
        
        const name = nameInput.value.trim();
        const periodId = periodSelect.value;
        
        if (!name) {
            showToast('请输入人物姓名', 'error');
            return;
        }
        
        if (!periodId) {
            showToast('请选择时期', 'error');
            return;
        }
        
        try {
            console.log(`[EditPanel] 添加人物: ${name} -> ${periodId}`);
            
            // 调用 DataManager 添加人物
            this.dataManager.addPerson(name, periodId);
            
            showToast(`✓ 成功添加人物: ${name}`, 'success');
            
            // 清空表单
            nameInput.value = '';
            periodSelect.value = '';
            
            // 刷新关系列表（人物选择器需要更新）
            this.render();
            
            // 触发数据变更事件
            const event = new CustomEvent('dataChanged', { 
                detail: { action: 'addPerson', name, periodId } 
            });
            document.dispatchEvent(event);
            
        } catch (error) {
            console.error('[EditPanel] 添加人物失败:', error);
            showToast('添加人物失败: ' + error.message, 'error');
        }
    }

    /**
     * 处理添加关系 (任务 8.2)
     */
    async handleAddRelationship() {
        const periodSelect = document.getElementById('relPeriod');
        const person1Select = document.getElementById('relPerson1');
        const person2Select = document.getElementById('relPerson2');
        const typeSelect = document.getElementById('relType');
        const noteInput = document.getElementById('relNote');
        
        const periodId = periodSelect.value;
        const person1 = person1Select.value;
        const person2 = person2Select.value;
        const type = typeSelect.value;
        const note = noteInput.value.trim();
        
        // 验证输入
        if (!periodId) {
            showToast('请选择时期', 'error');
            return;
        }
        
        if (!person1 || !person2) {
            showToast('请选择两个人物', 'error');
            return;
        }
        
        if (person1 === person2) {
            showToast('不能选择同一个人物', 'error');
            return;
        }
        
        if (!type) {
            showToast('请选择关系类型', 'error');
            return;
        }
        
        try {
            console.log(`[EditPanel] 添加关系: ${person1} - ${person2} (${type})`);
            
            // 调用 DataManager 添加关系
            const relationship = this.dataManager.addRelationship(person1, person2, type, periodId, note);
            
            showToast(`✓ 成功添加关系: ${person1} ↔️ ${person2}`, 'success');
            
            // 清空表单
            periodSelect.value = '';
            person1Select.innerHTML = '<option value="">-- 选择人物1 --</option>';
            person2Select.innerHTML = '<option value="">-- 选择人物2 --</option>';
            typeSelect.value = '';
            noteInput.value = '';
            
            // 刷新关系列表
            const filterPeriod = document.getElementById('filterPeriod')?.value || '';
            this.renderRelationshipList(filterPeriod);
            
            // 触发数据变更事件
            const event = new CustomEvent('dataChanged', { 
                detail: { action: 'addRelationship', relationship } 
            });
            document.dispatchEvent(event);
            
        } catch (error) {
            console.error('[EditPanel] 添加关系失败:', error);
            showToast('添加关系失败: ' + error.message, 'error');
        }
    }

    /**
     * 处理修改关系
     * 弹出修改表单，可修改人物1、人物2、关系类型、时期、备注
     * @param {string} relationshipId - 关系 ID
     * @param {Object} rel - 当前关系对象
     */
    handleEditRelationship(relationshipId, rel) {
        console.log(`[EditPanel] 修改关系: ${relationshipId}`, rel);

        // 若已有打开的修改弹窗，先移除
        const existing = document.getElementById('editRelModal');
        if (existing) existing.remove();

        const periods = this.timelineController.getAllPeriods();
        const periodOptions = periods.map(p =>
            `<option value="${p.id}" ${p.id === rel.period ? 'selected' : ''}>${p.name}</option>`
        ).join('');

        const typeOptions = [
            { value: 'friend', label: '朋友' },
            { value: 'crush', label: '暗恋' },
            { value: 'lover', label: '恋人' },
            { value: 'roommate', label: '舍友' }
        ].map(t =>
            `<option value="${t.value}" ${t.value === rel.type ? 'selected' : ''}>${t.label}</option>`
        ).join('');

        // 构建当前时期的人物选项
        const currentPeriod = this.timelineController.getPeriodData(rel.period);
        const buildPersonOptions = (selected) => {
            if (!currentPeriod) return '';
            return currentPeriod.roster.map(name =>
                `<option value="${name}" ${name === selected ? 'selected' : ''}>${name}</option>`
            ).join('');
        };

        // 创建弹窗
        const modal = document.createElement('div');
        modal.id = 'editRelModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:8px;padding:24px;width:90%;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
                <h3 style="color:#667eea;margin-bottom:16px;margin-top:0;">✏️ 修改关系</h3>
                <form id="editRelForm" style="display:flex;flex-direction:column;gap:12px;">
                    <div class="form-group">
                        <label for="editRelPeriod">时期:</label>
                        <select id="editRelPeriod" required>
                            ${periodOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editRelPerson1">人物1:</label>
                        <select id="editRelPerson1" required>
                            ${buildPersonOptions(rel.person1)}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editRelPerson2">人物2:</label>
                        <select id="editRelPerson2" required>
                            ${buildPersonOptions(rel.person2)}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editRelType">关系类型:</label>
                        <select id="editRelType" required>
                            ${typeOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editRelNote">备注:</label>
                        <input type="text" id="editRelNote" value="${rel.note || ''}" placeholder="例如：断联" />
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">
                        <button type="button" id="editRelCancel" class="btn btn-secondary">取消</button>
                        <button type="submit" class="btn btn-success">💾 保存修改</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        // 时期切换时更新人物选项
        const editPeriodSelect = modal.querySelector('#editRelPeriod');
        const editPerson1 = modal.querySelector('#editRelPerson1');
        const editPerson2 = modal.querySelector('#editRelPerson2');
        editPeriodSelect.addEventListener('change', () => {
            const pd = this.timelineController.getPeriodData(editPeriodSelect.value);
            if (!pd) return;
            const opts = (sel) => pd.roster.map(name =>
                `<option value="${name}" ${name === sel ? 'selected' : ''}>${name}</option>`
            ).join('');
            editPerson1.innerHTML = opts(editPerson1.value);
            editPerson2.innerHTML = opts(editPerson2.value);
        });

        // 取消按钮
        modal.querySelector('#editRelCancel').addEventListener('click', () => modal.remove());
        // 点击遮罩关闭
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        // 表单提交
        modal.querySelector('#editRelForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const newPeriod = editPeriodSelect.value;
            const newPerson1 = editPerson1.value;
            const newPerson2 = editPerson2.value;
            const newType = modal.querySelector('#editRelType').value;
            const newNote = modal.querySelector('#editRelNote').value.trim();

            if (!newPerson1 || !newPerson2) {
                showToast('请选择两个人物', 'error');
                return;
            }
            if (newPerson1 === newPerson2) {
                showToast('不能选择同一个人物', 'error');
                return;
            }

            try {
                this.dataManager.updateRelationship(relationshipId, {
                    period: newPeriod,
                    person1: newPerson1,
                    person2: newPerson2,
                    type: newType,
                    note: newNote
                });
                showToast('✓ 关系已修改', 'success');
                modal.remove();
                // 刷新关系列表
                const filterPeriod = document.getElementById('filterPeriod')?.value || '';
                this.renderRelationshipList(filterPeriod);
                // 触发数据变更事件
                document.dispatchEvent(new CustomEvent('dataChanged', {
                    detail: { action: 'editRelationship', relationshipId }
                }));
            } catch (err) {
                console.error('[EditPanel] 修改关系失败:', err);
                showToast('修改关系失败: ' + err.message, 'error');
            }
        });
    }

    /**
     * 处理删除关系 (任务 8.2 - 需求 4.4)
     * @param {string} relationshipId - 关系 ID
     * @param {Object} rel - 关系对象（用于显示确认信息）
     */
    async handleDeleteRelationship(relationshipId, rel) {
        // 确认删除
        const confirmed = confirm(`确定要删除关系吗？\n\n${rel.person1} ↔️ ${rel.person2}\n关系类型: ${rel.type}\n时期: ${rel.period}`);
        
        if (!confirmed) {
            return;
        }
        
        try {
            console.log(`[EditPanel] 删除关系: ${relationshipId}`);
            
            // 调用 DataManager 删除关系
            this.dataManager.deleteRelationship(relationshipId);
            
            showToast(`✓ 关系已删除`, 'success');
            
            // 刷新关系列表
            const filterPeriod = document.getElementById('filterPeriod')?.value || '';
            this.renderRelationshipList(filterPeriod);
            
            // 触发数据变更事件
            const event = new CustomEvent('dataChanged', { 
                detail: { action: 'deleteRelationship', relationshipId } 
            });
            document.dispatchEvent(event);
            
        } catch (error) {
            console.error('[EditPanel] 删除关系失败:', error);
            showToast('删除关系失败: ' + error.message, 'error');
        }
    }

    /**
     * 处理导出数据
     */
    handleExportData() {
        try {
            console.log('[EditPanel] 导出数据');
            this.dataManager.exportData();
        } catch (error) {
            console.error('[EditPanel] 导出数据失败:', error);
            showToast('导出数据失败: ' + error.message, 'error');
        }
    }

    /**
     * 处理导入数据
     * @param {File} file - JSON 文件
     */
    async handleImportData(file) {
        if (!file) return;
        
        console.log('[EditPanel] 导入数据:', file.name);
        
        try {
            // 读取文件内容
            const jsonString = await this.readFileAsText(file);
            
            // 导入数据
            await this.dataManager.importData(jsonString);
            
            showToast('✓ 数据导入成功', 'success');
            
            // 刷新界面
            this.render();
            
            // 触发页面重新加载以更新所有组件
            if (confirm('数据导入成功！需要刷新页面以更新显示。是否现在刷新？')) {
                window.location.reload();
            }
            
        } catch (error) {
            console.error('[EditPanel] 导入数据失败:', error);
            showToast('导入数据失败: ' + error.message, 'error');
        }
        
        // 清空文件输入
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) {
            fileInput.value = '';
        }
    }

    /**
     * 读取文件为文本
     * @param {File} file - 文件对象
     * @returns {Promise<string>} 文件内容
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            
            reader.onerror = (e) => {
                reject(new Error('文件读取失败'));
            };
            
            reader.readAsText(file, 'UTF-8');
        });
    }

    /**
     * 更新编辑面板（用于外部触发）
     */
    update() {
        this.render();
    }
}

// ============== 应用初始化 ==============

// 应用初始化
document.addEventListener('DOMContentLoaded', async () => {
    console.log('应用初始化...');
    
    try {
        // 验证 HTML 结构 (任务 1.3)
        verifyHTMLStructure();
        
        // 创建并初始化应用
        const app = new App();
        await app.init();
        
        // 存储到全局供调试使用
        window.app = app;
        
        console.log('\n✓ 应用初始化完成！可以开始使用了\n');
        
    } catch (error) {
        console.error('应用初始化失败:', error);
        showToast('应用初始化失败: ' + error.message, 'error');
        
        const graphContainer = document.getElementById('graphContainer');
        if (graphContainer) {
            graphContainer.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #dc3545;">
                    <h3>❌ 初始化失败</h3>
                    <p>${error.message}</p>
                    <p style="font-size: 0.9em; color: #666; margin-top: 10px;">请检查 data.json 文件是否存在</p>
                </div>
            `;
        }
    }
});

/**
 * 验证 HTML 基础结构 (任务 1.3)
 * 验证点：
 * - 主容器 div 存在
 * - Vis.js 库已加载
 * - 基础 meta 标签存在
 * - 中文字体支持
 */
function verifyHTMLStructure() {
    console.log('=== 验证 HTML 基础结构 (任务 1.3) ===');
    
    const checks = [
        {
            name: '主容器 #app',
            test: () => document.getElementById('app') !== null,
            requirement: '6.1'
        },
        {
            name: '时间轴容器 #timelineSelector',
            test: () => document.getElementById('timelineSelector') !== null,
            requirement: '6.1'
        },
        {
            name: '关系图容器 #graphContainer',
            test: () => document.getElementById('graphContainer') !== null,
            requirement: '6.1'
        },
        {
            name: '编辑面板 #editPanel',
            test: () => document.getElementById('editPanel') !== null,
            requirement: '6.1'
        },
        {
            name: '认证容器 #authContainer',
            test: () => document.getElementById('authContainer') !== null,
            requirement: '6.1'
        },
        {
            name: 'Vis.js 库已加载',
            test: () => typeof vis !== 'undefined' && typeof vis.Network !== 'undefined',
            requirement: '6.1'
        },
        {
            name: 'Viewport meta 标签',
            test: () => {
                const viewport = document.querySelector('meta[name="viewport"]');
                return viewport !== null && viewport.content.includes('width=device-width');
            },
            requirement: '9.1'
        },
        {
            name: 'Charset UTF-8',
            test: () => {
                const charset = document.querySelector('meta[charset]');
                return charset !== null && charset.getAttribute('charset').toUpperCase() === 'UTF-8';
            },
            requirement: '9.1'
        },
        {
            name: '中文字体支持',
            test: () => {
                const bodyStyle = getComputedStyle(document.body);
                const fontFamily = bodyStyle.fontFamily;
                return fontFamily.includes('Microsoft YaHei') || 
                       fontFamily.includes('SimHei') ||
                       fontFamily.includes('sans-serif');
            },
            requirement: '9.1'
        }
    ];
    
    let passCount = 0;
    let failCount = 0;
    
    checks.forEach(check => {
        const result = check.test();
        const status = result ? '✓ 通过' : '✗ 失败';
        const style = result ? 'color: green; font-weight: bold;' : 'color: red; font-weight: bold;';
        
        console.log(`%c${status}%c - ${check.name} (需求 ${check.requirement})`, style, '');
        
        if (result) passCount++;
        else failCount++;
    });
    
    console.log(`\n总结: ${passCount} 通过 / ${failCount} 失败 / ${checks.length} 总计`);
    
    if (failCount === 0) {
        console.log('%c任务 1.3 验证通过! ✓', 'color: green; font-weight: bold; font-size: 14px;');
        showToast('HTML 基础结构验证通过', 'success');
    } else {
        console.warn('部分检查未通过，请检查上述失败项');
        showToast(`HTML 结构验证: ${passCount}/${checks.length} 通过`, 'info');
    }
    
    console.log('=====================================\n');
}

/**
 * 显示提示消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型 (success, error, info)
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // 3秒后自动移除
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// 导出工具函数供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { showToast };
}

// ============== AI 聊天记录查看器 (Owner 模式 - 读取 Cloudflare KV 所有用户) ==============

(function() {
    const viewBtn = document.getElementById('viewChatLogsBtn');
    const modal = document.getElementById('chatLogModal');
    const closeBtn = document.getElementById('closeChatLogBtn');
    const clearBtn = document.getElementById('clearChatLogsBtn');
    const refreshBtn = document.getElementById('refreshChatLogsBtn');
    const content = document.getElementById('chatLogContent');

    if (!viewBtn || !modal) return;

    const WORKER_URL = 'https://api.wanglejiang.online';
    const OWNER_KEY = 'lejiang_owner_2024';

    function escapeHtml(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // 解析 UA，返回 设备类型(OS·品牌) 格式，如 "电脑(Win10·Edge)" "手机(Android 14·HONOR)"
    function parseDeviceInfo(ua) {
        if (!ua) return '未知';
        var type = '未知', os = '', brand = '';

        if (/iPhone/i.test(ua)) {
            type = '手机';
            var im = ua.match(/iPhone OS\s+([\d_]+)/i);
            os = im ? 'iOS ' + im[1].replace(/_/g, '.') : 'iOS';
            brand = 'iPhone';
        } else if (/iPad/i.test(ua)) {
            type = '平板';
            var im = ua.match(/OS\s+([\d_]+)/i);
            os = im ? 'iPadOS ' + im[1].replace(/_/g, '.') : 'iPadOS';
            brand = 'iPad';
        } else if (/Android/i.test(ua)) {
            // Android 平板 UA 通常含 "Tablet" 字样；手机 WebView 可能不含 "Mobile"，默认按手机处理
            type = /Tablet/i.test(ua) ? '平板' : '手机';
            var am = ua.match(/Android\s+([\d\.]+)/i);
            os = am ? 'Android ' + am[1] : 'Android';
            // 从 Build/XXX 前的型号字段提取品牌
            var bm = ua.match(/;\s*([^;)]+?)\s+Build\//i);
            var model = bm ? bm[1].trim() : '';
            // 从 Build/XXX 中也能识别（如 HONORLSA-AN00）
            var buildStr = ua.match(/Build\/([^\);]+)/i);
            buildStr = buildStr ? buildStr[1] : '';
            if (/HONOR/i.test(model) || /HONOR/i.test(buildStr)) brand = 'HONOR';
            else if (/HUAWEI|HW\-/i.test(model) || /HUAWEI/i.test(buildStr)) brand = '华为';
            else if (/Mi\s|Redmi|POCO/i.test(model)) brand = '小米';
            else if (/OPPO/i.test(model) || /^PG[A-Z]|^PJZ|^PCHM/i.test(model)) brand = 'OPPO';
            else if (/vivo/i.test(model) || /^V[0-9]{4}/i.test(model)) brand = 'vivo';
            else if (/SM\-[A-Z0-9]+/i.test(model)) brand = '三星';
            else if (/ONEPLUS|IN20/i.test(model)) brand = '一加';
            else if (/Realme/i.test(model)) brand = 'Realme';
            else if (/PKP|PNP/i.test(model)) brand = '红米';
            else if (model) brand = model;  // 识别不到就显示型号
            else brand = 'Android';
            if (brand !== model && model && !/^(HONOR|HUAWEI|HW-|OPPO|vivo|SM-|ONEPLUS|Realme|PKP|PNP|Mi\s|Redmi|POCO|PG|PJZ|PCHM|IN20|V[0-9]{4})/i.test(model)) {
                // 是新品牌，添加型号作为参考
                // 这里不添加，保持简洁
            }
        } else if (/Mac OS X|Macintosh/i.test(ua)) {
            type = '电脑';
            var mm = ua.match(/Mac OS X\s+([\d_]+)/i);
            os = mm ? 'macOS ' + mm[1].replace(/_/g, '.') : 'macOS';
            brand = 'Mac';
            if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) brand += '(Safari)';
            else if (/Chrome/i.test(ua)) brand += '(Chrome)';
        } else if (/Windows NT 10/i.test(ua)) {
            type = '电脑';
            os = 'Win10/11';
            if (/Edg/i.test(ua)) brand = 'Edge';
            else if (/Chrome/i.test(ua)) brand = 'Chrome';
            else if (/Firefox/i.test(ua)) brand = 'Firefox';
        } else if (/Windows NT 6\.3/i.test(ua)) {
            type = '电脑'; os = 'Win8.1';
        } else if (/Windows NT 6\.1/i.test(ua)) {
            type = '电脑'; os = 'Win7';
        } else if (/Windows/i.test(ua)) {
            type = '电脑'; os = 'Windows';
        } else if (/Linux/i.test(ua)) {
            type = '电脑'; os = 'Linux';
        }

        var out = type;
        var extras = [];
        if (os) extras.push(os);
        if (brand) extras.push(brand);
        if (extras.length) out += '(' + extras.join('·') + ')';
        return out;
    }

    async function renderLogs() {
        // 顶部状态栏 + 加载动画
        content.innerHTML = `
            <div style="padding:8px 12px;background:#fafaf8;border-bottom:1px solid #eee;font-size:12px;color:#666;display:flex;justify-content:space-between;align-items:center;">
                <span id="chatLogsCount">正在加载…</span>
                <span id="chatLogsLoadTime" style="color:#999;"></span>
            </div>
            <div id="chatLogsList" style="overflow-y:auto;">
                <div style="text-align:center;color:#999;padding:40px 0;">
                    <div style="display:inline-block;width:24px;height:24px;border:3px solid #e8e4df;border-top-color:#7c3aed;border-radius:50%;animation:chatLogsSpin .8s linear infinite;"></div>
                    <div style="margin-top:10px;">加载中…</div>
                </div>
                <style>@keyframes chatLogsSpin{to{transform:rotate(360deg);}}</style>
            </div>
        `;
        const startTime = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(`${WORKER_URL}/chat-logs?key=${OWNER_KEY}`, {
                signal: controller.signal,
                cache: 'no-store'
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
                throw new Error('HTTP ' + res.status + (res.status === 403 ? '（owner key 不正确）' : res.status === 500 ? '（Worker 内部错误，请检查 KV 绑定）' : ''));
            }
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); }
            catch (jsonErr) {
                const preview = text.substring(0, 200).replace(/</g, '&lt;');
                throw new Error('Worker 返回非 JSON 数据。前 200 字符: ' + preview);
            }
            const logs = data.logs || [];
            const countEl = document.getElementById('chatLogsCount');
            const timeEl = document.getElementById('chatLogsLoadTime');
            const listEl = document.getElementById('chatLogsList');
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            if (logs.length === 0) {
                if (countEl) countEl.textContent = '暂无聊天记录';
                if (timeEl) timeEl.textContent = '耗时 ' + elapsed + 's';
                listEl.innerHTML = '<p style="text-align:center;color:var(--text-faint);padding:40px 0;">暂无聊天记录</p>';
                return;
            }

            // 最新的排最上面
            logs.sort((a, b) => (b.ts || 0) - (a.ts || 0));

            if (countEl) countEl.textContent = '共 ' + logs.length + ' 条记录（所有用户）';
            if (timeEl) timeEl.textContent = '耗时 ' + elapsed + 's';

            // 分批渲染：先渲染前 50 条，其余延迟
            const renderBatch = (batch) => {
                return batch.map(function(log) {
                    var statusBadge = (log.ok === false || log.ok === 0)
                        ? '<span class="log-status log-fail">失败</span>'
                        : '<span class="log-status log-ok">成功</span>';
                    var timeStr = log.t || (log.ts ? new Date(log.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知时间');
                    // 解析设备类型 + 品牌 + 操作系统
                    var device = parseDeviceInfo(log.ua || '');
                    return '<div class="log-item">' +
                        '<div class="log-time">' + escapeHtml(timeStr) + ' ' + statusBadge +
                        ' <span style="background:#e8f4fd;padding:1px 6px;border-radius:4px;font-size:11px;color:#444;">' + escapeHtml(device) + '</span></div>' +
                        '<div class="log-q"><b>问:</b> ' + escapeHtml(log.q || '') + '</div>' +
                        '<div class="log-a"><b>答:</b> ' + escapeHtml(log.a || '') + '</div>' +
                        '</div>';
                }).join('');
            };

            const FIRST_BATCH = 50;
            const firstBatch = logs.slice(0, FIRST_BATCH);
            const rest = logs.slice(FIRST_BATCH);
            listEl.innerHTML = renderBatch(firstBatch);

            if (rest.length > 0) {
                const moreBtn = document.createElement('div');
                moreBtn.style.cssText = 'text-align:center;padding:14px;color:#7c3aed;cursor:pointer;font-size:13px;border-top:1px solid #f0f0f0;';
                moreBtn.textContent = '还有 ' + rest.length + ' 条，点击加载全部…';
                moreBtn.addEventListener('click', () => {
                    moreBtn.remove();
                    listEl.insertAdjacentHTML('beforeend', renderBatch(rest));
                });
                listEl.appendChild(moreBtn);
            }
        } catch(e) {
            clearTimeout(timeoutId);
            let errMsg = e.message;
            let hint = '';
            if (e.name === 'AbortError') {
                errMsg = '请求超时（10 秒）';
                hint = 'Worker 响应过慢，可能 KV 数据量过大或 Worker 冷启动。请稍后重试。';
            } else if (e.name === 'TypeError' && /fetch|network/i.test(e.message)) {
                errMsg = '网络错误：' + e.message;
                hint = '无法连接 Worker，请检查网络是否畅通。';
            }
            content.innerHTML =
                '<div style="text-align:center;color:#c00;padding:30px 20px;">' +
                    '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">加载失败</div>' +
                    '<div style="font-size:12px;color:#666;margin-bottom:12px;">' + escapeHtml(errMsg) + '</div>' +
                    (hint ? '<div style="font-size:12px;color:#999;background:#fafaf8;padding:10px;border-radius:6px;margin-bottom:12px;">' + escapeHtml(hint) + '</div>' : '') +
                    '<div style="font-size:12px;color:#999;text-align:left;background:#fafaf8;padding:12px;border-radius:6px;line-height:1.7;">' +
                        '<strong>排查清单：</strong><br>' +
                        '1. Cloudflare Workers → 选中 lejiang-search<br>' +
                        '2. Settings → Variables → KV Namespace Bindings<br>' +
                        '3. 确认变量名 <code>SEARCH_LOGS</code> 已绑定到命名空间 <code>lejiang_search_logs</code><br>' +
                        '4. 浏览器直接访问下方 URL 查看返回：<br>' +
                        '<code style="word-break:break-all;">' + WORKER_URL + '/chat-logs?key=' + OWNER_KEY + '</code>' +
                    '</div>' +
                '</div>';
            console.error('[聊天记录] 加载失败:', e);
        }
    }

    viewBtn.addEventListener('click', function() {
        renderLogs();
        modal.style.display = 'flex';
    });

    closeBtn.addEventListener('click', function() {
        modal.style.display = 'none';
    });

    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.style.display = 'none';
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', renderLogs);
    }

    clearBtn.addEventListener('click', async function() {
        if (!confirm('确定清空所有用户的聊天记录吗？此操作不可恢复。')) return;
        try {
            const res = await fetch(`${WORKER_URL}/chat-clear?key=${OWNER_KEY}`, { method: 'POST' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            await renderLogs();
            showToast('所有用户聊天记录已清空', 'success');
        } catch(e) {
            showToast('清空失败: ' + e.message, 'error');
        }
    });
})();

// ============== AI 助手浮动按钮 ==============

(function() {
    const aiBtn = document.getElementById('aiFloatBtn');
    const aiSidebar = document.getElementById('aiSidebar');
    const aiClose = document.getElementById('aiSidebarClose');
    const aiIframe = document.getElementById('aiIframe');
    const aiTipBubble = document.getElementById('aiTipBubble');
    const aiTipClose = document.getElementById('aiTipClose');

    if (!aiBtn) return;

    // ===== 新功能提示气泡 =====
    // 用户点过/关闭过就不再显示
    const TIP_KEY = 'lejiang_ai_tip_dismissed_v1';
    const tipDismissed = localStorage.getItem(TIP_KEY) === '1';
    function showTipBubble() {
        if (tipDismissed || !aiTipBubble) return;
        setTimeout(() => aiTipBubble.classList.add('show'), 800);
    }
    function hideTipBubble(permanent) {
        if (!aiTipBubble) return;
        aiTipBubble.classList.remove('show');
        aiTipBubble.classList.add('hide');
        if (permanent) localStorage.setItem(TIP_KEY, '1');
    }
    showTipBubble();
    if (aiTipClose) {
        aiTipClose.addEventListener('click', (e) => {
            e.stopPropagation();
            hideTipBubble(true);
        });
    }

    // 判断是否为移动端
    function isMobile() {
        return window.innerWidth <= 768;
    }

    aiBtn.addEventListener('click', () => {
        // 点击按钮 = 用户已注意到 AI，不再提示
        hideTipBubble(true);
        if (isMobile()) {
            // 手机端：跳转到 AI 页面
            window.location.href = 'ai.html';
        } else {
            // 电脑端：展开侧边栏
            if (aiSidebar.classList.contains('open')) {
                aiSidebar.classList.remove('open');
            } else {
                // 首次打开时加载 iframe（带版本号强制刷新）
                if (!aiIframe.src || aiIframe.src.indexOf('v=') === -1) {
                    aiIframe.src = 'ai.html?v=14.3';
                }
                aiSidebar.classList.add('open');
            }
        }
    });

    if (aiClose) {
        aiClose.addEventListener('click', () => {
            aiSidebar.classList.remove('open');
        });
    }

    // 监听 iframe 内 AI 页面发来的"关闭侧边栏"消息
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'lejiang_close_ai_sidebar') {
            aiSidebar.classList.remove('open');
        }
    });

    // 窗口尺寸变化时，如果在移动端则关闭侧边栏
    window.addEventListener('resize', () => {
        if (isMobile() && aiSidebar.classList.contains('open')) {
            aiSidebar.classList.remove('open');
        }
    });
})();
