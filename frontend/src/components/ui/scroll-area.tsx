import * as React from "react";

export function ScrollArea(props: React.PropsWithChildren & { className?: string }) {
  return (
    <div className={`flex-1 overflow-y-auto ${props.className || ""}`}>
      {props.children}
    </div>
  );
}
