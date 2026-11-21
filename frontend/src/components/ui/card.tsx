import * as React from "react";

export function CardHeader(props: React.PropsWithChildren & { className?: string }) {
  return (
    <header className={`bg-primary text-primary-foreground px-4 py-3 ${props.className || ""}`}>
      {props.children}
    </header>
  );
}

export function CardTitle(props: React.PropsWithChildren & { className?: string }) {
  return <h3 className={`text-lg font-semibold ${props.className || ""}`}>{props.children}</h3>;
}

export function CardContent(props: React.PropsWithChildren & { className?: string }) {
  return <div className={`p-4 ${props.className || ""}`}>{props.children}</div>;
}

export function Card(props: React.PropsWithChildren & { className?: string }) {
  return (
    <div className={`bg-background border border-border rounded-xl shadow-sm overflow-hidden ${props.className || ""}`}>
      {props.children}
    </div>
  );
}
