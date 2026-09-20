import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONVERSION_RULE_SETS,
  ConversionStore,
  convertPrescription,
  dosageToGrams,
  formatOldDosage,
  getDailyMaxGrams,
  getRuleSet,
  reduceForChild,
  round1,
  type OldPrescription,
} from '../src/conversion';

const rx: OldPrescription = {
  id: 'rx-test',
  items: [
    { herb: '白芍', dosage: { qian: 2 } },
    { herb: '黄芪', dosage: { liang: 1, qian: 2 } },
    { herb: '甘草', dosage: { qian: 1, fen: 5 } },
  ],
};

describe('convertPrescription', () => {
  it('整张方子一次换算，每味药都按同一套折算关系', () => {
    const record = convertPrescription(rx, 'simplified-3g', '张三', 1000);
    expect(record.items.length).toBe(3);
    const ruleSet = getRuleSet('simplified-3g');
    for (let i = 0; i < rx.items.length; i++) {
      expect(record.items[i].grams).toBe(dosageToGrams(rx.items[i].dosage, ruleSet));
    }
    expect(record.ruleSetId).toBe('simplified-3g');
  });

  it('小数留一位', () => {
    // 十六两制 3钱 = 9.375 → 9.4
    expect(dosageToGrams({ qian: 3 }, getRuleSet('sixteen-liang'))).toBe(9.4);
    // 十六两制 1分 = 0.3125 → 0.3
    expect(dosageToGrams({ fen: 1 }, getRuleSet('sixteen-liang'))).toBe(0.3);
    // 简化制 2钱5分 = 7.5
    expect(dosageToGrams({ qian: 2, fen: 5 }, getRuleSet('simplified-3g'))).toBe(7.5);
    // 港台制 2钱 = 7.5
    expect(dosageToGrams({ qian: 2 }, getRuleSet('hk-3.75g'))).toBe(7.5);
  });

  it('克数和原方并排留着', () => {
    const record = convertPrescription(rx, 'simplified-3g', '张三', 1000);
    const item = record.items[1];
    expect(item.original).toEqual({ liang: 1, qian: 2 });
    expect(item.originalText).toBe('1两2钱');
    expect(item.grams).toBe(36);
  });

  it('记下谁换算的、按哪套折算关系算的', () => {
    const record = convertPrescription(rx, 'hk-3.75g', '李四', 1234);
    expect(record.operator).toBe('李四');
    expect(record.ruleSetId).toBe('hk-3.75g');
    expect(record.ruleSetName).toContain('港台');
    expect(record.createdAt).toBe(1234);
  });

  it('超出一天常用量当场标出来', () => {
    const record = convertPrescription(rx, 'simplified-3g', '张三', 1000);
    // 黄芪 1两2钱 = 36g > 30g 常用量
    const huangqi = record.items.find(i => i.herb === '黄芪')!;
    expect(huangqi.exceedsDailyLimit).toBe(true);
    expect(huangqi.dailyMaxGrams).toBe(30);
    // 甘草 1钱5分 = 4.5g ≤ 10g，不标
    const gancao = record.items.find(i => i.herb === '甘草')!;
    expect(gancao.exceedsDailyLimit).toBe(false);
  });

  it('不在常用量表里的药不误标', () => {
    const record = convertPrescription(
      { id: 'rx-x', items: [{ herb: '仙茅', dosage: { liang: 5 } }] },
      'simplified-3g',
      '张三',
      1000,
    );
    expect(record.items[0].dailyMaxGrams).toBeNull();
    expect(record.items[0].exceedsDailyLimit).toBe(false);
  });

  it('未知的折算关系直接报错', () => {
    expect(() => convertPrescription(rx, 'no-such-rule', '张三')).toThrow();
  });
});

