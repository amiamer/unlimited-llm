/**
 * Unit Tests for the Read-Along Normalizer
 * Feature: read-along-alignment (Phase 1)
 *
 * The normalizer is applied to both document sentences and STT transcripts,
 * so its job is to make the two representations collide: casing, punctuation,
 * symbols, and numbers must all converge on the same token stream.
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../normalize';

describe('normalize', () => {
  describe('casing, punctuation, whitespace', () => {
    it('lowercases and strips punctuation', () => {
      expect(normalize('Hello, World!')).toEqual(['hello', 'world']);
    });

    it('collapses arbitrary whitespace', () => {
      expect(normalize('  a \t b\n\n c  ')).toEqual(['a', 'b', 'c']);
    });

    it('removes apostrophes in place rather than splitting', () => {
      expect(normalize("don't")).toEqual(['dont']);
      expect(normalize('the bank’s rates')).toEqual(['the', 'banks', 'rates']);
    });

    it('treats hyphens and slashes as separators', () => {
      expect(normalize('two-thirds')).toEqual(['two', 'thirds']);
      expect(normalize('and/or')).toEqual(['and', 'or']);
    });

    it('returns [] for empty and punctuation-only input', () => {
      expect(normalize('')).toEqual([]);
      expect(normalize('   ')).toEqual([]);
      expect(normalize('...!?,;—')).toEqual([]);
    });
  });

  describe('symbol expansion', () => {
    it('expands % to percent after the number', () => {
      expect(normalize('2%')).toEqual(['two', 'percent']);
      expect(normalize('rates rose 2% today')).toEqual([
        'rates', 'rose', 'two', 'percent', 'today',
      ]);
    });

    it('expands $ to dollars after the number', () => {
      expect(normalize('$100')).toEqual(['one', 'hundred', 'dollars']);
      expect(normalize('$1,500')).toEqual([
        'one', 'thousand', 'five', 'hundred', 'dollars',
      ]);
    });

    it('expands & and +', () => {
      expect(normalize('AT&T')).toEqual(['at', 'and', 't']);
      expect(normalize('cash + credit')).toEqual(['cash', 'plus', 'credit']);
    });
  });

  describe('number expansion', () => {
    it('expands single digits and teens', () => {
      expect(normalize('0')).toEqual(['zero']);
      expect(normalize('7')).toEqual(['seven']);
      expect(normalize('13')).toEqual(['thirteen']);
      expect(normalize('19')).toEqual(['nineteen']);
    });

    it('expands tens and compounds', () => {
      expect(normalize('20')).toEqual(['twenty']);
      expect(normalize('42')).toEqual(['forty', 'two']);
      expect(normalize('99')).toEqual(['ninety', 'nine']);
    });

    it('expands hundreds', () => {
      expect(normalize('100')).toEqual(['one', 'hundred']);
      expect(normalize('305')).toEqual(['three', 'hundred', 'five']);
      expect(normalize('999')).toEqual(['nine', 'hundred', 'ninety', 'nine']);
    });

    it('expands magnitude groups (thousand, million)', () => {
      expect(normalize('1000')).toEqual(['one', 'thousand']);
      expect(normalize('1,000,000')).toEqual(['one', 'million']);
      expect(normalize('2500')).toEqual(['two', 'thousand', 'five', 'hundred']);
    });

    it('expands decimals as "point" plus digits', () => {
      expect(normalize('3.5')).toEqual(['three', 'point', 'five']);
      expect(normalize('12.05')).toEqual(['twelve', 'point', 'zero', 'five']);
    });

    it('does not confuse sentence-final periods with decimal points', () => {
      expect(normalize('rates rose. then fell.')).toEqual([
        'rates', 'rose', 'then', 'fell',
      ]);
    });

    it('leaves mixed alphanumeric tokens alone', () => {
      expect(normalize('covid19 q3')).toEqual(['covid19', 'q3']);
    });
  });

  describe('symmetry between document text and spoken transcript', () => {
    it('makes "2%" and "two percent" produce identical tokens', () => {
      expect(normalize('rates rose by 2% last quarter')).toEqual(
        normalize('Rates rose by two percent last quarter'),
      );
    });

    it('makes "$100" and "one hundred dollars" produce identical tokens', () => {
      expect(normalize('a $100 fee')).toEqual(
        normalize('a one hundred dollars fee'),
      );
    });
  });
});
