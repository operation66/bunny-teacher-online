import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';

export const SearchableSelect = ({
  options = [],
  value = '',
  onChange,
  placeholder = 'Search...',
  getOptionLabel = (opt) => String(opt?.label ?? opt ?? ''),
  getOptionValue = (opt) => String(opt?.value ?? opt ?? ''),
  className = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  const normalized = useMemo(() => options.map((opt) => ({
    label: getOptionLabel(opt),
    value: getOptionValue(opt),
    raw: opt,
  })), [options, getOptionLabel, getOptionValue]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => o.label.toLowerCase().includes(q));
  }, [normalized, query]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    setHighlightIndex(0);
  }, [open, query]);

  const currentLabel = useMemo(() => {
    const found = normalized.find((o) => o.value === String(value));
    return found?.label ?? '';
  }, [normalized, value]);

  const commitSelection = (opt) => {
    onChange?.(opt.value, opt.raw);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlightIndex((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const opt = filtered[highlightIndex];
      if (opt) commitSelection(opt);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlightIndex}"]`);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`text-left truncate ${currentLabel ? 'text-gray-900' : 'text-gray-500'}`}>
          {currentLabel || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              autoFocus
              className="w-full pl-9 pr-3 py-2 text-sm border-b border-gray-200 focus:outline-none"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-48 overflow-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No results</li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={idx === highlightIndex}
                  data-index={idx}
                  className={`px-3 py-2 text-sm cursor-pointer ${idx === highlightIndex ? 'bg-blue-50' : ''}`}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onClick={() => commitSelection(opt)}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};