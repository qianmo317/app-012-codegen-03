// 老方子旧单位（两 / 钱 / 分）换算成克。
// 整张方子一次换算、每味药按同一套折算关系、小数留一位；
// 换算记录要记下谁换算的、按哪套折算关系算的；
// 超一天常用量当场标出；小儿按年龄体重减量单列；
// 同一张方子按不同折算关系各算一份，互不覆盖。

export interface OldDosage {
  liang?: number; // 两
  qian?: number;  // 钱
  fen?: number;   // 分
}

export interface OldPrescriptionItem {
  herb: string;
  dosage: OldDosage;
}

export interface OldPrescription {
  id: string;
  items: OldPrescriptionItem[];
}

export interface ConversionRuleSet {
  id: string;
  name: string;
  gramsPerLiang: number;
  gramsPerQian: number;
  gramsPerFen: number;
}

// 常用的几套旧制折算关系
export const CONVERSION_RULE_SETS: ConversionRuleSet[] = [
  { id: 'simplified-3g', name: '大陆简化制（1两=30克，1钱=3克，1分=0.3克）', gramsPerLiang: 30, gramsPerQian: 3, gramsPerFen: 0.3 },
  { id: 'sixteen-liang', name: '十六两制（1两=31.25克，1钱=3.125克，1分=0.3125克）', gramsPerLiang: 31.25, gramsPerQian: 3.125, gramsPerFen: 0.3125 },
  { id: 'hk-3.75g', name: '港台制（1两=37.5克，1钱=3.75克，1分=0.375克）', gramsPerLiang: 37.5, gramsPerQian: 3.75, gramsPerFen: 0.375 },
];

export function getRuleSet(id: string): ConversionRuleSet {
  const ruleSet = CONVERSION_RULE_SETS.find(r => r.id === id);
  if (!ruleSet) throw new Error(`未知的折算关系: ${id}`);
  return ruleSet;
}

// 小数留一位
export function round1(n: number): number {
  return parseFloat(n.toFixed(1));
}

// 把旧单位剂量写成中文串，如「1两2钱5分」
export function formatOldDosage(dosage: OldDosage): string {
  const parts: string[] = [];
  if (dosage.liang) parts.push(`${dosage.liang}两`);
  if (dosage.qian) parts.push(`${dosage.qian}钱`);
  if (dosage.fen) parts.push(`${dosage.fen}分`);
  return parts.length > 0 ? parts.join('') : '0钱';
}

// 单味药按某套折算关系折成克（留一位小数）
export function dosageToGrams(dosage: OldDosage, ruleSet: ConversionRuleSet): number {
  const grams =
    (dosage.liang ?? 0) * ruleSet.gramsPerLiang +
    (dosage.qian ?? 0) * ruleSet.gramsPerQian +
    (dosage.fen ?? 0) * ruleSet.gramsPerFen;
  return round1(grams);
}

// 各味药一天的常用量上限（克），换算后超出即当场标出提醒
export const DAILY_MAX_GRAMS: Record<string, number> = {
  白芍: 15, 赤芍: 12, 生地: 15, 熟地: 15, 黄芪: 30, 当归: 12,
  川芎: 10, 白术: 12, 苍术: 9, 茯苓: 15, 党参: 30, 丹参: 15,
  甘草: 10, 桂枝: 10, 柴胡: 10, 黄芩: 10, 黄连: 5, 黄柏: 12,
  知母: 12, 贝母: 10, 杏仁: 10, 桃仁: 10, 红花: 10, 枸杞: 12,
  菊花: 10, 薄荷: 6, 陈皮: 10, 青皮: 10, 半夏: 9, 远志: 10,
  酸枣仁: 15, 五味子: 6,
};

export function getDailyMaxGrams(herb: string): number | null {
  return DAILY_MAX_GRAMS[herb] ?? null;
}

export interface ConvertedItem {
  herb: string;
  original: OldDosage;       // 原方剂量，与克数并排留着
  originalText: string;
  grams: number;             // 换算后的克数（一位小数）
  dailyMaxGrams: number | null;
  exceedsDailyLimit: boolean;
}

export interface ConversionRecord {
  id: string;                // 方子编号#折算关系 —— 两套折算关系各算一份时互不覆盖
  prescriptionId: string;
  ruleSetId: string;
  ruleSetName: string;
  operator: string;          // 谁换算的
  createdAt: number;
  items: ConvertedItem[];
}

// 整张方子一次换算，每味药都按同一套折算关系
export function convertPrescription(
  rx: OldPrescription,
  ruleSetId: string,
  operator: string,
  now: number = Date.now(),
): ConversionRecord {
  const ruleSet = getRuleSet(ruleSetId);
  const items: ConvertedItem[] = rx.items.map(item => {
    const grams = dosageToGrams(item.dosage, ruleSet);
    const dailyMaxGrams = getDailyMaxGrams(item.herb);
    return {
      herb: item.herb,
      original: { ...item.dosage },
      originalText: formatOldDosage(item.dosage),
      grams,
      dailyMaxGrams,
      exceedsDailyLimit: dailyMaxGrams !== null && grams > dailyMaxGrams,
    };
  });
  return {
    id: `${rx.id}#${ruleSet.id}`,
    prescriptionId: rx.id,
    ruleSetId: ruleSet.id,
    ruleSetName: ruleSet.name,
    operator,
    createdAt: now,
    items,
  };
}

