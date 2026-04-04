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

// =========== 文本合规检查辅助函数（2.0 版本）===========
// suggest 有三种值：
//   'pass'   → 内容正常，放行
//   'review' → 疑似违规，需人工审核（本项目选择直接拦截，偏保守策略）
//   'risky'  → 确定违规，拦截
async function checkTextSec(text, openid) {
  if (!text || text.trim() === '') return { code: 0 };
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,     // 固定值 2，使用 2.0 接口
      scene: 2,       // 场景：1=资料 2=评论 3=论坛 4=社交日志，备注属于"评论"场景
      openid,         // 必填：发起请求的用户 openid（用户需在近 2 小时内访问过小程序）
      content: text,
    });

    // 2.0 接口正常情况下不抛异常，通过 result.suggest 字段判断结果
    const suggest = res.result && res.result.suggest;
    if (suggest === 'risky' || suggest === 'review') {
      // 记录命中详情，方便后续排查
      console.warn('[checkText] 内容违规，detail:', JSON.stringify(res.detail));
      return { code: 87014, msg: '内容包含违规信息', suggest, detail: res.detail };
    }

    return { code: 0, suggest: 'pass' };
  } catch (err) {
    // 61010：用户近 2 小时内未访问小程序，openid 失效
    // 40003：openid 无效
    // 以上两种情况说明接口本身可用，但凭证问题，按需决定是否拦截
    // 其余异常（权限未开通、网络超时等）兜底放行，避免误拦截正常用户
    const errCode = err.errCode || err.errcode;
    console.error('[checkText] 接口异常，errCode:', errCode, err.errMsg || err.message);
    if (errCode === 61010 || errCode === 40003) {
      // openid 问题：保守策略可在此拦截，宽松策略则放行
      // 当前选择放行，避免因 openid 失效误伤用户
      return { code: 0, msg: '放行(openid失效)' };
    }
    return { code: 0, msg: '放行(接口异常)' };
  }
}

