import { z } from "zod";

/**
 * 기관 수동 계약 입력 — 관리자 폼(FormData)을 검증하고 KST 날짜를 저장 시각으로 바꾼다.
 * 서버 액션(lib/actions/adminBilling.ts)이 이 결과만 믿고 DB에 쓴다.
 */

/** 기관 계약으로 줄 수 있는 등급 */
export const CONTRACT_PLAN_IDS = ["pro", "enterprise"] as const;
export type ContractPlanId = (typeof CONTRACT_PLAN_IDS)[number];

export type ContractParse<T> = { ok: true; value: T } | { ok: false; error: "invalid" | "period" };

export interface ContractCreateInput {
  userId: string;
  planCode: ContractPlanId;
  startAt: string;
  endAt: string;
  /** 계약 금액(원, VAT 포함) — 기록용 */
  amount: number;
  orgName: string;
  contractRef: string | null;
  memo: string | null;
  paidAt: string | null;
  taxInvoiceAt: string | null;
}

export interface ContractUpdateInput {
  subscriptionId: string;
  orgName: string;
  contractRef: string | null;
  memo: string | null;
  paidAt: string | null;
  taxInvoiceAt: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_MS = 9 * 3600_000;

/**
 * YYYY-MM-DD(KST)를 저장 시각으로. 시작은 그날 0시, 종료는 그날 23:59:59.
 * 형식 오류·달력에 없는 날짜(2026-02-30)는 null — Date가 다음 달로 넘기는 경우도 되돌려 비교해 거른다.
 */
export function kstDateToIso(date: string, edge: "start" | "end"): string | null {
  if (!DATE_RE.test(date)) return null;
  const iso = `${date}T${edge === "start" ? "00:00:00" : "23:59:59"}+09:00`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + KST_MS).toISOString().slice(0, 10) === date ? iso : null;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

/** 선택 날짜 — 비우면 null, 형식이 틀리면 실패 */
const optionalDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const iso = kstDateToIso(v, "start");
    if (!iso) ctx.addIssue({ code: z.ZodIssueCode.custom });
    return iso;
  });

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "");

const DetailSchema = z.object({
  orgName: text(200),
  contractRef: optionalText(100),
  memo: optionalText(2000),
  paidAt: optionalDate,
  taxInvoiceAt: optionalDate,
});

const detailOf = (fd: FormData) => ({
  orgName: field(fd, "orgName"),
  contractRef: field(fd, "contractRef"),
  memo: field(fd, "memo"),
  paidAt: field(fd, "paidDate"),
  taxInvoiceAt: field(fd, "taxInvoiceDate"),
});

export function parseContractCreate(fd: FormData): ContractParse<ContractCreateInput> {
  const amountRaw = field(fd, "amount").trim();
  const parsed = DetailSchema.extend({
    userId: z.string().uuid(),
    planCode: z.enum(CONTRACT_PLAN_IDS),
    amount: z.number().int().min(0).max(10_000_000_000),
  }).safeParse({
    ...detailOf(fd),
    userId: field(fd, "userId"),
    planCode: field(fd, "planCode"),
    amount: /^\d+$/.test(amountRaw) ? Number(amountRaw) : NaN,
  });
  const startAt = kstDateToIso(field(fd, "startDate"), "start");
  const endAt = kstDateToIso(field(fd, "endDate"), "end");
  if (!parsed.success || !startAt || !endAt) return { ok: false, error: "invalid" };
  if (Date.parse(endAt) <= Date.parse(startAt)) return { ok: false, error: "period" };
  return { ok: true, value: { ...parsed.data, startAt, endAt } };
}

export function parseContractUpdate(fd: FormData): ContractParse<ContractUpdateInput> {
  const parsed = DetailSchema.extend({ subscriptionId: z.string().uuid() }).safeParse({
    ...detailOf(fd),
    subscriptionId: field(fd, "subscriptionId"),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "invalid" };
}

export function parseContractEnd(fd: FormData): ContractParse<{ subscriptionId: string; endAt: string }> {
  const id = z.string().uuid().safeParse(field(fd, "subscriptionId"));
  const endAt = kstDateToIso(field(fd, "endDate"), "end");
  return id.success && endAt ? { ok: true, value: { subscriptionId: id.data, endAt } } : { ok: false, error: "invalid" };
}

export function parseSubscriptionId(fd: FormData): ContractParse<{ subscriptionId: string }> {
  const id = z.string().uuid().safeParse(field(fd, "subscriptionId"));
  return id.success ? { ok: true, value: { subscriptionId: id.data } } : { ok: false, error: "invalid" };
}
