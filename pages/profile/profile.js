import { createStoreBindings } from 'mobx-miniprogram-bindings';
import { store } from '../../store/index';

const AVATAR_OPTIONS = ['😎', '🤓', '🤪', '👽', '🤡', '💩', '🐒', '🦄', '🐶', '🐱'];

Page({
  data: {
    statusBarHeight: 20, currentMonthIdx: new Date().getMonth(),
    showEditProfileModal: false, showReportModal: false, selectedPartner: null,
    showNoticeModal: false, unreadCount: 0, notifications: [],
    avatarOptions: AVATAR_OPTIONS, editForm: {}, partnerCDs: {}, currentTime: Date.now(),
    partnerActionStatus: { water: { disabled: false, countdownStr: '' }, paper: { disabled: false, countdownStr: '' }, poke: { disabled: false, countdownStr: '' } },
    timeSinceLastPoop: { text: '尚未记录', isWarning: false },
    isEditingRemark: false, editRemarkText: '', isSaving: false, pendingInviteId: null 
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync(); this.setData({ statusBarHeight: sysInfo.statusBarHeight });
    if (options && options.inviteId) this.data.pendingInviteId = options.inviteId;
    this.storeBindings = createStoreBindings(this, { store, fields: ['logs', 'userProfile', 'reportData', 'userDocId', 'partners'], actions: ['updateUserProfile', 'calculateReport', 'setUserDocId', 'setPartners'] });

    setTimeout(() => {
      if (wx.cloud) {
        if (!this.data.userDocId) this.initUserFromCloud();
        else { this.processPendingInvite(); this.fetchPartners(); }
        this.fetchNotifications();
      }
    }, 100); 
  },

  onShow() {
    this.startTimer();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 4, hidden: false });
    this.calculateReport(); this.updateLastPoopTime(); this.fetchNotifications();
  },

  onHide() { this.stopTimer(); },
  onUnload() { this.stopTimer(); this.storeBindings.destroyStoreBindings(); },

  onShareAppMessage() {
    if (!this.data.userDocId) return wx.showToast({ title: '请先完成一次资料保存哦', icon: 'none' });
    return { title: '邀请你成为我的噗通密友！', path: `/pages/profile/profile?inviteId=${this.data.userDocId}` }
  },

  startTimer() {
    if (this.timer) this.stopTimer();
    this.timer = setInterval(() => {
      const now = Date.now();
      const updateData = { currentTime: now };
      if (this.data.selectedPartner) updateData.partnerActionStatus = this.calcPartnerActionStatus(now, this.data.selectedPartner.id);
      this.setData(updateData);
    }, 1000);
  },
  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  calcPartnerActionStatus(now, partnerId) {
    const { partnerCDs } = this.data;
    const getStatus = (type) => {
      const cdTime = partnerCDs[`${partnerId}_${type}`]; const disabled = cdTime && now < cdTime; let countdownStr = '';
      if (disabled) {
         const diff = Math.floor((cdTime - now) / 1000); const h = String(Math.floor(diff / 3600)).padStart(2, '0'); const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0'); const s = String(diff % 60).padStart(2, '0');
         countdownStr = h !== '00' ? `${h}:${m}:${s}` : `${m}:${s}`;
      }
      return { disabled, countdownStr };
    };
    return { water: getStatus('water'), paper: getStatus('paper'), poke: getStatus('poke') };
  },

  updateLastPoopTime() {
    const logs = store.logs || []; 
    let successLogs = logs.filter(l => l.status === 'success');
    
    if (successLogs.length > 0) {
      // 1. 修复排序：按实际的打卡日期和时间重新降序（解决补打卡导致顺序错乱的问题）
      successLogs.sort((a, b) => {
        const timeA = new Date(`${a.date.replace(/-/g, '/')} ${a.time}:00`).getTime();
        const timeB = new Date(`${b.date.replace(/-/g, '/')} ${b.time}:00`).getTime();
        return timeB - timeA;
      });

      // 拿到真正离现在最近的一次实际排便记录
      const lastLog = successLogs[0]; 
      
      let actualTimeStr = `${lastLog.date.replace(/-/g, '/')} ${lastLog.time}:00`;
      
      // 2. 修复时间差：如果是过去日期的补录，按用户选择的“时间段”推算实际时间
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      if (lastLog.date !== todayStr) {
         // 根据选中的时间段，映射一个大概的实际发生时间
         const periodMap = { '晨间': '08:00', '上午': '10:30', '下午': '15:00', '晚间': '20:30', '深夜': '23:50' };
         const approxTime = periodMap[lastLog.period] || '12:00';
         actualTimeStr = `${lastLog.date.replace(/-/g, '/')} ${approxTime}:00`;
      }

      const lastDate = new Date(actualTimeStr);
      if (!isNaN(lastDate.getTime())) {
        let diffMs = Date.now() - lastDate.getTime(); 
        if (diffMs < 0) diffMs = 0; // 容错：防止设备时间误差算出负数
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        this.setData({ timeSinceLastPoop: { text: `${diffHours} 小时`, isWarning: diffHours > 48 } });
      }
    } else { 
      this.setData({ timeSinceLastPoop: { text: '尚未记录', isWarning: false }}); 
    }
  },

  async fetchNotifications() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'getNotifications' } });
      if (res.result.code === 0) this.setData({ notifications: res.result.data, unreadCount: res.result.unreadCount });
    } catch(e) {}
  },

  openNoticeModal() { 
    this.setData({ showNoticeModal: true }); 
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true });
    // 清除红点标记为已读
    if(this.data.unreadCount > 0) {
      this.setData({ unreadCount: 0 });
      wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'markNotificationsRead' } });
    }
  },
  closeNoticeModal() { this.setData({ showNoticeModal: false }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false }); },

  async initUserFromCloud() {
    if (!wx.cloud) return; const db = wx.cloud.database();
    try {
      const res = await db.collection('users').get();
      if (res.data.length > 0) {
        const userData = res.data[0]; this.setUserDocId(userData._id);
        this.updateUserProfile({ nickname: userData.nickname, avatar: userData.avatar, signature: userData.signature, isPublic: userData.isPublic });
        this.processPendingInvite(); this.fetchPartners();
      }
    } catch (err) {}
  },

  async processPendingInvite() {
    const inviteId = this.data.pendingInviteId;
    if (!inviteId || !this.data.userDocId) return;
    this.data.pendingInviteId = null;
    if (this.data.userDocId === inviteId) return wx.showToast({ title: '不能邀请自己哦', icon: 'none' });

    const db = wx.cloud.database(); const _ = db.command;
    wx.showLoading({ title: '处理羁绊中...' });
    try {
      const checkRes = await db.collection('relationships').where(_.or([{ userA_id: this.data.userDocId, userB_id: inviteId }, { userA_id: inviteId, userB_id: this.data.userDocId }])).get();
      if (checkRes.data.length > 0) return wx.showToast({ title: '你们已经是密友啦', icon: 'none' });
      await db.collection('relationships').add({ data: { userA_id: this.data.userDocId, userB_id: inviteId, createTime: db.serverDate() } });
      wx.showToast({ title: '密友绑定成功！', icon: 'success' });
      this.fetchPartners();
    } catch (e) { wx.showToast({ title: '绑定失败', icon: 'none' }); }
  },

  async fetchPartners() {
    if (!this.data.userDocId || !wx.cloud) return;
    const db = wx.cloud.database(); const _ = db.command;
    try {
      const relRes = await db.collection('relationships').where(_.or([{ userA_id: this.data.userDocId }, { userB_id: this.data.userDocId }])).get();
      if (relRes.data.length === 0) return this.setPartners([]);
      const partnerIds = relRes.data.map(r => r.userA_id === this.data.userDocId ? r.userB_id : r.userA_id);
      const userRes = await db.collection('users').where({ _id: _.in(partnerIds) }).get();
      const localRemarks = wx.getStorageSync('partner_remarks') || {};
      const partners = userRes.data.map(u => {
        const rel = relRes.data.find(r => r.userA_id === u._id || r.userB_id === u._id);
        const days = Math.max(1, Math.floor((Date.now() - new Date(rel.createTime).getTime()) / (1000 * 3600 * 24)));
        return { id: u._id, relId: rel._id, name: u.nickname, remark: localRemarks[u._id] || "", avatar: u.avatar, status: "默默守护中", statusType: "success", lastRecord: "近期", lastEmoji: "✨", days: days, totalRecords: "保密" };
      });
      this.setPartners(partners);
    } catch(e) {}
  },

  async saveToCloudDirectly(profileData) {
    if (!wx.cloud) return; const db = wx.cloud.database();
    try {
      if (this.data.userDocId) await db.collection('users').doc(this.data.userDocId).update({ data: profileData });
      else {
        const res = await db.collection('users').add({ data: { ...profileData, interactions: { paper: 0, clap: 0 }, createTime: db.serverDate() } });
        this.setUserDocId(res._id);
      }
    } catch (err) { throw err; }
  },

  openEditModal() { const profile = this.data.userProfile || {}; this.setData({ editForm: { nickname: profile.nickname || '', avatar: profile.avatar || '🐒', signature: profile.signature || '', isPublic: profile.isPublic !== false } }, () => { this.setData({ showEditProfileModal: true }); }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true }); },
  closeEditModal() { this.setData({ showEditProfileModal: false }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false }); },
  setEditAvatar(e) { this.setData({ 'editForm.avatar': e.currentTarget.dataset.emoji }); },
  setEditNickname(e) { this.setData({ 'editForm.nickname': e.detail.value }); },
  setEditSignature(e) { this.setData({ 'editForm.signature': e.detail.value }); },

  async handleSaveProfile() {
    if (!this.data.editForm.nickname.trim()) return wx.showToast({ title: '昵称不能为空哦', icon: 'none' });
    if (this.data.editForm.nickname.length > 7) return wx.showToast({ title: '昵称最多7个字哦', icon: 'none' });
    if (this.data.editForm.signature.length > 21) return wx.showToast({ title: '签名不要超过21个字', icon: 'none' });
    if (this.data.isSaving) return; 
    
    this.setData({ isSaving: true });
    wx.showLoading({ title: '安全校验中...', mask: true });

    try {
      // 接入微信合规检查
      const textToCheck = this.data.editForm.nickname + ' ' + this.data.editForm.signature;
      const secRes = await wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'checkText', text: textToCheck } });
      if (secRes.result.code === 87014) {
        wx.hideLoading(); this.setData({ isSaving: false });
        return wx.showToast({ title: '资料包含违规词汇，请修改', icon: 'none' });
      }

      const newProfile = this.data.editForm;
      this.updateUserProfile(newProfile);
      await this.saveToCloudDirectly(newProfile);
      this.closeEditModal();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (e) { wx.showToast({ title: '网络异常，请重试', icon: 'error' }); } 
    finally { this.setData({ isSaving: false }); wx.hideLoading(); }
  },

  async togglePublic() {
    if (this.data.isSaving) return; this.setData({ isSaving: true });
    const profile = this.data.userProfile || {}; const newPublicStatus = !profile.isPublic;
    this.updateUserProfile({ isPublic: newPublicStatus });
    try { await this.saveToCloudDirectly({ isPublic: newPublicStatus }); wx.showToast({ title: newPublicStatus ? '已开启公开展示' : '已关闭公开展示', icon: 'none' }); } 
    catch (e) { this.updateUserProfile({ isPublic: !newPublicStatus }); wx.showToast({ title: '设置失败', icon: 'none' }); } 
    finally { this.setData({ isSaving: false }); }
  },

  openReportModal() { this.calculateReport(); this.setData({ showReportModal: true }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true }); },
  closeReportModal() { this.setData({ showReportModal: false }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false }); },
  openPartnerModal(e) { const selectedPartner = e.currentTarget.dataset.partner; this.setData({ selectedPartner, isEditingRemark: false, editRemarkText: '', partnerActionStatus: this.calcPartnerActionStatus(Date.now(), selectedPartner.id) }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: true }); },
  closePartnerModal() { this.setData({ selectedPartner: null, isEditingRemark: false }); if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false }); },
  startEditRemark() { this.setData({ isEditingRemark: true, editRemarkText: this.data.selectedPartner.remark || '' }); },
  onRemarkInput(e) { this.setData({ editRemarkText: e.detail.value }); },
  saveRemark() {
    const newRemark = this.data.editRemarkText.trim(); const pId = this.data.selectedPartner.id;
    let localRemarks = wx.getStorageSync('partner_remarks') || {}; localRemarks[pId] = newRemark; wx.setStorageSync('partner_remarks', localRemarks);
    const updatedPartners = this.data.partners.map(p => { if (p.id === pId) return { ...p, remark: newRemark }; return p; });
    this.setPartners(updatedPartners); this.setData({ 'selectedPartner.remark': newRemark, isEditingRemark: false }); wx.showToast({ title: '备注已保存', icon: 'success' });
  },

  handleUnbindPartner() {
    wx.showModal({
      title: '解除关系', content: `真的要解除羁绊吗？`, confirmColor: '#ef4444',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '解除中...' });
          try {
            const db = wx.cloud.database(); await db.collection('relationships').doc(this.data.selectedPartner.relId).remove();
            const updatedPartners = this.data.partners.filter(p => p.id !== this.data.selectedPartner.id);
            this.setPartners(updatedPartners); this.setData({ selectedPartner: null, isEditingRemark: false });
            if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ hidden: false });
            wx.hideLoading(); wx.showToast({ title: '已解除密友', icon: 'success' });
          } catch(e) { wx.hideLoading(); wx.showToast({ title: '解除失败', icon: 'none' }); }
        }
      }
    });
  },

  async handlePartnerInteract(e) {
    const { partnerId, type } = e.currentTarget.dataset;
    const cdKey = `${partnerId}_${type}`;
    if (this.data.partnerCDs[cdKey] && this.data.currentTime < this.data.partnerCDs[cdKey]) return;
    const partner = this.data.partners.find(p => p.id === partnerId);
    const actionText = type === 'water' ? '提醒喝水💧' : type === 'paper' ? '递了卷纸🧻' : '戳了戳👉';
    
    wx.showLoading({ mask: true });
    try {
      const db = wx.cloud.database();
      // 这里依旧使用云端直写（写到 interactions 表），同时我们在前面云函数处也优化了广场的点赞写入，双轨并行
      await db.collection('interactions').add({
        data: { from_user_id: this.data.userDocId, to_user_id: partnerId, type: type, isPartner: true, read: false, createTime: db.serverDate() }
      });
      const cdTime = Date.now() + 3 * 60 * 60 * 1000;
      this.setData({ [`partnerCDs.${cdKey}`]: cdTime, partnerActionStatus: this.calcPartnerActionStatus(Date.now(), partnerId) });
      wx.hideLoading(); wx.showToast({ title: `已向 ${partner.remark || partner.name} ${actionText}`, icon: 'none', duration: 2000 });
    } catch(e) { wx.hideLoading(); wx.showToast({ title: '发送失败，网络异常', icon: 'error' }); }
  },

  preventTouchMove() {}, preventBubble() {}
});