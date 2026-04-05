import { createStoreBindings } from 'mobx-miniprogram-bindings';
import { store } from '../../store/index';

const BRISTOL_TYPES = [{ id: 1, name: "小煤球", desc: "干硬难排", emoji: "🌑" }, { id: 2, name: "粗糙法棍", desc: "有点吃力", emoji: "🥜" }, { id: 3, name: "裂纹香肠", desc: "较为顺畅", emoji: "🌽" }, { id: 4, name: "完美香蕉", desc: "通畅顺滑", emoji: "🍌" }, { id: 5, name: "软软布丁", desc: "易于排出", emoji: "🍮" }, { id: 6, name: "糊状烂泥", desc: "略显拉稀", emoji: "🥣" }, { id: 7, name: "喷射水花", desc: "腹泻水样", emoji: "💧" }];
const COLORS = [{ id: 'brown', name: '棕黄', hex: '#b45309' }, { id: 'green', name: '偏绿', hex: '#16a34a' }, { id: 'black', name: '发黑', hex: '#111827' }, { id: 'red', name: '发红', hex: '#dc2626' }, { id: 'white', name: '灰白', hex: '#d1d5db' }];
const ODORS = ['无/微弱', '正常酸臭', '恶臭/刺鼻', '腥臭异味'];
const PERIODS = [{ id: 'morning', label: '晨间', range: '05:00-09:00' }, { id: 'forenoon', label: '上午', range: '09:00-12:00' }, { id: 'afternoon', label: '下午', range: '12:00-18:00' }, { id: 'evening', label: '晚间', range: '18:00-23:00' }, { id: 'night', label: '深夜', range: '23:00-05:00' }];
const DURATIONS = [{ id: 'fast', label: '极速', desc: '<3分钟', value: '3分钟内' }, { id: 'normal', label: '正常', desc: '3-10分钟', value: '约5分钟' }, { id: 'long', label: '蹲麻了', desc: '>10分钟', value: '10分钟+' }];
const PLACEHOLDERS = ["例如：昨晚吃了爆辣火锅...", "例如：今天多喝了水，感觉好多了~"];

// 新增：根据当前时间自动匹配时间段
const getCurrentPeriodLabel = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 9) return '晨间';
  if (hour >= 9 && hour < 12) return '上午';
  if (hour >= 12 && hour < 18) return '下午';
  if (hour >= 18 && hour < 23) return '晚间';
  return '深夜'; // 23:00 - 05:00
};

const formatDate = (date) => { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; };

