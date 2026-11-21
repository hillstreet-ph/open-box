import { Button } from "./button";

interface SidebarToggleProps {
  onClick?: () => void;
  "aria-label"?: string;
}

export function SidebarToggle({ onClick, "aria-label": ariaLabel }: SidebarToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={ariaLabel || "Toggle sidebar"}
      className="h-6 w-6 focus:outline-none focus:ring-2 focus:ring-primary ring-offset-2"
    >
      <svg
        className="h-5 w-5"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </svg>
    </Button>
  );
}
