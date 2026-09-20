import { describe, it, expect } from 'vitest';
import {
  CONVERSION_STANDARDS,
  getStandard,
  convertToGrams,
  roundTo1,
  formatOldAmount,
  convertPrescription,
  buildReductionRule,
  reduceForChild,
  conversionKey,
  reductionKey,
  ConversionLedger,
  CHILD_AGE_BANDS,
  ADULT_REFERENCE_WEIGHT_KG,
  type OldPrescription,
  type ChildInfo,
  type ConvertedRecord,
} from '../src/conversion';

const NOW = 1_700_000_000_000;

// 样例老方：桂枝汤风格 + 几味容易超量的药
const rx: OldPrescription = {
  id: 'old-rx-1',
  items: [
    { herb: '桂枝', amount: 3, unit: 'qian' },
    { herb: '白芍', amount: 3, unit: 'qian' },
    { herb: '甘草', amount: 2, unit: 'qian' },
    { herb: '杏仁', amount: 5, unit: 'qian' }, // 现代制下 15g，超过杏仁 10g 上限
    { herb: '薄荷', amount: 5, unit: 'fen' }, // 5分 = 0.5钱
  ],
};

const child: ChildInfo = { ageYears: 2, weightKg: 12, name: '小宝' };

describe('CONVERSION_STANDARDS 折算关系表', () => {
  it('内置现代制、汉代制、明清制三套，且内部十进自洽', () => {
    const ids = CONVERSION_STANDARDS.map(s => s.id);
    expect(ids).toContain('modern-tcm');
    expect(ids).toContain('han-dynasty');
    expect(ids).toContain('ming-qing');
    for (const s of CONVERSION_STANDARDS) {
      expect(convertToGrams(1, 'liang', s)).toBeCloseTo(s.liangToGrams, 10);
      expect(convertToGrams(10, 'qian', s)).toBeCloseTo(s.liangToGrams, 10);
      expect(convertToGrams(100, 'fen', s)).toBeCloseTo(s.liangToGrams, 10);
    }
  });

  it('现代制：1钱 = 3克，1分 = 0.3克', () => {
    const s = getStandard('modern-tcm');
    expect(convertToGrams(1, 'qian', s)).toBeCloseTo(3, 10);
    expect(convertToGrams(1, 'fen', s)).toBeCloseTo(0.3, 10);
    expect(convertToGrams(1, 'liang', s)).toBeCloseTo(30, 10);
  });

  it('汉代制：1两 = 13.8克，1钱 = 1.38克', () => {
    const s = getStandard('han-dynasty');
    expect(convertToGrams(1, 'liang', s)).toBeCloseTo(13.8, 10);
    expect(convertToGrams(1, 'qian', s)).toBeCloseTo(1.38, 10);
    expect(convertToGrams(1, 'fen', s)).toBeCloseTo(0.138, 10);
  });

  it('未知折算关系直接报错', () => {
    expect(() => getStandard('tang-dynasty')).toThrow(/未知的折算关系/);
  });
});

