import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

/**
 * A column header that links to the same page with `sort`/`dir` set. Clicking
 * the active column flips direction; clicking a new one starts at that
 * column's natural direction (Z→A for money, A→Z for text).
 */
export function SortableHeader({
  label,
  sortKey,
  activeSort,
  activeDir,
  defaultDir = "desc",
  params,
  align = "left",
}: {
  label: string;
  sortKey: string;
  activeSort: string;
  activeDir: SortDirection;
  defaultDir?: SortDirection;
  /** The current query string, minus sort/dir. */
  params: URLSearchParams;
  align?: "left" | "right";
}) {
  const isActive = activeSort === sortKey;
  const nextDir: SortDirection = isActive
    ? activeDir === "asc"
      ? "desc"
      : "asc"
    : defaultDir;

  const next = new URLSearchParams(params);
  next.set("sort", sortKey);
  next.set("dir", nextDir);

  const Icon = isActive ? (activeDir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <th className={`th ${align === "right" ? "text-right" : ""}`}>
      <Link
        href={`/items?${next.toString()}`}
        className={`inline-flex items-center gap-1 hover:text-slate-200 ${
          isActive ? "text-emerald-300" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
        aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        <Icon className={`h-3 w-3 ${isActive ? "" : "opacity-40"}`} />
      </Link>
    </th>
  );
}
