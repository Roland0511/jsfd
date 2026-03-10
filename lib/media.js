const fs = require('fs');
const path = require('path');
const { fetchWithAuth, fetchWithRetry } = require('./auth.js');

// QPS 限制：5 QPS
const MAX_QPS = 5;
// 每个分片大小：4MB
const CHUNK_SIZE = 4 * 1024 * 1024;
// 最小分片大小阈值，小于这个值直接下载
const MIN_SIZE_FOR_CHUNKING = 10 * 1024 * 1024;

/**
 * 简单的 QPS 限制器
 */
class QPSLimiter {
    constructor(maxQPS) {
        this.maxQPS = maxQPS;
        this.timestamps = [];
    }

    async acquire() {
        const now = Date.now();
        // 移除 1 秒前的记录
        this.timestamps = this.timestamps.filter(t => now - t < 1000);

        if (this.timestamps.length < this.maxQPS) {
            this.timestamps.push(now);
            return;
        }

        // 计算需要等待的时间
        const oldest = this.timestamps[0];
        const waitTime = 1000 - (now - oldest) + 10;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.acquire();
    }
}

const qpsLimiter = new QPSLimiter(MAX_QPS);

/**
 * 获取文件扩展名
 */
function getExtensionFromContentType(contentType) {
    const typeMap = {
        // 图片
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        // 视频
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
        'video/webm': 'webm',
        // 音频
        'audio/mpeg': 'mp3',
        'audio/mp3': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/webm': 'webm',
        // 文档
        'application/pdf': 'pdf',
        'application/zip': 'zip',
        'application/x-rar-compressed': 'rar',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    };

    // 精确匹配
    if (typeMap[contentType]) {
        return typeMap[contentType];
    }

    // 部分匹配
    for (const [type, ext] of Object.entries(typeMap)) {
        if (contentType.includes(type.split('/')[1])) {
            return ext;
        }
    }

    // 默认
    return 'bin';
}

/**
 * 获取文件大小（先尝试 HEAD 请求，失败则用 GET 请求）
 */
async function getFileSize(url, accessToken) {
    try {
        const res = await fetchWithAuth(url, {
            method: 'HEAD',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const contentLength = res.headers.get('content-length');
        const acceptRanges = res.headers.get('accept-ranges');
        const contentType = res.headers.get('content-type') || '';

        return {
            size: contentLength ? parseInt(contentLength, 10) : null,
            acceptRanges: acceptRanges === 'bytes',
            contentType
        };
    } catch (e) {
        // HEAD 请求失败，尝试用 GET 请求的第一个字节来获取信息
        try {
            const res = await fetchWithAuth(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Range': 'bytes=0-0'
                }
            });

            const contentRange = res.headers.get('content-range');
            const acceptRanges = res.headers.get('accept-ranges');
            const contentType = res.headers.get('content-type') || '';

            let size = null;
            if (contentRange) {
                const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                if (match) {
                    size = parseInt(match[1], 10);
                }
            }

            return {
                size,
                acceptRanges: acceptRanges === 'bytes' || (res.status === 206),
                contentType
            };
        } catch (e2) {
            // 如果都失败，返回空信息，将直接下载
            return {
                size: null,
                acceptRanges: false,
                contentType: ''
            };
        }
    }
}

/**
 * 下载单个分片
 */
async function downloadChunk(url, accessToken, start, end) {
    await qpsLimiter.acquire();

    const res = await fetchWithAuth(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Range': `bytes=${start}-${end}`
        }
    });

    if (res.status !== 206) {
        throw new Error(`Failed to download chunk ${start}-${end}, status: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/**
 * 并发下载文件
 */
async function downloadConcurrent(url, accessToken, fileSize, concurrency = 3) {
    const numChunks = Math.ceil(fileSize / CHUNK_SIZE);
    const results = new Array(numChunks);

    // 创建工作队列
    const queue = [];
    for (let i = 0; i < numChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min((i + 1) * CHUNK_SIZE - 1, fileSize - 1);
        queue.push({ index: i, start, end });
    }

    // 工作线程函数
    async function worker() {
        while (queue.length > 0) {
            const task = queue.shift();
            if (!task) break;
            const buffer = await downloadChunk(url, accessToken, task.start, task.end);
            results[task.index] = buffer;
        }
    }

    // 启动并发 worker
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }

    // 等待所有 worker 完成
    await Promise.all(workers);

    // 验证所有分片都已下载
    for (let i = 0; i < numChunks; i++) {
        if (!results[i]) {
            throw new Error(`Missing chunk ${i}`);
        }
    }

    return Buffer.concat(results);
}

/**
 * 下载媒体文件（支持大文件分片下载）
 */
async function downloadMedia(fileToken, savePath, accessToken) {
    const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;

    // 先获取文件信息
    const { size, acceptRanges, contentType } = await getFileSize(url, accessToken);

    // 获取文件扩展名
    const ext = getExtensionFromContentType(contentType);
    const finalSavePath = savePath.endsWith(`.${ext}`) ? savePath : `${savePath}.${ext}`;

    let buffer;

    // 如果文件较小或不支持分片，直接下载
    if (!acceptRanges || !size || size < MIN_SIZE_FOR_CHUNKING) {
        const res = await fetchWithAuth(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const arrayBuffer = await res.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
    } else {
        // 大文件并发分片下载
        buffer = await downloadConcurrent(url, accessToken, size);
    }

    // 确保输出目录存在
    const outputDir = path.dirname(finalSavePath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(finalSavePath, buffer);

    return finalSavePath;
}

/**
 * 下载飞书白板为图片
 * @param {string} whiteboardToken - 白板 token
 * @param {string} savePath - 保存路径（不含扩展名）
 * @param {string} accessToken - 飞书 access token
 * @param {boolean} [useCustomToken=false] - 是否使用自定义 token（绕过项目内置 auth）
 * @returns {string} 最终保存的文件路径
 */
async function downloadWhiteboard(whiteboardToken, savePath, accessToken, useCustomToken = false) {
    const url = `https://open.feishu.cn/open-apis/board/v1/whiteboards/${whiteboardToken}/download_as_image`;

    let res;
    if (useCustomToken) {
        res = await fetchWithRetry(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
    } else {
        res = await fetchWithAuth(url, { method: 'GET' });
    }

    // Get file extension from content-type
    const contentType = res.headers.get('content-type') || '';
    let ext = 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('svg')) ext = 'svg';

    const finalSavePath = savePath.endsWith(`.${ext}`) ? savePath : `${savePath}.${ext}`;

    // Ensure output directory exists
    const outputDir = path.dirname(finalSavePath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(finalSavePath, buffer);

    return finalSavePath;
}

module.exports = {
    downloadMedia,
    downloadWhiteboard
};
