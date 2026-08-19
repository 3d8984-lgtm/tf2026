export interface QcCheck {
  key: string;
  ko: string;
  zh: string;
}

export interface QcGroup {
  key: string;
  ko: string;
  zh: string;
  checks: QcCheck[];
}

/** Quality inspection checklist for the t-shirt quality inspection workstation. */
export const QC_GROUPS: QcGroup[] = [
  {
    key: "hologram",
    ko: "홀로그램 스티커",
    zh: "全息贴纸",
    checks: [
      { key: "attach", ko: "부착이 잘 되었는가?", zh: "贴附是否良好？" },
      { key: "position", ko: "위치는 적당한가?", zh: "位置是否合适？" },
      { key: "serial", ko: "일련번호는 동일한가?", zh: "序列号是否一致？" },
    ],
  },
  {
    key: "design",
    ko: "디자인",
    zh: "图案",
    checks: [
      { key: "attach", ko: "부착이 잘 되었는가?", zh: "贴附是否良好？" },
      { key: "position", ko: "위치는 적당한가?", zh: "位置是否合适？" },
      { key: "same", ko: "디자인은 동일한가?", zh: "图案是否一致？" },
    ],
  },
  {
    key: "twincode",
    ko: "트윈코드 마크",
    zh: "TwinCode 标识",
    checks: [
      { key: "attach", ko: "부착이 잘 되었는가?", zh: "贴附是否良好？" },
      { key: "position", ko: "위치는 적당한가?", zh: "位置是否合适？" },
      { key: "same", ko: "디자인은 동일한가?", zh: "图案是否一致？" },
    ],
  },
  {
    key: "tshirt",
    ko: "티셔츠",
    zh: "T恤",
    checks: [
      { key: "size", ko: "사이즈는 동일한가?", zh: "尺码是否一致？" },
      { key: "clean", ko: "이염, 오염은 없는가?", zh: "有无染色、污渍？" },
    ],
  },
];

export const QC_TOTAL = QC_GROUPS.reduce((s, g) => s + g.checks.length, 0);

export type QcChecks = Record<string, boolean>;

export const qcKey = (group: string, check: string) => `${group}.${check}`;

export const qcCheckedCount = (checks: QcChecks | null | undefined) =>
  Object.values(checks ?? {}).filter(Boolean).length;

export const qcIsComplete = (checks: QcChecks | null | undefined) =>
  qcCheckedCount(checks) === QC_TOTAL;
