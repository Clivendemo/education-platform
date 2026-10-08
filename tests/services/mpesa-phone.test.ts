import { describe, it, expect } from 'vitest';
import {
  normalizeMpesaPhoneNumber,
  isValidMpesaPhoneNumber,
} from '../../src/services/commerce/mpesa/mpesa-phone.util.js';
import { MpesaPhoneValidationError } from '../../src/services/commerce/commerce.interface.js';

describe('M-Pesa Phone Number Normalization & Validation', () => {
  describe('Valid Kenyan Mobile Formats', () => {
    it('normalizes local 10-digit 07... numbers to 2547...', () => {
      expect(normalizeMpesaPhoneNumber('0712345678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('0722000000')).toBe('254722000000');
      expect(normalizeMpesaPhoneNumber('0799123456')).toBe('254799123456');
    });

    it('normalizes local 10-digit 01... numbers to 2541...', () => {
      expect(normalizeMpesaPhoneNumber('0112345678')).toBe('254112345678');
      expect(normalizeMpesaPhoneNumber('0100000000')).toBe('254100000000');
    });

    it('normalizes local 9-digit numbers without leading zero (7XXXXXXXX / 1XXXXXXXX)', () => {
      expect(normalizeMpesaPhoneNumber('712345678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('112345678')).toBe('254112345678');
    });

    it('normalizes international numbers with leading + (+2547... / +2541...)', () => {
      expect(normalizeMpesaPhoneNumber('+254712345678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('+254112345678')).toBe('254112345678');
    });

    it('accepts already normalized numbers (2547... / 2541...)', () => {
      expect(normalizeMpesaPhoneNumber('254712345678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('254112345678')).toBe('254112345678');
    });

    it('handles formatted strings with spaces, hyphens, and brackets', () => {
      expect(normalizeMpesaPhoneNumber('0712 345 678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('+254 712-345-678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('(0712) 345 678')).toBe('254712345678');
      expect(normalizeMpesaPhoneNumber('+254 (011) 234-5678')).toBe('254112345678');
    });

    it('returns true from isValidMpesaPhoneNumber for valid numbers', () => {
      expect(isValidMpesaPhoneNumber('0712345678')).toBe(true);
      expect(isValidMpesaPhoneNumber('+254712345678')).toBe(true);
      expect(isValidMpesaPhoneNumber('0112345678')).toBe(true);
    });
  });

  describe('Invalid Mobile Formats & Rejections', () => {
    it('rejects Kenyan landlines (020...)', () => {
      expect(() => normalizeMpesaPhoneNumber('0201234567')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(isValidMpesaPhoneNumber('0201234567')).toBe(false);
    });

    it('rejects non-Kenyan international numbers (+1, +255, +44)', () => {
      expect(() => normalizeMpesaPhoneNumber('+12025550123')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber('+255712345678')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber('+447911123456')).toThrow(
        MpesaPhoneValidationError,
      );
    });

    it('rejects invalid Kenyan prefixes (08..., 09..., 03...)', () => {
      expect(() => normalizeMpesaPhoneNumber('0812345678')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber('0912345678')).toThrow(
        MpesaPhoneValidationError,
      );
    });

    it('rejects incomplete numbers (too short)', () => {
      expect(() => normalizeMpesaPhoneNumber('0712345')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber('7123')).toThrow(
        MpesaPhoneValidationError,
      );
    });

    it('rejects numbers with excessive digits', () => {
      expect(() => normalizeMpesaPhoneNumber('071234567890123')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber('25471234567899')).toThrow(
        MpesaPhoneValidationError,
      );
    });

    it('rejects non-string or empty inputs', () => {
      expect(() => normalizeMpesaPhoneNumber('')).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber(null as any)).toThrow(
        MpesaPhoneValidationError,
      );
      expect(() => normalizeMpesaPhoneNumber(undefined as any)).toThrow(
        MpesaPhoneValidationError,
      );
    });
  });
});
