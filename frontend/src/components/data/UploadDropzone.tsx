import { FileJson, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { cx } from "@/components/ui";

const ACCEPT = [".csv", ".json", ".ndjson", ".jsonl"];
const MAX_MB = 5;

export function UploadDropzone({ onFile, busy }: { onFile: (f: File) => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!ACCEPT.some((e) => name.endsWith(e))) return setError(`"${file.name}" is not a CSV or JSON file.`);
    if (file.size > MAX_MB * 1024 * 1024) return setError(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_MB} MB.`);
    if (file.size === 0) return setError(`"${file.name}" is empty.`);
    setError(null);
    onFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    accept(e.dataTransfer.files?.[0]);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a CSV or JSON dataset: drop a file or press Enter to browse"
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2/40 hover:border-accent/60",
          busy && "cursor-wait opacity-70",
        )}
      >
        {busy ? <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden /> : <UploadCloud className="h-8 w-8 text-accent" aria-hidden />}
        <div className="font-medium text-ink">{busy ? "Parsing and validating…" : "Drop a sensor dataset here, or click to browse"}</div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </span>
          <span className="inline-flex items-center gap-1">
            <FileJson className="h-3.5 w-3.5" /> JSON / JSON Lines
          </span>
          <span>max {MAX_MB} MB · 20 000 rows</span>
        </div>
        <p className="max-w-md text-[11px] text-muted">Files are parsed as inert data on the server (never executed). Columns are auto-detected by name aliases; you can remap them.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(",")}
        className="sr-only"
        data-testid="file-input"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
