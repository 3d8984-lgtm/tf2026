import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LangProvider } from "@/contexts/LangContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import FileUpload from "@/pages/FileUpload";
import MasterData from "@/pages/MasterData";
import WorkOrders from "@/pages/WorkOrders";
import TshirtProduction from "@/pages/TshirtProduction";
import TshirtWork from "@/pages/TshirtWork";
import CardPacking from "@/pages/CardPacking";
import SetPacking from "@/pages/SetPacking";
import Shipping from "@/pages/Shipping";
import Machines from "@/pages/Machines";
import Defects from "@/pages/Defects";
import Reports from "@/pages/Reports";
import SystemSettings from "@/pages/SystemSettings";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LangProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<FileUpload />} />
              <Route path="/master" element={<MasterData />} />
              <Route path="/work-orders" element={<WorkOrders />} />
              <Route path="/tshirt" element={<TshirtProduction />} />
              <Route path="/tshirt-work" element={<TshirtWork />} />
              <Route path="/card-packing" element={<CardPacking />} />
              <Route path="/set-packing" element={<SetPacking />} />
              <Route path="/shipping" element={<Shipping />} />
              <Route path="/machines" element={<Machines />} />
              <Route path="/defects" element={<Defects />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<SystemSettings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </LangProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
