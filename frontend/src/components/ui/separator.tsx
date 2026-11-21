import * as React from "react";

export function Separator(props: React.PropsWithChildren & { className?: string }) {
  return <div className={`h-px bg-muted ${props.className || ""}`} />;
}
