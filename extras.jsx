/* extras.jsx — Gallery, Queue, and placeholder views */
function GalleryView({ onOpenMedia }) {
  const [filter, setFilter] = useState('All');
  const types = ['All', 'Video', 'Image', 'Music', 'Sound'];
  const all = [...MEDIA, ...MEDIA.map((m, i) => ({ ...m, id: m.id + 'b', ago: ['6h ago', '1d ago', '2d ago', '3d ago'][i % 4] }))];
  const shown = filter === 'All' ? all : all.filter(m => m.type === filter);
  return (
    <div className="lib fade-up">
      <div className="lib-tabs">
        {types.map(t => <button key={t} className={'type-tab' + (filter === t ? ' on' : '')} style={{ '--ta': 'var(--amber)', height: 40, fontSize: 13.5 }} onClick={() => setFilter(t)}>{t}</button>)}
      </div>
      <div className="recent-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {shown.map((m, i) => (
          <button className="rcard" key={m.id + i} onClick={() => onOpenMedia(m)}>
            <Thumb g={m.g} type={m.type} dur={m.dur} />
            <div className="rc-meta">
              <div style={{ minWidth: 0 }}><div className="rc-title">{m.title}</div><div className="rc-sub">{m.project} · {m.meta}</div></div>
              <div className="rc-ago">{m.ago}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QueueView() {
  const labels = { running: ['Running', 'var(--green)'], waiting: ['Waiting', 'var(--amber)'], done: ['Complete', 'var(--cyan)'], failed: ['Failed', 'var(--rose)'] };
  return (
    <div className="lib fade-up">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {QUEUE.map(q => {
          const st = q.state === 'done' ? 'done' : q.state;
          const [lab, col] = labels[st] || labels.running;
          return (
            <div className="queued-item glass" key={q.id} style={{ marginBottom: 0, gap: 16 }}>
              <Thumb className="qi-thumb" g={q.g} type={q.type} style={{ width: 56, height: 56 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="qi-title">{q.title}</span>
                  <span className="badge" style={{ background: `color-mix(in oklab, ${col} 18%, transparent)`, color: col }}>{lab}</span>
                </div>
                <div className="qi-sub">{q.type} · {q.project} · {q.eta}</div>
                <div className="queued-prog"><i style={{ width: q.pct + '%', background: `linear-gradient(90deg, ${col}, var(--accent-2))` }} /></div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {q.state === 'done'
                  ? <button className="chip"><I.gallery size={15} /> Open</button>
                  : <button className="chip"><I.rerun size={15} /> Retry</button>}
                <button className="lc-act"><I.close size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Placeholder({ view, onBack }) {
  const meta = {
    projects: ['projects', 'Projects', 'Your creative worlds — Rebecca, Internet Dreams, EasyNews — each with memory, assets, and style rules.'],
    flows: ['flows', 'Flows', 'Repeatable creative processes. Chain idea → prompt → generation → gallery into one tap.'],
    analytics: ['analytics', 'Analytics', 'Creative activity at a glance — outputs, prompts saved, favorite styles, and streaks.'],
    settings: ['settings', 'Settings', 'Appearance, default project, providers, and prompt defaults.'],
    integrations: ['integrations', 'Integrations', 'Connect your providers and storage. Cloud-native, quietly in the background.'],
  }[view] || ['portal', 'Coming soon', 'This space is being designed.'];
  const Icon = I[meta[0]];
  return (
    <div className="empty fade-up">
      <div className="empty-orb"><Icon size={40} /></div>
      <h2>{meta[1]}</h2>
      <p>{meta[2]}</p>
      <button className="btn btn-ghost" onClick={onBack}><I.arrow size={17} style={{ transform: 'rotate(180deg)' }} /> Back to Portal</button>
    </div>
  );
}
Object.assign(window, { GalleryView, QueueView, Placeholder });
