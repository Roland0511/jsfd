const fs = require('fs');
const path = require('path');
const { getToken } = require('./auth.js');
const { fetchSheetRawData, csvContent } = require('./sheet.js');
const { resolveWiki } = require('./wiki.js');
const { extractToken } = require('./utils.js');
const { resolveUserMentions, fetchUserInfo } = require('./user.js');
const { readDocRaw } = require('./read.js');
const {
    CACHE_ASSETS_DIR,
    CACHE_DOCS_DIR,
    ensureCacheDirs,
    getCacheDocPath,
    sanitizeSheetName
} = require('./cache.js');
const { downloadMedia, downloadWhiteboard } = require('./media.js');

async function exportDocToDir(docToken, outputDir, options = {}) {
    const { useSharedAssets = false, skipCache = false } = options;
    const accessToken = await getToken();

    // 1. Read the document content first (use raw read without cache)
    const docResult = await readDocRaw(docToken);
    let { title, content } = docResult;

    // 2. Prepare output directory
    if (!outputDir) {
        outputDir = process.cwd();
    }
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 3. Resolve user mentions (@ou_xxxx)
    console.error(`[feishu-doc] Resolving user mentions...`);
    const mentionResult = await resolveUserMentions(content, accessToken);
    content = mentionResult.content;
    const userMap = mentionResult.userMap;

    // 4. Sanitize title for filename
    const sanitizedTitle = title.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'document';
    const markdownPath = path.join(outputDir, `${sanitizedTitle}.md`);

    // Check if this content has image tokens, board tokens, or file tokens
    const hasImageTokens = /!\[([^\]]*)\]\(token:([a-zA-Z0-9]+)\)/.test(content);
    const hasBoardTokens = /!\[([^\]]*)\]\(board_token:([a-zA-Z0-9]+)\)/.test(content);
    const hasFileTokens = /\[([^\]]*)\]\(file_token:([a-zA-Z0-9]+)(\|[^\)]+)?\)/.test(content);
    const hasVideoTags = /<video[^>]*src="file_token:([a-zA-Z0-9]+)"[^>]*>/.test(content);
    const hasAnyMedia = hasImageTokens || hasBoardTokens || hasFileTokens || hasVideoTags;

    // If no images or boards, just write directly and return
    if (!hasAnyMedia) {
        const finalMarkdown = `# ${title}\n\n${content}`;
        fs.writeFileSync(markdownPath, finalMarkdown, 'utf-8');
        return {
            success: true,
            title,
            content: finalMarkdown,
            markdown_path: markdownPath,
            assets_dir: null,
            images_downloaded: 0,
            images_failed: 0,
            boards_downloaded: 0,
            boards_failed: 0,
            users_resolved: userMap.size,
            downloads: [],
            users: Array.from(userMap.entries()).map(([openId, user]) => ({
                open_id: openId,
                name: user.name,
                email: user.email || user.enterprise_email
            }))
        };
    }

    // Use shared assets dir if specified
    const assetsDir = useSharedAssets ? CACHE_ASSETS_DIR : path.join(outputDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
    }

    // 5. Extract all image tokens, board tokens, and file tokens from markdown
    // Pattern matches:
    //   - ![image-UgM1bnnc](token:UgM1bnnc2o270kxTmZmciXS1n0c)
    //   - ![whiteboard-xxx](board_token:xxx)
    //   - [filename](file_token:token|viewType)
    //   - <video src="file_token:token" controls></video>
    const imageRegex = /!\[([^\]]*)\]\(token:([a-zA-Z0-9]+)\)/g;
    const boardRegex = /!\[([^\]]*)\]\(board_token:([a-zA-Z0-9]+)\)/g;
    const fileRegex = /\[([^\]]*)\]\(file_token:([a-zA-Z0-9]+)(\|([^\)]+))?\)/g;
    const videoTagRegex = /<video[^>]*src="file_token:([a-zA-Z0-9]+)"[^>]*>/g;
    let modifiedContent = content;
    const tokenMap = new Map(); // token -> localPath
    const downloads = [];

    let match;
    let index = 0;
    // Extract image tokens
    while ((match = imageRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const altText = match[1];
        const token = match[2];

        if (!tokenMap.has(token)) {
            // For shared assets, use token as filename to avoid duplicates
            let filename;
            if (useSharedAssets) {
                filename = `img_${token}`;
            } else {
                filename = `image_${index}_${token.substring(0, 8)}`;
            }
            const tempSavePath = path.join(assetsDir, filename);
            tokenMap.set(token, { tempSavePath, filename, index, useSharedAssets, type: 'image' });
            index++;
        }
    }
    // Extract board tokens
    while ((match = boardRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const altText = match[1];
        const token = match[2];

        if (!tokenMap.has(token)) {
            let filename;
            if (useSharedAssets) {
                filename = `board_${token}`;
            } else {
                filename = `whiteboard_${index}_${token.substring(0, 8)}`;
            }
            const tempSavePath = path.join(assetsDir, filename);
            tokenMap.set(token, { tempSavePath, filename, index, useSharedAssets, type: 'board' });
            index++;
        }
    }
    // Extract file tokens from links
    while ((match = fileRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const fileName = match[1];
        const token = match[2];
        const viewType = match[4] || 'card';

        if (!tokenMap.has(token)) {
            let filename;
            if (useSharedAssets) {
                filename = `file_${token}`;
            } else {
                // Use original filename if possible, sanitize it
                const sanitizedName = fileName.replace(/[<>:"/\\|?*]+/g, '_').trim() || `file_${index}`;
                filename = `${sanitizedName}_${token.substring(0, 8)}`;
            }
            const tempSavePath = path.join(assetsDir, filename);
            tokenMap.set(token, { tempSavePath, filename, index, useSharedAssets, type: 'file', originalName: fileName, viewType });
            index++;
        }
    }
    // Extract file tokens from video tags
    while ((match = videoTagRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const token = match[1];

        if (!tokenMap.has(token)) {
            let filename;
            if (useSharedAssets) {
                filename = `video_${token}`;
            } else {
                filename = `video_${index}_${token.substring(0, 8)}`;
            }
            const tempSavePath = path.join(assetsDir, filename);
            tokenMap.set(token, { tempSavePath, filename, index, useSharedAssets, type: 'file', isVideo: true });
            index++;
        }
    }

    // 6. Download all images, boards, and files (skip if already exists in shared assets)
    for (const [token, { tempSavePath, filename, useSharedAssets, type }] of tokenMap.entries()) {
        try {
            // Check if file already exists (with any extension)
            let existingPath = null;
            if (useSharedAssets) {
                const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'mp3', 'pdf', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'bin'];
                for (const ext of exts) {
                    const testPath = `${tempSavePath}.${ext}`;
                    if (fs.existsSync(testPath)) {
                        existingPath = testPath;
                        break;
                    }
                }
            }

            if (existingPath) {
                console.error(`[feishu-doc] Using cached ${type}: ${token}`);
                const actualFilename = path.basename(existingPath);
                tokenMap.get(token).actualFilename = actualFilename;
                tokenMap.get(token).savedPath = existingPath;
                downloads.push({ token, savedPath: existingPath, success: true, cached: true, type });
            } else {
                console.error(`[feishu-doc] Downloading ${type}: ${token}...`);
                let savedPath;
                if (type === 'board') {
                    savedPath = await downloadWhiteboard(token, tempSavePath, accessToken, false);
                } else {
                    // Both images and files use downloadMedia
                    savedPath = await downloadMedia(token, tempSavePath, accessToken);
                }
                const actualFilename = path.basename(savedPath);
                tokenMap.get(token).actualFilename = actualFilename;
                tokenMap.get(token).savedPath = savedPath;
                downloads.push({ token, savedPath, success: true, cached: false, type });
            }
        } catch (err) {
            console.error(`[feishu-doc] Failed to download ${type} ${token}:`, err.message);
            downloads.push({ token, error: err.message, success: false, type });
        }
    }

    // Helper function to format markdown links with proper handling of spaces
    const formatMarkdownLink = (altText, relativePath, isImage = false) => {
        // If path contains spaces, wrap it in angle brackets
        const needsBrackets = relativePath.includes(' ');
        const pathPart = needsBrackets ? `<${relativePath}>` : relativePath;
        if (isImage) {
            return `![${altText}](${pathPart})`;
        }
        return `[${altText}](${pathPart})`;
    };

    // Helper function to format HTML video tag with proper handling of spaces in src
    const formatVideoTag = (relativePath) => {
        // For HTML attributes, we need to URL encode spaces or use proper quoting
        // Use URL encoding for spaces
        const encodedPath = relativePath.replace(/ /g, '%20');
        return `<video src="${encodedPath}" controls></video>`;
    };

    // 7. Replace token references with local paths
    // Use a new regex to replace, since we need the actual filenames with extensions
    // First replace image tokens
    modifiedContent = content.replace(/!\[([^\]]*)\]\(token:([a-zA-Z0-9]+)\)/g, (fullMatch, altText, token) => {
        const tokenInfo = tokenMap.get(token);
        if (tokenInfo && tokenInfo.actualFilename) {
            let relativePath;
            if (useSharedAssets) {
                // For cached output, use relative path from docs dir to assets dir
                relativePath = path.posix.join('../assets', tokenInfo.actualFilename);
            } else {
                relativePath = path.posix.join('assets', tokenInfo.actualFilename);
            }
            return formatMarkdownLink(altText, relativePath, true);
        }
        return fullMatch; // keep original if download failed
    });
    // Then replace board tokens
    modifiedContent = modifiedContent.replace(/!\[([^\]]*)\]\(board_token:([a-zA-Z0-9]+)\)/g, (fullMatch, altText, token) => {
        const tokenInfo = tokenMap.get(token);
        if (tokenInfo && tokenInfo.actualFilename) {
            let relativePath;
            if (useSharedAssets) {
                relativePath = path.posix.join('../assets', tokenInfo.actualFilename);
            } else {
                relativePath = path.posix.join('assets', tokenInfo.actualFilename);
            }
            return formatMarkdownLink(altText, relativePath, true);
        }
        return fullMatch; // keep original if download failed
    });
    // Then replace file tokens from links
    modifiedContent = modifiedContent.replace(/\[([^\]]*)\]\(file_token:([a-zA-Z0-9]+)(\|([^\)]+))?\)/g, (fullMatch, fileName, token, _, viewType) => {
        const tokenInfo = tokenMap.get(token);
        if (tokenInfo && tokenInfo.actualFilename) {
            let relativePath;
            if (useSharedAssets) {
                relativePath = path.posix.join('../assets', tokenInfo.actualFilename);
            } else {
                relativePath = path.posix.join('assets', tokenInfo.actualFilename);
            }
            return formatMarkdownLink(fileName, relativePath, false);
        }
        return fullMatch; // keep original if download failed
    });
    // Then replace file tokens from video tags
    modifiedContent = modifiedContent.replace(/<video[^>]*src="file_token:([a-zA-Z0-9]+)"[^>]*>/g, (fullMatch, token) => {
        const tokenInfo = tokenMap.get(token);
        if (tokenInfo && tokenInfo.actualFilename) {
            let relativePath;
            if (useSharedAssets) {
                relativePath = path.posix.join('../assets', tokenInfo.actualFilename);
            } else {
                relativePath = path.posix.join('assets', tokenInfo.actualFilename);
            }
            return formatVideoTag(relativePath);
        }
        return fullMatch; // keep original if download failed
    });

    // 8. Prepend title as H1
    const finalMarkdown = `# ${title}\n\n${modifiedContent}`;

    // 9. Write markdown file
    fs.writeFileSync(markdownPath, finalMarkdown, 'utf-8');

    return {
        success: true,
        title,
        content: finalMarkdown,
        markdown_path: markdownPath,
        assets_dir: assetsDir,
        images_downloaded: downloads.filter(d => d.success && d.type === 'image').length,
        images_failed: downloads.filter(d => !d.success && d.type === 'image').length,
        boards_downloaded: downloads.filter(d => d.success && d.type === 'board').length,
        boards_failed: downloads.filter(d => !d.success && d.type === 'board').length,
        files_downloaded: downloads.filter(d => d.success && d.type === 'file').length,
        files_failed: downloads.filter(d => !d.success && d.type === 'file').length,
        users_resolved: userMap.size,
        downloads,
        users: Array.from(userMap.entries()).map(([openId, user]) => ({
            open_id: openId,
            name: user.name,
            email: user.email || user.enterprise_email
        }))
    };
}

