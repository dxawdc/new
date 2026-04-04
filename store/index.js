import { observable, action } from 'mobx-miniprogram';

export const store = observable({
  logs: [], 
  userDocId: null, 
  userProfile: {
    nickname: '神秘肠道家',
    avatar: '🐒',
    signature: '每日一蕉，烦恼抛抛', 
    isPublic: true 
  },
  
  // 【新增】全局密友列表
  partners: [],

  reportData: {
    pupuCount: 0, bananaCount: 0, struggleCount: 0, totalTime: 0, score: 0,
    honor: '暂无数据', summaryTitle: '开启你的记录吧', summaryDesc: '本月还没有足够的数据支撑报告，快去打卡你的第一次释放吧！',
    timeDesc: '暂无数据', favoritePeriod: '暂无'
  },

  setUserDocId: action(function (id) { this.userDocId = id; }),
  updateUserProfile: action(function (newProfile) { this.userProfile = { ...this.userProfile, ...newProfile }; }),
  
  // 【新增】设置密友数据
  setPartners: action(function (partnersList) {
    this.partners = partnersList;
  }),

  setLogs: action(function (logs) { this.logs = logs; this.calculateReport(); }),
  addLog: action(function (log) { this.logs.unshift(log); this.calculateReport(); }),
  deleteLog: action(function (id) { this.logs = this.logs.filter(log => log.id !== id); this.calculateReport(); }),
  updateLog: action(function (updatedLog) {
    const index = this.logs.findIndex(log => log.id === updatedLog.id);
    if (index > -1) { this.logs[index] = updatedLog; this.calculateReport(); }
  }),

  calculateReport: action(function () {
    const logs = this.logs || [];
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonthLogs = logs.filter(l => l.date && l.date.startsWith(monthPrefix));

    if (thisMonthLogs.length === 0) {
      this.reportData = {
        pupuCount: 0, bananaCount: 0, struggleCount: 0, totalTime: 0, score: 0,
        honor: '神秘人', summaryTitle: '开启你的记录吧', summaryDesc: '本月还没有足够的数据支撑报告，快去打卡你的第一次释放吧！', timeDesc: '暂无数据', favoritePeriod: '暂无'
      };
      return;
    }

    const pupuLogs = thisMonthLogs.filter(l => l.status === 'success');
    const struggleLogs = thisMonthLogs.filter(l => l.status !== 'success');
    let totalTime = 0, bananaCount = 0, periodCounts = {};

    pupuLogs.forEach(log => {
      let durationVal = 5; 
      if (log.duration && log.duration.id) {
        if (log.duration.id === 'fast') durationVal = 2; else if (log.duration.id === 'normal') durationVal = 5; else if (log.duration.id === 'long') durationVal = 15;
      }
      totalTime += durationVal;
      if (log.mainType && log.mainType.id === 4) bananaCount++;
      if (log.period) periodCounts[log.period] = (periodCounts[log.period] || 0) + 1;
    });

    struggleLogs.forEach(log => {
      let durationVal = 5; 
      if (log.duration && log.duration.id) {
        if (log.duration.id === 'fast') durationVal = 2; else if (log.duration.id === 'normal') durationVal = 5; else if (log.duration.id === 'long') durationVal = 15;
      }
      totalTime += durationVal;
    });

    let favoritePeriod = '暂无', maxP = 0;
    for (let p in periodCounts) { if (periodCounts[p] > maxP) { maxP = periodCounts[p]; favoritePeriod = p; } }

    let baseScore = 80; 
    baseScore += (bananaCount * 5); 
    baseScore -= (struggleLogs.length * 8); 
    if (pupuLogs.length >= 15) baseScore += 5; 
    let score = Math.max(0, Math.min(100, baseScore)); 

    let honor = "肠道观察员", summaryTitle = "继续保持哦", summaryDesc = "你的肠道规律正在养成中，多喝水多运动，健康近在咫尺。";
    if (score >= 90) { honor = "🍌 肠胃王者"; summaryTitle = "你的肠道简直是工业奇迹"; summaryDesc = `本月成功噗噗 ${pupuLogs.length} 次，包含 ${bananaCount} 枚完美香蕉！膳食纤维摄入非常到位，简直是肠道界的模范生！`; } 
    else if (struggleLogs.length > pupuLogs.length && struggleLogs.length > 0) { honor = "🌵 仙人掌体质"; summaryTitle = "肠道正在发出干旱警报"; summaryDesc = `本月遗憾挣扎了 ${struggleLogs.length} 次，比成功的次数还多。把白开水当成最好的朋友，多吃火龙果尝试破局吧。`; } 
    else if ((totalTime / thisMonthLogs.length) > 10) { honor = "📱 马桶哲学家"; summaryTitle = "在厕所待得太久啦"; summaryDesc = "平均每次坐在马桶上的时间较长。建议放下手机，专注释放，保护好你的小雏菊。"; } 
    else if (score >= 70) { honor = "🌟 丝滑达人"; summaryTitle = "整体状态非常丝滑"; summaryDesc = "虽然偶尔有小波折，但大部分时间你都掌控得很好。继续保持规律作息！"; } 
    else if (struggleLogs.length > 0) { honor = "⚠️ 亚健康警告"; summaryTitle = "肠胃发出了轻微抗议"; summaryDesc = `本月有 ${struggleLogs.length} 次努力但无果的挣扎，多补充些水分和膳食纤维，给肠胃放个假。`; }

    let timeDesc = totalTime > 150 ? `相当于看了一部好莱坞大片。` : (totalTime > 45 ? `相当于看了 ${Math.round(totalTime / 45)} 集甄嬛传。` : "喝了几杯咖啡的时间。");
    this.reportData = { pupuCount: pupuLogs.length, bananaCount, struggleCount: struggleLogs.length, totalTime, score, honor, summaryTitle, summaryDesc, timeDesc, favoritePeriod };
  })
});