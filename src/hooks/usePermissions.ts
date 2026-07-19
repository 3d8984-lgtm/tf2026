import { useAuth } from "@/hooks/useAuth";

export type UserRole = "worker" | "manager" | "admin";

// Permission definitions per role
const ROLE_PERMISSIONS: Record<UserRole, {
  menuAccess: string[];
  settingsTabs: string[];
  canEdit: {
    orders: boolean;
    production: boolean;
    shipping: boolean;
    defects: boolean;
    twinmetaSync: boolean;
  };
}> = {
  worker: {
    menuAccess: ["/", "/all-orders", "/tshirt-work", "/card-qr-inspect", "/card-photo-inspect", "/tshirt", "/monitor", "/shipping", "/defects", "/manual",
      "/outsource", "/outsource/orders", "/outsource/silicon", "/outsource/heat-transfer", "/outsource/hologram", "/outsource/nfc-card", "/outsource/card-order/templates", "/outsource/card-order/orders", "/outsource/logo", "/outsource/tshirt-order", "/outsource/tshirt-factory", "/outsource/packaging", "/outsource/history", "/outsource/settings"],
    settingsTabs: [],
    canEdit: {
      orders: false,
      production: false,
      shipping: false,
      defects: false,
      twinmetaSync: false,
    },
  },
  manager: {
    menuAccess: ["/", "/upload", "/master", "/tshirt-work", "/card-qr-inspect", "/card-photo-inspect", "/tshirt", "/monitor", "/shipping", "/defects", "/reports", "/manual", "/settings",
      "/outsource", "/outsource/orders", "/outsource/silicon", "/outsource/heat-transfer", "/outsource/hologram", "/outsource/nfc-card", "/outsource/card-order/templates", "/outsource/card-order/orders", "/outsource/logo", "/outsource/tshirt-order", "/outsource/tshirt-factory", "/outsource/packaging", "/outsource/history", "/outsource/settings"],
    settingsTabs: ["general", "equipment", "plcTags", "sensors", "commands", "alarms", "inspection"],
    canEdit: {
      orders: true,
      production: true,
      shipping: true,
      defects: true,
      twinmetaSync: true,
    },
  },
  admin: {
    menuAccess: ["/", "/upload", "/master", "/tshirt-work", "/card-qr-inspect", "/card-photo-inspect", "/tshirt", "/monitor", "/shipping", "/defects", "/reports", "/manual", "/settings",
      "/outsource", "/outsource/orders", "/outsource/silicon", "/outsource/heat-transfer", "/outsource/hologram", "/outsource/nfc-card", "/outsource/card-order/templates", "/outsource/card-order/orders", "/outsource/logo", "/outsource/tshirt-order", "/outsource/tshirt-factory", "/outsource/packaging", "/outsource/history", "/outsource/settings"],
    settingsTabs: ["general", "users", "equipment", "plcTags", "sensors", "commands", "alarms", "inspection", "webhook", "courier", "callback"],
    canEdit: {
      orders: true,
      production: true,
      shipping: true,
      defects: true,
      twinmetaSync: true,
    },
  },
};

// Map DB role strings to UserRole
function resolveRole(dbRole: string | undefined | null): UserRole {
  if (dbRole === "admin") return "admin";
  if (dbRole === "manager") return "manager";
  return "worker";
}

export function usePermissions() {
  const { profile } = useAuth();
  const role = resolveRole(profile?.role);
  const perms = ROLE_PERMISSIONS[role];

  return {
    role,
    canAccessMenu: (path: string) => perms.menuAccess.includes(path),
    canAccessSettingsTab: (tab: string) => perms.settingsTabs.includes(tab),
    canEditOrders: perms.canEdit.orders,
    canEditProduction: perms.canEdit.production,
    canEditShipping: perms.canEdit.shipping,
    canEditDefects: perms.canEdit.defects,
    canTwinmetaSync: perms.canEdit.twinmetaSync,
    isAdmin: role === "admin",
    isManager: role === "manager" || role === "admin",
  };
}

export const ROLE_LABELS = {
  ko: { worker: "현장작업자", manager: "생산관리자", admin: "최고관리자" } as Record<UserRole, string>,
  zh: { worker: "现场操作员", manager: "生产管理员", admin: "最高管理员" } as Record<UserRole, string>,
};
