import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Category } from "@/lib/types";
import { Icon } from "./icons";

export interface CategoryGroup {
  group: string;
  items: Category[];
}

/** Group categories by `groupName` (first-seen order) and filter by name.
 *  A whitespace-only query matches everything; groups with no matches drop out. */
export function groupCategories(categories: Category[], query: string): CategoryGroup[] {
  const q = query.trim().toLowerCase();
  const byGroup = new Map<string, Category[]>();
  for (const c of categories) {
    if (q && !c.name.toLowerCase().includes(q)) continue;
    const items = byGroup.get(c.groupName) ?? [];
    items.push(c);
    byGroup.set(c.groupName, items);
  }
  return [...byGroup.entries()].map(([group, items]) => ({ group, items }));
}

interface CategorySelectProps {
  categories: Category[];
  /** Selected category id, or null when uncategorized. */
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Accessible name for the control. */
  label?: string;
  /** Attention-ring the trigger (item still needs a category). */
  needs?: boolean;
  className?: string;
}

// Open upward when the trigger is within this many px of the viewport bottom.
const FLIP_THRESHOLD = 240;

/**
 * Custom category dropdown — a styled trigger + filterable popover. Replaces a
 * native `<select>` (which can't be styled). The popover is an editable
 * combobox: type-to-filter, keyboard nav (↑/↓/Home/End/Enter/Esc), click-outside
 * dismiss, and it flips above near the panel edge. Focus returns to the trigger
 * on close.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = "— Select category —",
  label = "Category",
  needs = false,
  className = "",
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const groups = groupCategories(categories, query);
  const flat = groups.flatMap((g) => g.items);
  const indexById = new Map(flat.map((c, i) => [c.id, i]));
  const selected = categories.find((c) => c.id === value) ?? null;

  // Read live values inside the [open]-only listener effect without re-binding.
  const activeRef = useRef(active);
  activeRef.current = active;
  const flatRef = useRef(flat);
  flatRef.current = flat;

  function close(refocus: boolean) {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  }

  function choose(id: string) {
    onChange(id);
    close(true);
  }

  // Outside-click + keyboard nav while open. Depends on [open] only — live
  // `active`/`flat` are read via refs so we don't re-bind on every keystroke.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const items = flatRef.current;
      switch (e.key) {
        case "Escape":
          close(true);
          break;
        case "Tab":
          close(false); // let focus move naturally out of the popover
          break;
        case "ArrowDown":
          e.preventDefault();
          setActive((i) => Math.min(items.length - 1, i + 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
          break;
        case "Home":
          e.preventDefault();
          setActive(0);
          break;
        case "End":
          e.preventDefault();
          setActive(items.length - 1);
          break;
        case "Enter": {
          e.preventDefault();
          const c = items[activeRef.current];
          if (c) choose(c.id);
          break;
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind once per open
  }, [open]);

  // On open: pick flip direction, seed the active row to the selection, focus filter.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setUp(below < FLIP_THRESHOLD && r.top > below);
    setActive(value ? flat.findIndex((c) => c.id === value) : -1);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on open
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const triggerState = needs
    ? open
      ? "border-attention ring-[3px] ring-attention-weak"
      : "border-attention-line"
    : open
      ? "border-ink ring-[3px] ring-ink-weak"
      : "border-line-strong hover:border-ink-line";

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={`flex min-h-[40px] w-full items-center gap-2 rounded-control border bg-[var(--dd-trigger-bg)] px-3 py-[9px] text-left text-[13.5px] text-text transition-[border-color,box-shadow] ${triggerState}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-faint"}`}>
          {selected ? selected.name : placeholder}
        </span>
        <span
          aria-hidden
          className={`flex flex-none text-faint transition-transform ${open ? "rotate-180" : ""}`}
        >
          <Icon.chevD width={14} height={14} />
        </span>
      </button>

      {open && (
        <div
          className={`absolute inset-x-0 z-50 flex max-h-[264px] flex-col overflow-hidden rounded-control border border-line-strong bg-surface shadow-pop ${
            up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
        >
          <div className="flex flex-none items-center gap-2 border-b border-line px-[11px] py-[9px]">
            <Icon.search aria-hidden width={14} height={14} className="flex-none text-faint" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
              aria-label={`Filter ${label.toLowerCase()} options`}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Filter categories…"
              className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint"
            />
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="overflow-y-auto overflow-x-hidden p-[5px]"
          >
            {flat.length === 0 && (
              <div className="px-3 py-[14px] text-center text-[13px] text-faint">No matches</div>
            )}
            {groups.map((g, gi) => (
              <div key={g.group} className={gi > 0 ? "mt-[2px]" : ""}>
                <div className="px-[9px] pb-1 pt-[7px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-faint">
                  {g.group}
                </div>
                {g.items.map((c) => {
                  const idx = indexById.get(c.id)!;
                  const isActive = idx === active;
                  const isSelected = c.id === value;
                  return (
                    <button
                      key={c.id}
                      id={`${listId}-opt-${idx}`}
                      type="button"
                      data-idx={idx}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(c.id)}
                      className={`flex w-full items-center gap-2 rounded-[calc(var(--radius-sm)*0.7)] px-[9px] py-2 text-left text-[13.5px] leading-[1.2] ${
                        isActive ? "bg-ink-weak" : ""
                      } ${isSelected ? "font-semibold text-ink" : isActive ? "text-text" : "text-muted"}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {isSelected && (
                        <span aria-hidden className="flex flex-none text-ink">
                          <Icon.check width={14} height={14} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
