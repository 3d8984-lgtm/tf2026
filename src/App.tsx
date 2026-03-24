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

import TshirtProduction from "@/pages/TshirtProduction";
import TshirtWork from "@/pages/TshirtWork";
import ProductionMonitor from "@/pages/ProductionMonitor";
import Shipping from "@/pages/Shipping";
import Defects from "@/pages/Defects";
import Reports from "@/pages/Reports";
import SystemSettings from "@/pages/SystemSettings";
import NotFound from "@/pages/NotFound";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

const queryClient = new QueryClient();

function PendingApproval() {
  const { signOut } = useAuth();
  const { t } = useLang();

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
          <Clock className="w-6 h-6 text-warning" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t("auth.pendingTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("auth.pendingDesc")}</p>
        <Button variant="outline" onClick={signOut}>{t("auth.logout")}</Button>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (profile && !profile.approved) return <PendingApproval />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<FileUpload />} />
        <Route path="/master" element={<MasterData />} />
        
        <Route path="/tshirt" element={<TshirtProduction />} />
        <Route path="/tshirt-work" element={<TshirtWork />} />
        <Route path="/monitor" element={<ProductionMonitor />} />
        <Route path="/shipping" element={<Shipping />} />
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