describe('formatOldDosage / round1 / getDailyMaxGrams', () => {
  it('旧单位写成中文串', () => {
    expect(formatOldDosage({ liang: 1, qian: 2, fen: 5 })).toBe('1两2钱5分');
    expect(formatOldDosage({ qian: 3 })).toBe('3钱');
    expect(formatOldDosage({})).toBe('0钱');
  });

  it('round1 保留一位小数', () => {
    expect(round1(9.375)).toBe(9.4);
    expect(round1(6)).toBe(6);
  });

  it('常用量表查询', () => {
    expect(getDailyMaxGrams('黄芪')).toBe(30);
    expect(getDailyMaxGrams('不存在的药')).toBeNull();
  });

  it('折算关系表至少有两套，互不相同', () => {
    expect(CONVERSION_RULE_SETS.length).toBeGreaterThanOrEqual(2);
    const ids = CONVERSION_RULE_SETS.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('reduceForChild 小儿减量', () => {
  const record = convertPrescription(rx, 'simplified-3g', '张三', 1000);

  it('按年龄减：减过的量单独列出，减了多少、按什么减的写明白', () => {
    const plan = reduceForChild(record, { ageYears: 5, weightKg: 18 }, 'age', 2000);
    expect(plan.items.length).toBe(3);
    const baishao = plan.items.find(i => i.herb === '白芍')!;
    // 白芍 2钱 = 6g，4~7岁减半 → 3g
    expect(baishao.adultGrams).toBe(6);
    expect(baishao.reducedGrams).toBe(3);
    expect(baishao.reducedBy).toBe(3);
    expect(baishao.rule).toContain('年龄');
    expect(baishao.rule).toContain('1/2');
    expect(plan.method).toBe('age');
    expect(plan.patient).toEqual({ ageYears: 5, weightKg: 18 });
  });

  it('按体重减：体重÷60kg', () => {
    const plan = reduceForChild(record, { ageYears: 10, weightKg: 20 }, 'weight', 2000);
    const baishao = plan.items.find(i => i.herb === '白芍')!;
    // 6g × 20/60 = 2g
    expect(baishao.reducedGrams).toBe(2);
    expect(baishao.reducedBy).toBe(4);
    expect(baishao.rule).toContain('体重');
  });

  it('年龄体重取保守：两者取小', () => {
    // 10岁按年龄是2/3，20kg按体重是1/3，取小即1/3
    const plan = reduceForChild(record, { ageYears: 10, weightKg: 20 }, 'conservative', 2000);
    const baishao = plan.items.find(i => i.herb === '白芍')!;
    expect(baishao.reducedGrams).toBe(2);
    expect(baishao.rule).toContain('取保守');
  });

  it('减量不会减出比成人量还多的数', () => {
    const plan = reduceForChild(record, { ageYears: 15, weightKg: 80 }, 'conservative', 2000);
    for (const item of plan.items) {
      expect(item.reducedGrams).toBeLessThanOrEqual(item.adultGrams);
      expect(item.reducedBy).toBeGreaterThanOrEqual(0);
    }
  });

  it('年龄分档边界', () => {
    const at = (age: number) => reduceForChild(record, { ageYears: age, weightKg: 60 }, 'age').items[0].ratio;
    expect(at(0.5)).toBe(0.25);
    expect(at(2)).toBeCloseTo(1 / 3, 5);
    expect(at(6)).toBe(0.5);
    expect(at(10)).toBeCloseTo(2 / 3, 5);
    expect(at(12)).toBe(1);
  });

  it('年龄体重不合法时报错', () => {
    expect(() => reduceForChild(record, { ageYears: -1, weightKg: 10 }, 'age')).toThrow();
    expect(() => reduceForChild(record, { ageYears: 5, weightKg: 0 }, 'age')).toThrow();
  });
});

describe('ConversionStore 记录保存', () => {
  let store: ConversionStore;

  beforeEach(() => {
    store = new ConversionStore();
  });

  it('同一张方子按两套折算关系各算一份，互不盖掉', () => {
    const a = convertPrescription(rx, 'simplified-3g', '张三', 1000);
    const b = convertPrescription(rx, 'hk-3.75g', '张三', 2000);
    store.saveRecord(a);
    store.saveRecord(b);

    const all = store.recordsFor(rx.id);
    expect(all.length).toBe(2);
    expect(all.map(r => r.ruleSetId).sort()).toEqual(['hk-3.75g', 'simplified-3g']);
    // 两份的克数各算各的，互不影响
    const simplified = store.getRecord(a.id)!;
    const hk = store.getRecord(b.id)!;
    expect(simplified.items[0].grams).toBe(6);
    expect(hk.items[0].grams).toBe(7.5);
  });

  it('同一套折算关系重算时更新原记录，不多出一份', () => {
    store.saveRecord(convertPrescription(rx, 'simplified-3g', '张三', 1000));
    store.saveRecord(convertPrescription(rx, 'simplified-3g', '李四', 3000));
    const all = store.recordsFor(rx.id);
    expect(all.length).toBe(1);
    expect(all[0].operator).toBe('李四');
  });

  it('小儿减量单按折算关系和减量方法分开存', () => {
    const a = convertPrescription(rx, 'simplified-3g', '张三', 1000);
    const b = convertPrescription(rx, 'hk-3.75g', '张三', 2000);
    store.saveRecord(a);
    store.saveRecord(b);
    store.savePlan(reduceForChild(a, { ageYears: 5, weightKg: 18 }, 'age', 1000));
    store.savePlan(reduceForChild(a, { ageYears: 5, weightKg: 18 }, 'weight', 1000));
    store.savePlan(reduceForChild(b, { ageYears: 5, weightKg: 18 }, 'age', 1000));

    expect(store.plansFor(a.id).length).toBe(2);
    expect(store.plansFor(b.id).length).toBe(1);
    // 两套折算关系的小儿单基数不同，互不盖掉
    const planA = store.plansFor(a.id).find(p => p.method === 'age')!;
    const planB = store.plansFor(b.id).find(p => p.method === 'age')!;
    expect(planA.items[0].adultGrams).toBe(6);
    expect(planB.items[0].adultGrams).toBe(7.5);
  });

  it('带存储键时记录落到 localStorage，重开还在', () => {
    const key = 'conversion-test-persist';
    localStorage.removeItem(key);
    const s1 = new ConversionStore(key);
    s1.saveRecord(convertPrescription(rx, 'simplified-3g', '张三', 1000));
    s1.savePlan(reduceForChild(convertPrescription(rx, 'simplified-3g', '张三', 1000), { ageYears: 5, weightKg: 18 }, 'age', 1000));

    const s2 = new ConversionStore(key);
    expect(s2.recordsFor(rx.id).length).toBe(1);
    expect(s2.plansFor(`${rx.id}#simplified-3g`).length).toBe(1);
    localStorage.removeItem(key);
  });
});
