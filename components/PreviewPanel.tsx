import type { ConverterController } from '../hooks/useConverter.ts';
import { bytes } from '../lib/client.ts';

export default function PreviewPanel({
  controller,
}: {
  controller: ConverterController;
}) {
  const {
    source,
    preview,
    result,
    resultTab,
    setResultTab,
    dragging,
    locked,
    token,
    input,
    sample,
    dragDepth,
    setDragging,
    loadFile,
    settings,
    restartPreview,
    maxInputMB,
  } = controller;
  const background =
    settings.background === 'custom' ? settings.customColor : settings.background;
  const transparent = resultTab || background === 'transparent';
  return (
    <section className="panel" aria-label="Animation preview">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <h2 className="font-semibold">Canvas</h2>
        <div
          className="flex gap-1 rounded-lg border border-white/10 p-1"
          role="group"
          aria-label="Preview selection"
        >
          {[false, true].map((isResult) => (
            <button
              key={String(isResult)}
              type="button"
              disabled={isResult && !result}
              aria-pressed={resultTab === isResult}
              onClick={() => setResultTab(isResult)}
              className={`rounded-md px-3 py-1.5 text-xs ${resultTab === isResult ? 'bg-slate-600/60 text-white' : 'text-slate-400'}`}
            >
              {isResult ? 'Exported GIF' : 'SVG preview'}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`relative flex h-[420px] items-center justify-center p-6 sm:h-[560px] ${source ? (transparent ? 'checkerboard' : '') : 'dotted'} ${dragging ? 'outline-2 -outline-offset-2 outline-accent' : ''}`}
        style={{ backgroundColor: source && !transparent ? background : undefined }}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!locked && token) {
            dragDepth.current++;
            setDragging(true);
          }
        }}
        onDragLeave={() => {
          if (--dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          loadFile(event.dataTransfer.files[0]);
        }}
      >
        {source && preview ? (
          <img
            src={resultTab && result ? result.url : preview}
            alt={
              resultTab
                ? 'Exported GIF animation'
                : 'SVG animation at selected output dimensions'
            }
            className="max-h-full max-w-full object-contain"
            style={{ backgroundColor: resultTab ? 'transparent' : background }}
          />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="grid h-20 w-16 -rotate-6 place-items-center rounded-xl border border-accent/40 bg-accent/10 font-mono text-lg text-accent">
              &lt;svg&gt;
            </div>
            <h3 className="mt-2 text-lg font-medium">A little motion goes a long way.</h3>
            <p className="text-sm text-slate-400">Drop an SVG here to get started</p>
            <button
              type="button"
              className="primary"
              disabled={locked || !token}
              onClick={() => input.current?.click()}
            >
              Choose SVG file
            </button>
            <button
              type="button"
              className="text-button"
              disabled={locked || !token}
              onClick={sample}
            >
              Or try the sample animation ↗
            </button>
            <span className="text-xs text-slate-500">
              Animated or static SVG · up to {maxInputMB} MB
            </span>
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#18211b]/95 text-xl font-semibold text-accent">
            Drop your SVG here
          </div>
        )}
      </div>
      {source && !resultTab && (
        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 text-xs text-slate-400">
          <span>
            Live preview · {settings.width || '—'} × {settings.height || '—'} px ·{' '}
            {background === 'transparent'
              ? 'Transparent (checkerboard)'
              : background.toUpperCase()}
            . Export to update GIF timing and colors.
          </span>
          <button type="button" className="text-button shrink-0" onClick={restartPreview}>
            Restart ↻
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-white/10 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {source?.name || 'No file selected'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {source
              ? `${Math.round(source.meta.width)} × ${Math.round(source.meta.height)} · ${bytes(source.size)} · ${source.meta.animations ? `${source.meta.animations} animated attributes` : 'Static SVG'}`
              : 'Choose an SVG to preview and export.'}
          </p>
        </div>
        {source && (
          <button
            type="button"
            className="text-button shrink-0"
            disabled={locked}
            onClick={() => input.current?.click()}
          >
            Replace file
          </button>
        )}
      </div>
      {result && (
        <p className="border-t border-white/10 px-5 py-4 text-sm text-accent">
          Export ready · {result.width} × {result.height} · {result.frames} frames ·{' '}
          {result.duration}s · {bytes(result.bytes)}
        </p>
      )}
    </section>
  );
}
