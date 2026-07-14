"use client";

import { useState } from "react";
import type { PlanId, ScanLimits } from "@/lib/quota";

interface PlanOption {
  id: PlanId;
  label: string;
  limits: ScanLimits;
}

/**
 * 사용자별 요금제·개별 한도 설정 폼.
 * 요금제를 고르면 숫자 입력칸의 placeholder가 그 요금제 기본값으로 갱신된다.
 * 숫자칸을 비우면 요금제 기본값을 따르고, 값을 넣으면 그 사용자만의 개별 한도가 된다.
 */
export function UserLimitsForm({
  action,
  userId,
  currentPlan,
  custom,
  effective,
  planOptions,
  labels,
}: {
  action: (formData: FormData) => void;
  userId: string;
  currentPlan: PlanId;
  custom: Partial<ScanLimits>;
  effective: ScanLimits;
  planOptions: PlanOption[];
  labels: {
    plan: string;
    daily: string;
    weekly: string;
    monthly: string;
    save: string;
    customHint: string;
    effective: string;
  };
}) {
  const [plan, setPlan] = useState<PlanId>(currentPlan);
  const planDefaults = planOptions.find((p) => p.id === plan)?.limits;

  const windows: { key: "daily" | "weekly" | "monthly"; label: string }[] = [
    { key: "daily", label: labels.daily },
    { key: "weekly", label: labels.weekly },
    { key: "monthly", label: labels.monthly },
  ];

  return (
    <form action={action} className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3">
      <input type="hidden" name="id" value={userId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`plan-${userId}`} className="mb-1 block text-xs font-semibold">
            {labels.plan}
          </label>
          <select
            id={`plan-${userId}`}
            name="plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanId)}
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
          >
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {windows.map(({ key, label }) => (
          <div key={key}>
            <label htmlFor={`${key}-${userId}`} className="mb-1 block text-xs font-semibold">
              {label}
            </label>
            <input
              id={`${key}-${userId}`}
              name={key}
              type="number"
              min={0}
              max={100000}
              inputMode="numeric"
              defaultValue={custom[key] ?? ""}
              placeholder={String(planDefaults?.[key] ?? "")}
              className="w-24 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-sm tabular-nums"
            />
          </div>
        ))}

        <button
          type="submit"
          className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
        >
          {labels.save}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
        {labels.customHint} · {labels.effective}: {effective.daily}/{effective.weekly}/{effective.monthly}
      </p>
    </form>
  );
}
