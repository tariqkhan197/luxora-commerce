import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FormShellProps {
  title: string;
  description?: string;
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}

export function FormShell({ title, description, error, children, footer }: FormShellProps) {
  return (
    <div className="w-full max-w-md">
      <h1 className="display-2">{title}</h1>
      {description ? <p className="mt-3 text-sm leading-relaxed text-ink-soft">{description}</p> : null}
      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 text-sm text-ink-soft">{footer}</div> : null}
    </div>
  );
}
