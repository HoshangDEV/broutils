import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BulkRename } from "@/components/bulk-rename";
import "./App.css";

function App() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex items-baseline gap-2">
        <h1 className="text-2xl font-bold tracking-tight">BroUtils</h1>
        <span className="text-sm text-muted-foreground">a small toolbox</span>
      </header>

      <Tabs defaultValue="bulk-rename" className="w-full gap-6">
        <TabsList>
          <TabsTrigger value="bulk-rename">Bulk Rename</TabsTrigger>
          {/* Future tools get their own <TabsTrigger> + <TabsContent> here. */}
        </TabsList>

        <TabsContent value="bulk-rename">
          <BulkRename />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default App;
