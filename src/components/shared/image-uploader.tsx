"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { randomFileName, type StorageBucket } from "@/lib/storage";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface ImageUploaderProps {
  bucket: StorageBucket;
  /** Owner-scoped folder, e.g. `<vendor_id>` or `<vendor_id>/<product_id>`. */
  folder: string;
  accept: readonly string[];
  maxBytes: number;
  /** Called with the stored path; persist it with a Server Action. */
  onUploaded: (path: string) => Promise<ActionResult<unknown> | void>;
  label?: string;
  multiple?: boolean;
  className?: string;
}

/**
 * Uploads straight from the browser to Supabase Storage. The storage RLS
 * policies decide whether the user may write to `folder`; the Server Action
 * then validates the path again before saving it.
 */
export function ImageUploader({
  bucket,
  folder,
  accept,
  maxBytes,
  onUploaded,
  label = "Upload image",
  multiple,
  className,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function uploadOne(file: File) {
    if (!accept.includes(file.type)) throw new Error(`"${file.name}" is not a supported image type.`);
    if (file.size > maxBytes)
      throw new Error(`"${file.name}" is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const path = `${folder}/${randomFileName(file.type)}`;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError)
      throw new Error(
        uploadError.message === "new row violates row-level security policy"
          ? "You are not allowed to upload here."
          : uploadError.message,
      );
    const result = await onUploaded(path);
    if (result && !result.ok) {
      await supabase.storage.from(bucket).remove([path]);
      throw new Error(result.error.fieldErrors?.path?.[0] ?? result.error.message);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const list = Array.from(files).slice(0, multiple ? 12 : 1);
    startTransition(async () => {
      for (let index = 0; index < list.length; index += 1) {
        setProgress(list.length > 1 ? `Uploading ${index + 1} of ${list.length}…` : "Uploading…");
        try {
          await uploadOne(list[index]);
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
          break;
        }
      }
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(",")}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
        disabled={pending}
      />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        {progress ?? label}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
