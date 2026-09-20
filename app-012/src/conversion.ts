// 老方子换算：钱 / 两 / 分 → 克
// ----------------------------------------------------------------
// 纯函数模块，不依赖 DOM 与游戏循环，可在 UI、结算或单测中直接复用。
//
// 需求对应：
//  1. 整张方子一次换算，每味药都按同一套折算关系（convertPrescription）
//  2. 小数保留一位（roundTo1）
//  3. 换算出的克数与原方并排（ConvertedItem 同时保留 original 与 grams）
//  4. 记录谁换算的、按哪套折算关系（ConvertedRecord.meta + ConversionStandard）
//  5. 超出该药一天常用量当场标出（overdose / warning）
//  6. 小孩按年龄 + 体重往下减，减后单独列一份，写明减量与依据（reduceForChild）
//  7. 同一方子按两套折算各算一份互不覆盖（ConversionLedger 按 方子×折算 建账）

import { getDailyDoseLimit } from './dosage-limits';

// ---------- 旧单位 ----------

/** 老方子常用的旧制衡单位：两、钱、分（一钱 = 十分，一两 = 十钱） */
export type OldWeightUnit = 'liang' | 'qian' | 'fen';

export const OLD_UNIT_LABELS: Record<OldWeightUnit, string> = {
  liang: '两',
  qian: '钱',
  fen: '分',
};

// ---------- 折算关系 ----------

/**
 * 一套折算关系：给定旧制数量，返回克数。
 * 旧制内部统一为十进：一两 = 十钱 = 一百分。
 */
export interface ConversionStandard {
  /** 稳定标识，作为账本 key 的一部分，禁止随意改动 */
  id: string;
  /** 中文名称 */
  name: string;
  /** 一两大致合多少克（一钱 = liangToGrams / 10，一分 = liangToGrams / 100） */
  liangToGrams: number;
  /** 来源 / 适用范围说明 */
  basis: string;
}

/**
 * 折算关系表（同一味药必须整方按同一套关系换算）：
 *  - modern-tcm：1979 年起中药行业通用的近似换算，一两 ≈ 30g，一钱 ≈ 3g
 *  - han-dynasty：经方派依据，按汉代衡制考证一两 ≈ 13.8g（一钱 ≈ 1.4g）
 *  - ming-qing：明清至民国库平制 / 台港常用口径，一两 ≈ 37.5g（一钱 ≈ 3.75g）
 */
export const CONVERSION_STANDARDS: ConversionStandard[] = [
  {
    id: 'modern-tcm',
    name: '现代中医通用制（1钱≈3克）',
    liangToGrams: 30,
    basis: '1979 年中药行业统一近似换算：1两≈30g，1钱≈3g，1分≈0.3g。现代方剂通用。',
  },
  {
    id: 'han-dynasty',
    name: '汉代经方制（1两≈13.8克）',
    liangToGrams: 13.8,
    basis: '汉代衡制考证（以出土权衡器为据，1两≈13.8g，1钱≈1.4g，1分≈0.14g）。用于《伤寒论》《金匮要略》等经方折算。',
  },
  {
    id: 'ming-qing',
    name: '明清库平制（1两≈37.5克）',
    liangToGrams: 37.5,
    basis: '明清至民国库平/关平制，亦为台港常见口径：1两≈37.5g，1钱≈3.75g，1分≈0.375g。',
  },
];

export function getStandard(id: string): ConversionStandard {
  const s = CONVERSION_STANDARDS.find(item => item.id === id);
  if (!s) throw new Error(`未知的折算关系：${id}`);
  return s;
}

const UNIT_TO_LIANG: Record<OldWeightUnit, number> = {
  liang: 1,
  qian: 0.1,
  fen: 0.01,
};

