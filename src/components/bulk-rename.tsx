import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  FolderUploadIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  basename,
  previewName,
  renameFiles,
  type DroppedFile,
  type RenameResult,
} from "@/lib/rename";
import { cn } from "@/lib/utils";

type Status =
  | { state: "idle" }
  | { state: "renaming" }
  | { state: "done"; ok: number; failed: number };

export function BulkRename() {
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [baseName, setBaseName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Listen for native file drops from the Tauri webview (gives real paths).
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setIsDragging(true);
      } else if (payload.type === "leave") {
        setIsDragging(false);
      } else if (payload.type === "drop") {
        setIsDragging(false);
        addPaths(payload.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function handleSelectFiles() {
    const selected = await open({ multiple: true });
    if (!selected) return;
    addPaths(Array.isArray(selected) ? selected : [selected]);
  }

  function addPaths(paths: string[]) {
    setStatus({ state: "idle" });
    setErrors({});
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path));
      const next = [...prev];
      for (const path of paths) {
        if (!seen.has(path)) {
          seen.add(path);
          next.push({ path, name: basename(path) });
        }
      }
      return next;
    });
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((f) => f.path !== path));
    setStatus({ state: "idle" });
  }

  function clearAll() {
    setFiles([]);
    setStatus({ state: "idle" });
    setErrors({});
  }

  const canRename =
    files.length > 0 &&
    baseName.trim().length > 0 &&
    status.state !== "renaming";

  const preview = useMemo(
    () =>
      files.map((file, i) => ({
        ...file,
        newName: baseName.trim()
          ? previewName(file.name, baseName, i + 1)
          : null,
      })),
    [files, baseName],
  );

  async function handleRename() {
    if (!canRename) return;
    setStatus({ state: "renaming" });
    setErrors({});

    const results: RenameResult[] = await renameFiles(
      files.map((f) => f.path),
      baseName,
    );

    const nextErrors: Record<string, string> = {};
    let ok = 0;
    let failed = 0;

    // Rebuild the file list so renamed files keep working for a second pass.
    const updated: DroppedFile[] = results.map((r) => {
      if (r.ok) {
        ok++;
        return { path: r.new_path, name: r.new_name };
      }
      failed++;
      nextErrors[r.old_path] = r.error ?? "rename failed";
      return { path: r.old_path, name: basename(r.old_path) };
    });

    setFiles(updated);
    setErrors(nextErrors);
    setStatus({ state: "done", ok, failed });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Bulk Rename</h2>
        <p className="text-sm text-muted-foreground">
          Drop files below, type a name, and they become{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">name-1</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">name-2</code>,
          … in the same folder.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30",
        )}
      >
        <HugeiconsIcon
          icon={FolderUploadIcon}
          className={cn(
            "size-8",
            isDragging ? "text-primary" : "text-muted-foreground",
          )}
        />
        <p className="text-sm font-medium">
          {isDragging ? "Drop to add files" : "Drag & drop files here"}
        </p>
        <p className="text-xs text-muted-foreground">
          {files.length > 0
            ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
            : "Files are renamed in place — originals are replaced"}
        </p>
        <Button className="mt-1" size="sm" onClick={handleSelectFiles}>
          <HugeiconsIcon icon={FolderUploadIcon} />
          Select Files
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="base-name">Base name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="base-name"
            placeholder="e.g. pname"
            value={baseName}
            onChange={(e) => setBaseName(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button onClick={handleRename} disabled={!canRename}>
            <HugeiconsIcon icon={PencilEdit02Icon} />
            {status.state === "renaming" ? "Renaming…" : "Rename"}
          </Button>
          <Button
            variant="ghost"
            onClick={clearAll}
            disabled={files.length === 0 || status.state === "renaming"}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Status banner */}
      {status.state === "done" && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            status.failed === 0
              ? "border-border bg-muted/40 text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <HugeiconsIcon
            icon={status.failed === 0 ? CheckmarkCircle02Icon : Alert02Icon}
            className="size-4"
          />
          <span>
            Renamed {status.ok} file{status.ok === 1 ? "" : "s"}
            {status.failed > 0 && `, ${status.failed} failed`}.
          </span>
        </div>
      )}

      {/* Preview table */}
      {files.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Current name</TableHead>
                <TableHead>New name</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((file, i) => {
                const error = errors[file.path];
                return (
                  <TableRow key={file.path}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {file.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {error ? (
                        <span className="text-destructive">{error}</span>
                      ) : (
                        <span
                          className={
                            file.newName ? "" : "text-muted-foreground"
                          }
                        >
                          {file.newName ?? "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeFile(file.path)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
