let lastFeedFetchTime = 0; 
// 内存防抖缓存
const leaderboardCache = { month: { data: null, timestamp: 0 }, banana: { data: null, timestamp: 0 }, bronze: { data: null, timestamp: 0 } };
const CACHE_VALID_MS = 60 * 1000; 

function formatTimeAgo(timestamp) {
  if (!timestamp) return '刚刚';
  const time = new Date(timestamp).getTime();
  if (isNaN(time)) return '刚刚';
  const diff = Math.floor((Date.now() - time) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
  return Math.floor(diff / 2592000) + '个月前';
}

Page({
  data: {
    statusBarHeight: 20,
    squareTab: 'feed', 
    boardType: 'month', 
    feeds: [],
    leaderboard: [],
    monthlyInteractions: {}, 
    showUserProfileModal: null, 
    currentMonthIdx: new Date().getMonth(),
    isLoading: true,
    
    // 分页状态
    feedPage: 0,
    hasMoreFeeds: true,
    isFeedLoadingMore: false
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    
    // 🌟 方案三核心：冷启动本地缓存瞬间渲染（0ms 白屏）
    const storedInteractions = wx.getStorageSync('square_interactions') || {};
    const localFeeds = wx.getStorageSync('square_cache_feeds') || [];
    const localBoard = wx.getStorageSync('square_cache_board_month') || [];

    this.setData({ 
      statusBarHeight: sysInfo.statusBarHeight,
      monthlyInteractions: storedInteractions,
      feeds: localFeeds,
      leaderboard: localBoard
    });
    
    this.fetchFeeds();
    this.fetchLeaderboard(this.data.boardType);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, hidden: false });
    }

    // 检查其他页面（首页/历史）是否触发了删除，需要强制刷新广场动态
    const app = getApp();
    if (app._squareFeedNeedsRefresh) {
      app._squareFeedNeedsRefresh = false;
      lastFeedFetchTime = 0; // 重置防抖时间戳，确保本次强制重新拉取
    }

    const now = Date.now();
    if (now - lastFeedFetchTime > 60000 || this.data.feeds.length === 0) {
      this.fetchFeeds();
    }
    this.fetchLeaderboard(this.data.boardType);
  },

  onPullDownRefresh() {
    Promise.all([
      this.fetchFeeds(true),
      this.fetchLeaderboard(this.data.boardType, true)
    ]).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 🌟 方案一核心：上拉触底加载下一页
  onReachBottom() {
    if (this.data.squareTab === 'feed' && this.data.hasMoreFeeds && !this.data.isFeedLoadingMore) {
      this.setData({ isFeedLoadingMore: true });
      this.fetchFeeds(false, true);
    }
  },

  async fetchFeeds(force = false, isLoadMore = false) {
    if (!isLoadMore && !force && this.data.feeds.length === 0) wx.showNavigationBarLoading();

    let targetPage = isLoadMore ? this.data.feedPage + 1 : 0;

    try {
      const feedRes = await wx.cloud.callFunction({
        name: 'getSquareData',
        data: { action: 'getFeeds', page: targetPage }
        // pageSize 由云函数固定为10，前端不再传入
      });

      const rawData = feedRes.result?.data || [];
      // 直接使用云函数返回的 hasMore，精准判断是否还有下一页
      const hasMore = feedRes.result?.hasMore ?? false;

      const formattedFeeds = rawData.map(item => {
        let displayMainType = item.mainType;
        if (item.status === 'failed' || !displayMainType) {
          displayMainType = { name: '没拉出来', emoji: '💨', id: 0 };
        }
        return {
          ...item,
          id: item._id,
          mainType: displayMainType,
          displayTime: formatTimeAgo(item.createTime || item.createdAt || item.timestamp || item._createTime)
        };
      });

      let nextFeeds = isLoadMore ? [...this.data.feeds, ...formattedFeeds] : formattedFeeds;

      this.setData({
        feeds: nextFeeds,
        feedPage: targetPage,
        hasMoreFeeds: hasMore, // 由云函数精准告知，不再靠条数猜测
        isFeedLoadingMore: false
      });

      // 仅将第一页数据存入本地缓存，供下次秒开
      if (!isLoadMore) {
        wx.setStorageSync('square_cache_feeds', nextFeeds.slice(0, 10));
        lastFeedFetchTime = Date.now();
      }
    } catch (err) {
      console.error('动态拉取失败', err);
      this.setData({ isFeedLoadingMore: false });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  async fetchLeaderboard(type, force = false) {
    const cache = leaderboardCache[type];
    const now = Date.now();

    // 内存秒开
    if (cache.data && !force && (now - cache.timestamp < CACHE_VALID_MS)) {
      this.setData({ leaderboard: cache.data, isLoading: false });
      return; 
    }

    // 硬盘秒开兜底
    if (!cache.data) {
      const localBoard = wx.getStorageSync(`square_cache_board_${type}`);
      if (localBoard && localBoard.length > 0) {
        this.setData({ leaderboard: localBoard, isLoading: false });
      } else {
        this.setData({ isLoading: true, leaderboard: [] });
      }
    }

    try {
      const boardRes = await wx.cloud.callFunction({
        name: 'getSquareData',
        data: { action: 'getLeaderboard', boardType: type }
      });
      const boardData = boardRes.result?.data || [];

      // 更新两级缓存
      leaderboardCache[type] = { data: boardData, timestamp: Date.now() };
      wx.setStorageSync(`square_cache_board_${type}`, boardData);

      // 防串台：手快切走就不更新旧视图
      if (this.data.boardType === type) {
        this.setData({ leaderboard: boardData, isLoading: false });
      }
    } catch (err) {
      console.error('排行榜拉取失败', err);
      if (this.data.boardType === type) this.setData({ isLoading: false });
    }
  },

  setSquareTab(e) { this.setData({ squareTab: e.currentTarget.dataset.tab }); },

  setBoardType(e) {
    const type = e.currentTarget.dataset.type;
    if (this.data.boardType === type) return; 
    this.setData({ boardType: type });
    this.fetchLeaderboard(type);
  },

  async handleOpenProfile(e) {
    const source = e.currentTarget.dataset.source;
    const targetId = source._openid || source.id; 
    if (!targetId) return wx.showToast({ title: '无法获取用户信息', icon: 'none' });

    wx.showLoading({ title: '加载名片中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({ name: 'getSquareData', data: { action: 'getUserStats', targetId } });
      wx.hideLoading();

      if (res.result && res.result.code === 0) {
        const realData = res.result.data;
        this.setData({
          showUserProfileModal: {
            isFromFeed: source.note !== undefined, 
            originalFeedId: source.id, id: targetId,
            name: realData.name, avatar: realData.avatar, signature: realData.signature,
            poopCount: realData.poopCount, struggleCount: realData.struggleCount, 
            interactions: realData.interactions
          }
        });
        if (this.getTabBar()) this.getTabBar().setData({ hidden: true });
      } else {
        wx.showToast({ title: '获取资料失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络开小差了', icon: 'none' });
    }
  },

  closeProfileModal() {
    this.setData({ showUserProfileModal: null });
    if (this.getTabBar()) this.getTabBar().setData({ hidden: false });
  },

  preventTouchMove() {},

  handleInteract(e) {
    const { context, type } = e.currentTarget.dataset;
    const { feeds, leaderboard, monthlyInteractions, showUserProfileModal, currentMonthIdx } = this.data;

    let targetId = context === 'feed' ? e.currentTarget.dataset.feed.id : showUserProfileModal.id;
    let key = context === 'feed' ? `feed_${targetId}_${type}` : `user_${targetId}_${type}_${currentMonthIdx}`;

    if (monthlyInteractions[key]) return wx.showToast({ title: '已表态过啦', icon: 'none' });

    const backupFeeds = JSON.parse(JSON.stringify(feeds));
    const backupLeaderboard = JSON.parse(JSON.stringify(leaderboard));
    const backupInteractions = { ...monthlyInteractions };
    const backupModal = showUserProfileModal ? JSON.parse(JSON.stringify(showUserProfileModal)) : null;

    const nextInteractions = { ...monthlyInteractions, [key]: true };
    const updatePayload = { monthlyInteractions: nextInteractions };

    if (context === 'feed') {
      updatePayload.feeds = feeds.map(f => f.id === targetId ? 
        { ...f, interactions: { ...(f.interactions || {}), [type]: ((f.interactions || {})[type] || 0) + 1 } } : f);
    } else {
      const modal = showUserProfileModal;
      updatePayload.showUserProfileModal = { ...modal, interactions: { ...modal.interactions, [type]: (modal.interactions[type] || 0) + 1 } };
      if (modal.isFromFeed) {
        updatePayload.feeds = feeds.map(f => f.id === modal.originalFeedId ? { ...f, userInteractions: { ...(f.userInteractions || {}), [type]: ((f.userInteractions || {})[type] || 0) + 1 } } : f);
      } else {
        updatePayload.leaderboard = leaderboard.map(u => u.id === targetId ? { ...u, interactions: { ...u.interactions, [type]: (u.interactions[type] || 0) + 1 } } : u);
      }
    }

    this.setData(updatePayload);
    wx.setStorageSync('square_interactions', nextInteractions); 
    wx.showToast({ title: type === 'paper' ? '递纸成功🧻' : '膜拜成功👏', icon: 'none' });

    // 修改处：发起云函数，交给云端处理（包含触发通知）
    wx.cloud.callFunction({
      name: 'getSquareData',
      data: { action: 'interact', context, targetId, type }
    }).catch(err => {
      console.error('互动同步失败，进行回滚', err);
      this.setData({ feeds: backupFeeds, leaderboard: backupLeaderboard, showUserProfileModal: backupModal, monthlyInteractions: backupInteractions });
      wx.setStorageSync('square_interactions', backupInteractions);
      wx.showToast({ title: '网络波动，表态未生效', icon: 'none' });
    });
  }
});