/** 按指定折算关系把旧制数量换算成克（不做取舍，保留全精度） */
export function convertToGrams(amount: number, unit: OldWeightUnit, standard: ConversionStandard): number {
  if (!(unit in UNIT_TO_LIANG)) throw new Error(`未知的旧单位：${unit}`);
  return amount * UNIT_TO_LIANG[unit] * standard.liangToGrams;
}

/** 保留一位小数（换算结果的统一取舍口径） */
export function roundTo1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

// ---------- 老方与换算结果 ----------

export interface OldPrescriptionItem {
  herb: string;
  /** 旧制数量（两/钱/分），允许小数，如「二分半」写成 2.5 + 'fen' */
  amount: number;
  unit: OldWeightUnit;
  /** 煎法：先煎 / 后下 / 普通，沿用游戏既有约定 */
  decoct?: 'normal' | 'first' | 'last';
}

export interface OldPrescription {
  id: string;
  items: OldPrescriptionItem[];
}

export type OverdoseStatus = 'normal' | 'overdose' | 'limitMissing';

export interface ConvertedItem {
  herb: string;
  /** 原方数量与单位，与克数并排展示用 */
  original: { amount: number; unit: OldWeightUnit; text: string };
  /** 换算后的克数（保留一位） */
  grams: number;
  decoct: 'normal' | 'first' | 'last';
  /** 该味药一天常用量上限（克），无参考数据时为 undefined */
  dailyMaxGrams: number | undefined;
  overdose: boolean;
  status: OverdoseStatus;
  /** 现场提示语；正常时为空串 */
  warning: string;
}

export interface ConversionMeta {
  /** 按哪套折算关系算的 */
  standardId: string;
  standardName: string;
  standardBasis: string;
  /** 谁换算的（抓药/复核人署名） */
  convertedBy: string;
  /** 换算时间（毫秒时间戳） */
  convertedAt: number;
}

export interface ConvertedRecord {
  prescriptionId: string;
  meta: ConversionMeta;
  items: ConvertedItem[];
  /** 本张方里超量药味的数量 */
  overdoseCount: number;
}

/** 把旧数量+单位格式化成「3钱」「2.5分」这样的并排展示文本 */
export function formatOldAmount(amount: number, unit: OldWeightUnit): string {
  const label = OLD_UNIT_LABELS[unit];
  if (!label) throw new Error(`未知的旧单位：${unit}`);
  return `${amount}${label}`;
}

function buildConvertedItem(
  item: OldPrescriptionItem,
  standard: ConversionStandard,
): ConvertedItem {
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    throw new Error(`「${item.herb}」的旧制数量无效：${item.amount}`);
  }
  const grams = roundTo1(convertToGrams(item.amount, item.unit, standard));
  const limit = getDailyDoseLimit(item.herb);

  let status: OverdoseStatus;
  let warning = '';
  if (!limit) {
    status = 'limitMissing';
    warning = `《药典》未收录「${item.herb}」的一天常用量，无法自动核对，请人工复核`;
  } else if (grams > limit.max) {
    status = 'overdose';
    warning = `超量提醒：${item.herb} ${formatOldAmount(item.amount, item.unit)}合${grams}g，`
      + `超出一天常用量上限 ${limit.max}g，请药师复核后再抓`;
  } else {
    status = 'normal';
  }

  return {
    herb: item.herb,
    original: { amount: item.amount, unit: item.unit, text: formatOldAmount(item.amount, item.unit) },
    grams,
    decoct: item.decoct ?? 'normal',
    dailyMaxGrams: limit?.max,
    overdose: status === 'overdose',
    status,
    warning,
  };
}

export interface ConvertOptions {
  /** 谁换算的，必填 */
  convertedBy: string;
  /** 换算时间，默认 Date.now()，测试可注入 */
  now?: number;
}

/**
 * 整张方子一次换算：每味药都按同一套折算关系，结果保留一位小数；
 * 超出该药一天常用量的味次当场标出（overdose / warning）。
 */
