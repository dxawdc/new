import { createStoreBindings } from 'mobx-miniprogram-bindings';
import { store } from '../../store/index';

const BRISTOL_TYPES = [
  { id: 1, name: "小煤球", emoji: "🌑", barColor: "#9ca3af" },
  { id: 2, name: "粗糙法棍", emoji: "🥜", barColor: "#fdba74" },
  { id: 3, name: "裂纹香肠", emoji: "🌽", barColor: "#fcd34d" },
  { id: 4, name: "完美香蕉", emoji: "🍌", barColor: "#facc15" },
  { id: 5, name: "软软布丁", emoji: "🍮", barColor: "#fbbf24" },
  { id: 6, name: "糊状烂泥", emoji: "🥣", barColor: "#93c5fd" },
  { id: 7, name: "喷射水花", emoji: "💧", barColor: "#60a5fa" }
];

const PERIOD_CONFIG = [
  { label: '晨间', emoji: '🌅', color: '#fbbf24' },
  { label: '上午', emoji: '☀️', color: '#facc15' },
  { label: '下午', emoji: '🌤️', color: '#fb923c' },
  { label: '晚间', emoji: '🌙', color: '#818cf8' },
  { label: '深夜', emoji: '🌌', color: '#4b5563' }
];

const PERIOD_LABELS = ['晨间', '上午', '下午', '晚间', '深夜'];

