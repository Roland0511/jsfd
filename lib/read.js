const fs = require('fs');
const { getToken } = require('./auth.js');
const { fetchDocxContent } = require('./docx.js');
const { fetchBitableContent } = require('./bitable.js');
const { fetchSheetContent, fetchSheetRawData, csvContent } = require('./sheet.js');
const { resolveWiki } = require('./wiki.js');
const { extractToken } = require('./utils.js');
const {
    CACHE_ASSETS_DIR,
    CACHE_DOCS_DIR,
    ensureCacheDirs,
    getCacheDocPath,
    isCacheValid,
    sanitizeSheetName
} = require('./cache.js');
const { downloadMedia } = require('./media.js');

async function readDocRaw(docToken) {
    const accessToken = await getToken();
    const cleanToken = extractToken(docToken);

    try {
        return await fetchDocxContent(cleanToken, accessToken);
    } catch (e) {
        // Code 1770002 = Not Found (often means it's a wiki token not a doc token)
        // Code 1061001 = Permission denied (sometimes happens with wiki wrappers)
        // "Request failed with status code 404" = Generic Axios/HTTP error
        const isNotFound = e.message.includes('not found') ||
                           e.message.includes('1770002') ||
                           e.message.includes('status code 404') ||
                           e.message.includes('HTTP 404');

        if (isNotFound) {
            try {
                const wikiNode = await resolveWiki(cleanToken, accessToken);
                if (wikiNode) {
                    const { obj_token, obj_type } = wikiNode;

                    if (obj_type === 'docx' || obj_type === 'doc') {
                        return await fetchDocxContent(obj_token, accessToken);
                    } else if (obj_type === 'bitable') {
                        return await fetchBitableContent(obj_token, accessToken);
                    } else if (obj_type === 'sheet') {
                        return await fetchSheetContent(obj_token, accessToken);
                    } else {
                        throw new Error(`Unsupported Wiki Object Type: ${obj_type}`);
                    }
                }
            } catch (wikiError) {
                // If wiki resolution also fails, throw the original error
            }
        }
        throw e;
    }
}

async function exportSheetToCache(docToken, actualToken) {
    ensureCacheDirs();
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
            const tempSavePath = require('path').join(CACHE_ASSETS_DIR, filename);
            tokenMap.set(token, { tempSavePath, filename });

            try {
                // Check if file already exists
                let existingPath = null;
                const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
                const fs = require('fs');
                for (const ext of exts) {
                    const testPath = `${tempSavePath}.${ext}`;
                    if (fs.existsSync(testPath)) {
                        existingPath = testPath;
                        break;
                    }
                }

                if (existingPath) {
                    console.error(`[feishu-doc] Using cached image: ${token}`);
                    const actualFilename = require('path').basename(existingPath);
                    tokenMap.get(token).actualFilename = actualFilename;
                    tokenMap.get(token).savedPath = existingPath;
                    downloads.push({ token, savedPath: existingPath, success: true, cached: true });
                } else {
                    console.error(`[feishu-doc] Downloading image: ${token}...`);
                    const savedPath = await downloadMedia(token, tempSavePath, accessToken);
                    const actualFilename = require('path').basename(savedPath);
                    tokenMap.get(token).actualFilename = actualFilename;
                    tokenMap.get(token).savedPath = savedPath;
                    downloads.push({ token, savedPath, success: true, cached: false });
                }
            } catch (err) {
                console.error(`[feishu-doc] Failed to download image ${token}:`, err.message);
                downloads.push({ token, error: err.message, success: false });
            }
        }
    }

    // Process each sheet and write to individual files
    const sheetFiles = [];
    const path = require('path');
    const fs = require('fs');

    for (const sheetResult of sheetCsvResults) {
        let modifiedCsvContent = sheetResult.content;

        // Replace token references in CSV
        if (sheetResult.imageTokens && sheetResult.imageTokens.length > 0) {
            for (const token of sheetResult.imageTokens) {
                const tokenInfo = tokenMap.get(token);
                if (tokenInfo && tokenInfo.actualFilename) {
                    const relativePath = path.posix.join('../assets', tokenInfo.actualFilename);
                    // Replace token:xxx with the local path
                    modifiedCsvContent = modifiedCsvContent.replace(new RegExp(`token:${token}`, 'g'), relativePath);
                }
            }
        }

        // Write individual sheet CSV file
        const sanitizedSheetName = sanitizeSheetName(sheetResult.title || 'Sheet');
        const csvPath = path.join(CACHE_DOCS_DIR, `${docToken}_${sanitizedSheetName}.csv`);
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
        cache_files: sheetFiles.map(sf => sf.csv_path),
        assets_dir: CACHE_ASSETS_DIR,
        images_downloaded: downloads.filter(d => d.success).length,
        images_failed: downloads.filter(d => !d.success).length,
        downloads
    };
}