export function convertPrescription(
  prescription: OldPrescription,
  standardId: string,
  options: ConvertOptions,
): ConvertedRecord {
  const standard = getStandard(standardId);
  const convertedBy = options.convertedBy?.trim();
  if (!convertedBy) throw new Error('换算人署名不能为空');
  if (!prescription.items.length) throw new Error('方子为空，无药可换算');

  const items = prescription.items.map(item => buildConvertedItem(item, standard));
  return {
    prescriptionId: prescription.id,
    meta: {
      standardId: standard.id,
      standardName: standard.name,
      standardBasis: standard.basis,
      convertedBy,
      convertedAt: options.now ?? Date.now(),
    },
    items,
    overdoseCount: items.filter(i => i.overdose).length,
  };
}

// ---------- 小儿减量 ----------

/**
 * 年龄分段（教材常用「老幼剂量折算表」口径）：
 * 新生儿（1 个月内）1/6、乳婴儿（1 个月~1 岁）1/3、
 * 幼儿（1~3 岁）1/2、学龄儿童（3~7 岁）2/3、
 * 学龄期儿童（7~12 岁）5/6；12~14 岁可给成人量（系数 1）。
 */
export interface AgeRule {
  /** 年龄段中文名称 */
  label: string;
  /** 该年龄段取成人量的比例（下限边界含） */
  factor: number;
}

export interface AgeBand extends AgeRule {
  /** 年龄下限（岁，含） */
  minYears: number;
  /** 年龄上限（岁，不含；null 表示无上界） */
  maxYears: number | null;
}

export const CHILD_AGE_BANDS: AgeBand[] = [
  { minYears: 0, maxYears: 1 / 12, label: '新生儿（1个月内）', factor: 1 / 6 },
  { minYears: 1 / 12, maxYears: 1, label: '乳婴儿（1个月~1岁）', factor: 1 / 3 },
  { minYears: 1, maxYears: 3, label: '幼儿（1~3岁）', factor: 1 / 2 },
  { minYears: 3, maxYears: 7, label: '学龄儿童（3~7岁）', factor: 2 / 3 },
  { minYears: 7, maxYears: 12, label: '学龄期儿童（7~12岁）', factor: 5 / 6 },
  { minYears: 12, maxYears: 15, label: '少年（12~15岁）', factor: 1 },
];

/** 体重折算时的成人体重基准（公斤） */
export const ADULT_REFERENCE_WEIGHT_KG = 50;

/** 小儿适用年龄上界（岁）：超过则不在小儿减量范围内 */
export const CHILD_MAX_AGE_YEARS = 15;

export function getAgeBand(ageYears: number): AgeBand {
  if (!Number.isFinite(ageYears) || ageYears < 0) {
    throw new Error(`小儿年龄无效：${ageYears}`);
  }
  if (ageYears > CHILD_MAX_AGE_YEARS) {
    throw new Error(`年龄 ${ageYears} 岁已超出小儿减量范围（0~${CHILD_MAX_AGE_YEARS} 岁）`);
  }
  const band = CHILD_AGE_BANDS.find(b => ageYears >= b.minYears
    && (b.maxYears === null || ageYears < b.maxYears));
  if (!band) throw new Error(`找不到年龄 ${ageYears} 岁对应的减量分段`);
  return band;
}

export interface ChildInfo {
  /** 年龄（岁；1 个月写作 1/12） */
  ageYears: number;
  /** 体重（公斤） */
  weightKg: number;
  /** 患儿称呼/标识，便于在单子上写明是给谁减的量 */
  name?: string;
}

export interface ReductionRule {
  /** 年龄分段名称 */
  ageBandLabel: string;
  /** 年龄系数（取成人量比例） */
  ageFactor: number;
  /** 体重系数 = 体重 / 成人体重基准(50kg)，封顶 1 */
  weightFactor: number;
  /** 最终减量系数 = (年龄系数 + 体重系数) / 2，封顶 1、不为负 */
  factor: number;
  /** 系数计算的中文说明 */
  description: string;
}

