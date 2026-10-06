import { Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTimeUtc } from "@/lib/format";

/**
 * Shown on unpaid orders. Payment collection is not enabled in this release,
 * so the copy states plainly that nothing was charged and when the hold ends.
 */
export function PaymentNotice({ reservationExpiresAt }: { reservationExpiresAt: string | null }) {
  return (
    <Alert variant="info">
      <Clock />
      <AlertTitle>Awaiting payment — nothing has been charged</AlertTitle>
      <AlertDescription>
        Online payment is not yet available on Luxora, so this order has not been paid and will not ship.
        {reservationExpiresAt
          ? ` Your items are reserved until ${formatDateTimeUtc(new Date(reservationExpiresAt))}. After that they are released and the order is cancelled automatically.`
          : null}
      </AlertDescription>
    </Alert>
  );
}
