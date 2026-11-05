'use client';

import React, { useEffect, useRef, useState, useId } from 'react';
import type { AutocompleteResponse, AutocompleteSuggestion } from '@/lib/api/types';

export interface AutocompleteSearchProps {
  country?: string;
  className?: string;
}

export function AutocompleteSearch({
  country = 'ke',
  className = '',
}: AutocompleteSearchProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestQueryRef = useRef(query);
  latestQueryRef.current = query;

  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      setHighlightedIndex(-1);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const url = `/api/v1/search/autocomplete?q=${encodeURIComponent(trimmed)}&country=${encodeURIComponent(country)}&limit=5`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          throw new Error(`Autocomplete error: ${res.status}`);
        }

        const payload = (await res.json()) as AutocompleteResponse;
        if (latestQueryRef.current.trim() === trimmed) {
          setSuggestions(payload.data || []);
          setIsOpen((payload.data || []).length > 0);
          setHighlightedIndex(-1);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setSuggestions([]);
        setIsOpen(false);
        setIsLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [query, country]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelectSuggestion = (suggestion: AutocompleteSuggestion) => {
    setQuery(suggestion.text);
    setIsOpen(false);
    setHighlightedIndex(-1);
    setSearchFeedback(
      `Selected "${suggestion.text}". Full catalogue discovery will be activated in Phase 3.`,
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsOpen(false);
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      setSearchFeedback(
        `Search for "${trimmed}" recorded. Full faceted catalogue search will be activated in Phase 3.`,
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && suggestions.length > 0) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else if (suggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen && suggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
      }
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`.trim()}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-[var(--text-primary)]"
        >
          Search Kenyan Educational Materials
        </label>
        <div className="relative flex items-center">
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchFeedback(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0 && query.trim().length >= 2) {
                setIsOpen(true);
              }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-activedescendant={
              highlightedIndex >= 0
                ? `${listboxId}-item-${highlightedIndex}`
                : undefined
            }
            autoComplete="off"
            placeholder="Search CBC grades, KCSE past papers, schemes of work..."
            className="min-h-12 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-3 pr-24 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          />
          <button
            type="submit"
            className="absolute right-1.5 inline-flex min-h-9 items-center justify-center rounded-md bg-[var(--accent-primary)] px-4 text-xs font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {isOpen && suggestions.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Autocomplete search suggestions"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] py-1.5 shadow-lg"
        >
          {suggestions.map((item, index) => {
            const isHighlighted = highlightedIndex === index;
            const contextText = [
              item.context?.curriculum,
              item.context?.grade,
              item.context?.subject,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <li
                key={`${item.type}-${item.text}-${index}`}
                id={`${listboxId}-item-${index}`}
                role="option"
                aria-selected={isHighlighted}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleSelectSuggestion(item)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isHighlighted
                    ? 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                }`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate text-[var(--text-primary)]">
                    {item.text}
                  </span>
                  {contextText ? (
                    <span className="text-xs text-[var(--text-muted)] truncate">
                      {contextText}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  {item.type === 'CURRICULUM_TOPIC' ? 'Curriculum Topic' : 'Resource'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {searchFeedback ? (
        <p
          role="status"
          className="mt-2 text-xs font-medium text-[var(--accent-secondary)]"
        >
          {searchFeedback}
        </p>
      ) : null}
    </div>
  );
}
