const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

// 排行榜生成辅助函数
async function buildLeaderboard(boardType) {
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthRegex = db.RegExp({ regexp: '^' + monthPrefix })
  let matchCond = { date: monthRegex }

  if (boardType === 'month') { matchCond.status = 'success' } 
  else if (boardType === 'banana') { matchCond.status = 'success'; matchCond['mainType.id'] = 4 } 
  else if (boardType === 'bronze') { matchCond.status = 'failed' }

  const res = await db.collection('logs').aggregate()
    .match(matchCond).group({ _id: '$_openid', count: $.sum(1), totalDuration: $.sum('$durationValue') })
    .sort({ count: -1 }).limit(100)
    .lookup({ from: 'users', localField: '_id', foreignField: '_openid', as: 'userInfo' }).end()

  return res.list
    .filter(item => item.userInfo && item.userInfo.length > 0 && item.userInfo[0].isPublic)
    .map((item, index) => {
      const user = item.userInfo[0]
      const avgD = item.totalDuration ? Math.round(item.totalDuration / item.count) : 5
      return {
        id: item._id, rank: index + 1, name: user.nickname || '神秘肠道家', avatar: user.avatar || '👤',
        count: item.count, avgDuration: `${avgD}分`, interactions: user.interactions || { paper: 0, clap: 0 }
      }
  })
}

// 文本合规检查辅助函数
async function checkTextSec(text) {
  if (!text) return { code: 0 };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    return { code: 0, res };
  } catch (err) {
    if (err.errCode === 87014) return { code: 87014, msg: '内容包含违规信息' };
    return { code: 0, msg: '放行(未配置权限或异常)' }; // 兼容未开通权限的小程序
  }
}

