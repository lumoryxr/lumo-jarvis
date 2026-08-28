import { useState } from 'react';
import { usePersona } from '../state/persona';
import { useProactiveness, ALL_TRIGGERS, inQuietHours, type Proactiveness } from '../state/proactiveness';
import type { Proposal } from '../core/types';
import './ProactivenessPanel.css';

const TRIGGER_LABEL: Record<Proposal['trigger'], string> = {
  morning: '早上开工',
  idle: '空闲提醒',
  task_done: '任务完成',
  review_due: '需要你拍板',
  metric_anomaly: '异常告警',
  inspiration: '灵感',
  anniversary: '纪念日',
  playful: '小调皮',
};

const TONE_TINT: Record<NonNullable<Proposal['tone']>, string> = {
  matter_of_fact: 'var(--cyan)',
  warm: 'var(--cyan-soft)',
  playful: 'var(--gold)',
  concerned: 'var(--magenta)',
};

/**
 * The right rail's "she has an idea" panel.
 *
 * Surfaces:
 *   - 4-band regulator: silent / companion / chatty / custom
 *   - Daily cap + cooldown editor (only visible in custom)
 *   - Quiet-hours picker
 *   - Per-trigger on/off (only in custom)
 *   - Active proposals the user can approve / dismiss
 *
 * Lives inside TaskBoard so it always rides with the right rail — the
 * widget/compact modes don't show it (the avatar already represents her).
 */
export function ProactivenessPanel() {
  const proposals = usePersona((s) => s.proposals);
  const dismissProposal = usePersona((s) => s.dismissProposal);

  const band = useProactiveness((s) => s.band);
  const config = useProactiveness((s) => s.config);
  const triggerEnabled = useProactiveness((s) => s.triggerEnabled);
  const firedToday = useProactiveness((s) => s.firedToday);
  const setBand = useProactiveness((s) => s.setBand);
  const patchConfig = useProactiveness((s) => s.patchConfig);
  const setTriggerEnabled = useProactiveness((s) => s.setTriggerEnabled);

  const [showSettings, setShowSettings] = useState(false);
  const quiet = inQuietHours(config);

  return (
    <section className="props panel bracketed">
      <header className="props__head">
        <div className="props__title">
          <span className="props__dot" aria-hidden />
          <span className="label">HER THOUGHTS · 她的想法</span>
        </div>
        <div className="props__stats">
          <span className="mono">{proposals.length}</span>
          <span className="props__sep">·</span>
          <span title="今日已发出的提议">
            <span className="mono">{firedToday}</span>/<span className="mono">{config.dailyCap}</span>
          </span>
        </div>
      </header>

      {/* --- band selector ---------------------------------------------- */}
      <div className="props__bands" role="radiogroup" aria-label="主动性档位">
        {(['silent', 'companion', 'chatty'] as Proactiveness[]).map((b) => (
          <button
            key={b}
            className={`props__band ${band === b ? 'is-on' : ''}`}
            onClick={() => setBand(b)}
            aria-pressed={band === b}
            title={BAND_HINT[b]}
          >
            <span className="label">{BAND_LABEL[b]}</span>
          </button>
        ))}
        <button
          className={`props__band props__band--settings ${band === 'custom' ? 'is-on' : ''}`}
          onClick={() => {
            setBand('custom');
            setShowSettings((v) => !v);
          }}
          aria-pressed={band === 'custom'}
          title="自定义"
        >
          <span className="label">···</span>
        </button>
      </div>

      {quiet && (
        <p className="props__quiet">
          安静时段中(到 {config.quietEnd}:00 之前不会再开口)
        </p>
      )}

      {/* --- per-trigger switches (custom only) ------------------------- */}
      {band === 'custom' && showSettings && (
        <div className="props__settings">
          <div className="props__row">
            <span className="label">每日上限</span>
            <input
              type="range" min={0} max={10} step={1}
              value={config.dailyCap}
              onChange={(e) => patchConfig({ dailyCap: Number(e.target.value) })}
            />
            <span className="mono props__num">{config.dailyCap}</span>
          </div>
          <div className="props__row">
            <span className="label">冷却</span>
            <input
              type="range" min={10} max={240} step={10}
              value={config.cooldownMin}
              onChange={(e) => patchConfig({ cooldownMin: Number(e.target.value) })}
            />
            <span className="mono props__num">{config.cooldownMin}m</span>
          </div>
          <div className="props__row">
            <span className="label">安静开始</span>
            <input
              type="number" min={0} max={23}
              value={config.quietStart}
              onChange={(e) => patchConfig({ quietStart: Number(e.target.value) })}
            />
            <span className="label">结束</span>
            <input
              type="number" min={0} max={23}
              value={config.quietEnd}
              onChange={(e) => patchConfig({ quietEnd: Number(e.target.value) })}
            />
          </div>
          <ul className="props__triggers">
            {ALL_TRIGGERS.map((t) => (
              <li key={t} className="props__trigger">
                <label>
                  <input
                    type="checkbox"
                    checked={triggerEnabled[t]}
                    onChange={(e) => setTriggerEnabled(t, e.target.checked)}
                  />
                  <span className="label">{TRIGGER_LABEL[t]}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- active proposals ------------------------------------------ */}
      <ul className="props__list">
        {proposals.length === 0 ? (
          <li className="props__empty">
            {band === 'silent' ? '已静音 — 她不会主动开口。'
              : quiet ? '安静时段中。'
              : '暂时没什么想说的。'}
          </li>
        ) : (
          proposals.map((p) => (
            <li
              key={p.id}
              className="props__item"
              style={{ '--tint': TONE_TINT[p.tone ?? 'matter_of_fact'] } as React.CSSProperties}
            >
              <div className="props__item-head">
                <span className="props__trigger-tag label">{TRIGGER_LABEL[p.trigger]}</span>
                <span className="props__conf mono">{Math.round(p.confidence * 100)}%</span>
              </div>
              <p className="props__reason">{p.reasoning}</p>
              {p.suggestedTask && (
                <div className="props__suggest">
                  <span className="props__suggest-arrow" aria-hidden>→</span>
                  <span className="props__suggest-title">{p.suggestedTask.title}</span>
                </div>
              )}
              <div className="props__item-actions">
                <button className="props__btn is-primary" onClick={() => dismissProposal(p.id)}>
                  {p.suggestedTask ? '考虑下' : '知道了'}
                </button>
                <button className="props__btn" onClick={() => dismissProposal(p.id)}>
                  不用
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
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
  silent: '只在你说话时回应;不主动开口。',
  companion: '每天最多 3 次主动提议;22:00–8:00 安静。',
  chatty: '每天最多 6 次主动提议;23:00–7:00 安静。',
  custom: '自己定上限、冷却、安静时段、每类开关。',
};