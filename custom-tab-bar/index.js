Component({
  data: {
    selected: 0,
    hidden: false, // 控制显示隐藏，防止挡住弹窗
    list: [
      { pagePath: "/pages/index/index", text: "打卡", icon: "🏠" },
      { pagePath: "/pages/history/history", text: "历史", icon: "📅" },
      { pagePath: "/pages/stats/stats", text: "统计", icon: "📊" },
      { pagePath: "/pages/square/square", text: "广场", icon: "🌍" },
      { pagePath: "/pages/profile/profile", text: "我的", icon: "👤" }
    ]
  },
  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset;
      const url = data.path;
      wx.switchTab({ url });
    }
  }
})
