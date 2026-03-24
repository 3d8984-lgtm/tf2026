import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LangProvider } from "@/contexts/LangContext";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import FileUpload from "@/pages/FileUpload";
import MasterData from "@/pages/MasterData";
import WorkOrders from "@/pages/WorkOrders";
import TshirtProduction from "@/pages/TshirtProduction";
import TshirtWork from "@/pages/TshirtWork";
import ProductionMonitor from "@/pages/ProductionMonitor";
import Defects from "@/pages/Defects";
import Reports from "@/pages/Reports";
import SystemSettings from "@/pages/SystemSettings";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<FileUpload />} />
        <Route path="/master" element={<MasterData />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/tshirt" element={<TshirtProduction />} />
        <Route path="/tshirt-work" element={<TshirtWork />} />
        <Route path="/monitor" element={<ProductionMonitor />} />
        <Route path="/defects" element={<Defects />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<SystemSettings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <Auth />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LangProvider>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<AuthRoute />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </LangProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