describe('convertPrescription 整方一次换算', () => {
  it('整方每味药都按同一套折算、克数保留一位、与原方并排', () => {
    const rec = convertPrescription(rx, 'modern-tcm', { convertedBy: '王药师', now: NOW });

    expect(rec.items).toHaveLength(5);
    expect(rec.items.map(i => i.herb)).toEqual(['桂枝', '白芍', '甘草', '杏仁', '薄荷']);

    // 3钱 = 9g，原文与克数同时保留
    const guizhi = rec.items[0];
    expect(guizhi.grams).toBe(9);
    expect(guizhi.original.text).toBe('3钱');
    expect(guizhi.original.amount).toBe(3);
    expect(guizhi.original.unit).toBe('qian');

    // 2钱 = 6g
    expect(rec.items[2].grams).toBe(6);
    // 5分 = 1.5g
    expect(rec.items[4].grams).toBe(1.5);
  });

  it('小数保留一位（汉代制 3钱 = 4.14g → 4.1g）', () => {
    const rec = convertPrescription(rx, 'han-dynasty', { convertedBy: '王药师', now: NOW });
    expect(rec.items[0].grams).toBe(4.1);
    // 5分 = 0.138*5 = 0.69 → 0.7
    expect(rec.items[4].grams).toBe(0.7);
  });

  it('记下谁换算的、按哪套折算（含来源依据与时间）', () => {
    const rec = convertPrescription(rx, 'modern-tcm', { convertedBy: ' 王药师 ', now: NOW });
    expect(rec.meta.convertedBy).toBe('王药师');
    expect(rec.meta.standardId).toBe('modern-tcm');
    expect(rec.meta.standardName).toContain('3克');
    expect(rec.meta.standardBasis.length).toBeGreaterThan(10);
    expect(rec.meta.convertedAt).toBe(NOW);
    expect(rec.prescriptionId).toBe('old-rx-1');
  });

  it('未署名 / 空方子 / 非法数量直接报错', () => {
    expect(() => convertPrescription(rx, 'modern-tcm', { convertedBy: '  ' })).toThrow(/署名/);
    expect(() => convertPrescription({ id: 'x', items: [] }, 'modern-tcm', { convertedBy: '王' })).toThrow(/空/);
    const bad: OldPrescription = { id: 'x', items: [{ herb: '甘草', amount: 0, unit: 'qian' }] };
    expect(() => convertPrescription(bad, 'modern-tcm', { convertedBy: '王' })).toThrow(/无效/);
  });
});

describe('一天常用量超量提醒', () => {
  it('超出该味药一天常用量当场标出', () => {
    const rec = convertPrescription(rx, 'modern-tcm', { convertedBy: '王药师', now: NOW });
    const xingren = rec.items.find(i => i.herb === '杏仁')!;
    expect(xingren.grams).toBe(15);
    expect(xingren.overdose).toBe(true);
    expect(xingren.status).toBe('overdose');
    expect(xingren.dailyMaxGrams).toBe(10);
    expect(xingren.warning).toContain('超量提醒');
    expect(xingren.warning).toContain('15g');
    expect(rec.overdoseCount).toBe(1);
  });

  it('同一味药换套折算后不超量则不再报警（杏仁 5钱 → 汉代制 6.9g）', () => {
    const rec = convertPrescription(rx, 'han-dynasty', { convertedBy: '王药师', now: NOW });
    const xingren = rec.items.find(i => i.herb === '杏仁')!;
    expect(xingren.grams).toBe(6.9);
    expect(xingren.overdose).toBe(false);
    expect(xingren.warning).toBe('');
    expect(rec.overdoseCount).toBe(0);
  });

  it('未收录常用量的药材标记 limitMissing 但不阻断换算', () => {
    const weird: OldPrescription = { id: 'x', items: [{ herb: '无名草药', amount: 2, unit: 'qian' }] };
    const rec = convertPrescription(weird, 'modern-tcm', { convertedBy: '王药师' });
    expect(rec.items[0].grams).toBe(6);
    expect(rec.items[0].status).toBe('limitMissing');
    expect(rec.items[0].dailyMaxGrams).toBeUndefined();
    expect(rec.items[0].warning).toContain('人工复核');
  });
});

