import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversionPanel } from '../src/conversionPanel';
import { ConversionStore } from '../src/conversion';

function setup() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const store = new ConversionStore();
  const panel = new ConversionPanel(root, store);
  return { root, store, panel };
}

function setInput(root: HTMLElement, selector: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
}

function click(root: HTMLElement, selector: string) {
  root.querySelector<HTMLButtonElement>(selector)!.click();
}

describe('ConversionPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('alert', vi.fn());
  });

  it('添加药味后整张换算，克数与原方并排显示', () => {
    const { root } = setup();
    setInput(root, '.cv-herb', '白芍');
    setInput(root, '.cv-qian', '2');
    click(root, '.cv-add');
    setInput(root, '.cv-herb', '甘草');
    setInput(root, '.cv-qian', '1');
    setInput(root, '.cv-fen', '5');
    click(root, '.cv-add');

    setInput(root, '.cv-operator', '张三');
    click(root, '.cv-convert');

    const html = root.querySelector('.cv-results')!.innerHTML;
    expect(html).toContain('白芍');
    expect(html).toContain('2钱');       // 原方
    expect(html).toContain('6.0g');      // 换算后的克数
    expect(html).toContain('1钱5分');
    expect(html).toContain('4.5g');
    expect(html).toContain('张三');      // 谁换算的
    expect(html).toContain('大陆简化制'); // 按哪套折算关系
  });

  it('超出一天常用量的药当场标出来', () => {
    const { root } = setup();
    setInput(root, '.cv-herb', '黄芪');
    setInput(root, '.cv-liang', '1');
    setInput(root, '.cv-qian', '2');
    click(root, '.cv-add');
    setInput(root, '.cv-operator', '张三');
    click(root, '.cv-convert');

    const html = root.querySelector('.cv-results')!.innerHTML;
    expect(html).toContain('36.0g');
    expect(html).toContain('超日用量');
    expect(html).toContain('cv-warn');
    expect(window.alert).toHaveBeenCalled();
  });

  it('小儿减量单独列一份，写清减了多少、按什么减的', () => {
    const { root } = setup();
    setInput(root, '.cv-herb', '白芍');
    setInput(root, '.cv-qian', '2');
    click(root, '.cv-add');
    setInput(root, '.cv-operator', '张三');
    click(root, '.cv-convert');

    setInput(root, '.cv-age', '5');
    setInput(root, '.cv-weight', '18');
    root.querySelector<HTMLButtonElement>('[data-reduce]')!.click();

    const plan = root.querySelector('.cv-plan')!;
    expect(plan.textContent).toContain('小儿减量单');
    expect(plan.textContent).toContain('6.0g'); // 成人量
    expect(plan.textContent).toContain('3.0g'); // 小儿量
    expect(plan.textContent).toContain('按年龄');
  });

  it('同一张方子按两套折算关系各算一份，两份都在', () => {
    const { root } = setup();
    setInput(root, '.cv-herb', '白芍');
    setInput(root, '.cv-qian', '2');
    click(root, '.cv-add');
    setInput(root, '.cv-operator', '张三');

    click(root, '.cv-convert');
    root.querySelector<HTMLSelectElement>('.cv-ruleset').value = 'hk-3.75g';
    click(root, '.cv-convert');

    const records = root.querySelectorAll('.cv-record');
    expect(records.length).toBe(2);
    const html = root.querySelector('.cv-results')!.innerHTML;
    expect(html).toContain('6.0g');  // 简化制 2钱 = 6g
    expect(html).toContain('7.5g');  // 港台制 2钱 = 7.5g
  });

  it('没填换算人或没加药味时不换算', () => {
    const { root, store } = setup();
    click(root, '.cv-convert');
    expect(store.recordsFor('').length).toBe(0);
    expect(root.querySelectorAll('.cv-record').length).toBe(0);

    setInput(root, '.cv-herb', '白芍');
    setInput(root, '.cv-qian', '2');
    click(root, '.cv-add');
    click(root, '.cv-convert'); // 没填换算人
    expect(root.querySelectorAll('.cv-record').length).toBe(0);
  });
});
