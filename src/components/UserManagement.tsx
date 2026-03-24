import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();
  const { lang } = useLang();
  const { toast } = useToast();
  const isKo = lang === "ko";

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

  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {isKo ? "관리자 권한이 필요합니다" : "需要管理员权限"}
      </div>
    );
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="text-xs">
          {isKo ? "전체" : "全部"}: {users.length}
        </Badge>
        <Badge variant="default" className="text-xs">
          {isKo ? "승인됨" : "已批准"}: {users.filter(u => u.approved).length}
        </Badge>
        <Badge variant="destructive" className="text-xs">
          {isKo ? "대기중" : "待审核"}: {users.filter(u => !u.approved).length}
        </Badge>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "이메일" : "邮箱"}</TableHead>
              <TableHead>{isKo ? "역할" : "角色"}</TableHead>
              <TableHead>{isKo ? "상태" : "状态"}</TableHead>
              <TableHead>{isKo ? "가입일" : "注册日"}</TableHead>
              <TableHead>{isKo ? "관리" : "操作"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-xs">{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">
                    {u.role === "admin" ? (isKo ? "관리자" : "管理员") : (isKo ? "사용자" : "用户")}
                  </Badge>
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
                  {u.role !== "admin" && (
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
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
