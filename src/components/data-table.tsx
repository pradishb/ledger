// A table built on TanStack Table and shadcn's table and checkbox.
// TanStack holds the state (sorting, selection, column sizes, order and visibility); this file
// renders it, adds drag-to-reorder and drag-to-resize on headers, and remembers column layout
// per device.
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type Column, type ColumnDef, type ColumnOrderState, type ColumnSizingState, type Header,
  type RowData, type RowSelectionState, type SortingState, type Table as TTable, type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align header and cells (money). */
    align?: 'right';
    /** Extra classes for this column's cells. */
    cellClass?: string | ((row: TData) => string);
    cellStyle?: (row: TData) => CSSProperties;
    /** Hidden on phones. */
    hideOnMobile?: boolean;
    /** Shares leftover space until the user gives it a width. */
    flex?: boolean;
    /** Name in the Columns menu, when the header isn't plain text. */
    label?: string;
    /** Phantom generic use, so TypeScript doesn't flag TValue as unused. */
    _value?: TValue;
  }
}

const SELECT = '_select';
const FLEX_MIN = 140;
const MIN_W = 48;

interface Saved { sizing: ColumnSizingState; order: ColumnOrderState; visibility: VisibilityState }

function useSaved(id: string) {
  const key = `ledger.table.${id}`;
  const [saved, setSaved] = useState<Saved>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? '{}');
      return { sizing: v.sizing ?? {}, order: v.order ?? [], visibility: v.visibility ?? {} };
    } catch { return { sizing: {}, order: [], visibility: {} }; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* storage unavailable */ }
  }, [key, saved]);
  return [saved, setSaved] as const;
}

export interface DataTableProps<T> {
  /** Key for remembering this table's column layout. */
  id: string;
  data: T[];
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  getRowId: (row: T) => string;
  /** Controlled sorting; leave out for unsorted (data order) with click-to-sort. */
  sorting?: SortingState;
  onSortingChange?: (s: SortingState) => void;
  /** Turns on the checkbox column. */
  selection?: RowSelectionState;
  onSelectionChange?: (s: RowSelectionState) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  rowTitle?: string;
  /** Extra rows under the body, given the columns in their current order. */
  footer?: (cols: Column<T, unknown>[]) => ReactNode;
  /** Filters and search, shown in a bar above the table. */
  toolbar?: ReactNode;
  /** Shown at the right end of that bar, before the Columns menu (a row count, say). */
  toolbarEnd?: ReactNode;
  empty?: ReactNode;
}

