import type { ConverterController } from '../hooks/useConverter.ts';
import { defaults } from '../hooks/useConverter.ts';
import { presetDimensions, resolutionPresets } from '../lib/presets.ts';
import { Field, Check } from './FormControls';

export default function ExportSettings({
  controller,
}: {
  controller: ConverterController;
}) {
  const {
    source,
    settings,
    locked,
    setSettings,
    convert,
    preset,
    dimension,
    set,
    tooLarge,
    invalid,
    estimate,
    token,
    busy,
    loading,
    progress,
    percent,
    jobId,
    cancelling,
    cancel,
    result,
    notice,
    mode,
  } = controller;
  return (
    <aside className="panel">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
        <h2 className="font-semibold">Export settings</h2>
        <button
          type="button"
          className="text-button"
          disabled={!source || locked}
          onClick={() => setSettings(defaults(source!.meta))}
        >
          Reset
        </button>
      </div>
      <form onSubmit={convert} className="p-5 pb-0">
        <fieldset disabled={!source || locked} className="disabled:opacity-45">
          <legend className="sr-only">GIF export settings</legend>
          <Field label="Output size">
            <select
              className="field"
              value={settings.preset}
              onChange={(e) => preset(e.target.value)}
            >
              {resolutionPresets.map(({ id, label, width, height }) => (
                <option key={id} value={id}>
                  {label} · {width} × {height}
                </option>
              ))}
              <option value="original">Original dimensions</option>
              <option value="custom">Custom dimensions</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {(['width', 'height'] as const).map((name) => (
              <Field key={name} label={`${name === 'width' ? 'Width' : 'Height'} (px)`}>
                <input
                  className="field"
                  type="number"
                  min="16"
                  max="4096"
                  step="1"
                  required
                  value={settings[name]}
                  onChange={(e) => dimension(name, e.target.value)}
                />
              </Field>
            ))}
          </div>
          <Check
            checked={settings.aspect}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                aspect: e.target.checked,
                ...(s.preset !== 'custom'
                  ? presetDimensions(s.preset, source!.meta, e.target.checked)
                  : e.target.checked
                    ? {
                        height: Math.round(
                          (Number(s.width) * source!.meta.height) / source!.meta.width,
                        ),
                      }
                    : {}),
              }))
            }
          >
            Keep aspect ratio
          </Check>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Presets fit your artwork inside the selected resolution when aspect ratio is
            locked. Custom sizes support up to 4096 px per side.
          </p>
          <div className="my-5 border-t border-white/10" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frame rate (fps)">
              <select
                className="field"
                value={settings.fps}
                onChange={(e) => set('fps', e.target.value)}
              >
                {[
                  [10, 'compact'],
                  [20, 'balanced'],
                  [25, 'smooth'],
                  [50, 'extra smooth'],
                ].map(([n, name]) => (
                  <option value={n} key={n}>
                    {n} · {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Duration (sec)">
              <input
                className="field"
                type="number"
                min="0.02"
                max="120"
                step="any"
                required
                readOnly={settings.autoDuration}
                value={settings.duration}
                onChange={(e) => set('duration', e.target.value)}
              />
            </Field>
          </div>
          <Check
            checked={settings.autoDuration}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                autoDuration: e.target.checked,
                ...(e.target.checked
                  ? { duration: Number(source!.meta.duration.toFixed(6)) }
                  : {}),
              }))
            }
          >
            Use detected duration
          </Check>
          <Field label="Background">
            <div className="flex gap-2">
              <select
                className="field"
                value={settings.background}
                onChange={(e) => set('background', e.target.value)}
              >
                <option value="transparent">Transparent</option>
                <option value="#ffffff">White</option>
                <option value="#000000">Black</option>
                <option value="#0f172a">Dark blue</option>
                <option value="custom">Custom color</option>
              </select>
              {settings.background === 'custom' && (
                <input
                  aria-label="Custom background color"
                  type="color"
                  className="mt-2 h-11 w-12 shrink-0 rounded border border-white/20"
                  value={settings.customColor}
                  onChange={(e) => set('customColor', e.target.value)}
                />
              )}
            </div>
          </Field>
          <p className="mb-5 text-xs leading-relaxed text-slate-400">
            Preview updates immediately. Transparent clears the SVG canvas background;
            white, black, or a custom color replaces it. Artwork colors stay intact.
          </p>
          <details className="border-y border-white/10">
            <summary className="py-4 text-sm">Advanced options</summary>
            <div className="pt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start at (sec)">
                  <input
                    className="field"
                    type="number"
                    min="0"
                    max="3600"
                    step="any"
                    required
                    value={settings.start}
                    onChange={(e) => set('start', e.target.value)}
                  />
                </Field>
                <Field label="Palette">
                  <select
                    className="field"
                    value={settings.colors}
                    onChange={(e) => set('colors', e.target.value)}
                  >
                    {[256, 128, 64, 32].map((n) => (
                      <option key={n} value={n}>
                        {n} colors
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Playback">
                <select
                  className="field"
                  value={settings.loop}
                  onChange={(e) => set('loop', e.target.value)}
                >
                  {[
                    [0, 'Loop forever'],
                    [-1, 'Play once'],
                    [1, 'Play twice'],
                    [2, 'Play three times'],
                    [4, 'Play five times'],
                  ].map(([n, name]) => (
                    <option key={n} value={n}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Check
                checked={settings.dither}
                onChange={(e) => set('dither', e.target.checked)}
              >
                Dither colors for smoother gradients
              </Check>
            </div>
          </details>
        </fieldset>
        <p
          className={`py-4 text-xs leading-relaxed ${source && (tooLarge || invalid) ? 'text-red-300' : 'text-slate-400'}`}
        >
          {estimate}
        </p>
        <button
          type="submit"
          className="primary w-full"
          disabled={!source || !token || locked || invalid || tooLarge}
        >
          {busy ? 'Converting…' : loading ? 'Reading SVG…' : 'Convert to GIF'}
        </button>
      </form>
      {busy && (
        <section className="px-5 pt-5" aria-label="Export progress">
          <div className="flex justify-between gap-2 text-xs text-slate-300">
            <span role="status">{progress.message}</span>
            <span>{percent}%</span>
          </div>
          <progress
            className="my-3 h-2 w-full overflow-hidden rounded-full bg-slate-700"
            max="100"
            value={percent}
          >
            {percent}%
          </progress>
          <button
            type="button"
            className="text-button"
            disabled={(mode !== 'stream' && !jobId) || cancelling}
            onClick={cancel}
          >
            {cancelling ? 'Cancelling…' : 'Cancel export'}
          </button>
        </section>
      )}
      {result && (
        <a
          href={result.url}
          download={source!.name.replace(/\.svg$/i, '') + '.gif'}
          className="mx-5 mt-4 block rounded-xl border border-accent px-4 py-3 text-center text-sm font-semibold text-accent transition hover:bg-accent/10"
        >
          Download GIF ↓
        </a>
      )}
      <p
        role="status"
        className={`m-5 text-xs leading-relaxed ${notice.error ? 'rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-red-200' : 'text-slate-400'}`}
      >
        {notice.text}
      </p>
    </aside>
  );
}
