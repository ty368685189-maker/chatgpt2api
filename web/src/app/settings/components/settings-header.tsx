"use client";

export function SettingsHeader() {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/75 px-5 py-5 shadow-[0_20px_60px_-36px_rgba(25,33,61,0.22)] backdrop-blur-sm sm:px-6 sm:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex rounded-full bg-stone-100 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-stone-500 uppercase dark:bg-white/8 dark:text-stone-300">
            Dual公益站
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">设置</h1>
            <p className="max-w-2xl text-sm leading-6 text-stone-500">
              这里把全局代理、图片参数、备份和接入信息集中在一起，改完保存就会立刻影响后续行为。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-stone-500 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">保存即生效</span>
          <span className="rounded-full bg-stone-100 px-3 py-1.5 dark:bg-white/8 dark:text-stone-300">支持代理测试</span>
        </div>
      </div>
    </section>
  );
}