describe('小儿减量（年龄 + 体重）', () => {
  it('系数 = 年龄系数与体重系数的平均', () => {
    // 2岁属幼儿(1~3岁) → 0.5；12kg/50kg = 0.24；平均 0.37
    const rule = buildReductionRule(child);
    expect(rule.ageBandLabel).toContain('幼儿');
    expect(rule.ageFactor).toBe(0.5);
    expect(rule.weightFactor).toBe(0.24);
    expect(rule.factor).toBe(0.37);
    expect(rule.description).toContain('0.37');
  });

  it('各年龄段系数符合老幼剂量折算表', () => {
    const cases: Array<[number, number]> = [
      [0, 1 / 6],
      [0.5, 1 / 3],
      [1, 1 / 2],
      [5, 2 / 3],
      [10, 5 / 6],
      [13, 1],
    ];
    for (const [age, factor] of cases) {
      // 体重取 50kg 基准的同比例，使「年龄系数 = 体重系数」，平均后仍为该年龄段系数
      const rule = buildReductionRule({ ageYears: age, weightKg: 50 * factor });
      expect(rule.ageFactor, `年龄 ${age}`).toBeCloseTo(factor, 2);
      expect(rule.factor, `年龄 ${age}`).toBeCloseTo(factor, 2);
    }
  });

  it('体重系数按 50kg 成人基准、封顶为 1', () => {
    expect(buildReductionRule({ ageYears: 13, weightKg: 25 }).weightFactor).toBe(0.5);
    expect(buildReductionRule({ ageYears: 13, weightKg: 80 }).weightFactor).toBe(1);
  });

  it('减量单单独列出：成人量、小儿量、减了多少克/百分比、依据都写明', () => {
    const adult = convertPrescription(rx, 'modern-tcm', { convertedBy: '王药师', now: NOW });
    const reduced = reduceForChild(adult, child, { reducedBy: '李调剂', now: NOW });

    expect(reduced.prescriptionId).toBe('old-rx-1');
    expect(reduced.reducedBy).toBe('李调剂');
    expect(reduced.reducedAt).toBe(NOW);
    expect(reduced.child).toMatchObject({ ageYears: 2, weightKg: 12, name: '小宝' });
    // 来源成人换算可追溯
    expect(reduced.source.standardId).toBe('modern-tcm');
    expect(reduced.source.convertedBy).toBe('王药师');
    // 依据写明白
    expect(reduced.rule.description).toContain('幼儿');
    expect(reduced.rule.factor).toBe(0.37);

    const guizhi = reduced.items.find(i => i.herb === '桂枝')!;
    expect(guizhi.originalText).toBe('3钱');
    expect(guizhi.adultGrams).toBe(9);
    expect(guizhi.childGrams).toBe(3.3); // 9 * 0.37 = 3.33 → 3.3
    expect(guizhi.reducedGrams).toBe(5.7);
    expect(guizhi.reducedPercent).toBe(63.3); // 5.7/9 = 63.33... → 63.3
    expect(guizhi.overdose).toBe(false);
  });

  it('减量后仍超量要继续标出', () => {
    // 黄连 8钱 → 现代制 24g，远超 5g 上限；幼儿 0.37 系数 → 8.9g 仍超
    const bad: OldPrescription = { id: 'x', items: [{ herb: '黄连', amount: 8, unit: 'qian' }] };
    const adult = convertPrescription(bad, 'modern-tcm', { convertedBy: '王' });
    expect(adult.items[0].overdose).toBe(true);
    const reduced = reduceForChild(adult, child, { reducedBy: '李' });
    expect(reduced.items[0].childGrams).toBe(8.9);
    expect(reduced.items[0].overdose).toBe(true);
    expect(reduced.items[0].warning).toContain('仍超量');
    expect(reduced.overdoseCount).toBe(1);
  });

  it('非法年龄 / 体重 / 空署名报错', () => {
    const adult = convertPrescription(rx, 'modern-tcm', { convertedBy: '王' });
    expect(() => buildReductionRule({ ageYears: -1, weightKg: 10 })).toThrow(/年龄/);
    expect(() => buildReductionRule({ ageYears: 20, weightKg: 10 })).toThrow(/超出小儿/);
    expect(() => buildReductionRule({ ageYears: 2, weightKg: 0 })).toThrow(/体重/);
    expect(() => reduceForChild(adult, child, { reducedBy: ' ' })).toThrow(/署名/);
  });

  it('分段边界数量与基准体重正确', () => {
    expect(CHILD_AGE_BANDS).toHaveLength(6);
    expect(ADULT_REFERENCE_WEIGHT_KG).toBe(50);
  });
});