exports.main = async (event, context) => {
  const { action, boardType, page = 0, pageSize = 20 } = event 
  const wxContext = cloud.getWXContext()
  const myOpenId = wxContext.OPENID

  if (event.Type === 'Timer' || action === 'generateLeaderboardCache') {
    try {
      for (let t of ['month', 'banana', 'bronze']) {
        const list = await buildLeaderboard(t);
        await db.collection('leaderboard_cache').doc(t).set({ data: { list, updateTime: db.serverDate() } });
      }
      return { code: 0, msg: '排行榜缓存更新成功' }
    } catch (err) { return { code: -1, msg: err.message } }
  }
  
  // =========== 核心优化1：微信合规校验 ===========
  if (action === 'checkText') {
    return await checkTextSec(event.text);
  }

  // =========== 核心优化2：突破 100 条限制，云端安全下发所有记录 ===========
  if (action === 'getAllLogs') {
    try {
      const countRes = await db.collection('logs').where({ _openid: myOpenId }).count();
      if (countRes.total === 0) return { code: 0, data: [] };
      const MAX_LIMIT = 100;
      const tasks = [];
      for (let i = 0; i < Math.ceil(countRes.total / MAX_LIMIT); i++) {
        tasks.push(db.collection('logs').where({ _openid: myOpenId })
          .orderBy('date', 'desc').orderBy('time', 'desc')
          .skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
      }
      const results = await Promise.all(tasks);
      const logs = results.reduce((acc, cur) => acc.concat(cur.data), []);
      return { code: 0, data: logs };
    } catch (err) { return { code: -1, msg: err.message } }
  }

  // =========== 核心优化3：安全的云端写库与广场同步 ===========
  if (action === 'saveLog') {
    const { logData, isEdit, logId, userProfile } = event;
    logData._openid = myOpenId; 
    try {
      let resId = logId;
      if (isEdit) {
        // 先查出老数据，用于兼容查找老版本的广场动态
        const oldLogRes = await db.collection('logs').doc(logId).get().catch(() => null);
        const oldLog = oldLogRes ? oldLogRes.data : null;

        // 1. 修改个人记录
        await db.collection('logs').doc(logId).set({ data: logData });
        
        // 2. 同步更新或删除广场关联动态
        if (userProfile && userProfile.isPublic) {
          const orConditions = [{ logId: logId, _openid: myOpenId }];
          if (oldLog && oldLog.note && oldLog.note.trim() !== '') {
            orConditions.push({ note: oldLog.note.trim(), _openid: myOpenId }); // 兼容老数据
          }

          if (logData.note && logData.note.trim() !== '') {
            // 如果修改后还有 note，则更新广场动态
            await db.collection('feeds').where(_.or(orConditions)).update({
              data: {
                status: logData.status,
                mainType: logData.mainType,
                duration: logData.duration.value,
                note: logData.note.trim(),
                user: userProfile.nickname,
                avatar: userProfile.avatar,
                logId: logId // 顺便把老数据的 logId 补齐，以后找起来更准
              }
            });
          } else {
            // 如果把 note 清空了，按照规则应该从广场移除
            await db.collection('feeds').where(_.or(orConditions)).remove();
          }
        }
      } else {
        // 1. 新增个人记录
        const res = await db.collection('logs').add({ data: logData });
        resId = res._id;
        
        // 2. 同步推送到广场
        if (logData.note && logData.note.trim() !== '' && userProfile && userProfile.isPublic) {
          await db.collection('feeds').add({
            data: {
              _openid: myOpenId, user: userProfile.nickname, avatar: userProfile.avatar, status: logData.status,
              mainType: logData.mainType, duration: logData.duration.value, note: logData.note.trim(),
              interactions: { paper: 0, clap: 0 }, createTime: db.serverDate(),
              logId: resId // 绑定唯一标识
            }
          });
        }
      }
      return { code: 0, id: resId, msg: '保存成功' };
    } catch (err) { return { code: -1, msg: err.message }; }
  }

  if (action === 'deleteLog') {
    try {
      // 1. 先查出原记录，获取它里面可能存在的 note
      const logRes = await db.collection('logs').doc(event.logId).get().catch(() => null);
      
      // 2. 删除个人历史记录
      await db.collection('logs').doc(event.logId).remove();
      
      // 3. 语法修正：精准同步删除广场动态
      if (logRes && logRes.data) {
        const oldLog = logRes.data;
        const orConditions = [{ logId: event.logId, _openid: myOpenId }];
        // 兼容没有存 logId 的老数据
        if (oldLog.note && oldLog.note.trim() !== '') {
          orConditions.push({ note: oldLog.note.trim(), _openid: myOpenId }); 
        }
        
        // 使用正确的 _.or() 语法进行删除
        await db.collection('feeds').where(_.or(orConditions)).remove();
      }
      return { code: 0, msg: '删除成功' };
    } catch (err) { return { code: -1, msg: err.message }; }
  }

  // =========== 原有广场业务 ===========
  if (action === 'getFeeds') {
    try {
      const res = await db.collection('feeds').where({ createTime: _.gte(new Date(Date.now() - 3 * 24 * 3600 * 1000)) })
        .orderBy('createTime', 'desc').skip(page * pageSize).limit(pageSize).get()
      return { code: 0, data: res.data }
    } catch (err) { return { code: -1, msg: err.message } }
  }

  if (action === 'getLeaderboard') {
    try {
      const cacheDoc = await db.collection('leaderboard_cache').doc(boardType).get().catch(() => null);
      if (cacheDoc && cacheDoc.data && cacheDoc.data.list) return { code: 0, data: cacheDoc.data.list }
      const list = await buildLeaderboard(boardType); return { code: 0, data: list }
    } catch (err) { return { code: -1, msg: err.message } }
  }

  if (action === 'getUserStats') {
    try {
      const monthRegex = db.RegExp({ regexp: '^' + `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` });
      const [successRes, failedRes, userRes] = await Promise.all([
        db.collection('logs').where({ _openid: event.targetId, status: 'success', date: monthRegex }).count(),
        db.collection('logs').where({ _openid: event.targetId, status: 'failed', date: monthRegex }).count(),
        db.collection('users').where({ _openid: event.targetId }).get()
      ]);
      const userData = userRes.data[0] || {};
      return { code: 0, data: { poopCount: successRes.total || 0, struggleCount: failedRes.total || 0, interactions: userData.interactions || { paper: 0, clap: 0 }, name: userData.nickname || '神秘肠道家', avatar: userData.avatar || '🐒', signature: userData.signature || '每日一蕉，烦恼抛抛' } }
    } catch (err) { return { code: -1, msg: err.message } }
  }

  // =========== 互动与消息通知核心逻辑 ===========
  if (action === 'interact') {
    const { context: interactContext, targetId, type } = event; 
    try {
      let notifyOpenId = targetId; // 默认是对人的点赞
      if (interactContext === 'feed') {
        const feedRes = await db.collection('feeds').doc(targetId).get();
        notifyOpenId = feedRes.data._openid;
        await db.collection('feeds').doc(targetId).update({ data: { [`interactions.${type}`]: _.inc(1) } });
      } else if (interactContext === 'user') {
        await db.collection('users').where({ _openid: targetId }).update({ data: { [`interactions.${type}`]: _.inc(1) } });
      }

      // 如果不是自己给自己点赞，则写一条消息通知
    //if (notifyOpenId !== myOpenId) {
      await db.collection('interactions').add({
        data: {
          to_user_id: notifyOpenId, from_user_id: myOpenId,
          type: type, context: interactContext, isPartner: false, read: false, createTime: db.serverDate()
        }
      });
    //}
      return { code: 0, msg: '互动成功' }
    } catch (err) { return { code: -1, msg: err.message } }
  }

  if (action === 'getNotifications') {
    try {
      const myUserRes = await db.collection('users').where({ _openid: myOpenId }).get();
      const myDocId = myUserRes.data.length > 0 ? myUserRes.data[0]._id : '';

      const res = await db.collection('interactions').where(_.or([
        { to_user_id: myOpenId },
        { to_user_id: myDocId } // 兼容密友传 _id 的情况
      ])).orderBy('createTime', 'desc').limit(50).get();

      // 查询发件人信息
      const userIds = [...new Set(res.data.map(n => n.from_user_id))];
      const uRes = await db.collection('users').where(_.or([{ _openid: _.in(userIds) }, { _id: _.in(userIds) }])).get();
      const usersMap = {};
      uRes.data.forEach(u => { usersMap[u._openid] = u; usersMap[u._id] = u; });

      const formatted = res.data.map(n => {
        const u = usersMap[n.from_user_id] || { nickname: '神秘人', avatar: '👤' };
        let content = '';
        if (n.type === 'clap') content = '膜拜了你的动态 🙏';
        else if (n.type === 'paper') content = '给你递了纸巾 🧻';
        else if (n.type === 'water') content = '关心你，提醒你喝水啦 💧';
        else if (n.type === 'poke') content = '悄悄地戳了戳你 👉';

        return { id: n._id, avatar: u.avatar, name: u.nickname, content, isPartner: n.isPartner || false, read: n.read, time: n.createTime }
      });
      return { code: 0, data: formatted, unreadCount: formatted.filter(n => !n.read).length };
    } catch(err) { return { code: -1, msg: err.message }; }
  }

  if (action === 'markNotificationsRead') {
    try {
      const myUserRes = await db.collection('users').where({ _openid: myOpenId }).get();
      const myDocId = myUserRes.data.length > 0 ? myUserRes.data[0]._id : '';
      await db.collection('interactions').where(_.or([{ to_user_id: myOpenId }, { to_user_id: myDocId }])).update({ data: { read: true } });
      return { code: 0 };
    } catch(err) { return { code: -1 }; }
  }

  return { code: -1, msg: '未知 action' }
}