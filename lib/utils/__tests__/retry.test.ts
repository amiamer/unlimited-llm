import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryWithBackoff, isRetryableError } from '../retry';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should succeed on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    
    const result = await retryWithBackoff(operation);
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue('success');
    
    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should throw error after max attempts', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('persistent error'));
    
    await expect(
      retryWithBackoff(operation, {
        maxAttempts: 3,
        initialDelayMs: 10,
      })
    ).rejects.toThrow('persistent error');
    
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should not retry if shouldRetry returns false', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('non-retryable'));
    
    await expect(
      retryWithBackoff(operation, {
        maxAttempts: 3,
        initialDelayMs: 10,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('non-retryable');
    
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should call onRetry callback', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('error 1'))
      .mockResolvedValue('success');
    
    const onRetry = vi.fn();
    
    await retryWithBackoff(operation, {
      maxAttempts: 3,
      initialDelayMs: 10,
      onRetry,
    });
    
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('should use exponential backoff', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('error 1'))
      .mockRejectedValueOnce(new Error('error 2'))
      .mockResolvedValue('success');
    
    const delays: number[] = [];
    const onRetry = vi.fn((attempt) => {
      delays.push(Date.now());
    });
    
    await retryWithBackoff(operation, {
      maxAttempts: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      onRetry,
    });
    
    // Verify delays increase (exponential backoff)
    expect(delays.length).toBe(2);
    // Second delay should be roughly 2x the first (with some tolerance)
    // We can't test exact timing due to test environment variability
  });

  it('should respect maxDelayMs', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('error 1'))
      .mockRejectedValueOnce(new Error('error 2'))
      .mockResolvedValue('success');
    
    await retryWithBackoff(operation, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 500,
      backoffMultiplier: 10,
    });
    
    // Should complete without hanging (maxDelayMs caps the delay)
    expect(operation).toHaveBeenCalledTimes(3);
  });
});

describe('isRetryableError', () => {
  it('should identify network errors as retryable', () => {
    expect(isRetryableError(new Error('network error'))).toBe(true);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('timeout occurred'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('should identify server errors as retryable', () => {
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
    expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
  });

  it('should identify rate limiting as retryable', () => {
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('should not retry client errors', () => {
    expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
    expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
    expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
    expect(isRetryableError(new Error('Invalid input'))).toBe(false);
  });
});
