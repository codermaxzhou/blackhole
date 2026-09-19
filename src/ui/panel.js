// Parameter panel: 21 sliders in 4 groups, live value readouts,
// per-group reset, collapsible.

import { PARAMS, PARAM_GROUPS, PARAM_MAP } from '../core/params.js';

export class Panel {
  constructor(root, { getParam, setParam, onOpenChange }) {
    this.root = root;
    this.getParam = getParam;
    this.setParam = setParam;
    this.onOpenChange = onOpenChange;
    this.inputs = {};
    this._build();
    this._bind();
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'PARAMETERS';
    const close = document.createElement('button');
    close.className = 'panel-close';
    close.textContent = 'ESC';
    close.addEventListener('click', () => this.close());
    head.append(title, close);
    r.appendChild(head);

    const body = document.createElement('div');
    body.className = 'panel-body';
    for (const group of PARAM_GROUPS) {
      const g = document.createElement('div');
      g.className = 'panel-group';
      const ghead = document.createElement('div');
      ghead.className = 'panel-ghead';
      const gl = document.createElement('span');
      gl.textContent = group.label;
      const gr = document.createElement('button');
      gr.className = 'panel-greset';
      gr.textContent = 'reset';
      gr.addEventListener('click', () => {
        for (const p of PARAMS.filter(x => x.group === group.id)) {
          this.setParam(p.key, p.def);
        }
      });
      ghead.append(gl, gr);
      g.appendChild(ghead);

      for (const p of PARAMS.filter(x => x.group === group.id)) {
        const row = document.createElement('div');
        row.className = 'panel-row';
        const lab = document.createElement('label');
        lab.textContent = p.label;
        lab.htmlFor = 'pp-' + p.key.replace(/[^a-z0-9]/gi, '');
        const val = document.createElement('span');
        val.className = 'panel-val';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = 'pp-' + p.key.replace(/[^a-z0-9]/gi, '');
        slider.min = String(p.min);
        slider.max = String(p.max);
        slider.step = String(p.step);
        slider.value = String(this.getParam(p.key));
        slider.setAttribute('aria-label', p.label);
        slider.addEventListener('input', () => {
          this.setParam(p.key, parseFloat(slider.value));
        });
        val.textContent = p.fmt(this.getParam(p.key));
        row.append(lab, val, slider);
        g.appendChild(row);
        this.inputs[p.key] = { slider, val, spec: p };
      }
      body.appendChild(g);
    }
    const foot = document.createElement('div');
    foot.className = 'panel-foot';
    const resetAll = document.createElement('button');
    resetAll.textContent = 'Reset all 21 parameters';
    resetAll.addEventListener('click', () => {
      for (const p of PARAMS) this.setParam(p.key, p.def);
    });
    foot.appendChild(resetAll);
    body.appendChild(foot);
    r.appendChild(body);
  }

  _bind() {
    this.closeBtn = this.root.querySelector('.panel-close');
    this.closeBtn.addEventListener('click', () => this.close());
  }

  refresh(key) {
    const entry = this.inputs[key];
    if (!entry) return;
    const v = this.getParam(key);
    entry.slider.value = String(v);
    entry.val.textContent = entry.spec.fmt(v);
  }

  refreshAll() {
    for (const key of Object.keys(this.inputs)) this.refresh(key);
  }

  open() {
    this.root.classList.add('open');
    this.onOpenChange && this.onOpenChange(true);
  }

  close() {
    this.root.classList.remove('open');
    this.onOpenChange && this.onOpenChange(false);
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }
}