export function DataTable<T>(p: DataTableProps<T>) {
  const [saved, setSaved] = useSaved(p.id);
  const [innerSort, setInnerSort] = useState<SortingState>([]);
  const sorting = p.sorting ?? innerSort;
  const selectable = !!p.onSelectionChange;

  const columns: ColumnDef<T, any>[] = selectable ? [selectColumn<T>(), ...p.columns] : p.columns; // eslint-disable-line @typescript-eslint/no-explicit-any

  const table = useReactTable<T>({
    data: p.data,
    columns,
    getRowId: p.getRowId,
    state: {
      sorting,
      rowSelection: p.selection ?? {},
      columnSizing: saved.sizing,
      columnOrder: saved.order.length ? [SELECT, ...saved.order.filter(k => k !== SELECT)] : [],
      columnVisibility: saved.visibility,
    },
    onSortingChange: u => { const next = typeof u === 'function' ? u(sorting) : u; (p.onSortingChange ?? setInnerSort)(next); },
    onRowSelectionChange: u => p.onSelectionChange?.(typeof u === 'function' ? u(p.selection ?? {}) : u),
    onColumnSizingChange: u => setSaved(s => ({ ...s, sizing: typeof u === 'function' ? u(s.sizing) : u })),
    onColumnOrderChange: u => setSaved(s => ({ ...s, order: typeof u === 'function' ? u(s.order) : u })),
    onColumnVisibilityChange: u => setSaved(s => ({ ...s, visibility: typeof u === 'function' ? u(s.visibility) : u })),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: selectable,
    enableSortingRemoval: true,
    columnResizeMode: 'onChange',
  });

  const rows = table.getRowModel().rows;
  const leaf = table.getVisibleLeafColumns();
  const customized = Object.keys(saved.sizing).length > 0 || saved.order.length > 0 || Object.keys(saved.visibility).length > 0;

  // A column's width: what the user set, else its default; flexible columns stay unset so they
  // share the space left over.
  const widthOf = (c: Column<T, unknown>) =>
    saved.sizing[c.id] ?? (c.columnDef.meta?.flex ? undefined : c.getSize());
  const minWidth = leaf.reduce((t, c) => t + (c.columnDef.meta?.hideOnMobile ? 0 : widthOf(c) ?? FLEX_MIN), 0);

  // Shift-click selects every row between the last one clicked and this one.
  const lastClicked = useRef<string | null>(null);
  function pick(rowId: string, shift: boolean) {
    const sel = { ...(p.selection ?? {}) };
    const on = !sel[rowId];
    const a = rows.findIndex(r => r.id === lastClicked.current), b = rows.findIndex(r => r.id === rowId);
    if (shift && a >= 0 && b >= 0) {
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { if (on) sel[rows[i].id] = true; else delete sel[rows[i].id]; }
    } else if (on) sel[rowId] = true; else delete sel[rowId];
    lastClicked.current = rowId;
    p.onSelectionChange?.(sel);
  }

  return (
    <div className="flex flex-col">
      {/* Filters on the left (from the page), the Columns menu on the right. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
        {p.toolbar}
        {/* ml-auto keeps this group on the right, even when the bar wraps onto a second line. */}
        <div className="ml-auto flex items-center gap-3">
          {p.toolbarEnd}
          <span className="hide-m-flex"><ColumnsMenu table={table} customized={customized} reset={() => setSaved({ sizing: {}, order: [], visibility: {} })} /></span>
        </div>
      </div>
      <Table className="table-fixed" style={{ minWidth }}>
        <TableHeader>
          {table.getHeaderGroups().map(hg => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map(h => <HeadCell key={h.id} header={h} table={table} width={widthOf(h.column)} />)}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id} data-state={r.getIsSelected() ? 'selected' : undefined} title={p.rowTitle}
              className={cn(p.onRowClick && 'cursor-pointer', p.rowClassName?.(r.original))}
              onClick={() => p.onRowClick?.(r.original)}>
              {r.getVisibleCells().map(cell => {
                const m = cell.column.columnDef.meta;
                if (cell.column.id === SELECT) {
                  return (
                    <TableCell key={cell.id} className="w-9 cursor-default pr-0" onClick={e => { e.stopPropagation(); pick(r.id, e.shiftKey); }}>
                      <Checkbox checked={r.getIsSelected()} tabIndex={-1} aria-label="Select row" className="pointer-events-none" />
                    </TableCell>
                  );
                }
                return (
                  <TableCell key={cell.id} style={m?.cellStyle?.(r.original)}
                    className={cn('truncate', m?.align === 'right' && 'text-right', m?.hideOnMobile && 'hide-m',
                      typeof m?.cellClass === 'function' ? m.cellClass(r.original) : m?.cellClass)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
        {p.footer && <TableFooter>{p.footer(leaf.filter(c => c.id !== SELECT))}</TableFooter>}
      </Table>
      {!rows.length && p.empty && <div className="empty">{p.empty}</div>}
    </div>
  );
}

function selectColumn<T>(): ColumnDef<T> {
  return {
    id: SELECT, size: 36, enableSorting: false, enableResizing: false, enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
        onCheckedChange={v => table.toggleAllRowsSelected(!!v)}
        disabled={!table.getRowModel().rows.length}
        aria-label="Select all shown" />
    ),
  };
}

function HeadCell<T>({ header, table, width }: { header: Header<T, unknown>; table: TTable<T>; width?: number }) {
  const col = header.column;
  const m = col.columnDef.meta;
  const fixed = col.id === SELECT;
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const sorted = col.getIsSorted();

  // Reorder by dragging one header onto another.
  const dnd = fixed ? {} : {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-col', col.id); },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes('text/x-col')) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setDrop(e.clientX > r.left + r.width / 2 ? 'after' : 'before');
    },
    onDragLeave: () => setDrop(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/x-col');
      const side = drop;
      setDrop(null);
      if (!from || from === col.id) return;
      const ids = table.getAllLeafColumns().map(c => c.id).filter(id => id !== SELECT);
      const current = table.getState().columnOrder.length ? table.getState().columnOrder.filter(id => id !== SELECT) : ids;
      const next = current.filter(id => id !== from);
      next.splice(next.indexOf(col.id) + (side === 'after' ? 1 : 0), 0, from);
      table.setColumnOrder(next);
    },
    onDragEnd: () => setDrop(null),
  };

  const label = header.isPlaceholder ? null : flexRender(col.columnDef.header, header.getContext());
  return (
    <TableHead style={{ width }} {...dnd}
      className={cn('relative select-none', !fixed && 'cursor-grab active:cursor-grabbing', m?.align === 'right' && 'text-right',
        m?.hideOnMobile && 'hide-m', fixed && 'w-9 pr-0',
        drop === 'before' && 'shadow-[inset_2px_0_0_var(--acc)]', drop === 'after' && 'shadow-[inset_-2px_0_0_var(--acc)]')}>
      {col.getCanSort() ? (
        <button type="button" onClick={col.getToggleSortingHandler()}
          className={cn('inline-flex max-w-full items-center gap-1 hover:text-foreground', m?.align === 'right' && 'flex-row-reverse', sorted && 'font-semibold text-foreground')}>
          <span className="truncate">{label}</span>
          {sorted === 'asc' ? <ArrowUp className="size-3 shrink-0" /> : sorted === 'desc' ? <ArrowDown className="size-3 shrink-0" /> : null}
        </button>
      ) : label}
      {col.getCanResize() && <ResizeHandle column={col} table={table} />}
    </TableHead>
  );
}

/** Drag a header's right edge to resize; double-click it to reset that column. */
function ResizeHandle<T>({ column, table }: { column: Column<T, unknown>; table: TTable<T> }) {
  return (
    <span role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset"
      className="group/rs absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none"
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => { e.stopPropagation(); column.resetSize(); }}
      onPointerDown={e => {
        e.preventDefault(); e.stopPropagation();
        const el = e.currentTarget;
        // Start from the width on screen, which for a flexible column isn't its default size.
        const start = (el.parentElement as HTMLElement).getBoundingClientRect().width;
        const x0 = e.clientX;
        el.setPointerCapture(e.pointerId);
        const onMove = (ev: PointerEvent) =>
          table.setColumnSizing(s => ({ ...s, [column.id]: Math.round(Math.max(MIN_W, start + ev.clientX - x0)) }));
        const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
      }}>
      <span className="absolute inset-y-[22%] left-[3.5px] w-px bg-input opacity-0 transition-opacity group-hover/rs:w-0.5 group-hover/rs:bg-primary group-hover/rs:opacity-100 [thead:hover_&]:opacity-100" />
    </span>
  );
}

function ColumnsMenu<T>({ table, customized, reset }: { table: TTable<T>; customized: boolean; reset: () => void }) {
  const cols = table.getAllLeafColumns().filter(c => c.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
          <Columns3 className="size-3.5" />Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Show columns</DropdownMenuLabel>
        {cols.map(c => (
          <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={v => c.toggleVisibility(!!v)} onSelect={e => e.preventDefault()}>
            {c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!customized} onSelect={reset}>Reset columns</DropdownMenuItem>
        <div className="px-2 pt-1 pb-1.5 text-[11px] leading-snug text-muted-foreground">Drag headers to reorder, or their edges to resize.</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
