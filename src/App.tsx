import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkRename } from "@/components/bulk-rename";
import { ConvertImages } from "@/components/convert-images";
import { CompressVideos } from "@/components/compress-videos";
import "./App.css";

function App() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-2">
        <img src="/favicon.png" alt="BroUtils" className="size-7" />
        <h1 className="text-2xl font-bold tracking-tight">BroUtils</h1>
        <span className="text-sm text-muted-foreground">a small toolbox</span>
      </header>

      <Tabs defaultValue="bulk-rename" className="w-full gap-6">
        <TabsList>
          <TabsTrigger value="bulk-rename">Bulk Rename</TabsTrigger>
          <TabsTrigger value="convert-images">Convert Images</TabsTrigger>
          <TabsTrigger value="compress-videos">Compress Videos</TabsTrigger>
          {/* Future tools get their own <TabsTrigger> + <TabsContent> here. */}
        </TabsList>

        <TabsContent value="bulk-rename">
          <BulkRename />
        </TabsContent>

        <TabsContent value="convert-images">
          <ConvertImages />
        </TabsContent>

        <TabsContent value="compress-videos">
          <CompressVideos />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default App;
