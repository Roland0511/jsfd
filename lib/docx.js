const { MarkdownConverter } = require('./markdown_converter');

async function fetchDocxContent(documentId, accessToken) {
  // 1. Get document info for title
  const infoUrl = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`;
  const infoRes = await fetch(infoUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const infoData = await infoRes.json();
  let title = "Untitled Docx";
  if (infoData.code === 0 && infoData.data && infoData.data.document) {
    title = infoData.data.document.title;
  }

  // 2. Fetch all blocks
  // List blocks API: GET https://open.feishu.cn/open-apis/docx/v1/documents/{document_id}/blocks
  // Use pagination if necessary, fetching all for now (basic implementation)
  let blocks = [];
  let pageToken = '';
  let hasMore = true;

  while (hasMore) {
    const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(`Failed to fetch docx blocks: ${data.msg}`);
    }

    if (data.data && data.data.items) {
      blocks = blocks.concat(data.data.items);
    }
    
    hasMore = data.data.has_more;
    pageToken = data.data.page_token;
  }

  const converter = new MarkdownConverter();
  const markdown = converter.convertBlocksToMarkdown(blocks);
  return { title, content: markdown };
}

async function appendDocxContent(documentId, content, accessToken) {
  // 1. Convert markdown content to Feishu blocks
  const blocks = convertMarkdownToBlocks(content);
  
  // 2. Append to the end of the document (root block)
  // POST https://open.feishu.cn/open-apis/docx/v1/documents/{document_id}/blocks/{block_id}/children
  // Use documentId as block_id to append to root
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      children: blocks,
      index: -1 // Append to end
    })
  });

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Failed to append to docx: ${data.msg}`);
  }
  
  return { success: true, appended_blocks: data.data.children };
}

function convertMarkdownToBlocks(markdown) {
  // Simple parser: split by newlines, treat # as headers, others as text
  // For robustness, this should be a real parser. Here we implement a basic one.
  const lines = markdown.split('\n');
  const blocks = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('# ')) {
      blocks.push({ block_type: 3, heading1: { elements: [{ text_run: { content: trimmed.substring(2) } }] } });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({ block_type: 4, heading2: { elements: [{ text_run: { content: trimmed.substring(3) } }] } });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({ block_type: 5, heading3: { elements: [{ text_run: { content: trimmed.substring(4) } }] } });
    } else if (trimmed.startsWith('- ')) {
      blocks.push({ block_type: 12, bullet: { elements: [{ text_run: { content: trimmed.substring(2) } }] } });
    } else {
      // Default to text (paragraph)
      blocks.push({ block_type: 2, text: { elements: [{ text_run: { content: line } }] } });
    }
  }
  return blocks;
}

module.exports = {
  fetchDocxContent,
  appendDocxContent
};
