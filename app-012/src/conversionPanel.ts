import { HERBS } from './herbs';
import {
  CONVERSION_RULE_SETS,
  ConversionStore,
  convertPrescription,
  formatOldDosage,
  reduceForChild,
  type ConversionRecord,
  type OldPrescriptionItem,
  type PediatricMethod,
} from './conversion';

const METHOD_LABELS: Record<PediatricMethod, string> = {
  age: '按年龄',
  weight: '按体重',
  conservative: '年龄体重取保守',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 老方子换算面板：旧单位（两/钱/分）整张换算成克，克数与原方并排显示
export class ConversionPanel {
  private store: ConversionStore;
  private items: OldPrescriptionItem[] = [];
  private prescriptionId: string;
  private visible = false;

  constructor(private root: HTMLElement, store?: ConversionStore) {
    this.store = store ?? new ConversionStore('apothecary-conversions-v1');
    this.prescriptionId = ConversionPanel.newId();
    this.buildSkeleton();
    this.bindEvents();
    this.renderItems();
    this.renderResults();
  }

  private static newId(): string {
    return `rx-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('cv-hidden', !this.visible);
    if (this.visible) this.renderResults();
  }

  private el<T extends HTMLElement>(selector: string): T {
    const node = this.root.querySelector<T>(selector);
    if (!node) throw new Error(`面板缺少元素: ${selector}`);
    return node;
  }

  private buildSkeleton(): void {
    this.root.className = 'cv-panel cv-hidden';
    const herbOptions = HERBS.map(h => `<option value="${h.name}"></option>`).join('');
    const ruleOptions = CONVERSION_RULE_SETS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    this.root.innerHTML = `
      <div class="cv-header">
        <span>老方子换算 <small>两 / 钱 / 分 → 克</small></span>
        <button type="button" class="cv-close" title="关闭">×</button>
      </div>
      <div class="cv-section">
        <div class="cv-row">
          <label>方子编号</label>
          <input class="cv-rxid" readonly />
          <button type="button" class="cv-newrx">换一张</button>
        </div>
        <div class="cv-row">
          <input class="cv-herb" list="cv-herblist" placeholder="药名" />
          <datalist id="cv-herblist">${herbOptions}</datalist>
          <input class="cv-liang" type="number" min="0" step="0.5" placeholder="两" title="两" />
          <input class="cv-qian" type="number" min="0" step="0.5" placeholder="钱" title="钱" />
          <input class="cv-fen" type="number" min="0" step="0.5" placeholder="分" title="分" />
          <button type="button" class="cv-add">添加</button>
        </div>
        <div class="cv-items"></div>
      </div>
      <div class="cv-section">
        <div class="cv-row">
          <label>折算关系</label>
          <select class="cv-ruleset">${ruleOptions}</select>
        </div>
        <div class="cv-row">
          <label>换算人</label>
          <input class="cv-operator" placeholder="谁换算的" />
          <button type="button" class="cv-convert">整张换算</button>
        </div>
      </div>
      <div class="cv-section">
        <div class="cv-row">
          <label>小儿</label>
          <input class="cv-age" type="number" min="0" step="0.5" placeholder="年龄(岁)" />
          <input class="cv-weight" type="number" min="0" step="0.5" placeholder="体重(kg)" />
          <select class="cv-method">
            <option value="age">按年龄减</option>
            <option value="weight">按体重减</option>
            <option value="conservative">年龄体重取保守</option>
          </select>
        </div>
        <div class="cv-hint">填好年龄体重后，点换算记录里的「小儿减量」单独出一份减量单。</div>
      </div>
      <div class="cv-results"></div>
    `;
    this.el<HTMLInputElement>('.cv-rxid').value = this.prescriptionId;
  }

  private bindEvents(): void {
    this.el<HTMLButtonElement>('.cv-close').addEventListener('click', () => this.toggle());
    this.el<HTMLButtonElement>('.cv-newrx').addEventListener('click', () => {
      this.prescriptionId = ConversionPanel.newId();
      this.el<HTMLInputElement>('.cv-rxid').value = this.prescriptionId;
      this.items = [];
      this.renderItems();
      this.renderResults();
    });
    this.el<HTMLButtonElement>('.cv-add').addEventListener('click', () => this.addItem());
    this.el<HTMLButtonElement>('.cv-convert').addEventListener('click', () => this.convertAll());

    this.el<HTMLDivElement>('.cv-items').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
      if (btn) {
        this.items.splice(Number(btn.dataset.remove), 1);
        this.renderItems();
      }
    });

    this.el<HTMLDivElement>('.cv-results').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-reduce]');
      if (btn) this.reduceForRecord(btn.dataset.reduce!);
    });
  }

  private addItem(): void {
    const herbInput = this.el<HTMLInputElement>('.cv-herb');
    const num = (sel: string) => {
      const v = parseFloat(this.el<HTMLInputElement>(sel).value);
      return isNaN(v) || v <= 0 ? undefined : v;
    };
    const herb = herbInput.value.trim();
    const dosage = { liang: num('.cv-liang'), qian: num('.cv-qian'), fen: num('.cv-fen') };
    if (!herb) {
      window.alert('请填写药名');
      return;
    }
    if (!dosage.liang && !dosage.qian && !dosage.fen) {
      window.alert('请填写剂量（两 / 钱 / 分至少一项）');
      return;
    }
    this.items.push({ herb, dosage });
    herbInput.value = '';
    this.el<HTMLInputElement>('.cv-liang').value = '';
    this.el<HTMLInputElement>('.cv-qian').value = '';
    this.el<HTMLInputElement>('.cv-fen').value = '';
    herbInput.focus();
    this.renderItems();
  }

  private convertAll(): void {
    const operator = this.el<HTMLInputElement>('.cv-operator').value.trim();
    if (this.items.length === 0) {
      window.alert('请先添加药味');
      return;
    }
    if (!operator) {
      window.alert('请填写换算人');
      return;
    }
    const ruleSetId = this.el<HTMLSelectElement>('.cv-ruleset').value;
    const record = convertPrescription({ id: this.prescriptionId, items: this.items }, ruleSetId, operator);
    this.store.saveRecord(record);
    this.renderResults();

    // 超一天常用量的当场提醒
    const over = record.items.filter(i => i.exceedsDailyLimit);
    if (over.length > 0) {
      window.alert(`注意：${over.map(i => `${i.herb} ${i.grams.toFixed(1)}g`).join('、')} 超出一天常用量，请复核！`);
    }
  }

  private reduceForRecord(recordId: string): void {
    const record = this.store.getRecord(recordId);
    if (!record) return;
    const age = parseFloat(this.el<HTMLInputElement>('.cv-age').value);
    const weight = parseFloat(this.el<HTMLInputElement>('.cv-weight').value);
    if (isNaN(age) || age < 0 || isNaN(weight) || weight <= 0) {
      window.alert('请先填好小儿的年龄和体重');
      return;
    }
    const method = this.el<HTMLSelectElement>('.cv-method').value as PediatricMethod;
    const plan = reduceForChild(record, { ageYears: age, weightKg: weight }, method);
    this.store.savePlan(plan);
    this.renderResults();
  }

  private renderItems(): void {
    const box = this.el<HTMLDivElement>('.cv-items');
    if (this.items.length === 0) {
      box.innerHTML = '<div class="cv-hint">还没有药味，先添加。</div>';
      return;
    }
    box.innerHTML = this.items
      .map((item, i) => `
        <div class="cv-item">
          <span>${escapeHtml(item.herb)} ${formatOldDosage(item.dosage)}</span>
          <button type="button" data-remove="${i}">删除</button>
        </div>`)
      .join('');
  }

  private renderResults(): void {
    const box = this.el<HTMLDivElement>('.cv-results');
    const records = this.store.recordsFor(this.prescriptionId);
    if (records.length === 0) {
      box.innerHTML = '<div class="cv-hint">这张方子还没有换算记录。</div>';
      return;
    }
    box.innerHTML = records.map(r => this.renderRecord(r)).join('');
  }

  private renderRecord(record: ConversionRecord): string {
    const overCount = record.items.filter(i => i.exceedsDailyLimit).length;
    const rows = record.items
      .map(item => {
        const warn = item.exceedsDailyLimit
          ? `<span class="cv-over-text">⚠ 超日用量${item.dailyMaxGrams}g</span>`
          : '';
        return `<tr class="${item.exceedsDailyLimit ? 'cv-over' : ''}">
          <td>${escapeHtml(item.herb)}</td>
          <td>${item.originalText}</td>
          <td><b>${item.grams.toFixed(1)}g</b></td>
          <td>${warn}</td>
        </tr>`;
      })
      .join('');

    const warnBanner = overCount > 0
      ? `<div class="cv-warn">⚠ 有 ${overCount} 味药超出一天常用量，请复核！</div>`
      : '';

    const plans = this.store.plansFor(record.id).map(plan => {
      const planRows = plan.items
        .map(item => `<tr>
          <td>${escapeHtml(item.herb)}</td>
          <td>${item.adultGrams.toFixed(1)}g</td>
          <td><b>${item.reducedGrams.toFixed(1)}g</b></td>
          <td>${item.reducedBy.toFixed(1)}g</td>
          <td>${escapeHtml(item.rule)}</td>
        </tr>`)
        .join('');
      return `<div class="cv-plan">
        <div class="cv-plan-head">小儿减量单（${METHOD_LABELS[plan.method]}）｜${plan.patient.ageYears}岁 ${plan.patient.weightKg}kg｜${formatTime(plan.createdAt)}</div>
        <table>
          <tr><th>药味</th><th>成人量</th><th>小儿量</th><th>已减</th><th>按什么减的</th></tr>
          ${planRows}
        </table>
      </div>`;
    }).join('');

    return `<div class="cv-record">
      <div class="cv-record-head">${escapeHtml(record.ruleSetName)}</div>
      <div class="cv-record-meta">换算人：${escapeHtml(record.operator)} ｜ ${formatTime(record.createdAt)}</div>
      <table>
        <tr><th>药味</th><th>原方</th><th>克数</th><th>提醒</th></tr>
        ${rows}
      </table>
      ${warnBanner}
      <button type="button" class="cv-reduce" data-reduce="${record.id}">小儿减量</button>
      ${plans}
    </div>`;
  }
}