async function readDoc(docToken) {
    const cleanToken = extractToken(docToken);

    // First check the document type
    const accessToken = await getToken();
    let isSheet = false;
    let actualToken = cleanToken;

    try {
        const wikiNode = await resolveWiki(cleanToken, accessToken);
        if (wikiNode) {
            const { obj_token, obj_type } = wikiNode;
            actualToken = obj_token;
            if (obj_type === 'sheet') {
                isSheet = true;
            } else if (obj_type === 'bitable') {
                // Bitable still uses raw read
                return await readDocRaw(docToken);
            }
        }
    } catch (e) {
        // Not a wiki node, continue
    }

    // If it's a sheet, handle specially
    if (isSheet) {
        ensureCacheDirs();

        // Check if cache is valid
        if (isCacheValid(cleanToken, true)) {
            try {
                // Read all sheet file paths
                const files = require('fs').readdirSync(CACHE_DOCS_DIR, { withFileTypes: true });
                const sheetFiles = [];
                const cacheFiles = [];

                for (const file of files) {
                    if (file.isFile() && file.name.startsWith(`${cleanToken}_`) && file.name.endsWith('.csv')) {
                        const filePath = require('path').join(CACHE_DOCS_DIR, file.name);
                        const sheetName = file.name.replace(`${cleanToken}_`, '').replace('.csv', '');
                        sheetFiles.push({
                            sheet_name: sheetName,
                            csv_path: filePath
                        });
                        cacheFiles.push(filePath);
                    }
                }

                return {
                    title: "Feishu Sheet",
                    cached: true,
                    sheet_files: sheetFiles,
                    cache_files: cacheFiles,
                    assets_dir: CACHE_ASSETS_DIR,
                    format: 'csv'
                };
            } catch (e) {
                console.error(`[feishu-doc] Failed to read sheet cache, falling back to fresh read:`, e.message);
            }
        }

        // Cache miss or invalid, export sheet to cache
        console.error(`[feishu-doc] Sheet cache miss for ${cleanToken}, exporting...`);
        const exportResult = await exportSheetToCache(cleanToken, actualToken);

        return {
            title: exportResult.title,
            cached: false,
            sheet_files: exportResult.sheet_files,
            cache_files: exportResult.cache_files,
            assets_dir: exportResult.assets_dir,
            images_downloaded: exportResult.images_downloaded,
            format: 'csv'
        };
    }

    // For docx type, proceed with existing logic
    ensureCacheDirs();

    // Check if cache is valid
    if (isCacheValid(cleanToken, false)) {
        try {
            const cachePath = getCacheDocPath(cleanToken, false);
            // Just read the title from first line
            let title = 'Document';
            try {
                const contentPreview = require('fs').readFileSync(cachePath, 'utf-8', { length: 1000 });
                const titleMatch = contentPreview.match(/^#\s+(.+)\n/);
                title = titleMatch ? titleMatch[1] : 'Document';
            } catch (e) {
                // Ignore read error for title parsing
            }
            return {
                title,
                cached: true,
                cache_path: cachePath,
                cache_files: [cachePath],
                assets_dir: CACHE_ASSETS_DIR,
                images_downloaded: 0,
                boards_downloaded: 0,
                files_downloaded: 0,
                users_resolved: 0,
                format: 'markdown'
            };
        } catch (e) {
            console.error(`[feishu-doc] Failed to read cache, falling back to fresh read:`, e.message);
        }
    }

    // Delegate to export module to avoid circular dependency
    const { exportDocToCache } = require('./export.js');

    // Cache miss or invalid, export to cache first
    console.error(`[feishu-doc] Cache miss for ${cleanToken}, exporting...`);
    const exportResult = await exportDocToCache(cleanToken);

    return {
        title: exportResult.title,
        cached: false,
        cache_path: exportResult.markdown_path,
        cache_files: [exportResult.markdown_path],
        assets_dir: exportResult.assets_dir,
        images_downloaded: exportResult.images_downloaded,
        boards_downloaded: exportResult.boards_downloaded,
        files_downloaded: exportResult.files_downloaded,
        users_resolved: exportResult.users_resolved,
        format: 'markdown'
    };
}

module.exports = {
    readDocRaw,
    readDoc,
    exportSheetToCache
};