describe('ConversionLedger 两套折算互不覆盖', () => {
  it('同一方子按两套折算各算一份，按键并存、互不盖掉', () => {
    const ledger = new ConversionLedger();
    const modern = ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '王药师', now: NOW });
    const han = ledger.convertAndRecord(rx, 'han-dynasty', { convertedBy: '王药师', now: NOW });

    expect(conversionKey('old-rx-1', 'modern-tcm')).toBe('old-rx-1::modern-tcm');
    expect(ledger.getConversion('old-rx-1', 'modern-tcm')).toBe(modern);
    expect(ledger.getConversion('old-rx-1', 'han-dynasty')).toBe(han);

    // 两份数值不同且各自保留
    expect(modern.items[0].grams).toBe(9);
    expect(han.items[0].grams).toBe(4.1);
    expect(ledger.getConversionsByPrescription('old-rx-1')).toHaveLength(2);
  });

  it('同一方子同一折算重新换算只更新自己那份，不影响另一折算', () => {
    const ledger = new ConversionLedger();
    ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '王药师', now: NOW });
    ledger.convertAndRecord(rx, 'han-dynasty', { convertedBy: '王药师', now: NOW });
    const reModern = ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '张复核', now: NOW });

    expect(ledger.getConversionsByPrescription('old-rx-1')).toHaveLength(2);
    expect(ledger.getConversion('old-rx-1', 'modern-tcm')!.meta.convertedBy).toBe('张复核');
    expect(ledger.getConversion('old-rx-1', 'han-dynasty')!.meta.convertedBy).toBe('王药师');
    expect(reModern.prescriptionId).toBe('old-rx-1');
  });

  it('不同方子互不干扰', () => {
    const ledger = new ConversionLedger();
    const rx2: OldPrescription = { id: 'old-rx-2', items: [{ herb: '甘草', amount: 1, unit: 'qian' }] };
    ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '王' });
    ledger.convertAndRecord(rx2, 'modern-tcm', { convertedBy: '王' });
    expect(ledger.getConversion('old-rx-1', 'modern-tcm')!.items).toHaveLength(5);
    expect(ledger.getConversion('old-rx-2', 'modern-tcm')!.items).toHaveLength(1);
  });

  it('小儿减量单单独入账，不会盖掉成人换算', () => {
    const ledger = new ConversionLedger();
    ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '王药师', now: NOW });
    const reduced = ledger.reduceAndRecord('old-rx-1', 'modern-tcm', child, { reducedBy: '李调剂', now: NOW });

    expect(reductionKey('old-rx-1', 'modern-tcm', child)).toContain('小宝');
    // 成人那份原样保留
    const adult = ledger.getConversion('old-rx-1', 'modern-tcm')!;
    expect(adult.items[0].grams).toBe(9);
    expect(adult.meta.convertedBy).toBe('王药师');
    // 小儿单可取回
    expect(ledger.getReduction('old-rx-1', 'modern-tcm', child)).toBe(reduced);
    expect(ledger.getReductionsByPrescription('old-rx-1')).toHaveLength(1);
  });

  it('两套折算下分别给同一患儿减量也互不覆盖', () => {
    const ledger = new ConversionLedger();
    ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '王', now: NOW });
    ledger.convertAndRecord(rx, 'han-dynasty', { convertedBy: '王', now: NOW });
    const r1 = ledger.reduceAndRecord('old-rx-1', 'modern-tcm', child, { reducedBy: '李', now: NOW });
    const r2 = ledger.reduceAndRecord('old-rx-1', 'han-dynasty', child, { reducedBy: '李', now: NOW });
    expect(r1.items[0].childGrams).toBe(3.3); // 9 * 0.37
    expect(r2.items[0].childGrams).toBe(1.5); // 4.14 * 0.37 = 1.5318 → 1.5
    expect(ledger.getReductionsByPrescription('old-rx-1')).toHaveLength(2);
  });

  it('未先换算不能做小儿减量', () => {
    const ledger = new ConversionLedger();
    expect(() => ledger.reduceAndRecord('old-rx-1', 'modern-tcm', child, { reducedBy: '李' }))
      .toThrow(/请先换算/);
  });
});

describe('工具函数', () => {
  it('roundTo1 一位小数取舍', () => {
    expect(roundTo1(4.14)).toBe(4.1);
    expect(roundTo1(4.15)).toBe(4.2);
    expect(roundTo1(0.69)).toBe(0.7);
  });

  it('formatOldAmount 并排文本', () => {
    expect(formatOldAmount(3, 'qian')).toBe('3钱');
    expect(formatOldAmount(2.5, 'fen')).toBe('2.5分');
    expect(formatOldAmount(1, 'liang')).toBe('1两');
  });

  it('recordConversion 可直接登记外来结果', () => {
    const ledger = new ConversionLedger();
    const rec: ConvertedRecord = convertPrescription(rx, 'modern-tcm', { convertedBy: '王' });
    ledger.recordConversion(rec);
    expect(ledger.getConversion('old-rx-1', 'modern-tcm')).toBe(rec);
  });
});
