#!/usr/bin/env node

/**
 * jafd - Just Another Feishu Doc Converter
 * CLI Entry Point
 */

const { program } = require('commander');
const { readDoc, readDocRaw } = require('../lib/read.js');
const { createDoc, writeDoc, appendDoc } = require('../lib/write.js');
const { exportDoc, exportDocToDir, exportSheetToDir } = require('../lib/export.js');
const { resolveDoc } = require('../lib/utils.js');
const { resolveWiki, listChildren, searchWiki } = require('../lib/wiki.js');
const { extractToken } = require('../lib/utils.js');
const { getToken } = require('../lib/auth.js');

program
  .name('jafd')
  .description('Just Another Feishu Doc Converter - Fetch and convert Feishu (Lark) content')
  .version('1.0.0');

// Read command
program
  .command('read')
  .description('Read a Feishu document (cached as markdown/csv with images)')
  .argument('<token>', 'Document token or URL')
  .action(async (token) => {
    try {
      console.log(JSON.stringify(await readDoc(token), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

// Export command
program
  .command('export')
  .description('Export document to specified directory')
  .argument('<token>', 'Document token or URL')
  .option('-o, --output-dir <path>', 'Output directory', process.cwd())
  .action(async (token, options) => {
    try {
      const cleanToken = extractToken(token);
      let isSheet = false;
      let actualToken = cleanToken;
      const accessToken = await getToken();
      try {
        const wikiNode = await resolveWiki(cleanToken, accessToken);
        if (wikiNode) {
          const { obj_token, obj_type } = wikiNode;
          actualToken = obj_token;
          if (obj_type === 'sheet') {
            isSheet = true;
          }
        }
      } catch (e) {
        // Not a wiki node, continue
      }

      if (isSheet) {
        console.log(JSON.stringify(await exportSheetToDir(token, actualToken, options.outputDir), null, 2));
      } else {
        console.log(JSON.stringify(await exportDoc(token, options.outputDir), null, 2));
      }
    } catch (e) {
      handleError(e);
    }
  });

// List children command
program
  .command('list')
  .alias('list-children')
  .description('List wiki space children')
  .argument('<token>', 'Wiki node token or URL')
  .action(async (token) => {
    try {
      console.log(JSON.stringify(await listChildren(token), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

// Search command
program
  .command('search')
  .description('Search wiki')
  .argument('<query>', 'Search query')
  .argument('<token>', 'Wiki node token or URL to start search from')
  .action(async (query, token) => {
    try {
      console.log(JSON.stringify(await searchWiki(query, token), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

// Resolve command
program
  .command('resolve')
  .description('Resolve document token')
  .argument('<token>', 'Document token or URL')
  .action(async (token) => {
    try {
      console.log(JSON.stringify(await resolveDoc(token), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

// Create command
program
  .command('create')
  .description('Create new document')
  .argument('<title>', 'Document title')
  .option('--folder <token>', 'Folder token')
  .action(async (title, options) => {
    try {
      console.log(JSON.stringify(await createDoc(title, options.folder), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

// Write command
program
  .command('write')
  .description('Write content to document (overwrites)')
  .argument('<token>', 'Document token or URL')
  .argument('<content>', 'Content to write')
  .action(async (token, content) => {
    try {
      console.log(JSON.stringify(await writeDoc(token, content), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

// Append command
program
  .command('append')
  .description('Append content to document')
  .argument('<token>', 'Document token or URL')
  .argument('<content>', 'Content to append')
  .action(async (token, content) => {
    try {
      console.log(JSON.stringify(await appendDoc(token, content), null, 2));
    } catch (e) {
      handleError(e);
    }
  });

function handleError(e) {
  const errorObj = {
    code: 1,
    error: e.message,
    msg: e.message
  };

  if (e.message.includes('HTTP 400') || e.message.includes('400')) {
    errorObj.tip = "Check if the token is valid (docx/...) and not a URL or wiki link without resolution.";
  }

  console.error(JSON.stringify(errorObj, null, 2));
  process.exit(1);
}

program.parse();
