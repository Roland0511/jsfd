const { getToken, fetchWithAuth } = require('./auth.js');

async function fetchUserInfo(openId, accessToken) {
    const url = `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`;
    const res = await fetchWithAuth(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await res.json();
    if (data.code !== 0) {
        console.warn(`[feishu-doc] Failed to fetch user ${openId}: ${data.msg}`);
        return null;
    }
    return data.data.user;
}

async function resolveUserMentions(content, accessToken) {
    // Pattern matches: @ou_xxxxxxxxxxxx
    const mentionRegex = /@(ou_[a-zA-Z0-9]+)/g;
    const openIds = new Set();
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
        openIds.add(match[1]);
    }

    if (openIds.size === 0) {
        return { content, userMap: new Map() };
    }

    const userMap = new Map();
    for (const openId of openIds) {
        try {
            const userInfo = await fetchUserInfo(openId, accessToken);
            if (userInfo) {
                userMap.set(openId, userInfo);
            }
        } catch (err) {
            console.warn(`[feishu-doc] Error resolving user ${openId}:`, err.message);
        }
    }

    // Replace mentions in content
    let modifiedContent = content;
    for (const [openId, userInfo] of userMap.entries()) {
        const name = userInfo.name || openId;
        const email = userInfo.email || userInfo.enterprise_email;
        if (email) {
            modifiedContent = modifiedContent.replace(new RegExp(`@${openId}`, 'g'), `[${name}](mailto:${email})`);
        } else {
            modifiedContent = modifiedContent.replace(new RegExp(`@${openId}`, 'g'), name);
        }
    }

    return { content: modifiedContent, userMap };
}

module.exports = {
    fetchUserInfo,
    resolveUserMentions
};