Page({
  data: {
    statusBarHeight: 20, todayStr: '', todayLogs: [], advice: {},
    isModalOpen: false, confirmDeleteId: null, editingLogId: null,
    randomPlaceholder: PLACEHOLDERS[0], bristolTypes: BRISTOL_TYPES, colors: COLORS, odors: ODORS, periods: PERIODS, durations: DURATIONS,
    newLog: { status: 'success', period: '晨间', selectedTypeIds: [4], colorId: null, odor: null, durationId: 'normal', note: '' },
    scrollPositions: {}, activeSwipeId: null    
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight, todayStr: formatDate(new Date()) });
    this.storeBindings = createStoreBindings(this, { store, fields: ['logs', 'userProfile'], actions: ['addLog', 'deleteLog', 'updateLog', 'setLogs'] });
    this.fetchCloudData();
  },

  async fetchCloudData() {
    wx.showNavigationBarLoading();
    try {
      // 修复 100 条限制：走后端拉取全部
      const res = await wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'getAllLogs' } });
      if (res.result.code === 0) {
        const cloudLogs = res.result.data.map(item => ({ ...item, id: item._id }));
        this.setLogs(cloudLogs);
        this.updateTodayView();
      }
    } catch (err) { console.error('拉取云端数据失败', err); } 
    finally { wx.hideNavigationBarLoading(); }
  },

  onUnload() { this.storeBindings.destroyStoreBindings(); },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 0, hidden: false });
    if (store.logs) this.updateTodayView(); 
  },

  updateTodayView() {
    const currentLogs = store.logs || []; 
    const todayLogs = currentLogs.filter(log => log.date === this.data.todayStr);
    const todaySuccessCount = todayLogs.filter(l => l.status === 'success').length;
    const todayFailedCount = todayLogs.filter(l => l.status === 'failed').length;
    
    // 修复：将所有成功的记录按真实时间降序，取真正的“最近一次记录”来生成健康建议
    const allSuccessLogs = currentLogs.filter(l => l.status === 'success').sort((a, b) => {
      const timeA = new Date(`${a.date.replace(/-/g, '/')} ${a.time}:00`).getTime();
      const timeB = new Date(`${b.date.replace(/-/g, '/')} ${b.time}:00`).getTime();
      return timeB - timeA;
    });

    let advice = { title: '开启记录', desc: '记录你的第一次释放，获取健康建议吧！', type: 'normal' };
    
    if (allSuccessLogs.length > 0) {
      const lastLog = allSuccessLogs[0];
      if (lastLog.mainType && lastLog.mainType.id <= 2) advice = { title: '近期有些干燥哦 🏜️', desc: '建议：多喝温水，安排上火龙果、西梅，多吃粗纤维蔬菜🥬', type: 'warning' };
      else if (lastLog.mainType && lastLog.mainType.id >= 6) advice = { title: '肠胃在抗议啦 🌧️', desc: '建议：近期饮食清淡，避免辛辣冷腻，注意补充电解质水💧', type: 'danger' };
      else advice = { title: '状态巅峰，太棒了！🍌', desc: '肠道非常健康，请继续保持规律作息和均衡饮食哦~', type: 'success' };
    }
    this.setData({ todayLogs, advice, todaySuccessCount, todayFailedCount });
  },

  preventTouchMove() {},
  onLogScroll(e) { const id = e.currentTarget.dataset.id; const scrollLeft = e.detail.scrollLeft; if (scrollLeft > 10) { if (this.data.activeSwipeId && this.data.activeSwipeId !== id) { this.closeAllSwipes(); this.data.activeSwipeId = id; } else if (this.data.activeSwipeId !== id) { this.data.activeSwipeId = id; } } else if (scrollLeft < 5 && this.data.activeSwipeId === id) { this.data.activeSwipeId = null; } },
  onLogTouchStart(e) { const id = e.currentTarget.dataset.id; if (this.data.activeSwipeId && this.data.activeSwipeId !== id) { this.closeAllSwipes(); } },
  onLogCardTap(e) { const id = e.currentTarget.dataset.id; if (this.data.activeSwipeId === id) { this.closeAllSwipes(); } },
  closeAllSwipes() { if (this.data.activeSwipeId) { const id = this.data.activeSwipeId; this.setData({ [`scrollPositions.${id}`]: this.data.scrollPositions[id] === 0 ? 0.001 : 0, activeSwipeId: null }); } },
  
 openAddModal() { 
    this.closeAllSwipes();
    
    // 获取当前时间段
    const currentPeriod = getCurrentPeriodLabel();

    this.setData({ 
      isModalOpen: true, 
      editingLogId: null, 
      randomPlaceholder: PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)], 
      newLog: { 
        status: 'success', 
        period: currentPeriod, // 这里不再写死 '晨间'，而是使用动态获取的值
        selectedTypeIds: [4], 
        colorId: null, 
        odor: null, 
        durationId: 'normal', 
        note: '' 
      } 
    }); 
    
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: true });
    }
  },
  openEditModal(e) { this.closeAllSwipes(); const log = e.currentTarget.dataset.log; this.setData({ isModalOpen: true, editingLogId: log.id, randomPlaceholder: PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)], newLog: { status: log.status, period: log.period, selectedTypeIds: log.types ? log.types.map(t => t.id) : [], colorId: log.color, odor: log.odor, durationId: log.duration.id, note: log.note || '' } }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true }); },
  closeModal() { this.setData({ isModalOpen: false }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false }); },
  
  setLogStatus(e) { this.setData({ 'newLog.status': e.currentTarget.dataset.status }); },
  setLogPeriod(e) { this.setData({ 'newLog.period': e.currentTarget.dataset.label }); },
  toggleType(e) { const id = e.currentTarget.dataset.id; let selectedTypeIds = [...this.data.newLog.selectedTypeIds]; const index = selectedTypeIds.indexOf(id); if (index > -1) selectedTypeIds.splice(index, 1); else selectedTypeIds.push(id); this.setData({ 'newLog.selectedTypeIds': selectedTypeIds }); },
  setLogColor(e) { const id = e.currentTarget.dataset.id; this.setData({ 'newLog.colorId': this.data.newLog.colorId === id ? null : id }); },
  setLogOdor(e) { const odor = e.currentTarget.dataset.odor; this.setData({ 'newLog.odor': this.data.newLog.odor === odor ? null : odor }); },
  setLogDuration(e) { this.setData({ 'newLog.durationId': e.currentTarget.dataset.id }); },
  onNoteInput(e) { this.setData({ 'newLog.note': e.detail.value }); },

  async handleLogSubmit() {
    const { newLog, editingLogId, todayStr, userProfile } = this.data;
    if (newLog.status === 'success' && newLog.selectedTypeIds.length === 0) return wx.showToast({ title: '请至少选择一种形态哦', icon: 'none' });
    if (newLog.note && newLog.note.length > 21) return wx.showToast({ title: '备注不要超过21个字哦', icon: 'none' });

    // 微信内容安全合规检查
    if (newLog.note && newLog.note.trim() !== '') {
      wx.showLoading({ title: '内容检测中...' });
      const secRes = await wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'checkText', text: newLog.note } });
      if (secRes.result.code === 87014) {
        wx.hideLoading();
        return wx.showToast({ title: '备注包含违规词汇，请修改', icon: 'none' });
      }
    }

    const selectedTypesObj = newLog.selectedTypeIds.map(id => BRISTOL_TYPES.find(t => t.id === id));
    const mainType = selectedTypesObj.length > 0 ? selectedTypesObj[selectedTypesObj.length - 1] : null;
    const selectedPeriod = PERIODS.find(p => p.label === newLog.period) || PERIODS[0];
    const selectedDuration = DURATIONS.find(d => d.id === newLog.durationId) || DURATIONS[1];
    let durationValue = 5; if (newLog.durationId === 'fast') durationValue = 2; if (newLog.durationId === 'long') durationValue = 15;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newRecord = { date: todayStr, time: timeStr, period: newLog.period, range: selectedPeriod.range, status: newLog.status, types: selectedTypesObj, mainType: mainType, color: newLog.colorId, odor: newLog.odor, duration: selectedDuration, note: newLog.note, durationValue };

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getSquareData',
        data: { action: 'saveLog', logData: newRecord, isEdit: !!editingLogId, logId: editingLogId, userProfile }
      });
      
      if (res.result.code === 0) {
        if (editingLogId) this.updateLog({ id: editingLogId, ...newRecord });
        else this.addLog({ id: res.result.id, ...newRecord });
        
        this.updateTodayView();
        this.closeModal();
        wx.hideLoading();
        wx.showToast({ title: '打卡完成', icon: 'success' });
      } else {
        throw new Error(res.result.msg);
      }
    } catch (err) {
      wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }); console.error(err);
    }
  },

  handleDeleteLog(e) { this.setData({ confirmDeleteId: e.currentTarget.dataset.id }); },
  closeConfirmModal() { this.setData({ confirmDeleteId: null }); },

  async executeDelete() {
    wx.showLoading({ title: '删除中...', mask: true });
    try {
      await wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'deleteLog', logId: this.data.confirmDeleteId } });
      this.deleteLog(this.data.confirmDeleteId);
      this.setData({ confirmDeleteId: null });
      this.updateTodayView();
      wx.hideLoading(); wx.showToast({ title: '已删除', icon: 'success' });
    } catch(err) {
      wx.hideLoading(); wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});