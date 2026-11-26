import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/client.ts';
import { errorMessage } from '../lib/errors.ts';
import type {
  SvgMetadata,
  SourceFile,
  ExportSettings,
  ExportResult,
  ConversionProgress,
  JobSnapshot,
} from '../lib/types.ts';

export const defaults = (meta: SvgMetadata): ExportSettings => ({
  width: Math.min(480, Math.round(meta.width)),
  height: Math.round((Math.min(480, Math.round(meta.width)) * meta.height) / meta.width),
  fps: 25,
  duration: Number(meta.duration.toFixed(6)),
  start: 0,
  colors: 256,
  loop: 0,
  dither: false,
  background: 'transparent',
  customColor: '#ffffff',
  aspect: true,
  autoDuration: true,
  preset: meta.width > 480 ? '480' : 'original',
});
const initial: ExportSettings = {
  width: 480,
  height: 480,
  fps: 25,
  duration: 1,
  start: 0,
  colors: 256,
  loop: 0,
  dither: false,
  background: 'transparent',
  customColor: '#ffffff',
  aspect: true,
  autoDuration: true,
  preset: '480',
};

export function useConverter() {
  const [token, setToken] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFile | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExportSettings>(initial);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [resultTab, setResultTab] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ConversionProgress>({
    progress: 0,
    message: 'Preparing export',
  });
  const [cancelling, setCancelling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState({
    text: 'Connecting to the converter…',
    error: false,
  });
  const input = useRef<HTMLInputElement>(null);
  const loadID = useRef(0);
  const dragDepth = useRef(0);
  const locked = busy || loading;
  const tell = (text: string, error = false) => setNotice({ text, error });
  const set = <K extends keyof ExportSettings>(name: K, value: ExportSettings[K]) =>
    setSettings((s) => ({ ...s, [name]: value }));

  useEffect(() => {
    const controller = new AbortController();
    api<{ token: string }>('/api/session', null, undefined, controller.signal)
      .then((session) => {
        setToken(session.token);
        setNotice({ text: 'Ready. Choose an SVG or try the sample.', error: false });
      })
      .catch((error) => {
        if (!(error instanceof Error && error.name === 'AbortError'))
          setNotice({
            text: 'Cannot connect to the converter. Please reload the page or try again shortly.',
            error: true,
          });
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!source) return;
    const url = URL.createObjectURL(new Blob([source.svg], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      setJobId(null);
      setBusy(false);
      setCancelling(false);
    };
    async function poll() {
      try {
        const job = await api<JobSnapshot>(
          `/api/jobs/${jobId}`,
          token,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setProgress(job);
        if (job.state === 'done' && job.result) {
          setResult({ ...job.result, url: `/api/jobs/${jobId}/download` });
          setResultTab(true);
          setNotice({ text: 'Your GIF is ready. Download it below.', error: false });
          finish();
          return;
        }
        if (job.state === 'cancelled' || job.state === 'error') {
          setNotice({
            text:
              job.state === 'cancelled'
                ? 'Export cancelled. Adjust settings and try again.'
                : job.message,
            error: job.state === 'error',
          });
          finish();
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          setNotice({ text: errorMessage(error), error: true });
          finish();
          return;
        }
        setNotice({
          text: 'Connection interrupted. Retrying export status…',
          error: true,
        });
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 450);
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, token]);

  async function loadFile(file: File | undefined) {
    if (!file || locked || !token) return;
    if (!file.name.toLowerCase().endsWith('.svg'))
      return tell('Choose a file with an .svg extension.', true);
    if (file.size > 10 * 1024 * 1024)
      return tell('Choose an SVG smaller than 10 MB.', true);
    const id = ++loadID.current;
    setLoading(true);
    tell('Reading SVG dimensions and animation…');
    try {
      const svg = await file.text();
      const meta = await api<SvgMetadata>('/api/inspect', token, { svg });
      if (id !== loadID.current) return;
      setSource({ svg, meta, name: file.name, size: file.size });
      setSettings(defaults(meta));
      setResult(null);
      setResultTab(false);
      tell(
        meta.animations
          ? 'Animation detected. Ready to export.'
          : 'Static SVG detected. Your GIF will contain one frame.',
      );
    } catch (error) {
      if (id === loadID.current) tell(errorMessage(error), true);
    } finally {
      if (id === loadID.current) setLoading(false);
      if (input.current) input.current.value = '';
    }
  }
  async function sample() {
    try {
      const response = await fetch('/sample.svg');
      if (!response.ok) throw new Error('Could not load the sample.');
      await loadFile(
        new File([await response.text()], 'Location.svg', { type: 'image/svg+xml' }),
      );
    } catch (error) {
      tell(errorMessage(error), true);
    }
  }
  function dimension(name: 'width' | 'height', value: string) {
    const metadata = source?.meta;
    if (!metadata) return;
    setSettings((s) => {
      const next = { ...s, [name]: value, preset: 'custom' };
      if (s.aspect && Number(value) > 0) {
        const other = name === 'width' ? 'height' : 'width';
        next[other] = Math.round((Number(value) * metadata[other]) / metadata[name]);
      }
      return next;
    });
  }
  function preset(value: string) {
    const metadata = source?.meta;
    if (!metadata) return;
    setSettings((s) => {
      if (value === 'custom') return { ...s, preset: value };
      const width = value === 'original' ? Math.round(metadata.width) : Number(value);
      return {
        ...s,
        preset: value,
        width,
        height: Math.round((width * metadata.height) / metadata.width),
      };
    });
  }
  const width = Number(settings.width);
  const height = Number(settings.height);
  const duration = Number(settings.duration);
  const frames = source?.meta.animations
    ? Math.max(1, Math.round(duration * Number(settings.fps)))
    : 1;
  const tooLarge = frames > 1800 || width * height * frames > 800000000;
  const invalid =
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 4096 ||
    height > 4096 ||
    !Number.isFinite(duration) ||
    duration < 0.02 ||
    duration > 120 ||
    !Number.isFinite(Number(settings.start)) ||
    Number(settings.start) < 0 ||
    Number(settings.start) > 3600;
  const estimate = !source
    ? 'Choose an SVG to see export details.'
    : tooLarge
      ? 'Export is too large. Reduce size, frame rate, or duration.'
      : invalid
        ? 'Set valid dimensions, duration, and start time.'
        : `${width} × ${height} px · ${frames} ${frames === 1 ? 'frame' : 'frames'} · ${duration.toFixed(2)} sec`;
  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source || locked || invalid || tooLarge || !token) return;
    setBusy(true);
    setResult(null);
    setResultTab(false);
    setCancelling(false);
    setProgress({ progress: 0, message: 'Preparing export' });
    tell('Preparing your GIF. Keep this page open until the export is ready.');
    const options = {
      width,
      height,
      duration,
      fps: Number(settings.fps),
      start: Number(settings.start),
      colors: Number(settings.colors),
      loop: Number(settings.loop),
      dither: settings.dither,
      background:
        settings.background === 'custom' ? settings.customColor : settings.background,
    };
    try {
      const { id } = await api<{ id: string }>('/api/convert', token, {
        svg: source.svg,
        options,
      });
      setJobId(id);
    } catch (error) {
      tell(errorMessage(error), true);
      setBusy(false);
    }
  }
  async function cancel() {
    if (!jobId) return;
    setCancelling(true);
    try {
      await api(`/api/jobs/${jobId}/cancel`, token, {});
    } catch (error) {
      tell(errorMessage(error), true);
      setCancelling(false);
    }
  }
  const percent = Math.round(progress.progress * 100);
  return {
    token,
    source,
    preview,
    settings,
    result,
    resultTab,
    loading,
    busy,
    jobId,
    progress,
    cancelling,
    dragging,
    notice,
    input,
    dragDepth,
    locked,
    setSettings,
    setResultTab,
    setDragging,
    set,
    loadFile,
    sample,
    dimension,
    preset,
    invalid,
    tooLarge,
    estimate,
    convert,
    cancel,
    percent,
  };
}

export type ConverterController = ReturnType<typeof useConverter>;
