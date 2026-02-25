const XLSX = require('xlsx');

function parseFile(buffer, fileName, selectedSheet = null) {
  // cellFormula: false — don't return formula strings
  // cellNF: false — don't return number format
  // cellDates: true — parse dates properly
  // raw: false — use formatted display values
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,  // read cached values, not formula strings
    cellNF: false,
    raw: false,
  });

  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) throw new Error('The file contains no sheets');

  const targetSheet = selectedSheet && sheetNames.includes(selectedSheet)
    ? selectedSheet
    : sheetNames[0];

  const worksheet = workbook.Sheets[targetSheet];

  // sheet_to_json with header:1 gives array-of-arrays
  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: false,   // use formatted display strings so $1,800.00 comes through
  });

  if (rawRows.length === 0) throw new Error('The selected sheet is empty');

  // ── Find the real header row ───────────────────────────────────────────────
  // Title rows (e.g. "🏠 Household Budget — 2024") typically have only 1
  // filled cell. The real header row has the MOST filled cells in the first
  // 10 rows. Pick that one.
  let headerRowIndex = 0;
  let maxNonEmpty = 0;

  const scanLimit = Math.min(10, rawRows.length);
  for (let i = 0; i < scanLimit; i++) {
    const nonEmpty = rawRows[i].filter(cell => cell !== null && String(cell).trim() !== '').length;
    if (nonEmpty > maxNonEmpty) {
      maxNonEmpty = nonEmpty;
      headerRowIndex = i;
    }
  }

  // Build headers — replace blank cells with Column_N
  const rawHeaders = rawRows[headerRowIndex];
  const headers = rawHeaders.map((h, i) => {
    const clean = h !== null ? String(h).trim() : '';
    return clean !== '' ? clean : `Column_${i + 1}`;
  });

  // Filter out:
  // 1. Completely empty rows
  // 2. Section header rows — rows where ONLY the first cell has a value
  //    and it looks like a label (e.g. "▸ INCOME", "TOTAL", "--- Section ---")
  const dataRows = rawRows.slice(headerRowIndex + 1).filter(row => {
    const nonEmpty = row.filter(cell => cell !== null && String(cell).trim() !== '');

    // Skip fully empty rows
    if (nonEmpty.length === 0) return false;

    // Skip section label rows: only col 0 filled, and it doesn't look like a number/date
    if (nonEmpty.length === 1) {
      const firstVal = String(row[0] ?? '').trim();
      const looksLikeData = /^-?[\d$£€,.]+/.test(firstVal) || row[0] instanceof Date;
      if (!looksLikeData) return false;
    }

    return true;
  });

  // Find which column indices actually have data
  const activeColIndices = headers.map((_, i) => i).filter(i => {
    const hasHeaderName = rawHeaders[i] !== null && String(rawHeaders[i]).trim() !== '';
    const hasData = dataRows.some(row => row[i] !== null && String(row[i]).trim() !== '');
    return hasHeaderName || hasData;
  });

  const finalHeaders = activeColIndices.map(i => headers[i]);

  // Build column metadata with type inference
  const columns = finalHeaders.map((name, idx) => {
    const colIndex = activeColIndices[idx];
    const values = dataRows
      .map(row => row[colIndex])
      .filter(v => v !== null && String(v).trim() !== '');
    const type = inferColumnType(values);
    return { name, type, sample: values.slice(0, 5) };
  });

  // Build clean row objects — only active columns
  const rows = dataRows.map(row => {
    const obj = {};
    activeColIndices.forEach((colIndex, idx) => {
      const val = row[colIndex];
      obj[finalHeaders[idx]] = (val !== null && String(val).trim() !== '') ? val : null;
    });
    return obj;
  });

  return {
    sheetNames,
    selectedSheet: targetSheet,
    rowCount: rows.length,
    columns,
    preview: rows.slice(0, 10),
    rows,
  };
}

function inferColumnType(values) {
  if (values.length === 0) return 'Text';

  let dateCount = 0;
  let numberCount = 0;
  let currencyCount = 0;
  let percentageCount = 0;

  for (const raw of values) {
    const v = String(raw).trim();

    // Percentage — "12.5%" or "0.125" from a % formatted cell
    if (/^-?\d+(\.\d+)?%$/.test(v)) { percentageCount++; continue; }

    // Currency — "$1,800.00" style (formatted display value)
    if (/^-?[$£€¥₹₨]\s?[\d,]+(\.\d+)?$|^[\d,]+(\.\d+)?\s?[$£€¥₹₨]$/.test(v)) {
      currencyCount++; continue;
    }

    // Number — plain digits with optional commas and decimals
    if (/^-?[\d,]+(\.\d+)?$/.test(v)) { numberCount++; continue; }

    // Date object or date string
    if (raw instanceof Date || isLikelyDate(v)) { dateCount++; continue; }
  }

  const total = values.length;
  const threshold = 0.6; // lowered from 0.7 — real files have mixed rows

  if (percentageCount / total >= threshold) return 'Percentage';
  if (currencyCount / total >= threshold) return 'Currency';
  if (dateCount / total >= threshold) return 'Date';
  if ((numberCount + currencyCount) / total >= threshold) return 'Number';

  const unique = new Set(values.map(v => String(v).trim().toLowerCase()));
  if (unique.size <= 20) return 'Category';

  return 'Text';
}

function isLikelyDate(str) {
  const patterns = [
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/,
    /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/,
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i,
    /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i,
  ];
  return patterns.some(p => p.test(str.trim()));
}

module.exports = { parseFile, inferColumnType };