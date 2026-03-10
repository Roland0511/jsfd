/**
 * Markdown Converter
 * Converts Feishu docx blocks to Markdown
 */

const BlockType = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  HEADING7: 9,
  HEADING8: 10,
  HEADING9: 11,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  EQUATION: 16,
  TODO: 17,
  BITABLE: 18,
  CALLOUT: 19,
  CHAT_CARD: 20,
  DIAGRAM: 21,
  DIVIDER: 22,
  FILE: 23,
  GRID: 24,
  GRID_COLUMN: 25,
  IFRAME: 26,
  IMAGE: 27,
  ISV: 28,
  MINDNOTE: 29,
  SHEET: 30,
  TABLE: 31,
  TABLE_CELL: 32,
  VIEW: 33,
  QUOTE_CONTAINER: 34,
  TASK: 35,
  OKR: 36,
  OKR_OBJECTIVE: 37,
  OKR_KEY_RESULT: 38,
  OKR_PROGRESS: 39,
  ADD_ONS: 40,
  JIRA_ISSUE: 41,
  WIKI_CATALOG: 42,
  BOARD: 43,
  AGENDA: 44,
  UNDEFINED: 999,
};

const CODE_LANGUAGE_MAP = {
  1: "plaintext",
  2: "python",
  3: "javascript",
  4: "java",
  5: "cpp",
  6: "c",
  7: "csharp",
  8: "php",
  9: "ruby",
  10: "go",
  11: "rust",
  12: "swift",
  13: "kotlin",
  14: "typescript",
  15: "html",
  16: "css",
  17: "sql",
  18: "shell",
  19: "bash",
  20: "powershell",
  21: "json",
  22: "xml",
  23: "yaml",
  24: "markdown",
};

const HEADING_LEVELS = {
  [BlockType.HEADING1]: 1,
  [BlockType.HEADING2]: 2,
  [BlockType.HEADING3]: 3,
  [BlockType.HEADING4]: 4,
  [BlockType.HEADING5]: 5,
  [BlockType.HEADING6]: 6,
};

const PARAGRAPH_BLOCK_TYPES = new Set([
  BlockType.TEXT,
  BlockType.CODE,
  BlockType.QUOTE,
  BlockType.EQUATION,
  BlockType.HEADING1,
  BlockType.HEADING2,
  BlockType.HEADING3,
  BlockType.HEADING4,
  BlockType.HEADING5,
  BlockType.HEADING6,
  BlockType.TABLE,
  BlockType.FILE,
  BlockType.VIEW,
]);

class MarkdownConverter {
  constructor() {
    this.MAX_MARKDOWN_HEADING_LEVEL = 6;
    this.MAX_TABLE_ROWS = 1000;
    this.MAX_TABLE_COLS = 50;
  }

  convertBlocksToMarkdown(blocks) {
    if (!blocks || !Array.isArray(blocks)) return "";

    const blockMap = {};
    const rootBlocks = [];

    for (const block of blocks) {
      if (block.block_id) {
        blockMap[block.block_id] = block;
      }
    }

    for (const block of blocks) {
      const parentId = block.parent_id;
      if (!parentId || !blockMap[parentId]) {
        rootBlocks.push(block);
      }
    }

    const convertedBlocks = [];
    // Track ordered list counters for root level
    const orderedCounters = {};
    const rootLevel = 0;

    for (const block of rootBlocks) {
      let orderedCounter;
      if (block.block_type === BlockType.ORDERED) {
        if (orderedCounters[rootLevel] === undefined) {
          orderedCounters[rootLevel] = 1;
        }
        orderedCounter = orderedCounters[rootLevel];
        orderedCounters[rootLevel]++;
      } else {
        orderedCounters[rootLevel] = undefined;
        orderedCounter = undefined;
      }

      const converted = this._convertBlock(block, blockMap, rootLevel, orderedCounter, {});
      if (converted) convertedBlocks.push(converted);
    }

    return this._mergeConvertedBlocks(convertedBlocks, rootBlocks);
  }

  _mergeConvertedBlocks(convertedBlocks, rootBlocks) {
    if (!convertedBlocks.length) return "";

    let resultParts = [];
    for (let i = 0; i < convertedBlocks.length; i++) {
      resultParts.push(convertedBlocks[i]);

      if (i < convertedBlocks.length - 1 && i < rootBlocks.length - 1) {
        const currentType = rootBlocks[i].block_type;
        const nextType = rootBlocks[i + 1].block_type;
        if (
          PARAGRAPH_BLOCK_TYPES.has(currentType) ||
          PARAGRAPH_BLOCK_TYPES.has(nextType)
        ) {
          resultParts.push("\n");
        }
      }
    }

    let result = resultParts.join("\n");
    result = result.replace(/\n{3,}/g, "\n\n");
    return result.trim();
  }

