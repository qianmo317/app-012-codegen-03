# 老方子换算：钱 / 两 / 分 → 克

老方子上写的是「两、钱、分」旧衡制，抓药前要先换成克才好上戥子称。
本模块 `src/conversion.ts` 负责整方换算、超量提醒与小儿减量，全部为纯函数，
配套单测见 `tests/conversion.test.ts`（`npm test`）。

## 1. 折算关系（一张方子必须整方用同一套）

旧制内部统一按十进制：**一两 = 十钱 = 一百分**。内置三套折算（`CONVERSION_STANDARDS`）：

| id | 名称 | 一两 | 一钱 | 一分 | 适用 |
| --- | --- | --- | --- | --- | --- |
| `modern-tcm` | 现代中医通用制 | ≈30g | **≈3g** | ≈0.3g | 1979 年起行业统一近似口径，现代方剂 |
| `han-dynasty` | 汉代经方制 | **≈13.8g** | ≈1.38g | ≈0.138g | 《伤寒论》《金匮要略》等经方，按出土权衡器考证 |
| `ming-qing` | 明清库平制 | ≈37.5g | ≈3.75g | ≈0.375g | 明清/民国库平、台港常见口径 |

> 同一味「桂枝三钱」，现代制合 9g、汉代制只合约 4.1g——折算关系选错，剂量差数倍，
> 所以每份结果都强制记录 `standardId / standardName / standardBasis`。

## 2. 换算与记录

```ts
import { convertPrescription, ConversionLedger } from './conversion';

const record = convertPrescription(rx, 'modern-tcm', { convertedBy: '王药师' });
// record.items[i] = {
//   herb: '桂枝',
//   original: { amount: 3, unit: 'qian', text: '3钱' }, // 原方与克数并排
//   grams: 9,                                           // 保留一位小数
//   overdose, status, dailyMaxGrams, warning, ...
// }
// record.meta = { standardId, standardName, standardBasis, convertedBy, convertedAt }
```

- **整方一次换算**：`convertPrescription(rx, standardId, { convertedBy })`，每味药共用同一套关系；
- **一位小数**：统一走 `roundTo1`（四舍五入，已处理浮点误差）；
- **署名 + 时间 + 折算依据**：写进 `record.meta`，换算人不可为空。

### 两套折算互不覆盖

`ConversionLedger` 按 **方子 id × 折算 id** 建账（键见 `conversionKey`）：

```ts
const ledger = new ConversionLedger();
ledger.convertAndRecord(rx, 'modern-tcm', { convertedBy: '王药师' });
ledger.convertAndRecord(rx, 'han-dynasty', { convertedBy: '王药师' });
// 两份并存；同方同折算重算只更新自己那份，不盖另一套
ledger.getConversionsByPrescription('old-rx-1'); // 两份并排核对
```

## 3. 一天常用量超量提醒

数据表在 `src/dosage-limits.ts`，依据《中国药典》2020 年版一部煎服常用量（如
杏仁 5~10g、黄连 2~5g、甘草 2~10g）。换算后逐味核对：

- `grams > dailyMaxGrams` → `status: 'overdose'`、`overdose: true`，
  `warning` 写明「超量提醒：杏仁 5钱合15g，超出一天常用量上限 10g，请药师复核后再抓」；
- 未收录的药材不阻断换算，标 `limitMissing`，提示人工复核；
- 汇总数 `record.overdoseCount`。

## 4. 小儿减量（年龄 + 体重，单独一份）

`reduceForChild(adultRecord, { ageYears, weightKg, name? }, { reducedBy })`
在一份成人换算结果上减量，**另出一份单子**，不改动成人那份；账本键还会带上患儿身份
（`reductionKey`），同一患儿按两套折算各减一份也互不覆盖。

减量系数（`buildReductionRule`）：

1. **年龄系数**——教材老幼剂量折算表（`CHILD_AGE_BANDS`）：
   新生儿(1个月内) 1/6、乳婴儿(1月~1岁) 1/3、幼儿(1~3岁) 1/2、
   学龄儿童(3~7岁) 2/3、学龄期(7~12岁) 5/6、12~15岁 1；
2. **体重系数** = 体重(kg) ÷ 成人基准 **50kg**，封顶 1（`ADULT_REFERENCE_WEIGHT_KG`）；
3. **减量系数** = (年龄系数 + 体重系数) ÷ 2，封顶 1。

每味药单独写明：

```ts
item.adultGrams      // 成人量，如 9
item.childGrams      // 减量后，9 × 0.37 = 3.3（一位小数）
item.reducedGrams    // 减了多少克，5.7
item.reducedPercent  // 减了百分之几，63.3
record.rule.description // 依据：按幼儿(1~3岁)取0.5；按体重12kg/50kg取0.24；平均得0.37
```

减量后仍超过一天常用量上限的，继续标 `overdose` 并提示「减量后仍超量」。
年龄 > 15 岁或年龄/体重非法时直接抛错。
