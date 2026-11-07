// Bank statements exported as spreadsheets (.xls, .xlsx, .csv): a "Statement of Account" with a header
// block (account number, currency) and a table of Date / Value Date / Ref. No. / Transaction Detail /
// Debit / Credit / Balance. Columns are found by their headings, not their position.

export interface StatementRow {
  /** yyyy-mm-dd the money moved (the value date when there is one). */
  date: string;
  ref: string;
  detail: string;
  /** Positive cents; one of the two is 0. */
  debit: number;
  credit: number;
  /** Position in the statement, oldest first. */
  index: number;
}

export interface Statement {
  account: string;
  currency: string;
  rows: StatementRow[];
}

type Cell = string | number | boolean | Date | null;

const text = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
const norm = (v: Cell) => text(v).toLowerCase().replace(/[^a-z]/g, '');
const cents = (v: Cell) => {
  const n = typeof v === 'number' ? v : parseFloat(text(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
};

/** "2026-11-02", "02/11/2026", "20261102" or a spreadsheet date, as yyyy-mm-dd; '' when it isn't a date. */
function toDate(v: Cell): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** The value beside a label in the header block ("Currency Type : NPR"). */
function besides(grid: Cell[][], label: string) {
  for (const row of grid) {
    const i = row.findIndex(c => norm(c) === label);
    if (i < 0) continue;
    const v = row.slice(i + 1).map(text).find(s => s && s !== ':');
    if (v) return v;
  }
  return '';
}

/** Read a statement from the sheet's cells (rows of cells, as SheetJS gives them). */
export function parseStatement(grid: Cell[][]): Statement {
  const head = grid.findIndex(r => r.some(c => norm(c) === 'debit') && r.some(c => norm(c) === 'credit') && r.some(c => norm(c) === 'date'));
  if (head < 0) throw new Error('No Date / Debit / Credit columns in that file.');
  // Headings can sit on two rows (Ref. No. under Date, in this layout).
  const col = (...names: string[]) => {
    for (const r of [grid[head], grid[head + 1] ?? []]) {
      const i = r.findIndex(c => names.includes(norm(c)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    date: col('date', 'transactiondate', 'txndate'),
    value: col('valuedate'),
    ref: col('refno', 'reference', 'referenceno'),
    detail: col('transactiondetail', 'description', 'details', 'particulars', 'narration', 'remarks'),
    debit: col('debit', 'withdrawal', 'withdraw'),
    credit: col('credit', 'deposit'),
  };
  const rows: StatementRow[] = [];
  for (const r of grid.slice(head + 1)) {
    const date = toDate(r[c.value] ?? null) || toDate(r[c.date] ?? null);
    if (!date) continue; // opening / closing balance lines, totals, blank rows
    const debit = cents(r[c.debit] ?? null), credit = cents(r[c.credit] ?? null);
    if (!debit && !credit) continue;
    rows.push({ date, ref: c.ref >= 0 ? text(r[c.ref] ?? null).replace(/^-$/, '') : '', detail: text(r[c.detail] ?? null), debit, credit, index: rows.length });
  }
  return { account: besides(grid, 'accountnumber'), currency: besides(grid, 'currencytype') || besides(grid, 'currency'), rows };
}

/** Read every sheet of a spreadsheet file into one statement. */
export async function readStatement(file: ArrayBuffer): Promise<Statement> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(file, { type: 'array', cellDates: true });
  const parts = book.SheetNames.map(n => XLSX.utils.sheet_to_json<Cell[]>(book.Sheets[n], { header: 1, raw: true, defval: null }))
    .filter(g => g.some(r => r.some(c => norm(c) === 'debit')))
    .map(parseStatement);
  if (!parts.length) throw new Error('No Date / Debit / Credit columns in that file.');
  let index = 0;
  return { account: parts[0].account, currency: parts[0].currency, rows: parts.flatMap(p => p.rows.map(r => ({ ...r, index: index++ }))) };
}
