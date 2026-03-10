import React from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn("card-header", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn("card-title", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn("card-content", className)} {...props} />;
}