exports.main = async (event, context) => {
  const { action, boardType, page = 0 } = event 
  const wxContext = cloud.getWXContext()
  const myOpenId = wxContext.OPENID  // 云函数自动从请求上下文中取，安全可信

  if (event.Type === 'Timer' || action === 'generateLeaderboardCache') {
    try {
      for (let t of ['month', 'banana', 'bronze']) {
        const list = await buildLeaderboard(t);
        await db.collection('leaderboard_cache').doc(t).set({ data: { list, updateTime: db.serverDate() } });
      }
      return { code: 0, msg: '排行榜缓存更新成功' }
    } catch (err) { return { code: -1, msg: err.message } }
  }
  
  // =========== 文本合规校验（2.0）===========
  // openid 直接从云函数上下文取，前端无需传递，也无法伪造
  if (action === 'checkText') {
    return await checkTextSec(event.text, myOpenId);
  }

  // =========== 突破 100 条限制，云端安全下发所有记录 ===========
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

  // =========== 安全的云端写库与广场同步 ===========
  if (action === 'saveLog') {
    const { logData, isEdit, logId, userProfile } = event;
    logData._openid = myOpenId; 
    try {
      let resId = logId;
      if (isEdit) {
        const oldLogRes = await db.collection('logs').doc(logId).get().catch(() => null);
        const oldLog = oldLogRes ? oldLogRes.data : null;

        await db.collection('logs').doc(logId).set({ data: logData });
        
        if (userProfile && userProfile.isPublic) {
          const orConditions = [{ logId: logId, _openid: myOpenId }];
          if (oldLog && oldLog.note && oldLog.note.trim() !== '') {
            orConditions.push({ note: oldLog.note.trim(), _openid: myOpenId });
          }

          if (logData.note && logData.note.trim() !== '') {
            await db.collection('feeds').where(_.or(orConditions)).update({
              data: {
                status: logData.status,
                mainType: logData.mainType,
                duration: logData.duration.value,
                note: logData.note.trim(),
                user: userProfile.nickname,
                avatar: userProfile.avatar,
                logId: logId
              }
            });
          } else {
            await db.collection('feeds').where(_.or(orConditions)).remove();
          }
        }
      } else {
        const res = await db.collection('logs').add({ data: logData });
        resId = res._id;
        
        if (logData.note && logData.note.trim() !== '' && userProfile && userProfile.isPublic) {
          await db.collection('feeds').add({
            data: {
              _openid: myOpenId, user: userProfile.nickname, avatar: userProfile.avatar, status: logData.status,
              mainType: logData.mainType, duration: logData.duration.value, note: logData.note.trim(),
              interactions: { paper: 0, clap: 0 }, createTime: db.serverDate(),
              logId: resId
            }
          });
        }
      }
      return { code: 0, id: resId, msg: '保存成功' };
    } catch (err) { return { code: -1, msg: err.message }; }
  }

  if (action === 'deleteLog') {
    try {
      const logRes = await db.collection('logs').doc(event.logId).get().catch(() => null);
      await db.collection('logs').doc(event.logId).remove();
      
      if (logRes && logRes.data) {
        const oldLog = logRes.data;
        const orConditions = [{ logId: event.logId, _openid: myOpenId }];
        if (oldLog.note && oldLog.note.trim() !== '') {
          orConditions.push({ note: oldLog.note.trim(), _openid: myOpenId }); 
        }
        await db.collection('feeds').where(_.or(orConditions)).remove();
      }
      return { code: 0, msg: '删除成功' };
    } catch (err) { return { code: -1, msg: err.message }; }
  }

  // =========== 广场业务 ===========
  if (action === 'getFeeds') {
    try {
      // 展示规则：3天内 且 总量不超过100条，每页10条
      const PAGE_SIZE = 10;
      const MAX_TOTAL = 100;
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      const skip = page * PAGE_SIZE;

      // 超出100条总量上限则直接返回空
      if (skip >= MAX_TOTAL) return { code: 0, data: [], total: MAX_TOTAL, hasMore: false };

      // 实际每次最多取到第100条为止
      const actualLimit = Math.min(PAGE_SIZE, MAX_TOTAL - skip);

      // 并行执行：拉数据 + 查总数
      const [res, countRes] = await Promise.all([
        db.collection('feeds')
          .where({ createTime: _.gte(threeDaysAgo) })
          .orderBy('createTime', 'desc')
          .skip(skip)
          .limit(actualLimit)
          .get(),
        db.collection('feeds')
          .where({ createTime: _.gte(threeDaysAgo) })
          .count()
      ]);

      const total = Math.min(countRes.total, MAX_TOTAL);
      const hasMore = skip + res.data.length < total;

      return { code: 0, data: res.data, total, hasMore }
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

  // =========== 互动与消息通知 ===========
  if (action === 'interact') {
    const { context: interactContext, targetId, type } = event; 
    try {
      let notifyOpenId = targetId;
      if (interactContext === 'feed') {
        const feedRes = await db.collection('feeds').doc(targetId).get();
        notifyOpenId = feedRes.data._openid;
        await db.collection('feeds').doc(targetId).update({ data: { [`interactions.${type}`]: _.inc(1) } });
      } else if (interactContext === 'user') {
        await db.collection('users').where({ _openid: targetId }).update({ data: { [`interactions.${type}`]: _.inc(1) } });
      }

      await db.collection('interactions').add({
        data: {
          to_user_id: notifyOpenId, from_user_id: myOpenId,
          type: type, context: interactContext, isPartner: false, read: false, createTime: db.serverDate()
        }
      });
      return { code: 0, msg: '互动成功' }
    } catch (err) { return { code: -1, msg: err.message } }
  }

  if (action === 'getNotifications') {
    try {
      const myUserRes = await db.collection('users').where({ _openid: myOpenId }).get();
      const myDocId = myUserRes.data.length > 0 ? myUserRes.data[0]._id : '';

      const res = await db.collection('interactions').where(_.or([
        { to_user_id: myOpenId },
        { to_user_id: myDocId }
      ])).orderBy('createTime', 'desc').limit(50).get();

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