"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
}

export function ProductGallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const [activeId, setActiveId] = useState(images[0]?.id ?? null);
  const active = images.find((image) => image.id === activeId) ?? images[0];

  if (!active) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-surface-muted text-ink-faint">
        <ImageIcon className="size-8" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row-reverse md:gap-4">
      <div className="relative aspect-[4/5] flex-1 overflow-hidden rounded-lg bg-surface-muted">
        <Image
          src={active.url}
          alt={active.alt || name}
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
        />
      </div>
      {images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto md:w-20 md:flex-col md:overflow-visible" aria-label="Product images">
          {images.map((image) => (
            <li key={image.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setActiveId(image.id)}
                aria-pressed={image.id === active.id}
                className={cn(
                  "relative block aspect-[4/5] w-16 overflow-hidden rounded-md border transition-colors md:w-20",
                  image.id === active.id ? "border-ink" : "border-transparent hover:border-line-strong",
                )}
              >
                <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
