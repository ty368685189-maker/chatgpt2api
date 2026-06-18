"use client";

import { useEffect, useState } from "react";
import { 
  Copy, 
  ExternalLink,
  KeyRound, 
  Link2,
  LoaderCircle, 
  Plus, 
  Trash2,
  Ticket,
  Users,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  login,
  adminFetchUsers,
  adminBanUser,
  adminUnbanUser,
  adminUpdateUserQuotaPolicy,
  adminResetUserPassword,
  adminChangeUserRole,
  adminDeleteUser,
  adminFetchRegCodes,
  adminCreateRegCode,
  adminDeleteRegCode,
  type AdminUser,
  type RegCodeItem
} from "@/lib/api";
import webConfig from "@/constants/common-env";
import { getStoredAuthSession } from "@/store/auth";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value.replace(/-/g, "/"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeIntegerInput(value: string, fallback = 0, allowNegative = false) {
  const raw = value.trim();
  if (!raw || raw === "-") {
    return fallback;
  }
  const cleaned = allowNegative ? raw.replace(/[^\d-]/g, "") : raw.replace(/[^\d]/g, "");
  if (!cleaned || cleaned === "-") {
    return fallback;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function UserKeysCard() {
  const [activeTab, setActiveTab] = useState("api-keys");
  const [currentLoginKey, setCurrentLoginKey] = useState("");

  const [codesItems, setCodesItems] = useState<RegCodeItem[]>([]);
  const [isLoadingCodes, setIsLoadingCodes] = useState(false);
  const [isCodeCreateOpen, setIsCodeCreateOpen] = useState(false);
  const [codeQuotaLimit, setCodeQuotaLimit] = useState(10);
  const [codeMaxUses, setCodeMaxUses] = useState(1);
  const [codeNote, setCodeNote] = useState("");
  const [isCreatingCode, setIsCreatingCode] = useState(false);
  const [deletingCode, setDeletingCode] = useState<RegCodeItem | null>(null);

  const [usersItems, setUsersItems] = useState<AdminUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AdminUser[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [userQuotaModeInput, setUserQuotaModeInput] = useState<"daily" | "fixed" | "hybrid">("daily");
  const [dailyQuotaLimitInput, setDailyQuotaLimitInput] = useState(10);
  const [fixedQuotaLimitInput, setFixedQuotaLimitInput] = useState(0);
  const [isUpdatingUserQuota, setIsUpdatingUserQuota] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<AdminUser | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [isResettingUserPwd, setIsResettingUserPwd] = useState(false);
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [usersSortMode, setUsersSortMode] = useState<"recent" | "usage" | "status">("recent");
  const [usersSummary, setUsersSummary] = useState({ total: 0, active: 0, banned: 0, admins: 0, quotaUsed: 0, quotaLimit: 0 });
  const serviceBaseUrl = webConfig.apiUrl.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const openAIBaseUrl = `${serviceBaseUrl}/v1`;

  const getQuotaModeLabel = (mode?: string) => {
    if (mode === "fixed") return "固定";
    if (mode === "hybrid") return "每日优先";
    if (mode === "daily") return "每日";
    return "每日";
  };

  const refreshUsersSummary = (items: AdminUser[]) => {
    setUsersSummary({
      total: items.length,
      active: items.filter((item) => item.status !== "banned").length,
      banned: items.filter((item) => item.status === "banned").length,
      admins: items.filter((item) => item.role === "admin").length,
      quotaUsed: items.reduce((sum, item) => sum + Number(item.quota_used || 0), 0),
      quotaLimit: items.reduce((sum, item) => sum + Number(item.quota_limit || 0), 0),
    });
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const loadCodes = async () => {
    setIsLoadingCodes(true);
    try {
      const res = await adminFetchRegCodes();
      setCodesItems(res.items || []);
    } catch (error) {
      toast.error("加载邀请码失败");
    } finally {
      setIsLoadingCodes(false);
    }
  };

  const handleCreateCode = async () => {
    setIsCreatingCode(true);
    try {
      await adminCreateRegCode({
        quota_limit: codeQuotaLimit,
        max_uses: codeMaxUses,
        note: codeNote.trim(),
      });
      toast.success("激活码创建成功");
      setIsCodeCreateOpen(false);
      setCodeNote("");
      void loadCodes();
    } catch (error) {
      toast.error("创建激活码失败");
    } finally {
      setIsCreatingCode(false);
    }
  };

  const handleDeleteCode = async () => {
    if (!deletingCode) return;
    try {
      await adminDeleteRegCode(deletingCode.code);
      toast.success("激活码删除成功");
      setDeletingCode(null);
      void loadCodes();
    } catch (error) {
      toast.error("删除激活码失败");
    }
  };

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await adminFetchUsers();
      setUsersItems(res.items || []);
      refreshUsersSummary(res.items || []);
      applyUserFilter(sortUsers(res.items || []), userSearchQuery);
    } catch (error) {
      toast.error("加载用户列表失败");
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const applyUserFilter = (list: AdminUser[], query: string) => {
    const q = query.toLowerCase().trim();
    if (!q) {
      setFilteredUsers(list);
      return;
    }
    setFilteredUsers(list.filter(u => 
      String(u.username || "").toLowerCase().includes(q) || 
      String(u.email || "").toLowerCase().includes(q) ||
      String(u.registered_by_code || "").toLowerCase().includes(q)
    ));
  };

  const handleUserSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    setUserSearchQuery(val);
    applyUserFilter(sortUsers(usersItems), val);
  };

  const refreshCurrentLoginKey = async () => {
    const session = await getStoredAuthSession();
    if (!session?.key) {
      setCurrentLoginKey("");
      return;
    }
    try {
      await login(session.key);
      setCurrentLoginKey(session.key);
    } catch {
      setCurrentLoginKey("");
    }
  };

  const sortUsers = (list: AdminUser[]) => {
    const copy = [...list];
    if (usersSortMode === "usage") {
      return copy.sort((a, b) => (b.quota_used || 0) - (a.quota_used || 0));
    }
    if (usersSortMode === "status") {
      return copy.sort((a, b) => {
        const rank = (u: AdminUser) => (u.status === "banned" ? 0 : u.role === "admin" ? 2 : 1);
        return rank(b) - rank(a);
      });
    }
    return copy.sort((a, b) => new Date(b.last_active_date || b.created_at).getTime() - new Date(a.last_active_date || a.created_at).getTime());
  };

  const handleToggleUserBan = async (user: AdminUser) => {
    try {
      if (user.status === "banned") {
        await adminUnbanUser(user.id);
        toast.success(`用户「${user.username}」已成功解封`);
      } else {
        await adminBanUser(user.id);
        toast.success(`用户「${user.username}」已封禁`);
      }
      void loadUsers();
    } catch (error) {
      toast.error("操作失败，请重试");
    }
  };

  const handleUpdateUserQuota = async () => {
    if (!editingUser) return;
    setIsUpdatingUserQuota(true);
    try {
      const nextDailyLimit = userQuotaModeInput === "fixed" ? 0 : Math.max(0, Number(dailyQuotaLimitInput || 0));
      const nextFixedLimit = userQuotaModeInput === "daily" ? 0 : Math.max(0, Number(fixedQuotaLimitInput || 0));
      await adminUpdateUserQuotaPolicy(editingUser.id, {
        quota_mode: userQuotaModeInput,
        daily_quota_limit: nextDailyLimit,
        fixed_quota_limit: nextFixedLimit,
      });
      toast.success("配额策略已成功调整");
      setEditingUser(null);
      void loadUsers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "调整配额策略失败");
    } finally {
      setIsUpdatingUserQuota(false);
    }
  };

  const handleResetUserPassword = async () => {
    if (!resetPwdUser) return;
    const pwd = newPasswordInput.trim();
    if (!pwd || pwd.length < 8) {
      toast.error("登录密钥长度必须至少为 8 个字符");
      return;
    }
    setIsResettingUserPwd(true);
    try {
      await adminResetUserPassword(resetPwdUser.id, pwd);
      toast.success(`用户「${resetPwdUser.username}」登录密钥已重置`);
      setResetPwdUser(null);
      setNewPasswordInput("");
    } catch (error) {
      toast.error("重置登录密钥失败");
    } finally {
      setIsResettingUserPwd(false);
    }
  };

  const handleUserRoleChange = async (user: AdminUser, newRole: string) => {
    try {
      await adminChangeUserRole(user.id, newRole);
      toast.success(`已成功修改用户角色为 ${newRole === "admin" ? "管理员" : "普通用户"}`);
      void loadUsers();
    } catch (error) {
      toast.error("修改角色失败");
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setIsDeletingUser(true);
    try {
      await adminDeleteUser(deletingUser.id);
      toast.success(`用户「${deletingUser.username}」已删除`);
      setDeletingUser(null);
      void loadUsers();
    } catch {
      toast.error("删除用户失败");
    } finally {
      setIsDeletingUser(false);
    }
  };

  useEffect(() => {
    if (activeTab === "api-keys") {
      void refreshCurrentLoginKey();
    } else if (activeTab === "reg-codes") {
      void loadCodes();
    } else if (activeTab === "users-mgmt") {
      void loadUsers();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "users-mgmt") {
      applyUserFilter(sortUsers(usersItems), userSearchQuery);
    }
  }, [usersSortMode, usersItems, userSearchQuery, activeTab]);

  return (
    <>
      <Card className="rounded-[24px] border-white/85 bg-white/90 shadow-sm dark:border-stone-800/80 dark:bg-stone-900/90">
        <CardContent className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-stone-100 dark:border-stone-850 pb-4">
              <TabsList className="bg-stone-100 dark:bg-stone-800 p-1 rounded-xl h-10.5 self-start">
                <TabsTrigger value="api-keys" className="rounded-lg text-xs font-semibold px-4 flex items-center gap-1.5">
                  <Link2 className="size-3.5" />
                  接入说明
                </TabsTrigger>
                <TabsTrigger value="reg-codes" className="rounded-lg text-xs font-semibold px-4 flex items-center gap-1.5">
                  <Ticket className="size-3.5" />
                  邀请码
                </TabsTrigger>
                <TabsTrigger value="users-mgmt" className="rounded-lg text-xs font-semibold px-4 flex items-center gap-1.5">
                  <Users className="size-3.5" />
                  用户管理
                </TabsTrigger>
              </TabsList>

              <div className="flex flex-wrap items-center gap-2">
                {activeTab === "users-mgmt" && (
                  <>
                    <Button variant={usersSortMode === "recent" ? "default" : "outline"} className="h-9.5 rounded-xl px-4 text-xs" onClick={() => setUsersSortMode("recent")}>最近活跃</Button>
                    <Button variant={usersSortMode === "usage" ? "default" : "outline"} className="h-9.5 rounded-xl px-4 text-xs" onClick={() => setUsersSortMode("usage")}>按配额使用</Button>
                    <Button variant={usersSortMode === "status" ? "default" : "outline"} className="h-9.5 rounded-xl px-4 text-xs" onClick={() => setUsersSortMode("status")}>按状态</Button>
                  </>
                )}
                {activeTab === "reg-codes" && (
                  <Button className="h-9.5 rounded-xl bg-stone-950 px-4 text-xs font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200" onClick={() => setIsCodeCreateOpen(true)}>
                    <Plus className="size-4 mr-1.5" />
                    生成邀请码
                  </Button>
                )}
                {activeTab === "users-mgmt" && (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-stone-400" />
                      <Input
                        type="text"
                        value={userSearchQuery}
                        onChange={handleUserSearch}
                        placeholder="搜索用户名、邮箱、激活码..."
                        className="h-9 rounded-xl pl-8 pr-3 text-xs w-48 border-stone-200 bg-white"
                      />
                    </div>
                    <Button variant="outline" size="icon" className="size-9 rounded-xl border-stone-200" onClick={() => void loadUsers()} title="刷新用户列表">
                      <RefreshCw className="size-3.5 text-stone-600" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <TabsContent value="api-keys" className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-850 dark:text-stone-100">
                    <Link2 className="size-4 text-stone-500" />
                    OpenAI Base URL
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-850">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs text-stone-700 dark:text-stone-200">{openAIBaseUrl}</code>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void handleCopy(openAIBaseUrl)}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-850 dark:text-stone-100">
                    <KeyRound className="size-4 text-stone-500" />
                    用户 API Key
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-850">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs text-stone-700 dark:text-stone-200">{currentLoginKey || "用户自己的登录密钥"}</code>
                    <Button variant="ghost" size="sm" className="h-7 px-2" disabled={!currentLoginKey} onClick={() => void handleCopy(currentLoginKey)}>
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-850 dark:text-stone-100">
                    <ExternalLink className="size-4 text-stone-500" />
                    Cherry Studio
                  </div>
                  <div className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">
                    填上面的地址和用户登录密钥就行。
                  </div>
                </div>
              </div>

            </TabsContent>

            <TabsContent value="reg-codes" className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">邀请码管理</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">派发生图额度激活码，防范批量刷算力。用户在注册账户时填写以继承每日限额配置。</p>
              </div>

              {isLoadingCodes ? (
                <div className="flex items-center justify-center py-10">
                  <LoaderCircle className="size-5 animate-spin text-stone-400" />
                </div>
              ) : codesItems.length === 0 ? (
                <div className="rounded-xl bg-stone-50/50 py-10 text-center text-xs text-stone-500 border dark:bg-stone-850/20">
                  暂无生成激活码。点击右上角按钮生成新的激活码。
                </div>
              ) : (
                <div className="grid gap-3">
                  {codesItems.map((item) => {
                    const isExpired = item.status === "expired" || (item.max_uses !== -1 && item.used_count >= item.max_uses);
                    return (
                      <div key={item.code} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 md:flex-row md:items-center md:justify-between dark:border-stone-800 dark:bg-stone-900">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="text-sm font-mono font-bold text-stone-850 bg-stone-100/80 px-2 py-0.5 rounded dark:bg-stone-800 dark:text-stone-200">{item.code}</code>
                            <Badge variant={isExpired ? "secondary" : "default"} className="rounded-md text-[10px]">
                              {isExpired ? "已过期/用尽" : "可用"}
                            </Badge>
                            <Badge variant="outline" className="rounded-md border-amber-200 text-amber-600 dark:text-amber-400 text-[10px]">
                              每日限额: {item.quota_limit} 次
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
                            <span>使用次数: {item.used_count} / {item.max_uses === -1 ? "无限制" : item.max_uses}</span>
                            <span>备注: {item.note || "无"}</span>
                            <span>创建时间: {formatDateTime(item.created_at)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-lg border-stone-250 bg-white px-3 text-xs"
                            onClick={() => void handleCopy(item.code)}
                          >
                            <Copy className="size-3.5 mr-1" />
                            复制
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-lg border-rose-250 bg-white px-3 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setDeletingCode(item)}
                          >
                            <Trash2 className="size-3.5 mr-1" />
                            作废/删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="users-mgmt" className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {[
                  ["用户总数", usersSummary.total],
                  ["正常用户", usersSummary.active],
                  ["已封禁", usersSummary.banned],
                  ["管理员", usersSummary.admins],
                  ["当前已用", usersSummary.quotaUsed],
                  ["当前额度", usersSummary.quotaLimit === 0 ? "不限" : usersSummary.quotaLimit],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">{label}</div>
                    <div className="mt-1 text-xl font-semibold text-stone-900 dark:text-stone-100">{value}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">用户管理</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">每个用户只有一串登录密钥。</p>
              </div>

              {isLoadingUsers ? (
                <div className="flex items-center justify-center py-10">
                  <LoaderCircle className="size-5 animate-spin text-stone-400" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50/50 py-10 text-center text-xs text-stone-500 dark:border-stone-800 dark:bg-stone-900/20">
                  {userSearchQuery ? "未搜索到匹配的用户账户。" : "暂无自助注册的用户账户。"}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
                  <table className="w-full border-collapse text-left text-xs text-stone-500">
                    <thead className="bg-stone-50 text-[10px] font-semibold tracking-wider text-stone-700 dark:bg-stone-850 dark:text-stone-300">
                      <tr>
                        <th className="px-4 py-3">用户</th>
                        <th className="px-4 py-3">角色 / 状态</th>
                        <th className="px-4 py-3">激活来源</th>
                        <th className="px-4 py-3">今日额度</th>
                        <th className="px-4 py-3">最近活动</th>
                        <th className="px-4 py-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 bg-white dark:divide-stone-800 dark:bg-stone-900">
                      {filteredUsers.map((user) => {
                        const isBanned = user.status === "banned";
                        return (
                          <tr key={user.id} className="hover:bg-stone-50/50 dark:hover:bg-stone-850/10">
                            <td className="px-4 py-3.5 font-medium text-stone-800 dark:text-stone-200">
                              <div>{user.username}</div>
                              {user.email && <div className="text-[10px] text-stone-400 font-normal">{user.email}</div>}
                            </td>
                            <td className="px-4 py-3.5 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <Badge variant={isBanned ? "danger" : "success"} className="text-[9px] px-1 py-0 rounded">
                                  {isBanned ? "已封禁" : "正常"}
                                </Badge>
                                {user.role === "admin" ? (
                                  <Badge className="bg-purple-500 text-white border-none text-[9px] px-1 py-0 rounded">管理员</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 rounded text-stone-400 border-stone-200">普通用户</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <code className="text-[10px] font-mono text-stone-600 dark:text-stone-400">{user.registered_by_code || "—"}</code>
                            </td>
                          <td className="px-4 py-3.5">
                            <span className="font-semibold text-stone-800 dark:text-stone-200">{user.quota_used}</span>
                            <span className="text-stone-400 font-normal">
                              {user.quota_limit === 0 ? " / 无限制" : ` / ${user.quota_limit} 次`}
                            </span>
                            <div className="mt-1 text-[10px] text-stone-400">
                              {user.quota_summary || (user.quota_mode ? `${getQuotaModeLabel(user.quota_mode)} 模式` : "每日模式")}
                            </div>
                          </td>
                            <td className="px-4 py-3.5 text-stone-400">
                              <div>{user.last_active_date || "—"}</div>
                              <div className="text-[10px]">{user.created_at ? `注册 ${user.created_at.split(" ")[0]}` : ""}</div>
                            </td>
                            <td className="px-4 py-3.5 text-right space-x-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px] text-stone-600 hover:text-stone-900"
                                onClick={() => {
                                  setEditingUser(user);
                  setUserQuotaModeInput((user.quota_mode as "daily" | "fixed" | "hybrid") || "daily");
                                  setDailyQuotaLimitInput(Number(user.daily_quota_limit ?? user.quota_limit ?? 0));
                                  setFixedQuotaLimitInput(Number(user.fixed_quota_limit ?? 0));
                                }}
                              >
                                配额策略
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px] text-stone-600 hover:text-stone-900"
                                onClick={() => {
                                  setResetPwdUser(user);
                                  setNewPasswordInput("");
                                }}
                              >
                                重置登录密钥
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px] text-stone-600 hover:text-stone-900"
                                disabled={!user.registered_by_code}
                                onClick={() => handleCopy(user.registered_by_code || "")}
                              >
                                复制邀请码
                              </Button>
                              
                              {user.role === "admin" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[10px] text-purple-600 hover:text-purple-700"
                                  onClick={() => void handleUserRoleChange(user, "user")}
                                >
                                  降级普通
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[10px] text-purple-600 hover:text-purple-700"
                                  onClick={() => void handleUserRoleChange(user, "admin")}
                                >
                                  提权管理
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                className={`h-7 px-2 text-[10px] font-medium ${isBanned ? "text-emerald-600 hover:text-emerald-700" : "text-red-500 hover:text-red-650"}`}
                                onClick={() => void handleToggleUserBan(user)}
                              >
                                {isBanned ? "解封" : "封禁"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px] font-medium text-red-600 hover:text-red-700"
                                onClick={() => setDeletingUser(user)}
                              >
                                删除
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isCodeCreateOpen} onOpenChange={setIsCodeCreateOpen}>
        <DialogContent className="rounded-3xl border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
          <DialogHeader className="gap-2">
            <DialogTitle>生成注册邀请码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              配置新邀请码的生图每日限额以及最大可使用次数。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200">每日生图额度</label>
              <Input
                type="text"
                value={codeQuotaLimit}
                onChange={(e) => setCodeQuotaLimit(normalizeIntegerInput(e.target.value, 0))}
                inputMode="numeric"
                step="1"
                min="0"
                className="h-11 rounded-xl"
              />
              <p className="text-[11px] text-stone-400 dark:text-stone-500">使用此注册码激活的账号每日可生图的额度上限。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200">最大可用次数</label>
              <Input
                type="text"
                value={codeMaxUses}
                onChange={(e) => setCodeMaxUses(normalizeIntegerInput(e.target.value, 1, true))}
                inputMode="numeric"
                step="1"
                min="-1"
                className="h-11 rounded-xl"
              />
              <p className="text-[11px] text-stone-400 dark:text-stone-500">此邀请激活码可用于多少个人注册，-1 表示无次数限制。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200">发放备注说明</label>
              <Input
                type="text"
                value={codeNote}
                onChange={(e) => setCodeNote(e.target.value)}
                placeholder="例如：发到L站论坛、群友专供邀请码"
                className="h-11 rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setIsCodeCreateOpen(false)} disabled={isCreatingCode}>取消</Button>
            <Button className="h-10 rounded-xl bg-stone-950 text-white" onClick={() => void handleCreateCode()} disabled={isCreatingCode}>
              {isCreatingCode ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingCode)} onOpenChange={(open) => !open && setDeletingCode(null)}>
        <DialogContent className="rounded-3xl border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
          <DialogHeader className="gap-2">
            <DialogTitle>作废/删除邀请码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确认要作废并删除邀请码「{deletingCode?.code}」吗？作废后，他人将无法再使用该邀请码注册新账户。已经注册成功的用户不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setDeletingCode(null)}>取消</Button>
            <Button variant="destructive" className="h-10 rounded-xl" onClick={() => void handleDeleteCode()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="rounded-3xl border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
          <DialogHeader className="gap-2">
            <DialogTitle>调整配额策略</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为用户「{editingUser?.username}」设置每日额度、固定额度，或者两者一起用。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200">配额模式</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "daily", label: "每日" },
                  { value: "fixed", label: "固定" },
                  { value: "hybrid", label: "每日优先" },
                ].map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    variant={userQuotaModeInput === item.value ? "default" : "outline"}
                    className="h-10 rounded-xl text-xs"
                    onClick={() => setUserQuotaModeInput(item.value as "daily" | "fixed" | "hybrid")}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs leading-5 text-stone-500 dark:text-stone-400">
                每日：按天重置。固定：总量耗尽即停。每日优先：先扣每日额度，后扣固定额度。
              </p>
            </div>
            {userQuotaModeInput === "daily" ? (
              <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200">每日额度</label>
              <Input
                  type="text"
                  value={dailyQuotaLimitInput}
                  onChange={(e) => setDailyQuotaLimitInput(normalizeIntegerInput(e.target.value, 0))}
                  inputMode="numeric"
                  step="1"
                  min="0"
                  className="h-11 rounded-xl"
                />
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                  当前模式只看每日额度，第二天自动重置。当前展示：{editingUser?.quota_summary || "暂无"}。
                </div>
              </div>
            ) : null}
            {userQuotaModeInput === "fixed" ? (
              <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200">固定额度</label>
              <Input
                  type="text"
                  value={fixedQuotaLimitInput}
                  onChange={(e) => setFixedQuotaLimitInput(normalizeIntegerInput(e.target.value, 0))}
                  inputMode="numeric"
                  step="1"
                  min="0"
                  className="h-11 rounded-xl"
                />
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                  当前模式只看总量，不会按天重置。当前展示：{editingUser?.quota_summary || "暂无"}。
                </div>
              </div>
            ) : null}
            {userQuotaModeInput === "hybrid" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-stone-700 dark:text-stone-200">每日额度</label>
                  <Input
                    type="text"
                    value={dailyQuotaLimitInput}
                    onChange={(e) => setDailyQuotaLimitInput(normalizeIntegerInput(e.target.value, 0))}
                    inputMode="numeric"
                    step="1"
                    min="0"
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-stone-700 dark:text-stone-200">固定额度</label>
                  <Input
                    type="text"
                    value={fixedQuotaLimitInput}
                    onChange={(e) => setFixedQuotaLimitInput(normalizeIntegerInput(e.target.value, 0))}
                    inputMode="numeric"
                    step="1"
                    min="0"
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="sm:col-span-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                  当前模式先扣每日额度，用完后自动扣固定额度。当前展示：{editingUser?.quota_summary || "暂无"}。
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setEditingUser(null)} disabled={isUpdatingUserQuota}>取消</Button>
            <Button className="h-10 rounded-xl bg-stone-950 text-white" onClick={() => void handleUpdateUserQuota()} disabled={isUpdatingUserQuota}>
              {isUpdatingUserQuota ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              确定修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetPwdUser)} onOpenChange={(open) => !open && setResetPwdUser(null)}>
        <DialogContent className="rounded-3xl border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
          <DialogHeader className="gap-2">
            <DialogTitle>重置登录密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为用户「{resetPwdUser?.username}」设定新的登录密钥。该密钥同时用于网页登录和 OpenAI 兼容客户端。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-3">
            <label className="text-sm font-medium text-stone-700 dark:text-stone-200">新登录密钥</label>
            <Input
              type="password"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="8-50 位，需同时包含字母和数字"
              className="h-11 rounded-xl"
            />
            <p className="text-xs leading-5 text-stone-500 dark:text-stone-400">
              建议用不容易猜到的密钥。不要和别的用户重复，否则系统会拒绝保存。
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setResetPwdUser(null)} disabled={isResettingUserPwd}>取消</Button>
            <Button className="h-10 rounded-xl bg-stone-950 text-white" onClick={() => void handleResetUserPassword()} disabled={isResettingUserPwd}>
              {isResettingUserPwd ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              确定重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingUser)} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent className="rounded-3xl border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-950">
          <DialogHeader className="gap-2">
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确认删除用户「{deletingUser?.username}」吗？删除后该用户无法登录，也不能再用登录密钥调用接口。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setDeletingUser(null)} disabled={isDeletingUser}>取消</Button>
            <Button variant="destructive" className="h-10 rounded-xl" onClick={() => void handleDeleteUser()} disabled={isDeletingUser}>
              {isDeletingUser ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

