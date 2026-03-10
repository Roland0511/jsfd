const { getTenantAccessToken, fetchWithAuth } = require('./auth');
const fs = require('fs');
const path = require('path');

async function resolveWiki(token, accessToken) {
  // Try to resolve via get_node API first to get obj_token and obj_type
  // API: GET https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token={token}
  
  const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${token}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  const data = await response.json();
  
  if (data.code === 0 && data.data && data.data.node) {
    return {
      obj_token: data.data.node.obj_token,
      obj_type: data.data.node.obj_type, // 'docx', 'doc', 'sheet', 'bitable'
      title: data.data.node.title
    };
  }

  // Handle specific errors if needed (e.g., node not found)
  if (data.code !== 0) {
    throw new Error(`Wiki resolution failed: ${data.msg} (Code: ${data.code})`);
  }
  
  return null;
}

async function listChildren(token) {
    // 1. Get node info to find space_id and node_token
    const nodeRes = await fetchWithAuth(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${token}`);
    const nodeData = await nodeRes.json();
    
    if (nodeData.code !== 0) {
        throw new Error(`GetNode Error: ${nodeData.msg} (${nodeData.code})`);
    }
    
    const { space_id, node_token, title } = nodeData.data.node;
    
    // 2. List child nodes
    const childrenRes = await fetchWithAuth(`https://open.feishu.cn/open-apis/wiki/v2/spaces/${space_id}/nodes?parent_node_token=${node_token}`);
    const childrenData = await childrenRes.json();
    
    if (childrenData.code !== 0) {
        throw new Error(`ListNodes Error: ${childrenData.msg} (${childrenData.code})`);
    }
    
    return {
        parent: { title, token: node_token, space_id },
        children: childrenData.data.items.map(item => ({
            title: item.title,
            node_token: item.node_token,
            obj_token: item.obj_token,
            obj_type: item.obj_type,
            has_child: item.has_child
        }))
    };
}

async function searchWiki(query, nodeToken) {
    let results = [];
    if (!nodeToken) {
        throw new Error("searchWiki requires a valid nodeToken to start searching.");
    }
    try {
        const { children } = await listChildren(nodeToken);
        if (children && children.length > 0) {
            for (const child of children) {
                if (child.title && child.title.toLowerCase().includes(query.toLowerCase())) {
                    results.push(child);
                }
                if (child.has_child) {
                    const subResults = await searchWiki(query, child.node_token);
                    results = results.concat(subResults);
                }
            }
        }
    } catch (e) {
        console.warn(`[searchWiki] Error processing node ${nodeToken}: ${e.message}`);
    }
    return results;
}

module.exports = {
  resolveWiki,
  listChildren,
  searchWiki
};
