import React from "react";
import { cn } from "@/lib/cn";

export function Badge({ className, variant = "default", ...props }) {
  return <span className={cn("badge", `badge-${variant}`, className)} {...props} />;
}
