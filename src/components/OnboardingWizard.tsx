import { useEffect } from 'react';
import { useOnboarding, PRESET_CATALOGUE, VOICE_CATALOGUE } from '../state/onboarding';
import { usePersona } from '../state/persona';
import { type Proactiveness } from '../state/proactiveness';
import { useActivity } from '../state/activity';
import './OnboardingWizard.css';

/**
 * First-run wizard. Five short steps, each narrow and skippable.
 *
 *   0. Welcome          — sets expectations
 *   1. Persona          — pick from 8 presets, name + voice update live
 *   2. Name             — type her name (preset-aligned default)
 *   3. Proactiveness    — 4 bands, choose one + quiet hours
 *   4. Done             — summary, commit
 *
 * The wizard is *blocking*: App.tsx renders only this component until
 * `useOnboarding.completed` flips to true.
 */
export function OnboardingWizard() {
  const choices = useOnboarding();

  const step = choices.step;

  // When `completed` flips true, push the choices into the persona +
  // proactiveness stores. Done here for the case where the wizard stays
  // mounted (reconfigure flow) — App.tsx also calls applyTo() right after
  // the initial commit because the wizard itself unmounts at that point.
  useEffect(() => {
    if (!choices.completed) return;
    useOnboarding.getState().applyTo();
  }, [choices.completed]);

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onb__card">
        <header className="onb__head">
          <div className="onb__brand">
            <span className="onb__mark" aria-hidden />
            <span className="onb__brand-name">LUMO · JARVIS</span>
          </div>
          <div className="onb__progress" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={`onb__dot ${i === step ? 'is-on' : ''} ${i < step ? 'is-done' : ''}`} />
            ))}
          </div>
        </header>

        <main className="onb__body">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepPersona />}
          {step === 2 && <StepName />}
          {step === 3 && <StepProactiveness />}
          {step === 4 && <StepDone />}
        </main>

        <footer className="onb__foot">
          {step > 0 && (
            <button className="onb__btn onb__btn--ghost" onClick={choices.back}>← 上一步</button>
          )}
          <span className="onb__hint">{step + 1} / {STEPS.length} · {STEPS[step]}</span>
          {step < STEPS.length - 1 ? (
            <>
              <button className="onb__btn onb__btn--ghost" onClick={choices.skip} title="使用 Lumina + 晓晓 + 陪伴档 默认">跳过</button>
              <button className="onb__btn onb__btn--primary" onClick={choices.next}>下一步 →</button>
            </>
          ) : (
            <button className="onb__btn onb__btn--primary" onClick={choices.commit}>完成,她到家了</button>
          )}
        </footer>
      </div>
    </div>
  );
}

const STEPS = ['欢迎', '性格', '名字', '节奏', '完成'] as const;

/* ---------------------------------------------- step: welcome */

