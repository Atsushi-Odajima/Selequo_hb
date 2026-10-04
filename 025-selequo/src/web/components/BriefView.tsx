import type { BriefContent } from '@shared/brief';
import { fmtDate, MustHaveBadge } from './ui';

const Cites = ({ ns }: { ns: number[] }) => (
  <>
    {ns.map((n) => (
      <a key={n} href={`#ev-${n}`} className="muted" style={{ fontSize: 11, verticalAlign: 'super', marginLeft: 1 }}>
        [{n}]
      </a>
    ))}
  </>
);

export function BriefView({ b }: { b: BriefContent }) {
  return (
    <article className="stack" style={{ gap: 18 }} data-testid="brief">
      <header style={{ borderBottom: '3px solid var(--ultra)', paddingBottom: 10 }}>
        <small className="muted">Decision Brief・作成 {fmtDate(b.generatedAt, true)}</small>
        <h2 style={{ fontSize: 22 }}>{b.project.title}</h2>
        {b.project.purpose && <p className="muted">{b.project.purpose}</p>}
      </header>
      <section>
        <h3>判断（User Decision）</h3>
        {b.decision && b.decision.status !== 'draft' ? (
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>選択</dt>
            <dd>
              <b>{b.decision.chosen}</b>
            </dd>
            <dt>理由</dt>
            <dd>{b.decision.reason}</dd>
            <dt>前提</dt>
            <dd>{b.decision.assumptions ?? '-'}</dd>
            <dt>期待する結果</dt>
            <dd>{b.decision.expectedOutcome ?? '-'}</dd>
            <dt>判断者・日時</dt>
            <dd>
              {b.decision.decidedBy}・{fmtDate(b.decision.decidedAt, true)}
            </dd>
            <dt>振り返り予定</dt>
            <dd>{b.decision.reviewDate ?? '-'}</dd>
            {b.decision.actualResult && (
              <>
                <dt>実際の結果</dt>
                <dd>{b.decision.actualResult}</dd>
              </>
            )}
            {b.decision.lessons && (
              <>
                <dt>学び</dt>
                <dd>{b.decision.lessons}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="muted">まだ判断は記録されていません。</p>
        )}
      </section>
      <section>
        <h3>主な違い（Key Differences）</h3>
        {b.keyDifferences.length ? (
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>項目</th>
                  {b.candidates.map((c) => (
                    <th key={c.id}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.keyDifferences.map((k) => (
                  <tr key={k.attribute}>
                    <th>{k.attribute}</th>
                    {k.values.map((v, i) => (
                      <td key={i} className={v.status === 'unknown' ? 'muted' : ''} style={v.status === 'conflict' ? { background: 'var(--warn-50)' } : undefined}>
                        {v.display}
                        {!v.verified && v.status === 'value' && <small className="muted">（未確認）</small>}
                        <Cites ns={v.cites} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">違いのある項目はありません。</p>
        )}
      </section>
      {b.mustHaves.length > 0 && (
        <section>
          <h3>Must-have</h3>
          <ul>
            {b.mustHaves.map((m) => (
              <li key={m.criterion}>
                <b>{m.criterion}</b>：
                {m.results.map((r, i) => (
                  <span key={i} style={{ marginRight: 10 }}>
                    {r.candidate} <MustHaveBadge s={r.status} /> {r.value}
                    <Cites ns={r.cites} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid cols-2">
        <section>
          <h3>Unknown（不足情報）</h3>
          <ul>{b.unknowns.length ? b.unknowns.map((u, i) => <li key={i}>{u.candidate}: {u.attribute}</li>) : <li className="muted">なし</li>}</ul>
        </section>
        <section>
          <h3>Conflict</h3>
          <ul>
            {b.conflicts.length ? (
              b.conflicts.map((c, i) => (
                <li key={i}>
                  {c.candidate} / {c.attribute}: {c.values.join(' vs ')}
                  <Cites ns={c.cites} />
                </li>
              ))
            ) : (
              <li className="muted">なし</li>
            )}
          </ul>
        </section>
      </div>
      <section>
        <h3>Price Snapshot</h3>
        <ul>
          {b.prices.map((p, i) => (
            <li key={i}>
              {p.candidate}: {p.display} <small className="muted">取得 {fmtDate(p.capturedAt, true)}</small>
              <Cites ns={p.cites} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Scenario別の結果</h3>
        {b.scenarioResults.map((s) => (
          <div key={s.scenario} style={{ marginTop: 8 }}>
            <b>{s.scenario}</b>
            <p className="muted" style={{ fontSize: 13 }}>
              {s.statement}
            </p>
          </div>
        ))}
        {b.scenarioResultsDiffer && <p className="callout ok" style={{ marginTop: 8 }}>条件（Scenario）によってスコアが最も高い候補が変わります。</p>}
      </section>
      {b.tradeoffs.length > 0 && (
        <section>
          <h3>Trade-offs</h3>
          <ul>
            {b.tradeoffs.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Evidence（出典）</h3>
        <ol style={{ fontSize: 12 }}>
          {b.evidence.map((e) => (
            <li key={e.n} id={`ev-${e.n}`}>
              {e.candidate} / {e.attribute}: <b>{e.value}</b> — {e.source.url && /^https?:/.test(e.source.url) ? <a href={e.source.url} target="_blank" rel="noopener noreferrer nofollow">{e.source.title ?? e.source.url}</a> : (e.source.title ?? e.source.type)} <span className="muted">（{e.source.quality}・{e.source.locator}・取得 {fmtDate(e.source.retrievedAt)}）</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="muted" style={{ fontSize: 12, borderTop: '1px solid var(--mist)', paddingTop: 10 }}>
        {b.disclaimer}
      </p>
    </article>
  );
}