export interface ReducedItem {
  herb: string;
  /** 原方（旧制）并排文本 */
  originalText: string;
  /** 成人换算克数（一位小数） */
  adultGrams: number;
  /** 小儿减量后克数（一位小数） */
  childGrams: number;
  /** 减下来的克数（一位小数，成人量 − 小儿量） */
  reducedGrams: number;
  /** 减量百分比，保留一位（如 66.7 表示减了 66.7%） */
  reducedPercent: number;
  decoct: 'normal' | 'first' | 'last';
  dailyMaxGrams: number | undefined;
  /** 减量后仍超过一天常用量上限 */
  overdose: boolean;
  status: OverdoseStatus;
  warning: string;
}

export interface ReducedRecord {
  prescriptionId: string;
  child: { ageYears: number; weightKg: number; name?: string };
  rule: ReductionRule;
  /** 用的是哪一套成人换算结果 */
  source: {
    standardId: string;
    standardName: string;
    convertedBy: string;
    convertedAt: number;
  };
  /** 谁做的减量（复核/调剂人） */
  reducedBy: string;
  reducedAt: number;
  items: ReducedItem[];
  overdoseCount: number;
}

function roundFactor(f: number): number {
  return Math.round((f + Number.EPSILON) * 100) / 100;
}

/** 按年龄与体重计算减量系数（两者各取比例后平均，封顶为成人量） */
export function buildReductionRule(child: ChildInfo): ReductionRule {
  if (!Number.isFinite(child.weightKg) || child.weightKg <= 0) {
    throw new Error(`小儿体重无效：${child.weightKg}`);
  }
  const band = getAgeBand(child.ageYears);
  const ageFactor = roundFactor(band.factor);
  const weightFactor = roundFactor(Math.min(1, child.weightKg / ADULT_REFERENCE_WEIGHT_KG));
  const factor = roundFactor(Math.min(1, (ageFactor + weightFactor) / 2));

  const description = `按${band.label}取成人量的 ${ageFactor}；`
    + `按体重 ${child.weightKg}kg 相对成人基准 ${ADULT_REFERENCE_WEIGHT_KG}kg 取 ${weightFactor}；`
    + `两系数平均得减量系数 ${factor}（即给成人量的 ${factor} 倍）`;

  return { ageBandLabel: band.label, ageFactor, weightFactor, factor, description };
}

export interface ReduceOptions {
  /** 谁做的小儿减量，必填 */
  reducedBy: string;
  now?: number;
}

/**
 * 在一份成人换算结果上，按年龄 + 体重为小儿减量，单独列出一份单子：
 * 每味药写明成人量、减量后克数、减了多少克/百分之几、按什么规则减的。
 */
export function reduceForChild(
  adult: ConvertedRecord,
  child: ChildInfo,
  options: ReduceOptions,
): ReducedRecord {
  const reducedBy = options.reducedBy?.trim();
  if (!reducedBy) throw new Error('减量操作人署名不能为空');

  const rule = buildReductionRule(child);

  const items: ReducedItem[] = adult.items.map(item => {
    const childGrams = roundTo1(item.grams * rule.factor);
    const reducedGrams = roundTo1(item.grams - childGrams);
    const reducedPercent = roundTo1(item.grams > 0 ? (reducedGrams / item.grams) * 100 : 0);

    let status: OverdoseStatus;
    let warning = '';
    if (item.dailyMaxGrams === undefined) {
      status = 'limitMissing';
      warning = `《药典》未收录「${item.herb}」的一天常用量，减量后仍请人工复核`;
    } else if (childGrams > item.dailyMaxGrams) {
      status = 'overdose';
      warning = `减量后仍超量：${item.herb} 小儿量 ${childGrams}g 仍高于一天常用量上限 ${item.dailyMaxGrams}g`;
    } else {
      status = 'normal';
    }

    return {
      herb: item.herb,
      originalText: item.original.text,
      adultGrams: item.grams,
      childGrams,
      reducedGrams,
      reducedPercent,
      decoct: item.decoct,
      dailyMaxGrams: item.dailyMaxGrams,
      overdose: status === 'overdose',
      status,
      warning,
    };
  });

  return {
    prescriptionId: adult.prescriptionId,
    child: { ageYears: child.ageYears, weightKg: child.weightKg, name: child.name },
    rule,
    source: {
      standardId: adult.meta.standardId,
      standardName: adult.meta.standardName,
      convertedBy: adult.meta.convertedBy,
      convertedAt: adult.meta.convertedAt,
    },
    reducedBy,
    reducedAt: options.now ?? Date.now(),
    items,
    overdoseCount: items.filter(i => i.overdose).length,
  };
}