function PersonaTunables() {
  const tunables = usePersona((s) => s.tunables);
  const setTunable = usePersona((s) => s.setTunable);
  const SLIDERS: { key: 'openness' | 'playfulness' | 'directness'; label: string; left: string; right: string }[] = [
    { key: 'openness',    label: '开放度', left: '惜字如金', right: '见啥说啥' },
    { key: 'playfulness', label: '俏皮度', left: '一本正经', right: '爱开玩笑' },
    { key: 'directness',  label: '直白度', left: '委婉',     right: '直说' },
  ];
  return (
    <div className="onb__tunables">
      <div className="onb__tunables-title label">微调她的人格</div>
      {SLIDERS.map((s) => (
        <div key={s.key} className="onb__tunable">
          <span className="onb__tunable-label">{s.label}</span>
          <span className="onb__tunable-end">{s.left}</span>
          <input
            type="range"
            min={-1} max={1} step={0.05}
            value={tunables[s.key]}
            onChange={(e) => setTunable(s.key, Number(e.target.value))}
          />
          <span className="onb__tunable-end">{s.right}</span>
          <span className="mono onb__tunable-val">
            {tunables[s.key] === 0 ? '0' : (tunables[s.key] > 0 ? '+' : '') + tunables[s.key].toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepWelcome() {
  const isSettings = useOnboarding((s) => s.completed);
  const language = useOnboarding((s) => s.language);
  const setLanguage = useOnboarding((s) => s.setLanguage);
  return (
    <section className="onb__step">
      <h1 id="onb-title" className="onb__h1">
        {isSettings ? '调整一下她的设定。' : '先认识一下。'}
      </h1>
      <p className="onb__lead">
        {isSettings
          ? '你已经选过了。重新走一遍会覆盖你之前的所有选择 —— 包括记忆也会被清空。'
          : '接下来 5 步,大概 1 分钟。你会选她的性格、给她起名、定一下她一天开口的节奏。'}
      </p>
      <ul className="onb__bullets">
        <li><span className="onb__bullet-tag">性格</span> 8 种预设,决定她说话的温度和方式。</li>
        <li><span className="onb__bullet-tag">名字</span> 她回应你时怎么称呼自己。</li>
        <li><span className="onb__bullet-tag">声音</span> M4 接 TTS 时会用上,先选个偏好。</li>
        <li><span className="onb__bullet-tag">节奏</span> 她每天主动开口几次、什么时候安静。</li>
        <li><span className="onb__bullet-tag">{isSettings ? '清空' : '完成'}</span> {isSettings ? '一键清空记忆、活动、提议记录,然后回到默认。' : '之后随时可以从右上角回来调整。'}</li>
      </ul>

      {/* P0-V: language picker on the welcome step. Affects the greeting line. */}
      <div className="onb__lang">
        <span className="onb__lang-label label">问候语言</span>
        <button
          className={`onb__lang-btn ${language === 'zh' ? 'is-on' : ''}`}
          onClick={() => setLanguage('zh')}
        >中文</button>
        <button
          className={`onb__lang-btn ${language === 'en' ? 'is-on' : ''}`}
          onClick={() => setLanguage('en')}
                  >English</button>
                </div>

                {/* P1-G: persona tunables. Shown only in settings mode (reconfigure).
                    The fresh wizard accepts the baseline; tweaking happens later. */}
                {isSettings && <PersonaTunables />}

                {isSettings && (
        <button
          className="onb__btn onb__btn--danger"
          onClick={() => {
            // Reset everything that onboarding owns.
            useOnboarding.getState().reset();
            try { localStorage.removeItem('lumo.memories.v1'); } catch { /* ignore */ }
            // Wipe in-memory stores too.
            const persona = usePersona.getState();
            const memSnap = persona.memories.slice();
            for (const m of memSnap) persona.removeMemory(m.id);
            const propSnap = persona.proposals.slice();
            for (const p of propSnap) persona.dismissProposal(p.id);
            useActivity.getState().clear();
          }}
        >
          清空记忆 & 重新开始
        </button>
      )}
    </section>
  );
}

/* ---------------------------------------------- step: persona */

function StepPersona() {
  const preset = useOnboarding((s) => s.preset);
  const setPreset = useOnboarding((s) => s.setPreset);
  const name = useOnboarding((s) => s.name);
  const voiceId = useOnboarding((s) => s.voiceId);
  const setVoiceId = useOnboarding((s) => s.setVoiceId);

  return (
    <section className="onb__step">
      <h2 className="onb__h2">选一种性格</h2>
      <p className="onb__lead">以后随时换。先选最接近的。</p>
      <div className="onb__grid" role="radiogroup" aria-label="性格预设">
        {PRESET_CATALOGUE.map((p) => (
          <button
            key={p.id}
            className={`onb__preset ${preset === p.id ? 'is-on' : ''}`}
            onClick={() => setPreset(p.id)}
            role="radio"
            aria-checked={preset === p.id}
          >
            <span className="onb__preset-glyph" aria-hidden>{p.emoji}</span>
            <span className="onb__preset-tag">{p.tagline}</span>
            <span className="onb__preset-desc">{p.description}</span>
          </button>
        ))}
      </div>

      <h3 className="onb__h3">声音偏好(M4 上线时用上)</h3>
      <div className="onb__voices">
        {VOICE_CATALOGUE.map((v) => (
          <button
            key={v.id}
            className={`onb__voice ${voiceId === v.id ? 'is-on' : ''}`}
            onClick={() => setVoiceId(v.id)}
          >
            <span className="onb__voice-name">{v.label}</span>
            <span className="onb__voice-tone">{v.tone}</span>
          </button>
        ))}
      </div>
      <p className="onb__preview-line">
        当前选的是 <span className="mono">{name}</span>
        <span className="onb__preview-sep"> · </span>
        <span className="mono">{voiceId}</span>
      </p>
    </section>
  );
}

/* ---------------------------------------------- step: name */

function StepName() {
  const name = useOnboarding((s) => s.name);
  const setName = useOnboarding((s) => s.setName);
  const preset = useOnboarding((s) => s.preset);

  return (
    <section className="onb__step">
      <h2 className="onb__h2">给她起个名字</h2>
      <p className="onb__lead">她会这样介绍自己,也会这样出现在面板上。</p>
      <div className="onb__name-row">
        <input
          className="onb__name-input"
          type="text"
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lumina"
          autoFocus
        />
        <span className="onb__name-count mono">{name.length}/16</span>
      </div>
      <p className="onb__hint-mini">
        建议 1–8 个字。当前性格 <strong className="onb__hint-preset">{PRESET_CATALOGUE.find((p) => p.id === preset)?.tagline ?? preset}</strong> 的默认名是 <span className="mono">{name}</span>。
      </p>
    </section>
  );
}

/* ---------------------------------------------- step: proactiveness */

function StepProactiveness() {
  const band = useOnboarding((s) => s.proactivenessBand);
  const setBand = useOnboarding((s) => s.setProactivenessBand);
  const quietStart = useOnboarding((s) => s.quietStart);
  const quietEnd = useOnboarding((s) => s.quietEnd);
  const setQuietHours = useOnboarding((s) => s.setQuietHours);

  return (
    <section className="onb__step">
      <h2 className="onb__h2">定一下节奏</h2>
      <p className="onb__lead">你什么时候想听她说话,什么时候想清静?</p>
      <div className="onb__bands" role="radiogroup" aria-label="主动性档位">
        {(['silent', 'companion', 'chatty', 'custom'] as Proactiveness[]).map((b) => (
          <button
            key={b}
            className={`onb__band ${band === b ? 'is-on' : ''}`}
            onClick={() => setBand(b)}
            role="radio"
            aria-checked={band === b}
          >
            <span className="onb__band-name">{BAND_LABEL[b]}</span>
            <span className="onb__band-hint">{BAND_HINT[b]}</span>
          </button>
        ))}
      </div>

      <h3 className="onb__h3">安静时段</h3>
      <p className="onb__lead-mini">这段时间她不会主动开口打扰你。默认 22:00 – 次日 8:00。</p>
      <div className="onb__quiet">
        <div className="onb__quiet-row">
          <label className="onb__quiet-label">
            <span className="label">从</span>
            <input
              type="number" min={0} max={23}
              value={quietStart}
              onChange={(e) => setQuietHours(Number(e.target.value), quietEnd)}
              className="onb__quiet-input"
            />
            <span className="onb__quiet-unit">:00</span>
          </label>
          <span className="onb__quiet-sep">→</span>
          <label className="onb__quiet-label">
            <span className="label">到</span>
            <input
              type="number" min={0} max={23}
              value={quietEnd}
              onChange={(e) => setQuietHours(quietStart, Number(e.target.value))}
              className="onb__quiet-input"
            />
            <span className="onb__quiet-unit">:00</span>
          </label>
        </div>
        <QuietBar start={quietStart} end={quietEnd} />
      </div>
    </section>
  );
}

const BAND_LABEL: Record<Proactiveness, string> = {
  silent: '沉默',
  companion: '陪伴',
  chatty: '唠叨',
  custom: '自定义',
};
const BAND_HINT: Record<Proactiveness, string> = {
  silent: '不说话,只在你说时才回。',
  companion: '每天最多 3 次主动提议;22:00–8:00 安静。',
  chatty: '每天最多 6 次主动提议;23:00–7:00 安静。',
  custom: '自己定上限和安静时段。',
};

/** Tiny 24-hour strip showing the quiet window as a dimmer band. */
function QuietBar({ start, end }: { start: number; end: number }) {
  const cells: { h: number; quiet: boolean }[] = [];
  for (let h = 0; h < 24; h++) {
    let quiet = false;
    if (start === end) quiet = false;
    else if (start < end) quiet = h >= start && h < end;
    else quiet = h >= start || h < end;
    cells.push({ h, quiet });
  }
  return (
    <div className="onb__bar" aria-hidden>
      {cells.map(({ h, quiet }) => (
        <span key={h} className={`onb__bar-cell ${quiet ? 'is-quiet' : ''}`} title={`${h}:00`} />
      ))}
    </div>
  );
}

/* ---------------------------------------------- step: done */

function StepDone() {
  const choices = useOnboarding();
  const preset = PRESET_CATALOGUE.find((p) => p.id === choices.preset);

  return (
    <section className="onb__step onb__step--done">
      <div className="onb__done-glyph" aria-hidden>{preset?.emoji ?? '◌'}</div>
      <h2 className="onb__h2">她准备好了。</h2>
      <ul className="onb__summary">
        <li><span className="label">性格</span> <strong>{preset?.tagline ?? choices.preset}</strong></li>
        <li><span className="label">名字</span> <strong>{choices.name}</strong></li>
        <li><span className="label">声音</span> <span className="mono">{choices.voiceId}</span></li>
        <li><span className="label">节奏</span> <strong>{BAND_LABEL[choices.proactivenessBand]}</strong>,安静 {choices.quietStart}:00–{choices.quietEnd}:00</li>
      </ul>
      <p className="onb__lead">
        这些之后都能在右上角的 <kbd>···</kbd> 重新调整。
      </p>
    </section>
  );
}

/** Imperative entry point for the TopBar "reconfigure" button. */
export function openOnboardingAt(step = 0) {
  useOnboarding.getState().reopen(step);
}
export function resetOnboarding() {
  useOnboarding.getState().reset();
}
// Use the default export for the App mount point.
export default OnboardingWizard;
// Keep a hook for the boot side-effect check.
export function useIsOnboarded() {
  return useOnboarding((s) => s.completed);
}