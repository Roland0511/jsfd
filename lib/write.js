const { fetchWithAuth, getToken } = require('./auth.js');
const { sanitizeMarkdown, validateBlocks } = require('./input_guard.js');
const { resolveToken } = require('./utils.js');

// Block Types Mapping
const BLOCK_TYPE_NAMES = {
  1: "Page",
  2: "Text",
  3: "Heading1",
  4: "Heading2",
  5: "Heading3",
  12: "Bullet",
  13: "Ordered",
  14: "Code",
  15: "Quote",
  17: "Todo",
  18: "Bitable",
  21: "Diagram",
  22: "Divider",
  23: "File",
  27: "Image",
  30: "Sheet",
  31: "Table",
  32: "TableCell",
};

async function batchInsertBlocks(targetToken, blocks) {
    const BATCH_SIZE = 20;
    let blocksAdded = 0;

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
        const chunk = blocks.slice(i, i + BATCH_SIZE);
        const payload = { children: chunk };

        let retries = 3;
        while (retries > 0) {
            try {
                let createData;
                let batchError = null;

                try {
                    if (i > 0) await new Promise(r => setTimeout(r, 200));

                    const createRes = await fetchWithAuth(`https://open.feishu.cn/open-apis/docx/v1/documents/${targetToken}/blocks/${targetToken}/children`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    createData = await createRes.json();
                } catch (err) {
                    // Handle HTTP 400 (Bad Request) or 422 (Unprocessable Entity) by catching fetch error
                    if (err.message && (err.message.includes('HTTP 400') || err.message.includes('HTTP 422'))) {
                        batchError = err;
                    } else {
                        throw err;
                    }
                }

                if (batchError || (createData && createData.code !== 0)) {
                     const errorMsg = batchError ? batchError.message : `Code ${createData.code}: ${createData.msg}`;
                     console.error(`[feishu-doc] Batch failed (${errorMsg}). Retrying item-by-item.`);

                     for (const block of chunk) {
                        try {
                            const singleRes = await fetchWithAuth(`https://open.feishu.cn/open-apis/docx/v1/documents/${targetToken}/blocks/${targetToken}/children`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ children: [block] })
                            });
                            const singleData = await singleRes.json();
                            if (singleData.code !== 0) {
                                console.error(`[feishu-doc] Skipping bad block: ${singleData.msg} (Type: ${block.block_type})`);
                            } else {
                                blocksAdded++;
                            }
                        } catch (err) {
                             console.error(`[feishu-doc] Skipping bad block (exception): ${err.message} (Type: ${block.block_type})`);
                        }
                     }
                     // Consider the chunk processed (partially successful) to avoid failing the whole operation
                     // But we break the retry loop because we handled this chunk manually
                     break;
                }

                blocksAdded += chunk.length;
                break;
            } catch (e) {
                retries--;
                if (retries === 0) throw e;
                await new Promise(r => setTimeout(r, (3 - retries) * 1000));
            }
        }
    }
    return blocksAdded;
}

async function createDoc(title, folderToken) {
    const payload = { title };
    if (folderToken) payload.folder_token = folderToken;

    const res = await fetchWithAuth('https://open.feishu.cn/open-apis/docx/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);

    return {
        document_id: data.data?.document?.document_id,
        title: data.data?.document?.title,
        url: `https://feishu.cn/docx/${data.data?.document?.document_id}`
    };
}

function parseMarkdownToBlocks(content) {
    const blocks = [];
    const lines = content.split('\n');
    let inCodeBlock = false;
    let codeContent = [];

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                inCodeBlock = false;
                const codeText = sanitizeMarkdown(codeContent.join('\n'));
                blocks.push({
                    block_type: 14,
                    code: { elements: [{ text_run: { content: codeText, text_element_style: {} } }], language: 1 }
                });
                codeContent = [];
            } else {
                inCodeBlock = true;
            }
            continue;
        }
        if (inCodeBlock) {
            codeContent.push(line);
            continue;
        }

        if (!line.trim()) continue;

        let blockType = 2;
        let propName = 'text';
        let cleanText = sanitizeMarkdown(line);

        if (line.startsWith('# ')) { blockType = 3; propName = 'heading1'; cleanText = sanitizeMarkdown(line.substring(2)); }
        else if (line.startsWith('## ')) { blockType = 4; propName = 'heading2'; cleanText = sanitizeMarkdown(line.substring(3)); }
        else if (line.startsWith('### ')) { blockType = 5; propName = 'heading3'; cleanText = sanitizeMarkdown(line.substring(4)); }
        else if (line.startsWith('> ')) { blockType = 15; propName = 'quote'; cleanText = sanitizeMarkdown(line.substring(2)); }
        else if (line.startsWith('- ') || line.startsWith('* ')) { blockType = 12; propName = 'bullet'; cleanText = sanitizeMarkdown(line.substring(2)); }
        else if (/^\d+\. /.test(line)) { blockType = 13; propName = 'ordered'; cleanText = sanitizeMarkdown(line.replace(/^\d+\. /, '')); }

        if (!cleanText.trim()) continue;

        blocks.push({
            block_type: blockType,
            [propName]: { elements: [{ text_run: { content: cleanText, text_element_style: {} } }] }
        });
    }

    return blocks;
}

async function writeDoc(docToken, content) {
    // 0. Auto-resolve Wiki token if needed
    let targetToken = docToken;
    try {
        const resolved = await resolveToken(docToken);
        if (typeof resolved === 'string') targetToken = resolved;
        else if (resolved.token) targetToken = resolved.token;
    } catch (e) {}

    // 1. Get existing blocks (validation step)
    let blocksRes;
    try {
        blocksRes = await fetchWithAuth(`https://open.feishu.cn/open-apis/docx/v1/documents/${targetToken}/blocks`);
    } catch (e) {
        throw e;
    }

    const blocksData = await blocksRes.json();

    // 2. Delete existing content (robustly)
    try {
        const childrenRes = await fetchWithAuth(`https://open.feishu.cn/open-apis/docx/v1/documents/${targetToken}/blocks/${targetToken}/children?page_size=500`);
        const childrenData = await childrenRes.json();

        if (childrenData.code === 0 && childrenData.data?.items?.length > 0) {
            const directChildrenCount = childrenData.data.items.length;
            await fetchWithAuth(`https://open.feishu.cn/open-apis/docx/v1/documents/${targetToken}/blocks/${targetToken}/children/batch_delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start_index: 0, end_index: directChildrenCount })
            });
        }
    } catch (delErr) {
        console.warn(`[feishu-doc] Warning: clear content failed. Appending instead.`);
    }

    // 3. Parse Content into Blocks
    const blocks = parseMarkdownToBlocks(content);

    const validBlocks = validateBlocks(blocks);
    const blocksAdded = await batchInsertBlocks(targetToken, validBlocks);

    return { success: true, message: 'Document overwritten', blocks_added: blocksAdded };
}

async function appendDoc(docToken, content) {
    let targetToken = docToken;
    try {
        const resolved = await resolveToken(docToken);
        if (typeof resolved === 'string') targetToken = resolved;
        else if (resolved.token) targetToken = resolved.token;
    } catch (e) {}

    // Use the same robust parsing and batching logic as writeDoc
    const blocks = parseMarkdownToBlocks(content);
    const validBlocks = validateBlocks(blocks);
    const blocksAdded = await batchInsertBlocks(targetToken, validBlocks);

    return { success: true, message: 'Document appended', blocks_added: blocksAdded };
}

module.exports = {
    BLOCK_TYPE_NAMES,
    batchInsertBlocks,
    createDoc,
    writeDoc,
    appendDoc
};
