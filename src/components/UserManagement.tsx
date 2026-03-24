import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/contexts/LangContext";
import { usePermissions, ROLE_LABELS, type UserRole } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, UserCheck, UserX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  approved: boolean;
  role: string;
  created_at: string;
}

const ROLES: UserRole[] = ["worker", "manager", "admin"];

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = usePermissions();
  const { user: currentUser } = useAuth();
  const { lang } = useLang();
  const { toast } = useToast();
  const isKo = lang === "ko";
  const roleLabels = ROLE_LABELS[isKo ? "ko" : "zh"];

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setUsers(data as UserProfile[]);
    if (error) console.error(error);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const toggleApproval = async (userId: string, currentApproved: boolean) => {
    const { error } = await supabase
      .from("profiles")
      .update({ approved: !currentApproved })
      .eq("user_id", userId);

    if (error) {
      toast({ title: isKo ? "오류" : "错误", description: error.message, variant: "destructive" });
    } else {
      toast({ title: isKo ? "변경 완료" : "修改完成" });
      fetchUsers();
    }
  };

  const changeRole = async (userId: string, newRole: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("user_id", userId);

    if (error) {
      toast({ title: isKo ? "오류" : "错误", description: error.message, variant: "destructive" });
    } else {
      toast({ title: isKo ? "역할 변경 완료" : "角色修改完成" });
      fetchUsers();
    }
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {isKo ? "최고관리자 권한이 필요합니다" : "需要最高管理员权限"}
      </div>
    );
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const roleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
    if (role === "admin") return "default";
    if (role === "manager") return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="text-xs">
          {isKo ? "전체" : "全部"}: {users.length}
        </Badge>
        <Badge variant="default" className="text-xs">
          {isKo ? "승인됨" : "已批准"}: {users.filter(u => u.approved).length}
        </Badge>
        <Badge variant="destructive" className="text-xs">
          {isKo ? "대기중" : "待审核"}: {users.filter(u => !u.approved).length}
        </Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {isKo ? "등급: 현장작업자 / 생산관리자 / 최고관리자" : "等级: 现场操作员 / 生产管理员 / 最高管理员"}
        </span>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "이메일" : "邮箱"}</TableHead>
              <TableHead>{isKo ? "회원등급" : "会员等级"}</TableHead>
              <TableHead>{isKo ? "상태" : "状态"}</TableHead>
              <TableHead>{isKo ? "가입일" : "注册日"}</TableHead>
              <TableHead>{isKo ? "관리" : "操作"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const isSelf = u.user_id === currentUser?.id;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell>
                    {isSelf ? (
                      <Badge variant={roleBadgeVariant(u.role)} className="text-xs">
                        {roleLabels[(u.role as UserRole) || "worker"]}
                      </Badge>
                    ) : (
                      <Select value={u.role || "worker"} onValueChange={(v) => changeRole(u.user_id, v)}>
                        <SelectTrigger className="h-7 w-[120px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map(r => (
                            <SelectItem key={r} value={r} className="text-xs">
                              {roleLabels[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.approved ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {isKo ? "승인됨" : "已批准"}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <XCircle className="w-3.5 h-3.5" />
                        {isKo ? "대기중" : "待审核"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {!isSelf && (
                      <Button
                        variant={u.approved ? "outline" : "default"}
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => toggleApproval(u.user_id, u.approved)}
                      >
                        {u.approved ? (
                          <><UserX className="w-3.5 h-3.5 mr-1" />{isKo ? "차단" : "禁用"}</>
                        ) : (
                          <><UserCheck className="w-3.5 h-3.5 mr-1" />{isKo ? "승인" : "批准"}</>
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
