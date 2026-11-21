import { SidebarToggle } from "@/components/ui/SidebarToggle";
import { Slidebar } from "@/components/ui/Slidebar";
import { AIChatWidget } from "@/components/ui/AIChatWidget";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useState } from "react";

export default function App() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [slidebarOpen, setSlidebarOpen] = useState(false);

  return (
    <div className="bg-background text-foreground min-h-screen p-6">
      <div className="flex items-start gap-4">
        {/* Sidebar toggle — left side */}
        <div className="flex items-center gap-2">
          <SidebarToggle onClick={() => setSlidebarOpen(!slidebarOpen)} aria-label="Toggle sidebar" />
        </div>

        {/* Slidebar — right side panel */}
        <Slidebar isOpen={slidebarOpen} onClose={() => setSlidebarOpen(false)} />
      </div>

      {/* AI Chat Widget — circular floating button bottom-right corner */}
      <AIChatWidget isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

      {/* Main content area */}
      <main className="mt-12 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Open Box</h1>
        <p className="text-muted-foreground mb-6">
          HillStreet's managed storage gateway, powered by the OpenList engine.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="p-6">
            <CardHeader>
              <CardTitle>Storage Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Manage your connected cloud storages and local files.
              </p>
              <Button variant="outline" className="w-full">
                Browse Storage
              </Button>
            </CardContent>
          </Card>

          <Card className="p-6">
            <CardHeader>
              <CardTitle>File Operations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload, download, rename, move, copy, and delete files.
              </p>
              <Button variant="outline" className="w-full">
                Manage Files
              </Button>
            </CardContent>
          </Card>

          <Card className="p-6">
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect to WebDAV, S3, FTP, and other storage providers.
              </p>
              <Button variant="outline" className="w-full">
                Configure Integrations
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
