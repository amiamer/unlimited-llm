'use client';

import { useState, useEffect, useCallback } from 'react';

type ServerStatus = 'online' | 'offline' | 'checking';

/**
 * Polls the Next.js server to detect if it's running.
 * Uses a lightweight HEAD request to the sessions endpoint.
 */
export function useServerHealth(intervalMs = 15_000): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      setStatus(res.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [check, intervalMs]);

  return status;
}