// ---------- 换算账本 ----------

/** 同一张方子按两套折算各算一份时，用「方子 × 折算」做键，互不覆盖 */
export function conversionKey(prescriptionId: string, standardId: string): string {
  return `${prescriptionId}::${standardId}`;
}

/** 小儿减量单的账键：方子 × 折算 × 患儿（未署名时用体重+年龄区分） */
export function reductionKey(prescriptionId: string, standardId: string, child: ChildInfo): string {
  const who = child.name?.trim() || `age${child.ageYears}-w${child.weightKg}`;
  return `${conversionKey(prescriptionId, standardId)}::child::${who}`;
}

/**
 * 换算账本：保存所有方子、所有折算关系下的换算结果与小儿减量单，
 * 同方同折算再次换算只更新对应键，不会盖掉另一套折算或别的方子。
 */
export class ConversionLedger {
  private conversions = new Map<string, ConvertedRecord>();
  private reductions = new Map<string, ReducedRecord>();

  /** 换算整方并按 方子×折算 入账，返回该键下的新记录 */
  convertAndRecord(prescription: OldPrescription, standardId: string, options: ConvertOptions): ConvertedRecord {
    const record = convertPrescription(prescription, standardId, options);
    this.conversions.set(conversionKey(prescription.id, standardId), record);
    return record;
  }

  /** 直接登记一份已算好的换算结果（便于离线导入/对账） */
  recordConversion(record: ConvertedRecord): void {
    this.conversions.set(conversionKey(record.prescriptionId, record.meta.standardId), record);
  }

  getConversion(prescriptionId: string, standardId: string): ConvertedRecord | undefined {
    return this.conversions.get(conversionKey(prescriptionId, standardId));
  }

  /** 取同一张方子按全部折算关系算出的各份结果（并排核对用） */
  getConversionsByPrescription(prescriptionId: string): ConvertedRecord[] {
    return [...this.conversions.values()].filter(r => r.prescriptionId === prescriptionId);
  }

  /** 在已入账的成人换算结果上做小儿减量，单独入账，不动成人那份 */
  reduceAndRecord(prescriptionId: string, standardId: string, child: ChildInfo, options: ReduceOptions): ReducedRecord {
    const adult = this.getConversion(prescriptionId, standardId);
    if (!adult) throw new Error(`账上没有方子 ${prescriptionId} 按 ${standardId} 的换算结果，请先换算`);
    const reduced = reduceForChild(adult, child, options);
    this.reductions.set(reductionKey(prescriptionId, standardId, child), reduced);
    return reduced;
  }

  getReduction(prescriptionId: string, standardId: string, child: ChildInfo): ReducedRecord | undefined {
    return this.reductions.get(reductionKey(prescriptionId, standardId, child));
  }

  /** 一张方子下的全部小儿减量单 */
  getReductionsByPrescription(prescriptionId: string): ReducedRecord[] {
    return [...this.reductions.values()].filter(r => r.prescriptionId === prescriptionId);
  }
}
