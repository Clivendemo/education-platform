import { describe, it, expect } from 'vitest';
import {
  escapeRegexMetacharacters,
  sanitizeSearchQuery,
} from '../../src/utils/search-sanitizer.js';

describe('Search Sanitizer Unit Tests', () => {
  describe('escapeRegexMetacharacters', () => {
    it('escapes all POSIX regex metacharacters cleanly', () => {
      const input = 'math(cbc)+physics*chemistry?biology[grade]^term$foo.bar\\test';
      const escaped = escapeRegexMetacharacters(input);
      expect(escaped).toBe(
        'math\\(cbc\\)\\+physics\\*chemistry\\?biology\\[grade\\]\\^term\\$foo\\.bar\\\\test',
      );
    });

    it('leaves standard alphanumeric and spaces unchanged', () => {
      const input = 'grade 10 integrated science revision notes';
      expect(escapeRegexMetacharacters(input)).toBe(input);
    });
  });

  describe('sanitizeSearchQuery', () => {
    it('returns normalizedQuery: null for empty or single-character inputs', () => {
      expect(sanitizeSearchQuery('')).toEqual({
        sanitizedQuery: '',
        normalizedQuery: null,
      });
      expect(sanitizeSearchQuery('   ')).toEqual({
        sanitizedQuery: '',
        normalizedQuery: null,
      });
      expect(sanitizeSearchQuery('a')).toEqual({
        sanitizedQuery: 'a',
        normalizedQuery: null,
      });
    });

    it('returns normalizedQuery: null for queries exceeding 100 characters', () => {
      const longInput = 'a'.repeat(101);
      const res = sanitizeSearchQuery(longInput);
      expect(res.normalizedQuery).toBeNull();
      expect(res.sanitizedQuery.length).toBe(101);
    });

    it('redacts email addresses to [EMAIL]', () => {
      const input = 'revision notes by teacher john.doe@school.ke for grade 8';
      const res = sanitizeSearchQuery(input);
      expect(res.sanitizedQuery).toContain('[email]');
      expect(res.normalizedQuery).toContain('[email]');
      expect(res.normalizedQuery).not.toContain('john.doe@school.ke');
    });

    it('redacts Kenyan phone numbers (+254, 07..., 01...) to [PHONE]', () => {
      const input1 = 'call tutor +254712345678 for exam help';
      const res1 = sanitizeSearchQuery(input1);
      expect(res1.sanitizedQuery).toContain('[phone]');
      expect(res1.normalizedQuery).not.toContain('254712345678');

      const input2 = 'inquire on 0722123456 mathematics';
      const res2 = sanitizeSearchQuery(input2);
      expect(res2.sanitizedQuery).toContain('[phone]');
      expect(res2.normalizedQuery).not.toContain('0722123456');
    });

    it('redacts 16-digit card / national ID numbers to [NUMBER]', () => {
      const input = 'notes fee 1234567890123456 term 2';
      const res = sanitizeSearchQuery(input);
      expect(res.sanitizedQuery).toContain('[number]');
      expect(res.normalizedQuery).not.toContain('1234567890123456');
    });

    it('returns normalizedQuery: null if query contains only redaction placeholders or symbols', () => {
      const onlyEmail = sanitizeSearchQuery('teacher@domain.com');
      expect(onlyEmail.normalizedQuery).toBeNull();

      const onlyPhone = sanitizeSearchQuery('+254712345678');
      expect(onlyPhone.normalizedQuery).toBeNull();

      const onlySymbols = sanitizeSearchQuery('??? --- !!!');
      expect(onlySymbols.normalizedQuery).toBeNull();
    });

    it('collapses extra whitespace, lowercases, and preserves valid educational terms', () => {
      const input = '   Grade   8    CBC   Integrated   SCIENCE   ';
      const res = sanitizeSearchQuery(input);
      expect(res.sanitizedQuery).toBe('grade 8 cbc integrated science');
      expect(res.normalizedQuery).toBe('grade 8 cbc integrated science');
    });
  });
});