  _convertBlock(block, blockMap, level, orderedCounter, context = {}) {
    const blockType = block.block_type;
    if (!blockType) return "";

    let resultLines = [];
    const content = this._convertSingleBlock(block, blockType, level, blockMap, orderedCounter, context);
    if (content) resultLines.push(content);

    if (blockType !== BlockType.TABLE && blockType !== BlockType.TABLE_CELL) {
      // 如果是 VIEW 块，提取 view_type 传递给子块
      let childContext = { ...context };
      if (blockType === BlockType.VIEW && block.view) {
        childContext.parentViewType = block.view.view_type;
      }

      const childContent = this._convertChildBlocks(block, blockMap, level, childContext);
      if (childContent && childContent.length > 0) {
        if (blockType === BlockType.QUOTE_CONTAINER) {
          // For quote container, add > prefix to each line of child content
          const quotedContent = childContent.join("\n").split("\n").map(line => {
            return line.trim() ? `> ${line}` : ">";
          }).join("\n");
          resultLines.push(quotedContent);
        } else {
          resultLines.push(...childContent);
        }
      }
    }

    return resultLines.join("\n");
  }

  _convertSingleBlock(block, blockType, level, blockMap, orderedCounter, context = {}) {
    try {
      switch (blockType) {
        case BlockType.PAGE:
          return this._convertPageBlock(block);
        case BlockType.TEXT:
          return this._convertTextBlock(block);
        case BlockType.HEADING1:
        case BlockType.HEADING2:
        case BlockType.HEADING3:
        case BlockType.HEADING4:
        case BlockType.HEADING5:
        case BlockType.HEADING6:
          return this._convertHeadingBlock(block, blockType);
        case BlockType.BULLET:
          return this._convertBulletBlock(block, level);
        case BlockType.ORDERED:
          return this._convertOrderedBlock(block, level, orderedCounter || 1);
        case BlockType.CODE:
          return this._convertCodeBlock(block);
        case BlockType.QUOTE:
          return this._convertQuoteBlock(block);
        case BlockType.TODO:
          return this._convertTodoBlock(block, level);
        case BlockType.DIVIDER:
          return this._convertDividerBlock();
        case BlockType.IMAGE:
          return this._convertImageBlock(block);
        case BlockType.BOARD:
          return this._convertBoardBlock(block);
        case BlockType.QUOTE_CONTAINER:
          return ""; // Quote container content is handled in _convertChildBlocks
        case BlockType.TABLE:
          return this._convertTableBlock(block, blockMap);
        case BlockType.TABLE_CELL:
          return "";
        case BlockType.EQUATION:
          return this._convertEquationBlock(block);
        case BlockType.VIEW:
          return ""; // View block is a container, content handled in _convertChildBlocks
        case BlockType.FILE:
          return this._convertFileBlock(block, context);
        default:
          return this._convertUnsupportedBlock(block);
      }
    } catch (e) {
      console.warn(
        `[MarkdownConverter] Error converting block type ${blockType}:`,
        e,
      );
      return "";
    }
  }

  _convertChildBlocks(block, blockMap, level, context = {}) {
    const children = block.children || [];
    if (!children.length) return [];

    const childBlocks = children.map((id) => blockMap[id]).filter(Boolean);
    const resultLines = [];

    // Track ordered list counters per indentation level
    const orderedCounters = {};

    for (let i = 0; i < childBlocks.length; i++) {
      const childBlock = childBlocks[i];
      const childLevel = level + 1;

      let orderedCounter;
      if (childBlock.block_type === BlockType.ORDERED) {
        // Initialize or increment counter for this level
        if (orderedCounters[childLevel] === undefined) {
          orderedCounters[childLevel] = 1;
        }
        orderedCounter = orderedCounters[childLevel];
        orderedCounters[childLevel]++;
      } else {
        // Reset counter for this level when we hit a non-ordered block
        orderedCounters[childLevel] = undefined;
        orderedCounter = undefined;
      }

      const childContent = this._convertBlock(childBlock, blockMap, childLevel, orderedCounter, context);
      if (childContent) {
        resultLines.push(childContent);

        if (
          i < childBlocks.length - 1 &&
          childBlock.block_type === BlockType.TEXT &&
          childBlocks[i + 1].block_type === BlockType.TEXT
        ) {
          resultLines.push("");
        }
      }
    }

    return resultLines;
  }

