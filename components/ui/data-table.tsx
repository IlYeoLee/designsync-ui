"use client"

import * as React from "react"
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/registry/new-york/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/registry/new-york/ui/table"

/* ─────────────────────────────────────────────────────────────────────────────
 * DataTable — lightweight sortable, paginated table using existing Table.
 *
 * No external dependencies (no TanStack Table).
 * Composes: Table, Button.
 *
 * Usage:
 *   <DataTable
 *     columns={[
 *       { key: "name", header: "이름", sortable: true },
 *       { key: "role", header: "역할" },
 *       { key: "status", header: "상태", render: (v) => <Badge>{v}</Badge> },
 *     ]}
 *     data={[{ name: "김수현", role: "디자이너", status: "활성" }, ...]}
 *     pageSize={5}
 *   />
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DataTableColumn<T> {
  key: keyof T & string
  header: string
  sortable?: boolean
  className?: string
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  pageSize?: number
  className?: string
}

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  pageSize = 10,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
  const [page, setPage] = React.useState(0)

  // Sort
  const sorted = React.useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null || bVal == null) return 0
      const cmp = String(aVal).localeCompare(String(bVal), "ko")
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize)

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
    setPage(0)
  }

  return (
    <div data-slot="data-table" className={cn("space-y-4", className)}>
      <div className="rounded-[var(--ds-card-radius)] border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.sortable ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                      <ArrowUpDown className={cn(
                        "w-3.5 h-3.5",
                        sortKey === col.key ? "text-foreground" : "text-muted-foreground/50"
                      )} />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  데이터가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render
                        ? col.render(row[col.key], row)
                        : String(row[col.key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {sorted.length}개 중 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sorted.length)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="sr-only">이전</span>
            </Button>
            <span className="text-sm text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
              <span className="sr-only">다음</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export { DataTable }
