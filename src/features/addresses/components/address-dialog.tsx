"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Tables } from "@/lib/supabase/database.types";
import { AddressForm } from "./address-form";

interface AddressDialogProps {
  trigger: ReactNode;
  address?: Tables<"addresses"> | null;
  defaultCountry?: string;
  onSaved?: (id: string) => void;
}

export function AddressDialog({ trigger, address, defaultCountry, onSaved }: AddressDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{address ? "Edit address" : "New address"}</DialogTitle>
          <DialogDescription>
            Orders keep a copy of the address used, so later edits never change past orders.
          </DialogDescription>
        </DialogHeader>
        <AddressForm
          address={address}
          defaultCountry={defaultCountry}
          onSaved={(id) => {
            setOpen(false);
            onSaved?.(id);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