  _convertPageBlock(block) {
    const elements = block.page?.elements || [];
    return this._convertElementsToText(elements);
  }

  _convertTextBlock(block) {
    const elements = block.text?.elements || [];
    return this._convertElementsToText(elements);
  }

  _convertHeadingBlock(block, blockType) {
    const level = Math.min(
      HEADING_LEVELS[blockType] || 1,
      this.MAX_MARKDOWN_HEADING_LEVEL,
    );
    const prefix = "#".repeat(level) + " ";

    const headingKey =
      blockType > BlockType.TEXT ? `heading${blockType - 2}` : "heading1";
    const elements = block[headingKey]?.elements || [];
    const content = this._convertElementsToText(elements);

    return content ? prefix + content : "";
  }

  _convertBulletBlock(block, level) {
    const elements = block.bullet?.elements || [];
    const content = this._convertElementsToText(elements);
    if (!content) return "";
    const indent = "  ".repeat(Math.min(level, 10));
    return `${indent}- ${content}`;
  }

  _convertOrderedBlock(block, level, counter = 1) {
    const elements = block.ordered?.elements || [];
    const content = this._convertElementsToText(elements);
    if (!content) return "";
    const indent = "  ".repeat(Math.min(level, 10));
    return `${indent}${counter}. ${content}`;
  }

  _convertCodeBlock(block) {
    const codeData = block.code || {};
    const elements = codeData.elements || [];
    const langId = codeData.language || codeData.style?.language || 1;
    const language = CODE_LANGUAGE_MAP[langId] || "plaintext";
    const content = this._convertElementsToText(elements, true);
    return "```" + language + "\n" + content + "\n```";
  }

  _convertQuoteBlock(block) {
    const elements = block.quote?.elements || [];
    const content = this._convertElementsToText(elements);
    if (!content) return "";
    return content
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
  }

  _convertTodoBlock(block, level) {
    const todoData = block.todo || {};
    const elements = todoData.elements || [];
    const isDone = todoData.style?.done || false;
    const content = this._convertElementsToText(elements);
    if (!content) return "";
    const indent = "  ".repeat(Math.min(level, 10));
    const checkbox = isDone ? "[x]" : "[ ]";
    return `${indent}- ${checkbox} ${content}`;
  }

  _convertDividerBlock() {
    return "---";
  }

  _convertImageBlock(block) {
    const imageData = block.image || {};
    const token = imageData.token || "";
    if (!token) return "";
    return `![image-${token.substring(0, 8)}](token:${token})

`;
  }

  _convertBoardBlock(block) {
    const boardData = block.board || {};
    const token = boardData.token || "";
    if (!token) return "";
    // 使用 board_token: 前缀来区分白板和普通图片
    return `![whiteboard-${token.substring(0, 8)}](board_token:${token})

`;
  }

  _convertFileBlock(block, context = {}) {
    const fileData = block.file || {};
    const token = fileData.token || "";
    const name = fileData.name || "file";

    // 优先使用 FILE 块自己的 view_type，如果没有则继承父 VIEW 容器的 view_type，最后默认 1
    let viewType = fileData.view_type;
    if (viewType === undefined || viewType === null) {
      viewType = context.parentViewType;
    }
    if (viewType === undefined || viewType === null) {
      viewType = 1;
    }

    if (!token) return "";

    // 检测是否为视频文件
    const isVideo = /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(name);

    // view_type: 1=卡片视图, 2=预览视图, 3=内联视图
    // 如果是视频且 view_type 为 2 (预览模式)，使用 video 标签
    if (isVideo && viewType === 2) {
      return `<video src="file_token:${token}" controls></video>

`;
    }

    // 其他情况使用普通链接格式
    const viewTypeLabel = {
      1: "card",
      2: "preview",
      3: "inline"
    }[viewType] || "card";

    // 使用 file_token: 前缀来区分文件和图片
    return `[${name}](file_token:${token}|${viewTypeLabel})

`;
  }

  _convertTableBlock(block, blockMap) {
    const tableData = block.table || {};
    const property = tableData.property || {};
    const rowSize = property.row_size || 0;
    const columnSize = property.column_size || 0;

    if (rowSize <= 0 || columnSize <= 0) return "";

    let cells = tableData.cells || [];
    if (!cells.length && block.children) {
      cells = block.children.filter(
        (cid) => blockMap[cid]?.block_type === BlockType.TABLE_CELL,
      );
    }

    const matrix = this._buildTableMatrix(cells, rowSize, columnSize, blockMap);
    if (!matrix || matrix.length === 0) return "";

    return this._formatMarkdownTable(matrix);
  }

