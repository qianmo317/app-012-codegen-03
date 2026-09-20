// 每味药成人「一天常用量」区间（单位：克），用于换算后的超量提醒。
// 数据依据：《中华人民共和国药典》2020 年版一部「用法用量」项下的煎服（汤剂）常用量。
// 未收录的药材视为无参考值：不阻断换算，仅在条目上标记 limitMissing，由抓药的人自行把关。
// key 为药名，须与 herbs.ts 中的 name 保持一致。

export interface DailyDoseLimit {
  /** 一天常用量下限（克） */
  min: number;
  /** 一天常用量上限（克） */
  max: number;
  /** 来源备注，便于复核 */
  note?: string;
}

export const DAILY_DOSE_LIMITS: Record<string, DailyDoseLimit> = {
  白芍: { min: 6, max: 15 },
  赤芍: { min: 6, max: 12 },
  生地: { min: 10, max: 15, note: '鲜品 12~30g；此处按生地黄干品' },
  熟地: { min: 9, max: 15 },
  黄芪: { min: 9, max: 30 },
  当归: { min: 6, max: 12 },
  川芎: { min: 3, max: 10 },
  白术: { min: 6, max: 12 },
  苍术: { min: 3, max: 9 },
  茯苓: { min: 10, max: 15 },
  党参: { min: 9, max: 30 },
  丹参: { min: 10, max: 15 },
  甘草: { min: 2, max: 10, note: '清热解毒宜生用，补中宜炙用' },
  桂枝: { min: 3, max: 10 },
  柴胡: { min: 3, max: 10 },
  黄芩: { min: 3, max: 10 },
  黄连: { min: 2, max: 5 },
  黄柏: { min: 3, max: 12 },
  知母: { min: 6, max: 12 },
  贝母: { min: 5, max: 10, note: '川贝粉冲服一次 1~2g，此处按煎服常用量' },
  杏仁: { min: 5, max: 10, note: '内服不宜过量，以免苦杏仁苷中毒' },
  桃仁: { min: 5, max: 10 },
  红花: { min: 3, max: 10 },
  枸杞: { min: 6, max: 12, note: '即枸杞子' },
  菊花: { min: 5, max: 10 },
  薄荷: { min: 3, max: 6, note: '后下，不宜久煎' },
  陈皮: { min: 3, max: 10 },
  青皮: { min: 3, max: 10 },
  半夏: { min: 3, max: 9, note: '内服一般炮制后使用（法半夏/姜半夏）' },
  远志: { min: 3, max: 10 },
  酸枣仁: { min: 10, max: 15 },
  五味子: { min: 2, max: 6 },
};

export function getDailyDoseLimit(herb: string): DailyDoseLimit | undefined {
  return DAILY_DOSE_LIMITS[herb];
}
