import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import i18n from "../i18n";
import api, { errorText } from "./api";

/** GET `url` (skipped when null). Returns { data, loading, error, reload, setData }. */
export function useFetch(url, { params, poll } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState(null);
  const key = url ? `${url}?${JSON.stringify(params || {})}` : null;
  const alive = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!url) return;
    if (!quiet) setLoading(true);
    try {
      const res = await api.get(url, { params });
      if (alive.current) {
        setData(res.data);
        setError(null);
      }
    } catch (err) {
      if (alive.current) setError(errorText(err));
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    alive.current = true;
    load();
    let timer;
    if (poll) timer = setInterval(() => load(true), poll);
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [load, poll]);

  return { data, loading, error, reload: load, setData };
}

/** Wrap a mutation: shows a toast on success/failure and tracks busy state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const result = await fn();
      if (success) toast.success(i18n.t(success));
      return result;
    } catch (err) {
      toast.error(errorText(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);
  return [run, busy];
}
