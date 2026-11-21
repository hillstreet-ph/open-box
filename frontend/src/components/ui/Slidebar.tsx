import { useState, useRef, useEffect } from "react";
import { Button } from "./button";

export function Slidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [width, setWidth] = useState(256);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX - 40));
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed bottom-4 right-4 z-50 h-[500px] bg-background border border-border rounded-xl shadow-xl overflow-hidden"
          style={{ width }}
          onMouseDown={handleMouseDown}
        >
          <div
            className="absolute top-0 right-0 w-4 h-full cursor-ew-resize bg-transparent"
            aria-label="Resize slidebar"
          />
          <div className="absolute top-2 right-2 z-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Close slidebar"
            >
              ✕
            </Button>
          </div>
          <div className="p-6 h-full flex flex-col gap-4">
            <Button variant="default" className="w-full">
              Storage Management
            </Button>
            <Button variant="secondary" className="w-full">
              File Operations
            </Button>
            <Button variant="outline" className="w-full">
              Integrations
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