// ---- 小儿减量 ----

export interface PatientInfo {
  ageYears: number;
  weightKg: number;
}

export type PediatricMethod = 'age' | 'weight' | 'conservative';

interface AgeBracket {
  maxAge: number; // 小于该年龄（岁）
  ratio: number;  // 占成人量的比例
  label: string;
}

// 中医儿科常用的年龄折算
const AGE_BRACKETS: AgeBracket[] = [
  { maxAge: 1, ratio: 0.25, label: '1岁以下按成人量1/4' },
  { maxAge: 4, ratio: 1 / 3, label: '1~3岁按成人量1/3' },
  { maxAge: 8, ratio: 0.5, label: '4~7岁按成人量1/2' },
  { maxAge: 12, ratio: 2 / 3, label: '8~12岁按成人量2/3' },
  { maxAge: Infinity, ratio: 1, label: '12岁以上按成人量' },
];

const ADULT_WEIGHT_KG = 60;

export function ageRatio(ageYears: number): { ratio: number; label: string } {
  const bracket = AGE_BRACKETS.find(b => ageYears < b.maxAge)!;
  return { ratio: bracket.ratio, label: bracket.label };
}

export function weightRatio(weightKg: number): number {
  return Math.min(1, weightKg / ADULT_WEIGHT_KG);
}

export interface PediatricItem {
  herb: string;
  adultGrams: number;   // 成人量（换算记录里的克数）
  reducedGrams: number; // 减过之后的量
  reducedBy: number;    // 减了多少
  ratio: number;
  rule: string;         // 按什么减的
}

export interface PediatricPlan {
  id: string;           // 换算记录id@减量方法 —— 不同方法、不同折算关系的单子互不覆盖
  conversionId: string;
  patient: PatientInfo;
  method: PediatricMethod;
  createdAt: number;
  items: PediatricItem[];
}

// 按年龄和体重把成人量往下减，减过的量单独列一份
export function reduceForChild(
  record: ConversionRecord,
  patient: PatientInfo,
  method: PediatricMethod,
  now: number = Date.now(),
): PediatricPlan {
  if (!(patient.ageYears >= 0)) throw new Error('年龄不能为负');
  if (!(patient.weightKg > 0)) throw new Error('体重必须大于0');

  const age = ageRatio(patient.ageYears);
  const wRatio = weightRatio(patient.weightKg);

  let ratio: number;
  let rule: string;
  if (method === 'age') {
    ratio = age.ratio;
    rule = `按年龄折算：${patient.ageYears}岁，${age.label}（比例${round1(ratio)}）`;
  } else if (method === 'weight') {
    ratio = wRatio;
    rule = `按体重折算：${patient.weightKg}kg÷成人${ADULT_WEIGHT_KG}kg（比例${round1(ratio)}）`;
  } else {
    ratio = Math.min(age.ratio, wRatio);
    rule = `按年龄与体重取保守：${age.label}，体重${patient.weightKg}kg÷${ADULT_WEIGHT_KG}kg，两者取小（比例${round1(ratio)}）`;
  }

  const items: PediatricItem[] = record.items.map(item => {
    const reducedGrams = round1(item.grams * ratio);
    return {
      herb: item.herb,
      adultGrams: item.grams,
      reducedGrams,
      reducedBy: round1(item.grams - reducedGrams),
      ratio,
      rule,
    };
  });

  return {
    id: `${record.id}@${method}`,
    conversionId: record.id,
    patient: { ...patient },
    method,
    createdAt: now,
    items,
  };
}

// ---- 换算记录存储 ----

interface StoredData {
  records: ConversionRecord[];
  plans: PediatricPlan[];
}

export class ConversionStore {
  private records = new Map<string, ConversionRecord>();
  private plans = new Map<string, PediatricPlan>();

  constructor(private storageKey?: string) {
    this.load();
  }

  saveRecord(record: ConversionRecord): void {
    this.records.set(record.id, record);
    this.persist();
  }

  getRecord(id: string): ConversionRecord | undefined {
    return this.records.get(id);
  }

  // 同一张方子的全部换算记录：按两套折算关系各算的一份都在，互不盖掉
  recordsFor(prescriptionId: string): ConversionRecord[] {
    return [...this.records.values()]
      .filter(r => r.prescriptionId === prescriptionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  savePlan(plan: PediatricPlan): void {
    this.plans.set(plan.id, plan);
    this.persist();
  }

  plansFor(conversionId: string): PediatricPlan[] {
    return [...this.plans.values()]
      .filter(p => p.conversionId === conversionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private persist(): void {
    if (!this.storageKey || typeof localStorage === 'undefined') return;
    try {
      const data: StoredData = { records: [...this.records.values()], plans: [...this.plans.values()] };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // 存储失败不影响换算
    }
  }

  private load(): void {
    if (!this.storageKey || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw) as StoredData;
      for (const r of data.records ?? []) this.records.set(r.id, r);
      for (const p of data.plans ?? []) this.plans.set(p.id, p);
    } catch {
      // 读取失败按空记录处理
    }
  }
}
