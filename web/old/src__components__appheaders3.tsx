import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Download, Plus, Search, Upload } from "@mynaui/icons-react";

export default function AppHeaders2() {
  return (
    <header className="flex items-center justify-between gap-4 border-b bg-background px-6 py-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Products</h1>
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search products..."
            className="w-[280px] pl-9"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon" />}><Upload className="size-4" /></TooltipTrigger>
            <TooltipContent>
              <p>Import Products</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon" />}><Download className="size-4" /></TooltipTrigger>
            <TooltipContent>
              <p>Export Products</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button>
          <Plus className="size-4 stroke-2" />
          Add Product
        </Button>
      </div>
    </header>
  );
}
