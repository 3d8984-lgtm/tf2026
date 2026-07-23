import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LangProvider } from "@/contexts/LangContext";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import InstallAppButton from "@/components/InstallAppButton";

import Auth from "@/pages/Auth";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import FileUpload from "@/pages/FileUpload";
import AllOrders from "@/pages/AllOrders";
import MasterData from "@/pages/MasterData";


import TshirtWork from "@/pages/TshirtWork";
import CardQrInspection from "@/pages/CardQrInspection";
import CardPhotoInspection from "@/pages/CardPhotoInspection";
import ProductionMonitor from "@/pages/ProductionMonitor";
import Shipping from "@/pages/Shipping";
import ShippingScan from "@/pages/ShippingScan";
import Defects from "@/pages/Defects";
import Reports from "@/pages/Reports";
import SystemSettings from "@/pages/SystemSettings";
import Manual from "@/pages/Manual";
import CCTVQuality from "@/pages/CCTVQuality";
import Licenses from "@/pages/Licenses";
import OutsourceDashboard from "@/pages/outsource/OutsourceDashboard";
import OutsourceOrders from "@/pages/outsource/OutsourceOrders";
import SiliconFactory from "@/pages/outsource/SiliconFactory";
import HeatTransferFactory from "@/pages/outsource/HeatTransferFactory";
import HologramFactory from "@/pages/outsource/HologramFactory";
import NfcCardFactory from "@/pages/outsource/NfcCardFactory";
import LogoFactory from "@/pages/outsource/LogoFactory";
import TshirtFactory from "@/pages/outsource/TshirtFactory";
import TshirtOrderFactory from "@/pages/outsource/TshirtOrderFactory";
import PackagingFactory from "@/pages/outsource/PackagingFactory";
import OutsourceHistory from "@/pages/outsource/OutsourceHistory";
import OutsourceSettings from "@/pages/outsource/OutsourceSettings";
import OrderJobsDashboard from "@/pages/outsource/OrderJobsDashboard";
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
        <Route path="/all-orders" element={<AllOrders />} />
        <Route path="/master" element={<MasterData />} />
        
        
        <Route path="/card-qr-inspect" element={<CardQrInspection />} />
        <Route path="/card-photo-inspect" element={<CardPhotoInspection />} />
        <Route path="/tshirt-work" element={<TshirtWork />} />
        <Route path="/monitor" element={<ProductionMonitor />} />
        <Route path="/shipping" element={<Shipping />} />
        <Route path="/shipping/scan/:orderId" element={<ShippingScan />} />
        <Route path="/defects" element={<Defects />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/manual" element={<Manual />} />
        <Route path="/cctv-quality" element={<CCTVQuality />} />
        <Route path="/settings" element={<SystemSettings />} />
        <Route path="/licenses" element={<Licenses />} />
        <Route path="/outsource" element={<OutsourceDashboard />} />
        <Route path="/outsource/orders" element={<OutsourceOrders />} />
        <Route path="/outsource/silicon" element={<SiliconFactory />} />
        <Route path="/outsource/heat-transfer" element={<HeatTransferFactory />} />
        <Route path="/outsource/hologram" element={<HologramFactory />} />
        <Route path="/outsource/nfc-card" element={<NfcCardFactory />} />
        <Route path="/outsource/logo" element={<LogoFactory />} />
        <Route path="/outsource/tshirt-order" element={<TshirtOrderFactory />} />
        <Route path="/outsource/tshirt-factory" element={<TshirtFactory />} />
        <Route path="/outsource/packaging" element={<PackagingFactory />} />
        <Route path="/outsource/history" element={<OutsourceHistory />} />
        <Route path="/outsource/jobs" element={<OrderJobsDashboard />} />
        <Route path="/outsource/settings" element={<OutsourceSettings />} />
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
          <InstallAppButton />

          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<AuthRoute />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </LangProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
