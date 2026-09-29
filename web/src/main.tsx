import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toast"
import App from "./App"
import { useStore } from "@/app/store"
import "./index.css"

// До рендера: возврат с Keycloak обрабатывается раньше, чем роутер прочитает адрес.
void useStore.getState().bootstrap()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
)
