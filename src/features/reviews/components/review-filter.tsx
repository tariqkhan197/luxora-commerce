import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Link-based filter chips (server rendered). */
export function ReviewFilter<T extends string>({
  basePath,
  param,
  options,
  active,
}: {
  basePath: string;
  param: string;
  options: readonly { value: T; label: string }[];
  active: T;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Button key={option.value} asChild size="sm" variant={active === option.value ? "primary" : "ghost"}>
          <Link href={`${basePath}?${param}=${option.value}`}>{option.label}</Link>
        </Button>
      ))}
    </div>
  );
}