async function exportDoc(docToken, outputDir) {
    return await exportDocToDir(docToken, outputDir, { useSharedAssets: false });
}

async function exportDocToCache(docToken) {
    ensureCacheDirs();
    const result = await exportDocToDir(docToken, CACHE_DOCS_DIR, { useSharedAssets: true, skipCache: false });
    // Rename the markdown file to use token as filename for easy lookup
    const tokenMarkdownPath = getCacheDocPath(docToken, false);
    if (result.markdown_path !== tokenMarkdownPath) {
        if (fs.existsSync(tokenMarkdownPath)) {
            fs.unlinkSync(tokenMarkdownPath);
        }
        fs.renameSync(result.markdown_path, tokenMarkdownPath);
        result.markdown_path = tokenMarkdownPath;
    }
    // Don't read content back to keep memory usage low
    delete result.content;
    return result;
}

async function exportSheetToDir(docToken, actualToken, outputDir) {
    if (!outputDir) {
        outputDir = process.cwd();
    }
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const assetsDir = path.join(outputDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
    }

    const accessToken = await getToken();

    // Get raw sheet data
    const rawData = await fetchSheetRawData(actualToken, accessToken);
    if (rawData.error) {
        throw new Error(rawData.error);
    }

    // Convert to CSV - returns array of sheet data
    const sheetCsvResults = csvContent(rawData.sheets);

    // Collect all image tokens from all sheets
    const allImageTokens = new Set();
    for (const sheetResult of sheetCsvResults) {
        if (sheetResult.imageTokens) {
            for (const token of sheetResult.imageTokens) {
                allImageTokens.add(token);
            }
        }
    }

    const downloads = [];
    const tokenMap = new Map();

    // Download images if any
    if (allImageTokens.size > 0) {
        for (const token of allImageTokens) {
            const filename = `img_${token}`;
            const tempSavePath = path.join(assetsDir, filename);
            tokenMap.set(token, { tempSavePath, filename });

            try {
                console.error(`[feishu-doc] Downloading image: ${token}...`);
                const savedPath = await downloadMedia(token, tempSavePath, accessToken);
                const actualFilename = path.basename(savedPath);
                tokenMap.get(token).actualFilename = actualFilename;
                tokenMap.get(token).savedPath = savedPath;
                downloads.push({ token, savedPath, success: true });
            } catch (err) {
                console.error(`[feishu-doc] Failed to download image ${token}:`, err.message);
                downloads.push({ token, error: err.message, success: false });
            }
        }
    }

    // Process each sheet and write to individual files
    const sheetFiles = [];

    for (const sheetResult of sheetCsvResults) {
        let modifiedCsvContent = sheetResult.content;

        // Replace token references in CSV
        if (sheetResult.imageTokens && sheetResult.imageTokens.length > 0) {
            for (const token of sheetResult.imageTokens) {
                const tokenInfo = tokenMap.get(token);
                if (tokenInfo && tokenInfo.actualFilename) {
                    const relativePath = path.posix.join('assets', tokenInfo.actualFilename);
                    // Replace token:xxx with the local path
                    modifiedCsvContent = modifiedCsvContent.replace(new RegExp(`token:${token}`, 'g'), relativePath);
                }
            }
        }

        // Write individual sheet CSV file
        const sanitizedSheetName = sanitizeSheetName(sheetResult.title || 'Sheet');
        const csvPath = path.join(outputDir, `${sanitizedSheetName}.csv`);
        fs.writeFileSync(csvPath, modifiedCsvContent, 'utf-8');

        sheetFiles.push({
            sheet_name: sheetResult.title,
            csv_path: csvPath
        });
    }

    return {
        success: true,
        title: rawData.title,
        sheet_files: sheetFiles,
        assets_dir: assetsDir,
        images_downloaded: downloads.filter(d => d.success).length,
        images_failed: downloads.filter(d => !d.success).length,
        downloads
    };
}

module.exports = {
    exportDocToDir,
    exportDoc,
    exportDocToCache,
    exportSheetToDir
};
