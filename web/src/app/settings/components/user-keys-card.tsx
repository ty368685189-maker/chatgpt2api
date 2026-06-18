"use client";

import { useEffect, useRef, useState } from "react";
import { 
  Ban, 
  CheckCircle2, 
  Copy, 
  KeyRound, 
  LoaderCircle, 
  Pencil, 
  Plus, 
  Trash2,
  Ticket,
  Users,
  Shield,
  ShieldCheck,
  RefreshCw,
  Search,
  Lock
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
  createUserKey, 
  deleteUserKey, 
  fetchUserKeys, 
  updateUserKey, 
  type UserKey,
  adminFetchUsers,
  adminBanUser,
  adminUnbanUser,
  adminUpdateUserQuota,
  adminResetUserPassword,
  adminChangeUserRole,
  adminFetchRegCodes,
  adminCreateRegCode,
  adminDeleteRegCode,
  type AdminUser,
  type RegCodeItem
} from "@/lib/api";

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

export function UserKeysCard() {
  const [activeTab, setActiveTab] = useState("api-keys");

  // === 1. 用户密钥状态 ===
  const [keysItems, setKeysItems] = useState<UserKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isKeyCreateOpen, setIsKeyCreateOpen] = useState(false);
  const [keyRemarkName, setKeyRemarkName] = useState("");
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [pendingKeyIds, setPendingKeyIds] = useState<Set<string>>(() => new Set());
  const [revealedKey, setRevealedKey] = useState("");
  const [deletingKey, setDeletingKey] = useState<UserKey | null>(null);
  const [editingKey, setEditingKey] = useState<UserKey | null>(null);
  const [editKeyName, setEditKeyName] = useState("");
  const [editKeyValue, setEditKeyValue] = useState("");

  // === 2. Reg Codes State ===
  const [codesItems, setCodesItems] = useState<RegCodeItem[]>([]);
  const [isLoadingCodes, setIsLoadingCodes] = useState(false);
  const [isCodeCreateOpen, setIsCodeCreateOpen] = useState(false);
  const [codeQuotaLimit, setCodeQuotaLimit] = useState(10);
  const [codeMaxUses, setCodeMaxUses] = useState(1);
  const [codeNote, setCodeNote] = useState("");
  const [isCreatingCode, setIsCreatingCode] = useState(false);
  const [deletingCode, setDeletingCode] = useState<RegCodeItem | null>(null);

  // === 3. Users State ===
  const [usersItems, setUsersItems] = useState<AdminUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<AdminUser[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [userQuotaLimitInput, setUserQuotaLimitInput] = useState(10);
  const [isUpdatingUserQuota, setIsUpdatingUserQuota] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<AdminUser | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [isResettingUserPwd, setIsResettingUserPwd] = useState(false);
  const [usersSortMode, setUsersSortMode] = useState<"recent" | "usage" | "status">("recent");
  const [usersSummary, setUsersSummary] = useState({ total: 0, active: 0, banned: 0, admins: 0, quotaUsed: 0, quotaLimit: 0 });

  // === Actions ===
  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  // --- 用户密钥 Methods ---
  const loadKeys = async () => {
    setIsLoadingKeys(true);
    try {
      const data = await fetchUserKeys();
      setKeysItems(data.items);
    } catch (error) {
      toast.error("加载密钥失败");
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleCreateKey = async () => {
    setIsCreatingKey(true);
    try {
      const data = await createUserKey(keyRemarkName.trim());
      setKeysItems(data.items);
      setRevealedKey(data.key);
      setKeyRemarkName("");
      setIsKeyCreateOpen(false);
      toast.success("密钥创建成功");
    } catch (error) {
      toast.error("创建密钥失败");
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleToggleKey = async (item: UserKey) => {
    setPendingKeyIds(prev => new Set(prev).add(item.id));
    try {
      const data = await updateUserKey(item.id, { enabled: !item.enabled });
      setKeysItems(data.items);
      toast.success(item.enabled ? "密钥已禁用" : "密钥已启用");
    } catch (error) {
      toast.error("更新密钥状态失败");
    } finally {
      setPendingKeyIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleDeleteKey = async () => {
    if (!deletingKey) return;
    const item = deletingKey;
    setPendingKeyIds(prev => new Set(prev).add(item.id));
    try {
      const data = await deleteUserKey(item.id);
      setKeysItems(data.items);
      setDeletingKey(null);
      toast.success("密钥删除成功");
    } catch (error) {
      toast.error("删除密钥失败");
    } finally {
      setPendingKeyIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleEditKey = async () => {
    if (!editingKey) return;
    const item = editingKey;
    const tName = editKeyName.trim();
    const tKey = editKeyValue.trim();
    setPendingKeyIds(prev => new Set(prev).add(item.id));
    try {
      const data = await updateUserKey(item.id, {
        ...(tName !== item.name ? { name: tName } : {}),
        ...(tKey ? { key: tKey } : {}),
      });
      setKeysItems(data.items);
      setEditingKey(null);
      setEditKeyValue("");
      toast.success("密钥更新成功");
    } catch (error) {
      toast.error("更新密钥失败");
    } finally {
      setPendingKeyIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // --- Reg Codes Methods ---
  const loadCodes = async () => {
    setIsLoadingCodes(true);
    try {
      const res = await adminFetchRegCodes();
      setCodesItems(res.items || []);
    } catch (error) {
      toast.error("加载注册激活码失败");
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

  // --- Users Methods ---
  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await adminFetchUsers();
      setUsersItems(res.items || []);
      applyUserFilter(res.items || [], userSearchQuery);
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
      u.username.toLowerCase().includes(q) || 
      u.email.toLowerCase().includes(q) ||
      u.registered_by_code.toLowerCase().includes(q)
    ));
  };

  const handleUserSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    setUserSearchQuery(val);
    applyUserFilter(usersItems, val);
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
      await adminUpdateUserQuota(editingUser.id, userQuotaLimitInput);
      toast.success("每日生图限额已成功调整");
      setEditingUser(null);
      void loadUsers();
    } catch (error) {
      toast.error("调整限额失败");
    } finally {
      setIsUpdatingUserQuota(false);
    }
  };

  const handleResetUserPassword = async () => {
    if (!resetPwdUser) return;
    const pwd = newPasswordInput.trim();
    if (!pwd || pwd.length < 4) {
      toast.error("新密码长度必须至少为 4 个字符");
      return;
    }
    setIsResettingUserPwd(true);
    try {
      await adminResetUserPassword(resetPwdUser.id, pwd);
      toast.success(`用户「${resetPwdUser.username}」密码已成功重置`);
      setResetPwdUser(null);
      setNewPasswordInput("");
    } catch (error) {
      toast.error("重置密码失败");
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

  // Load initial active tab data
  useEffect(() => {
    if (activeTab === "api-keys") {
      void loadKeys();
    } else if (activeTab === "reg-codes") {
      void loadCodes();
    } else if (activeTab === "users-mgmt") {
      void loadUsers();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "users-mgmt") {
      applyUserFilter(usersItems, userSearchQuery);
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
                  <KeyRound className="size-3.5" />
                  API 密钥
                </TabsTrigger>
                <TabsTrigger value="reg-codes" className="rounded-lg text-xs font-semibold px-4 flex items-center gap-1.5">
                  <Ticket className="size-3.5" />
                  注册激活码
                </TabsTrigger>
                <TabsTrigger value="users-mgmt" className="rounded-lg text-xs font-semibold px-4 flex items-center gap-1.5">
                  <Users className="size-3.5" />
                  注册用户管理
                </TabsTrigger>
              </TabsList>

              <div className="flex flex-wrap items-center gap-2">
                {activeTab === "users-mgmt" && (
                  <>
                    <Button variant="outline" className="h-9.5 rounded-xl px-4 text-xs" onClick={() => setUsersSortMode("recent")}>最近活跃</Button>
                    <Button variant="outline" className="h-9.5 rounded-xl px-4 text-xs" onClick={() => setUsersSortMode("usage")}>按配额使用</Button>
                    <Button variant="outline" className="h-9.5 rounded-xl px-4 text-xs" onClick={() => setUsersSortMode("status")}>按状态</Button>
                  </>
                )}
                {activeTab === "api-keys" && (
                  <Button className="h-9.5 rounded-xl bg-stone-950 px-4 text-xs font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200" onClick={() => setIsKeyCreateOpen(true)}>
                    <Plus className="size-4 mr-1.5" />
                    创建 API 密钥
                  </Button>
                )}
                {activeTab === "reg-codes" && (
                  <Button className="h-9.5 rounded-xl bg-stone-950 px-4 text-xs font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200" onClick={() => setIsCodeCreateOpen(true)}>
                    <Plus className="size-4 mr-1.5" />
                    生成注册码
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

            {/* ====== TABS 1: API KEYS ====== */}
            <TabsContent value="api-keys" className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">静态 Bearer 密钥管理</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">生成并直接提供给客户端使用的静态密钥，不支持每日限额等业务细节。</p>
              </div>

              {revealedKey && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">
                  <div className="font-medium text-xs">新建密钥成功！该密钥仅在此处显示一次，请及时妥善保存：</div>
                  <div className="mt-2.5 flex flex-col gap-3 rounded-lg border border-emerald-250 bg-white p-3 md:flex-row md:items-center md:justify-between">
                    <code className="break-all font-mono text-[12px] select-all">{revealedKey}</code>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8.5 rounded-lg border-emerald-200 bg-white px-3 text-emerald-700 text-xs"
                      onClick={() => void handleCopy(revealedKey)}
                    >
                      <Copy className="size-3.5 mr-1" />
                      复制
                    </Button>
                  </div>
                </div>
              )}

              {isLoadingKeys ? (
                <div className="flex items-center justify-center py-10">
                  <LoaderCircle className="size-5 animate-spin text-stone-400" />
                </div>
              ) : keysItems.length === 0 ? (
                <div className="rounded-xl bg-stone-50/50 py-10 text-center text-xs text-stone-500 border dark:bg-stone-850/20">
                  暂无静态 API 密钥。点击右上角按钮创建。
                </div>
              ) : (
                <div className="grid gap-3">
                  {keysItems.map((item) => {
                    const isPending = pendingKeyIds.has(item.id);
                    return (
                      <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 md:flex-row md:items-center md:justify-between dark:border-stone-800 dark:bg-stone-900">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-stone-800 dark:text-stone-200">{item.name || "未命名密钥"}</div>
                            <Badge variant={item.enabled ? "success" : "secondary"} className="rounded-md text-[10px]">
                              {item.enabled ? "已启用" : "已禁用"}
                            </Badge>
                            {item.role === "admin" && (
                              <Badge className="bg-purple-500 text-white border-none text-[10px] rounded-md">管理员 Key</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
                            <span>创建时间 {formatDateTime(item.created_at)}</span>
                            <span>最近使用 {formatDateTime(item.last_used_at)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-lg border-stone-250 bg-white px-3 text-xs"
                            onClick={() => {
                              setEditingKey(item);
                              setEditKeyName(item.name);
                              setEditKeyValue("");
                            }}
                            disabled={isPending}
                          >
                            <Pencil className="size-3.5 mr-1" />
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-lg border-stone-250 bg-white px-3 text-xs"
                            onClick={() => void handleToggleKey(item)}
                            disabled={isPending}
                          >
                            {item.enabled ? <Ban className="size-3.5 mr-1" /> : <CheckCircle2 className="size-3.5 mr-1" />}
                            {item.enabled ? "禁用" : "启用"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-lg border-rose-250 bg-white px-3 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setDeletingKey(item)}
                            disabled={isPending}
                          >
                            <Trash2 className="size-3.5 mr-1" />
                            删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ====== TABS 2: REG CODES ====== */}
            <TabsContent value="reg-codes" className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">注册激活码管理 (邀请码)</h3>
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
                            <Badge variant={isExpired ? "secondary" : "success"} className="rounded-md text-[10px]">
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

            {/* ====== TABS 3: USERS MANAGEMENT ====== */}
            <TabsContent value="users-mgmt" className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">自助注册用户列表</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400">监管所有通过注册码完成自助注册的用户，支持单独修改每日生图配额、封禁等操作。</p>
              </div>

              {isLoadingUsers ? (
                <div className="flex items-center justify-center py-10">
                  <LoaderCircle className="size-5 animate-spin text-stone-400" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="rounded-xl bg-stone-50/50 py-10 text-center text-xs text-stone-500 border dark:bg-stone-850/20">
                  {userSearchQuery ? "未搜索到匹配的用户账户。" : "暂无自助注册的用户账户。"}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
                  <table className="w-full border-collapse text-left text-xs text-stone-500">
                    <thead className="bg-stone-50 text-[10px] font-semibold tracking-wider text-stone-700 dark:bg-stone-850 dark:text-stone-300">
                      <tr>
                        <th className="px-4 py-3">用户名 / 邮箱</th>
                        <th className="px-4 py-3">角色 / 状态</th>
                        <th className="px-4 py-3">激活来源</th>
                        <th className="px-4 py-3">今日额度</th>
                        <th className="px-4 py-3">创建时间</th>
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
                                <Badge variant={isBanned ? "destructive" : "success"} className="text-[9px] px-1 py-0 rounded">
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
                            </td>
                            <td className="px-4 py-3.5 text-stone-400">
                              {user.created_at ? user.created_at.split(" ")[0] : "—"}
                            </td>
                            <td className="px-4 py-3.5 text-right space-x-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px] text-stone-600 hover:text-stone-900"
                                onClick={() => {
                                  setEditingUser(user);
                                  setUserQuotaLimitInput(user.quota_limit);
                                }}
                              >
                                配额
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px] text-stone-600 hover:text-stone-900"
                                disabled={!user.auth_key_id && !(user as any).api_key}
                                onClick={() => void handleCopy((user as any).api_key || user.auth_key_id || "")}
                              >
                                复制密钥
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
                                重置密码
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

      {/* ================= 1. CREATE API KEY DIALOG ================= */}
      <Dialog open={isKeyCreateOpen} onOpenChange={setIsKeyCreateOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>创建静态 API 密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              输入名称备注，用于区分不同客户端（例如: "我的小红书客户端", "CherryStudio"）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">名称备注</label>
            <Input
              value={keyRemarkName}
              onChange={(e) => setKeyRemarkName(e.target.value)}
              placeholder="例如：Cherry Studio 绘图"
              className="h-11 rounded-xl border-stone-200"
            />
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 text-stone-700"
              onClick={() => setIsKeyCreateOpen(false)}
              disabled={isCreatingKey}
            >
              取消
            </Button>
            <Button
              className="h-10 rounded-xl bg-stone-950 text-white hover:bg-stone-855"
              onClick={() => void handleCreateKey()}
              disabled={isCreatingKey}
            >
              {isCreatingKey ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              生成密钥
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= 2. DELETE API KEY CONFIRMATION ================= */}
      <Dialog open={Boolean(deletingKey)} onOpenChange={(open) => !open && setDeletingKey(null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>删除 API 密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确认要删除密钥「{deletingKey?.name}」吗？删除后，任何使用该密钥的客户端将立即失效。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setDeletingKey(null)}>取消</Button>
            <Button variant="destructive" className="h-10 rounded-xl" onClick={() => void handleDeleteKey()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= 3. EDIT API KEY NAME / KEY DIALOG ================= */}
      <Dialog open={Boolean(editingKey)} onOpenChange={(open) => !open && setEditingKey(null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑 API 密钥</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              您可以修改密钥的备注，也可以强行更换其原生的 sk 密钥（留空则不修改 sk 密钥本身）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称备注</label>
              <Input
                value={editKeyName}
                onChange={(e) => setEditKeyName(e.target.value)}
                placeholder="例如：Cherry Studio"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">更新原生成密钥 (可选)</label>
              <Input
                value={editKeyValue}
                onChange={(e) => setEditKeyValue(e.target.value)}
                placeholder="以 sk-... 开头，留空代表不重新生成密钥值"
                className="h-11 rounded-xl font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setEditingKey(null)}>取消</Button>
            <Button className="h-10 rounded-xl bg-stone-950 text-white" onClick={() => void handleEditKey()}>保存修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= 4. GENERATE REGISTRATION CODE DIALOG ================= */}
      <Dialog open={isCodeCreateOpen} onOpenChange={setIsCodeCreateOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>生成注册邀请码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              配置新邀请码的生图每日限额以及最大可使用次数。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">每日生图额度</label>
              <Input
                type="number"
                value={codeQuotaLimit}
                onChange={(e) => setCodeQuotaLimit(Number(e.target.value) || 0)}
                className="h-11 rounded-xl"
              />
              <p className="text-[11px] text-stone-400">使用此注册码激活的账号每日可生图的额度上限。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">最大可用次数</label>
              <Input
                type="number"
                value={codeMaxUses}
                onChange={(e) => setCodeMaxUses(Number(e.target.value) || 1)}
                className="h-11 rounded-xl"
              />
              <p className="text-[11px] text-stone-400">此邀请激活码可用于多少个人注册 (-1 表示无次数限制)。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">发放备注说明</label>
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

      {/* ================= 5. DELETE REGISTRATION CODE CONFIRMATION ================= */}
      <Dialog open={Boolean(deletingCode)} onOpenChange={(open) => !open && setDeletingCode(null)}>
        <DialogContent className="rounded-2xl p-6">
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

      {/* ================= 6. UPDATE USER QUOTA DIALOG ================= */}
      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>调整每日生图额度</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为自助注册用户「{editingUser?.username}」单独调整每日生图的额度上限。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-3">
            <label className="text-sm font-medium text-stone-700">每日额度限制 (次)</label>
            <Input
              type="number"
              value={userQuotaLimitInput}
              onChange={(e) => setUserQuotaLimitInput(Number(e.target.value) || 0)}
              className="h-11 rounded-xl"
            />
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

      {/* ================= 7. RESET USER PASSWORD DIALOG ================= */}
      <Dialog open={Boolean(resetPwdUser)} onOpenChange={(open) => !open && setResetPwdUser(null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>重置用户密码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为自助注册用户「{resetPwdUser?.username}」强制设定新登录密码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-3">
            <label className="text-sm font-medium text-stone-700">新密码</label>
            <Input
              type="password"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="请输入至少 4 位新密码"
              className="h-11 rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" className="h-10 rounded-xl" onClick={() => setResetPwdUser(null)} disabled={isResettingUserPwd}>取消</Button>
            <Button className="h-10 rounded-xl bg-stone-950 text-white" onClick={() => void handleResetUserPassword()} disabled={isResettingUserPwd}>
              {isResettingUserPwd ? <LoaderCircle className="size-4 animate-spin mr-1.5" /> : null}
              确定修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
