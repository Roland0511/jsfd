
async function fetchSheetRawData(token, accessToken) {
  // 1. Get metainfo to find sheetIds
  const metaUrl = `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${token}/sheets/query`;
  const metaRes = await fetch(metaUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const metaData = await metaRes.json();

  if (metaData.code !== 0) {
     // Fallback or error
     return { title: "Sheet", sheets: [], error: metaData.msg };
  }

  const sheets = metaData.data.sheets;
  if (!sheets || sheets.length === 0) {
    return { title: "Sheet", sheets: [] };
  }

  const sheetDataList = [];

  // Sort sheets by index just in case
  sheets.sort((a, b) => a.index - b.index);

  // Fetch all visible sheets (no limit of 3)
  const visibleSheets = sheets.filter(s => !s.hidden);

  for (const sheet of visibleSheets) {
    const sheetId = sheet.sheet_id;
    const title = sheet.title;

    // No limit on maxCols, use all columns
    let totalRows = 100;
    let maxCols = 100; // Reasonable default but will use actual from grid

    if (sheet.grid_properties) {
      totalRows = sheet.grid_properties.row_count || 100;
      maxCols = sheet.grid_properties.column_count || 100;
    }

    // Avoid fetching empty grids
    if (totalRows === 0 || maxCols === 0) {
        sheetDataList.push({ title, rows: [], truncated: false });
        continue;
    }

    const lastColName = indexToColName(maxCols);

    // Fetch in batches of 5000 rows
    const BATCH_SIZE = 5000;
    const allRows = [];

    for (let startRow = 1; startRow <= totalRows; startRow += BATCH_SIZE) {
      const endRow = Math.min(startRow + BATCH_SIZE - 1, totalRows);
      const range = `${sheetId}!A${startRow}:${lastColName}${endRow}`;

      const valUrl = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${token}/values/${range}`;

      const valRes = await fetch(valUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const valData = await valRes.json();

      if (valData.code === 0 && valData.data && valData.data.valueRange) {
        const rows = valData.data.valueRange.values;
        if (rows && rows.length > 0) {
          // If not first batch, we might need to skip header or just append
          allRows.push(...rows);
        }
      } else {
        console.warn(`[feishu-doc] Failed to fetch rows ${startRow}-${endRow}: ${valData.msg}`);
      }
    }

    sheetDataList.push({ title, rows: allRows, truncated: false, totalRows });
  }

  return {
    title: "Feishu Sheet",
    sheets: sheetDataList
  };
}

async function fetchSheetContent(token, accessToken) {
  const rawData = await fetchSheetRawData(token, accessToken);

  if (rawData.error) {
    return { title: "Sheet", content: `Error fetching sheet meta: ${rawData.error}` };
  }

  if (!rawData.sheets || rawData.sheets.length === 0) {
    return { title: "Sheet", content: "Empty spreadsheet." };
  }

  let fullContent = [];

  for (const sheet of rawData.sheets) {
    fullContent.push(`## Sheet: ${sheet.title}`);

    if (sheet.error) {
      fullContent.push(`(Could not fetch values: ${sheet.error})`);
    } else if (sheet.rows && sheet.rows.length > 0) {
      fullContent.push(markdownTable(sheet.rows));
    } else {
      fullContent.push(`(Empty)`);
    }
  }

  return {
    title: "Feishu Sheet",
    content: fullContent.join("\n\n")
  };
}

function indexToColName(num) {
  let ret = '';
  while (num > 0) {
    num--;
    ret = String.fromCharCode(65 + (num % 26)) + ret;
    num = Math.floor(num / 26);
  }
  return ret || 'A';
}

function markdownTable(rows) {
  if (!rows || rows.length === 0) return "";

  // Normalize row length
  const maxLength = Math.max(...rows.map(r => r ? r.length : 0));

  if (maxLength === 0) return "(Empty Table)";

  // Ensure all rows are arrays and have strings
  const cleanRows = rows.map(row => {
      if (!Array.isArray(row)) return Array(maxLength).fill("");
      return row.map(cell => {
          if (cell === null || cell === undefined) return "";
          if (typeof cell === 'object') return JSON.stringify(cell); // Handle rich text segments roughly
          return String(cell).replace(/\n/g, "<br>"); // Keep single line
      });
  });

  const header = cleanRows[0];
  const body = cleanRows.slice(1);

  // Handle case where header might be shorter than max length
  const paddedHeader = [...header];
  while(paddedHeader.length < maxLength) paddedHeader.push("");

  let md = "| " + paddedHeader.join(" | ") + " |\n";
  md += "| " + paddedHeader.map(() => "---").join(" | ") + " |\n";

  for (const row of body) {
    // Pad row if needed
    const padded = [...row];
    while(padded.length < maxLength) padded.push("");
    md += "| " + padded.join(" | ") + " |\n";
  }

  return md;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Replace newlines with spaces
  str = str.replace(/\n/g, " ");
  // If contains quotes, commas, or newlines, wrap in quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvContentForSheet(sheet) {
  const csvParts = [];
  const imageTokens = [];

  if (sheet.rows && sheet.rows.length > 0) {
    // Normalize row length
    const maxLength = Math.max(...sheet.rows.map(r => r ? r.length : 0));

    for (const row of sheet.rows) {
      const cleanRow = [];
      let isEmptyRow = true;
      if (!Array.isArray(row)) {
        cleanRow.push(...Array(maxLength).fill(""));
      } else {
        for (let i = 0; i < maxLength; i++) {
          let cell = row[i];
          if (cell === null || cell === undefined) {
            cleanRow.push("");
          } else if (typeof cell === 'object') {
            // Check for image tokens in object
            const cellStr = JSON.stringify(cell);
            const tokenMatches = cellStr.match(/"token":"([a-zA-Z0-9]+)"/g);
            if (tokenMatches) {
              for (const match of tokenMatches) {
                const token = match.replace(/"token":"([a-zA-Z0-9]+)"/, '$1');
                imageTokens.push(token);
              }
            }
            cleanRow.push(cellStr);
            if (cellStr.trim()) isEmptyRow = false;
          } else {
            const cellStr = String(cell);
            // Check for image tokens like ![alt](token:xxx)
            const imageRegex = /!\[([^\]]*)\]\(token:([a-zA-Z0-9]+)\)/g;
            let match;
            while ((match = imageRegex.exec(cellStr)) !== null) {
              imageTokens.push(match[2]);
            }
            cleanRow.push(cellStr);
            if (cellStr.trim()) isEmptyRow = false;
          }
        }
      }
      // Skip empty rows
      if (!isEmptyRow) {
        csvParts.push(cleanRow.map(escapeCsvValue).join(','));
      }
    }
  }

  // Filter out empty lines
  const filteredCsvParts = csvParts.filter(line => line.trim() !== '');

  return {
    content: filteredCsvParts.join('\n'),
    imageTokens: [...new Set(imageTokens)] // Deduplicate
  };
}

function csvContent(sheets, options = {}) {
  // Return array of sheet data, each with their own CSV content
  return sheets.map(sheet => ({
    title: sheet.title,
    ...csvContentForSheet(sheet)
  }));
}

module.exports = {
  fetchSheetContent,
  fetchSheetRawData,
  csvContent
};
