import React from "react";
import { cn } from "@/lib/cn";

export function Button({ className, variant = "default", disabled, ...props }) {
  return (
    <button
      className={cn("btn", `btn-${variant}`, disabled ? "btn-disabled" : "", className)}
      disabled={disabled}
      {...props}
    />
  );
}
