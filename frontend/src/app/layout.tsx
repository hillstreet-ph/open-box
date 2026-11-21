import { SidebarToggle } from "@/components/ui/SidebarToggle";
import { Slidebar } from "@/components/ui/Slidebar";
import { AIChatWidget } from "@/components/ui/AIChatWidget";
import { useState } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [slidebarOpen, setSlidebarOpen] = useState(false);

  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground">
        <SidebarToggle
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        />
        
        {/* AI Chat Widget (floating button) */}
        <AIChatWidget isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

        {/* Slidebar (mobile navigation, slides from right) */}
        <Slidebar isOpen={slidebarOpen} onClose={() => setSlidebarOpen(false)} />

        {/* Main content */}
        <div className="container mx-auto p-6">{children}</div>
      </body>
    </html>
  );
}