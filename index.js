/**
 * jafd - Just Another Feishu Doc Converter
 * Node.js API Entry Point
 */

const { readDoc, readDocRaw } = require('./lib/read.js');
const { createDoc, writeDoc, appendDoc } = require('./lib/write.js');
const { exportDoc, exportDocToDir, exportSheetToDir } = require('./lib/export.js');
const { resolveDoc } = require('./lib/utils.js');
const { resolveWiki, listChildren, searchWiki } = require('./lib/wiki.js');
const { extractToken } = require('./lib/utils.js');
const { getToken } = require('./lib/auth.js');

module.exports = {
    readDoc,
    readDocRaw,
    createDoc,
    writeDoc,
    appendDoc,
    resolveDoc,
    listChildren,
    searchWiki,
    exportDoc,
    exportDocToDir,
    exportSheetToDir,
    extractToken,
    getToken
};
