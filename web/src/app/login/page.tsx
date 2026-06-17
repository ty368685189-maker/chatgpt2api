"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole, KeyRound } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HeaderActions } from "@/components/header-actions";
import { login, loginUser, fetchPublicAnnouncement } from "@/lib/api";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const [authKey, setAuthKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  useEffect(() => {
    fetchPublicAnnouncement()
      .then((res) => {
        if (res?.announcement) {
          setAnnouncement(res.announcement);
        }
      })
      .catch(() => {});
  }, []);

  const handleKeyLogin = async () => {
    const normalizedAuthKey = authKey.trim();
    if (!normalizedAuthKey) {
      toast.error("请输入密钥");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await login(normalizedAuthKey);
      await setStoredAuthSession({
        key: normalizedAuthKey,
        role: data.role,
        subjectId: data.subject_id,
        name: data.name,
      });
      toast.success("登录成功");
      router.replace(getDefaultRouteForRole(data.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "密钥验证失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordLogin = async () => {
    const normUsername = username.trim();
    const normPassword = password;
    if (!normUsername || !normPassword) {
      toast.error("请输入用户名和密码");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await loginUser({ username: normUsername, password: normPassword });
      const { user } = res;
      await setStoredAuthSession({
        key: user.api_key,
        role: user.role as any,
        subjectId: user.id,
        name: user.username,
      });
      toast.success("登录成功");
      router.replace(getDefaultRouteForRole(user.role as any));
    } catch (error) {
      const message = error instanceof Error ? error.message : "用户名或密码错误";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-1rem)] w-full px-4 py-6">
      <HeaderActions className="fixed top-4 right-4 z-10" />
      
      {announcement && (
        <div className="mb-5 w-full max-w-[505px] rounded-2xl border border-amber-250 bg-amber-50/70 p-4 text-sm text-amber-900 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300 backdrop-blur-sm animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-2.5">
            <span className="text-base select-none">📢</span>
            <div className="flex-1 text-xs leading-5 whitespace-pre-line" dangerouslySetInnerHTML={{ __html: announcement }} />
          </div>
        </div>
      )}

      <Card className="w-full max-w-[505px] rounded-[30px] border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(28,25,23,0.10)] dark:border-stone-800/80 dark:bg-stone-900/95">
        <CardContent className="space-y-7 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm dark:bg-stone-100 dark:text-stone-950">
              <LockKeyhole className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950 dark:text-white">欢迎回来</h1>
              <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">请选择登录方式以继续使用服务</p>
            </div>
          </div>

          <Tabs defaultValue="password" className="w-full">
            <TabsList className="grid h-12 w-full grid-cols-2 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
              <TabsTrigger value="password" className="rounded-lg py-2 text-sm font-medium transition-all">密码登录</TabsTrigger>
              <TabsTrigger value="apikey" className="rounded-lg py-2 text-sm font-medium transition-all">密钥登录</TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="mt-6 space-y-5">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="username" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    用户名
                  </label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handlePasswordLogin();
                      }
                    }}
                    placeholder="请输入用户名"
                    className="h-13 rounded-2xl border-stone-200 bg-white px-4 dark:border-stone-700 dark:bg-stone-850"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    密码
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handlePasswordLogin();
                      }
                    }}
                    placeholder="请输入密码"
                    className="h-13 rounded-2xl border-stone-200 bg-white px-4 dark:border-stone-700 dark:bg-stone-850"
                  />
                </div>
              </div>

              <Button
                className="h-13 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
                onClick={() => void handlePasswordLogin()}
                disabled={isSubmitting}
              >
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin mr-2" /> : null}
                登录
              </Button>
            </TabsContent>

            <TabsContent value="apikey" className="mt-6 space-y-5">
              <div className="space-y-2">
                <label htmlFor="auth-key" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  密钥
                </label>
                <div className="relative">
                  <Input
                    id="auth-key"
                    type="password"
                    value={authKey}
                    onChange={(event) => setAuthKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleKeyLogin();
                      }
                    }}
                    placeholder="请输入 sk-..."
                    className="h-13 rounded-2xl border-stone-200 bg-white pl-10 pr-4 dark:border-stone-700 dark:bg-stone-850"
                  />
                  <KeyRound className="absolute left-3.5 top-4 size-4.5 text-stone-400" />
                </div>
              </div>

              <Button
                className="h-13 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
                onClick={() => void handleKeyLogin()}
                disabled={isSubmitting}
              >
                {isSubmitting ? <LoaderCircle className="size-4 animate-spin mr-2" /> : null}
                验证并登录
              </Button>
            </TabsContent>
          </Tabs>

          <div className="text-center pt-2">
            <span className="text-sm text-stone-550 dark:text-stone-400">没有账号？ </span>
            <Link href="/signup" className="text-sm font-semibold text-stone-950 hover:underline dark:text-white">
              立即注册
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
