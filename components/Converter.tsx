import { useConverter } from '../hooks/useConverter.ts';
import ExportSettings from './ExportSettings';
import PreviewPanel from './PreviewPanel';

export default function Converter() {
  const controller = useConverter();
  const { input, locked, token, loadFile } = controller;

  return (
    <>
      <header className="flex h-20 items-center justify-between border-b border-white/10 px-[5vw]">
        <a
          href="/"
          className="flex items-center gap-3 text-lg font-semibold tracking-tight"
          aria-label="SVG Studio home"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-xl font-black text-[#17240f]">
            S↳
          </span>
          SVG Studio
        </a>
        <span className="rounded-full border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs text-accent">
          Transparent GIF exports
        </span>
      </header>
      <main className="mx-auto max-w-[1440px] px-[5vw] pt-10 pb-6">
        <p className="text-xs font-bold tracking-[.2em] text-accent">
          SVG TO GIF CONVERTER
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">
          Keep it moving.
        </h1>
        <p className="mt-4 mb-8 max-w-2xl leading-7 text-slate-400">
          Turn animated SVGs into crisp, looping GIFs. Pick a file, tune your export, and
          download.
        </p>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <PreviewPanel controller={controller} />
          <ExportSettings controller={controller} />
        </div>
        <footer className="flex flex-col justify-between gap-2 py-6 text-xs text-slate-500 sm:flex-row">
          <span>No account required. Exports expire automatically.</span>
          <span>SMIL animation · transparent output · shared color palette</span>
        </footer>
      </main>
      <input
        ref={input}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        disabled={locked || !token}
        onChange={(event) => loadFile(event.target.files?.[0])}
      />
    </>
  );
}