Page({
  data: {
    statusBarHeight: 20,
    currentRange: 'day',
    ranges: [
      { key: 'day', label: '日' }, { key: 'week', label: '周' },
      { key: 'month', label: '月' }, { key: 'year', label: '年' }
    ],
    trendViewType: 'line',
    distViewType: 'pie',
    periodViewType: 'pie', 
    statData: {}
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight });

    this.storeBindings = createStoreBindings(this, {
      store, fields: ['logs']
    });

    setTimeout(() => { this.calculateStats(); }, 100);
  },

  onUnload() { this.storeBindings.destroyStoreBindings(); },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, hidden: false });
    }
    if (store.logs) { this.calculateStats(); }
  },

  setRange(e) {
    this.setData({ currentRange: e.currentTarget.dataset.key }, () => {
      this.calculateStats();
    });
  },

  toggleTrendView() { this.setData({ trendViewType: this.data.trendViewType === 'line' ? 'bar' : 'line' }); },
  toggleDistView() { this.setData({ distViewType: this.data.distViewType === 'pie' ? 'list' : 'pie' }); },
  togglePeriodView() { this.setData({ periodViewType: this.data.periodViewType === 'pie' ? 'list' : 'pie' }); },

  // 💡 [核心修改点1]：同时支持渲染成功线与挣扎线
  generateSvgBg(trendData) {
    if (!trendData || trendData.length === 0) return '';
    const w = 300, h = 120, padTop = 30, padBot = 10; 
    const maxVal = Math.max(...trendData.map(d => Math.max(d.successVal, d.failedVal))) || 1;
    const usableH = h - padTop - padBot;
    
    // 生成噗噗(成功)坐标点
    const successPts = trendData.map((d, i) => ({
      x: (i + 0.5) * (w / trendData.length),
      y: h - padBot - (d.successVal / maxVal) * usableH,
      val: d.successVal
    }));

    // 生成挣扎(失败)坐标点
    const failedPts = trendData.map((d, i) => ({
      x: (i + 0.5) * (w / trendData.length),
      y: h - padBot - (d.failedVal / maxVal) * usableH,
      val: d.failedVal
    }));

    // 构建平滑曲线路径的辅助函数
    const buildPath = (pts) => {
      let pathD = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i+1];
        const cpX = p0.x + (p1.x - p0.x) / 2;
        pathD += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
      }
      return pathD;
    };

    const successPath = buildPath(successPts);
    const failedPath = buildPath(failedPts);
    const successAreaD = `${successPath} L ${successPts[successPts.length-1].x} ${h} L ${successPts[0].x} ${h} Z`;
    
    // 组装双曲线 SVG：黄色实线为主，灰色虚线代表失败
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#facc15" stop-opacity="0.4"/><stop offset="100%" stop-color="#facc15" stop-opacity="0.0"/></linearGradient>
      </defs>
      
      <path d="${failedPath}" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,4" />
      ${failedPts.map(p => p.val > 0 ? `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#fff" stroke="#9ca3af" stroke-width="2"/>` : `<circle cx="${p.x}" cy="${p.y}" r="2" fill="#d1d5db"/>`).join('')}
      ${failedPts.map(p => p.val > 0 ? `<text x="${p.x}" y="${p.y - 8}" fill="#6b7280" font-size="10" font-family="sans-serif" text-anchor="middle">${p.val}</text>` : '').join('')}

      <path d="${successAreaD}" fill="url(#gradSuccess)" />
      <path d="${successPath}" fill="none" stroke="#facc15" stroke-width="3" stroke-linecap="round" />
      ${successPts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="#facc15" stroke-width="2"/>`).join('')}
      ${successPts.map(p => p.val > 0 ? `<text x="${p.x}" y="${p.y - 12}" fill="#a16207" font-size="12" font-weight="bold" font-family="sans-serif" text-anchor="middle">${p.val}</text>` : '').join('')}
    </svg>`;
    
    const utf8Str = unescape(encodeURIComponent(svg));
    const buffer = new Uint8Array(utf8Str.split('').map(c => c.charCodeAt(0))).buffer;
    const base64 = wx.arrayBufferToBase64(buffer);
    
    return `data:image/svg+xml;base64,${base64}`;
  },

  buildPieData(distribution, successCount) {
    let pieLabels = [];
    let currentPercent = 0;
    const conicStops = distribution.map((item, index) => {
      let start = currentPercent; 
      let end = currentPercent + item.percent;
      if (index === distribution.length - 1) end = 100;
      let midAngleRad = ((start + (end - start) / 2) * 3.6 - 90) * (Math.PI / 180);
      pieLabels.push({ 
        name: item.name || item.label, 
        percent: item.percent, 
        left: 50 + Math.cos(midAngleRad) * 36.5, 
        top: 50 + Math.sin(midAngleRad) * 36.5, 
        show: item.percent > 6 
      });
      let gap = 0.6; 
      let colorEnd = end - gap;
      if (item.percent <= gap) colorEnd = start + item.percent * 0.5;
      currentPercent = end;
      return `${item.barColor} ${start}% ${colorEnd}%, #ffffff ${colorEnd}% ${end}%`;
    }).join(', ');

    return {
      gradient: `conic-gradient(${conicStops})`,
      labels: pieLabels
    };
  },

  calculateStats() {
    const { currentRange } = this.data;
    const logs = store.logs || []; 
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let filtered = logs;

    if (currentRange === 'day') {
      filtered = logs.filter(l => l.date === todayStr);
    } else if (currentRange === 'week') {
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - day + 1);
      monday.setHours(0,0,0,0);
      filtered = logs.filter(l => new Date(l.date) >= monday);
    } else if (currentRange === 'month') {
      const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      filtered = logs.filter(l => l.date.startsWith(monthPrefix));
    } else if (currentRange === 'year') {
      filtered = logs.filter(l => l.date.startsWith(`${now.getFullYear()}`));
    }

    const successCount = filtered.filter(l => l.status === 'success').length;
    const failedCount = filtered.filter(l => l.status === 'failed').length;

    // 💡 [核心修改点2]：频率趋势分离噗噗数与挣扎数
    let trendData = [];
    if (currentRange === 'day') {
      trendData = PERIOD_LABELS.map((label, i) => ({ 
        _id: i, label, 
        successVal: filtered.filter(l => l.period === label && l.status === 'success').length,
        failedVal: filtered.filter(l => l.period === label && l.status === 'failed').length
      }));
    } else if (currentRange === 'week') {
      const days = ['一', '二', '三', '四', '五', '六', '日'];
      trendData = days.map((d, i) => ({ 
        _id: i, label: d, 
        successVal: filtered.filter(l => (new Date(l.date).getDay() || 7) === i + 1 && l.status === 'success').length,
        failedVal: filtered.filter(l => (new Date(l.date).getDay() || 7) === i + 1 && l.status === 'failed').length
      }));
    } else if (currentRange === 'month') {
      trendData = [
        { _id: 0, label: '第1周', successVal: filtered.filter(l => new Date(l.date).getDate() <= 7 && l.status === 'success').length, failedVal: filtered.filter(l => new Date(l.date).getDate() <= 7 && l.status === 'failed').length },
        { _id: 1, label: '第2周', successVal: filtered.filter(l => new Date(l.date).getDate() > 7 && new Date(l.date).getDate() <= 14 && l.status === 'success').length, failedVal: filtered.filter(l => new Date(l.date).getDate() > 7 && new Date(l.date).getDate() <= 14 && l.status === 'failed').length },
        { _id: 2, label: '第3周', successVal: filtered.filter(l => new Date(l.date).getDate() > 14 && new Date(l.date).getDate() <= 21 && l.status === 'success').length, failedVal: filtered.filter(l => new Date(l.date).getDate() > 14 && new Date(l.date).getDate() <= 21 && l.status === 'failed').length },
        { _id: 3, label: '第4周', successVal: filtered.filter(l => new Date(l.date).getDate() > 21 && l.status === 'success').length, failedVal: filtered.filter(l => new Date(l.date).getDate() > 21 && l.status === 'failed').length }
      ];
    } else if (currentRange === 'year') {
      trendData = [1,2,3,4,5,6,7,8,9,10,11,12].map((m, i) => ({ 
        _id: i, label: `${m}月`, 
        successVal: filtered.filter(l => new Date(l.date).getMonth() + 1 === m && l.status === 'success').length,
        failedVal: filtered.filter(l => new Date(l.date).getMonth() + 1 === m && l.status === 'failed').length
      }));
    }

    const maxVal = Math.max(...trendData.map(t => Math.max(t.successVal, t.failedVal))) || 1;
    // 分别计算柱状图所需的两组高度占比百分比
    trendData = trendData.map(t => ({ 
      ...t, 
      successHeightPercent: (t.successVal / maxVal) * 100,
      failedHeightPercent: (t.failedVal / maxVal) * 100
    }));
    
    const trendSvgBg = this.generateSvgBg(trendData);

    // 其他逻辑均保持不变
    const typeCounts = {};
    BRISTOL_TYPES.forEach(t => typeCounts[t.id] = 0);
    const successLogsOnly = filtered.filter(l => l.status === 'success' && l.mainType);
    successLogsOnly.forEach(l => { typeCounts[l.mainType.id]++; });

    let distribution = BRISTOL_TYPES.map(t => ({ 
      ...t, 
      weight: typeCounts[t.id],
      percent: successLogsOnly.length > 0 ? Math.round((typeCounts[t.id] / successLogsOnly.length) * 100) : 0
    })).filter(item => item.weight > 0).sort((a, b) => b.weight - a.weight);

    const typePie = this.buildPieData(distribution, successLogsOnly.length);

    const periodCounts = {};
    PERIOD_LABELS.forEach(p => periodCounts[p] = 0);
    filtered.forEach(l => { if(l.period) periodCounts[l.period]++; });

    let periodDist = PERIOD_CONFIG.map(p => ({
      name: p.label,
      emoji: p.emoji,
      barColor: p.color,
      weight: periodCounts[p.label],
      percent: filtered.length > 0 ? Math.round((periodCounts[p.label] / filtered.length) * 100) : 0
    })).filter(item => item.weight > 0).sort((a, b) => b.weight - a.weight);

    const periodPie = this.buildPieData(periodDist, filtered.length);

    let mostFrequentEmoji = '❓';
    if (distribution.length > 0) {
      mostFrequentEmoji = distribution[0].emoji;
    }

    this.setData({ 
      statData: { 
        total: successCount, 
        failedCount: failedCount,
        mostFrequent: mostFrequentEmoji, 
        trend: trendData, 
        trendSvgBg, 
        distribution, 
        pieGradient: typePie.gradient, 
        pieLabels: typePie.labels,
        periodDistribution: periodDist,
        periodPieGradient: periodPie.gradient,
        periodPieLabels: periodPie.labels
      } 
    });
  }
});