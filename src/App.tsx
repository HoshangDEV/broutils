import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkRename } from "@/components/bulk-rename";
import { ConvertImages } from "@/components/convert-images";
import { CompressVideos } from "@/components/compress-videos";
import { HoshangDEVIcon, GitHubIcon } from "@/components/icon";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem("activeTab") || "compress-videos";
  });
  const [version, setVersion] = useState("");

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-2">
        <img src="/favicon.png" alt="BroUtils" className="size-7" />
        <h1 className="text-2xl font-bold tracking-tight">BroUtils</h1>
        <span className="text-sm text-muted-foreground">a small toolbox</span>
        {version && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            v{version}
          </span>
        )}
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full gap-6">
        <TabsList>
          <TabsTrigger value="compress-videos">Compress Videos</TabsTrigger>
          <TabsTrigger value="convert-images">Convert Images</TabsTrigger>
          <TabsTrigger value="bulk-rename">Bulk Rename</TabsTrigger>
          {/* Future tools get their own <TabsTrigger> + <TabsContent> here. */}
        </TabsList>

        <TabsContent value="compress-videos">
          <CompressVideos />
        </TabsContent>

        <TabsContent value="convert-images">
          <ConvertImages />
        </TabsContent>
        
        <TabsContent value="bulk-rename">
          <BulkRename />
        </TabsContent>

      </Tabs>

      <div className="flex gap-4 mx-auto mt-auto">
        <button
          onClick={() => openUrl("https://hoshang.dev")}
          className="text-xs text-muted-foreground fill-muted-foreground gap-2 flex flex-col items-center hover:bg-muted/50 transition-colors w-fit p-4 rounded-xl cursor-pointer"
        >
          <HoshangDEVIcon width={25} height={25} className="inline-block" />
          <p>HoshangDEV</p>
        </button>
        <button
          onClick={() => openUrl("https://github.com/HoshangDEV/broutils")}
          className="text-xs text-muted-foreground fill-muted-foreground gap-2 flex flex-col items-center hover:bg-muted/50 transition-colors w-fit p-4 rounded-xl cursor-pointer"
        >
          <GitHubIcon width={25} height={25} className="inline-block" />
          <p>GitHub</p>
        </button>
      </div>
    </main>
  );
}

export default App;
