"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, UserPlus, KeySquare } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import { registerUser, fetchPublicAnnouncement } from "@/lib/api";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [regCode, setRegCode] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadAnnouncement = async () => {
    try {
      const res = await fetchPublicAnnouncement();
      if (res?.announcement) {
        setAnnouncement(res.announcement);
      }
    } catch (error) {}
  };

  useEffect(() => {
    void loadAnnouncement();
  }, []);

  const handleRegister = async () => {
    const normUsername = username.trim();
    const normPassword = password;
    const normRegCode = regCode.trim();

    if (!normUsername || !normPassword || !normRegCode) {
      toast.error("请完整填写所有必填项");
      return;
    }

    if (normUsername.length < 2) {
      toast.error("用户名长度必须至少为 2 个字符");
      return;
    }

    if (normPassword.length < 4) {
      toast.error("密码长度必须至少为 4 个字符");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await registerUser({
        username: normUsername,
        password: normPassword,
        reg_code: normRegCode,
      });
      const { user } = res;
      await setStoredAuthSession({
        key: user.api_key,
        role: user.role as any,
        subjectId: user.id,
        name: user.username,
      });
      toast.success("注册并登录成功！");
      router.replace(getDefaultRouteForRole(user.role as any));
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-1rem)] w-full px-4 py-6">
      <HeaderActions className="fixed top-4 right-4 z-10" />
      
      {announcement && (
        <div className="mb-5 w-full max-w-[520px] rounded-2xl border border-amber-250 bg-amber-50/70 p-4 text-sm text-amber-900 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300 backdrop-blur-sm animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-2.5">
            <span className="text-base select-none">📢</span>
            <div className="flex-1 text-xs leading-5 whitespace-pre-line" dangerouslySetInnerHTML={{ __html: announcement }} />
          </div>
        </div>
      )}

      <Card className="w-full max-w-[520px] rounded-[30px] border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(28,25,23,0.10)] dark:border-stone-800/80 dark:bg-stone-900/95">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm dark:bg-stone-100 dark:text-stone-950">
              <UserPlus className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-white">创建新账户</h1>
              <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">请输入你的注册信息，并绑定激活码</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                用户名 <span className="text-red-500">*</span>
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入 2-50 位用户名"
                className="h-12 rounded-xl border-stone-200 bg-white px-4 dark:border-stone-700 dark:bg-stone-850"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                密码 <span className="text-red-500">*</span>
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入至少 4 位密码"
                className="h-12 rounded-xl border-stone-200 bg-white px-4 dark:border-stone-700 dark:bg-stone-850"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="regCode" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                激活注册码 <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Input
                  id="regCode"
                  type="text"
                  value={regCode}
                  onChange={(event) => setRegCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleRegister();
                    }
                  }}
                  placeholder="请输入获得的激活码 (GY-XXXX)"
                  className="h-12 rounded-xl border-stone-200 bg-white pl-10 pr-4 dark:border-stone-700 dark:bg-stone-850"
                />
                <KeySquare className="absolute left-3 top-3.5 size-4 text-stone-400" />
              </div>
            </div>
          </div>

          <Button
            className="h-12 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200 font-medium"
            onClick={() => void handleRegister()}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin mr-2" /> : null}
            提交注册
          </Button>

          <div className="text-center pt-2">
            <span className="text-sm text-stone-550 dark:text-stone-400">已有账户？ </span>
            <Link href="/login" className="text-sm font-semibold text-stone-950 hover:underline dark:text-white">
              返回登录
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
