const { getToken } = require('./auth.js');
const { resolveWiki } = require('./wiki.js');

function extractToken(input) {
    if (!input) return input;
    // Handle full URLs: https://.../docx/TOKEN or /wiki/TOKEN
    const match = input.match(/\/(?:docx|wiki|doc|sheet|file|base)\/([a-zA-Z0-9]+)/);
    if (match) return match[1];
    return input;
}

async function resolveToken(docToken) {
    // Ensure we have a clean token first
    const cleanToken = extractToken(docToken);
    const accessToken = await getToken();
    try {
        const wikiNode = await resolveWiki(cleanToken, accessToken);
        if (wikiNode) {
            const { obj_token, obj_type } = wikiNode;
            if (obj_type === 'docx' || obj_type === 'doc') {
                return obj_token;
            } else if (obj_type === 'bitable' || obj_type === 'sheet') {
                 return { token: obj_token, type: obj_type };
            }
        }
    } catch (e) {
        // Ignore resolution errors
    }
    return cleanToken; // Default fallback
}

async function resolveDoc(docToken) {
    const resolved = await resolveToken(docToken);
    if (!resolved) throw new Error('Could not resolve token');
    // Normalize return
    if (typeof resolved === 'string') return { token: resolved, type: 'docx' };
    return resolved;
}

module.exports = {
    extractToken,
    resolveToken,
    resolveDoc
};