  _buildTableMatrix(cells, rowSize, columnSize, blockMap) {
    const matrix = Array.from({ length: rowSize }, () =>
      Array(columnSize).fill(""),
    );

    for (let i = 0; i < cells.length; i++) {
      const cellId = cells[i];
      const rowIndex = Math.floor(i / columnSize);
      const colIndex = i % columnSize;

      if (rowIndex >= rowSize || colIndex >= columnSize) continue;

      matrix[rowIndex][colIndex] = this._extractTableCellContent(
        cellId,
        blockMap,
      );
    }

    return matrix;
  }

  _extractTableCellContent(cellId, blockMap) {
    const cellBlock = blockMap[cellId];
    if (!cellBlock || cellBlock.block_type !== BlockType.TABLE_CELL) return "";

    const childrenIds = cellBlock.children || [];
    const contentParts = [];

    for (const childId of childrenIds) {
      const childBlock = blockMap[childId];
      if (!childBlock) continue;

      const bt = childBlock.block_type;
      if (bt === BlockType.TEXT) {
        const elements = childBlock.text?.elements || [];
        const text = this._convertElementsToText(elements);
        if (text.trim()) contentParts.push(text.trim());
      } else if (bt === BlockType.CODE) {
        const elements = childBlock.code?.elements || [];
        const text = this._convertElementsToText(elements, true);
        if (text.trim()) contentParts.push("`" + text.trim() + "`");
      } else if (bt === BlockType.IMAGE) {
        contentParts.push("[image]");
      } else {
        const innerData =
          childBlock[
            Object.keys(childBlock).find((k) => childBlock[k]?.elements)
          ] || {};
        const elements = innerData.elements || [];
        const text = this._convertElementsToText(elements);
        if (text.trim()) contentParts.push(text.trim());
      }
    }

    let content = contentParts.join(" ");
    content = content.replace(/[\n\r]/g, " ").replace(/\|/g, "&#124;");
    return content.replace(/\s+/g, " ").trim();
  }

  _formatMarkdownTable(matrix) {
    if (!matrix.length || !matrix[0].length) return "";

    const columnCount = matrix[0].length;
    const normalizedMatrix = matrix.map((row) => {
      if (row.length < columnCount)
        return [...row, ...Array(columnCount - row.length).fill("")];
      if (row.length > columnCount) return row.slice(0, columnCount);
      return row;
    });

    const tableLines = [];
    tableLines.push(`| ${normalizedMatrix[0].join(" | ")} |`);
    tableLines.push(`| ${Array(columnCount).fill("---").join(" | ")} |`);

    for (let i = 1; i < normalizedMatrix.length; i++) {
      tableLines.push(`| ${normalizedMatrix[i].join(" | ")} |`);
    }

    return tableLines.join("\n");
  }

  _convertEquationBlock(block) {
    const content = block.equation?.content || "";
    return content ? `$$${content.trim()}$$` : "";
  }

  _convertUnsupportedBlock(block) {
    const type = block.block_type;
    return `<!-- Unsupported block type: ${type} -->`;
  }

  _convertElementsToText(elements, preserveFormatting = false) {
    if (!elements || !Array.isArray(elements)) return "";

    return elements
      .map((el) => this._convertSingleElement(el, preserveFormatting))
      .join("");
  }

  _convertSingleElement(element, preserveFormatting = false) {
    if (element.text_run) {
      let content = element.text_run.content || "";
      if (!preserveFormatting) {
        const style = element.text_run.text_element_style || {};
        if (style.link && style.link.url) {
          content = `[${content}](${style.link.url})`;
        } else if (style.inline_code) {
          content = "`" + content + "`";
        } else {
          if (style.bold) content = `**${content}**`;
          if (style.italic) content = `*${content}*`;
          if (style.strikethrough) content = `~~${content}~~`;
        }
      }
      return content;
    } else if (element.mention_user) {
      return `@${element.mention_user.user_id || ""}`;
    } else if (element.mention_doc) {
      const title = element.mention_doc.title || "";
      const url = element.mention_doc.url || "";
      if (title && url) return `[${title}](${url})`;
      return title;
    } else if (element.equation) {
      return `$${element.equation.content || ""}$`;
    } else if (element.link_preview) {
      const title = element.link_preview.title || "";
      const url = element.link_preview.url || "";
      if (title && url) return `[${title}](${url})`;
      return title || url;
    }

    return "";
  }
}

module.exports = {
  MarkdownConverter,
};
