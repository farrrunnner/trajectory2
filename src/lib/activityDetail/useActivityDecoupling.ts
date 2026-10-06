import { useEffect, useState } from 'react';
import { getAerobicDecoupling } from '@/lib/tauri';
import type { AerobicDecouplingRequest, AerobicDecouplingResponse } from '@/types';

type State = { key: string; response: AerobicDecouplingResponse | null; error: string | null };
export function useActivityDecoupling(request: AerobicDecouplingRequest | null, dataVersion: string) {
  const key = JSON.stringify({ request, dataVersion });
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    // Dragging can change the range on every pointer event. Only dispatch the settled range.
    const timer = setTimeout(() => {
      void getAerobicDecoupling(request).then((response) => {
        if (!cancelled) setState({ key, response, error: null });
      }).catch((error: unknown) => {
        if (!cancelled) setState({ key, response: null, error: String(error) });
      });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, request]);
  return {
    response: state?.key === key ? state.response : null,
    error: state?.key === key ? state.error : null,
    loading: request != null && state?.key !== key
  };
}
